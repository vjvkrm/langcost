import { describe, expect, it } from "bun:test";

import { normalizeConversation } from "../src/normalizer";
import type {
  WarpBlockRow,
  WarpConversationRow,
  WarpQueryRow,
  WarpTokenUsageEntry,
} from "../src/types";

// ── Builders ──

const CONVERSATION_ID = "4213546a-0000-0000-0000-000000000000";

function aConversation(overrides?: Partial<WarpConversationRow>): WarpConversationRow {
  return {
    conversation_id: CONVERSATION_ID,
    conversation_data: JSON.stringify({
      run_id: "run-1",
      conversation_usage_metadata: {
        credits_spent: 0,
        context_window_usage: 0.05,
        was_summarized: false,
        token_usage: [
          {
            model_id: "Claude Sonnet 4.6",
            warp_tokens: 0,
            byok_tokens: 1000,
            warp_token_usage_by_category: {},
            byok_token_usage_by_category: { primary_agent: 1000 },
          },
        ],
        tool_usage_metadata: { run_command_stats: { count: 1 } },
      },
    }),
    last_modified_at: "2026-03-20 10:00:10",
    ...overrides,
  };
}

function aTokenUsage(overrides?: Partial<WarpTokenUsageEntry>): WarpTokenUsageEntry {
  return {
    model_id: "Claude Sonnet 4.6",
    warp_tokens: 0,
    byok_tokens: 1000,
    warp_token_usage_by_category: {},
    byok_token_usage_by_category: { primary_agent: 1000 },
    ...overrides,
  };
}

function aConversationWithUsage(
  tokenUsage: WarpTokenUsageEntry[],
  creditsSpent = 0,
): WarpConversationRow {
  return aConversation({
    conversation_data: JSON.stringify({
      run_id: "run-1",
      conversation_usage_metadata: {
        credits_spent: creditsSpent,
        context_window_usage: 0.05,
        was_summarized: false,
        token_usage: tokenUsage,
        tool_usage_metadata: { run_command_stats: { count: 1 } },
      },
    }),
  });
}

function anExchange(overrides?: Partial<WarpQueryRow>): WarpQueryRow {
  return {
    exchange_id: "ex-1",
    conversation_id: CONVERSATION_ID,
    start_ts: "2026-03-20 10:00:01",
    input: JSON.stringify([{ Query: { text: "Fix this bug", context: [] } }]),
    output_status: '"Completed"',
    model_id: "claude-4-6-sonnet-high",
    working_directory: "/Users/test/project",
    ...overrides,
  };
}

function aBlock(overrides?: Partial<WarpBlockRow>): WarpBlockRow {
  return {
    block_id: "precmd-1",
    conversation_id: CONVERSATION_ID,
    start_ts: "2026-03-20 10:00:03",
    completed_ts: "2026-03-20 10:00:04",
    exit_code: 0,
    stylized_command: new TextEncoder().encode("git status"),
    stylized_output: new TextEncoder().encode("On branch main"),
    ai_metadata: JSON.stringify({
      requested_command_action_id: "toolu_01",
      conversation_id: CONVERSATION_ID,
      subagent_task_id: null,
    }),
    ...overrides,
  };
}

function ansiEncode(text: string): Uint8Array {
  const ansi = text
    .split("")
    .map((c) => `\x1b[1m${c}\x1b[0m`)
    .join("");
  return new TextEncoder().encode(ansi);
}

// ── Tests ──

describe("normalizeConversation", () => {
  describe("trace", () => {
    it("sets source to warp", () => {
      const { trace } = normalizeConversation(aConversation(), [anExchange()], []);

      expect(trace.source).toBe("warp");
    });

    it("normalizes Warp model ID to langcost pricing alias", () => {
      const { trace } = normalizeConversation(aConversation(), [anExchange()], []);

      expect(trace.model).toBe("claude-sonnet-4-6");
    });

    it("records total tokens from conversation metadata", () => {
      const { trace } = normalizeConversation(aConversation(), [anExchange()], []);

      expect(trace.totalInputTokens).toBe(1000);
    });

    it("status is complete when all exchanges Completed", () => {
      const exchanges = [
        anExchange({ exchange_id: "ex-1", output_status: '"Completed"' }),
        anExchange({ exchange_id: "ex-2", output_status: '"Completed"' }),
      ];
      const { trace } = normalizeConversation(aConversation(), exchanges, []);

      expect(trace.status).toBe("complete");
    });

    it("status is error when any exchange Failed", () => {
      const exchanges = [
        anExchange({ exchange_id: "ex-1", output_status: '"Completed"' }),
        anExchange({ exchange_id: "ex-2", output_status: '"Failed"' }),
      ];
      const { trace } = normalizeConversation(aConversation(), exchanges, []);

      expect(trace.status).toBe("error");
    });

    it("status is error when any block has a non-zero exit code", () => {
      const { trace } = normalizeConversation(
        aConversation(),
        [anExchange()],
        [aBlock({ exit_code: 1 })],
      );

      expect(trace.status).toBe("error");
    });

    it("status is partial when any exchange Cancelled with no errors", () => {
      const exchanges = [
        anExchange({ exchange_id: "ex-1", output_status: '"Completed"' }),
        anExchange({ exchange_id: "ex-2", output_status: '"Cancelled"' }),
      ];
      const { trace } = normalizeConversation(aConversation(), exchanges, []);

      expect(trace.status).toBe("partial");
    });

    it("error takes precedence over partial", () => {
      const exchanges = [
        anExchange({ exchange_id: "ex-1", output_status: '"Failed"' }),
        anExchange({ exchange_id: "ex-2", output_status: '"Cancelled"' }),
      ];
      const { trace } = normalizeConversation(aConversation(), exchanges, []);

      expect(trace.status).toBe("error");
    });

    it("stores tool usage metadata from conversation data", () => {
      const { trace } = normalizeConversation(aConversation(), [anExchange()], []);

      expect(trace.metadata?.toolUsageMetadata).toMatchObject({
        run_command_stats: { count: 1 },
      });
    });

    it("handles malformed conversation_data without throwing", () => {
      const conv = aConversation({ conversation_data: "not-json{{{" });
      const result = normalizeConversation(conv, [], []);

      expect(result.trace.source).toBe("warp");
      expect(result.trace.totalInputTokens).toBe(0);
    });

    it("computes credit and API comparator costs for Warp-billed sessions", () => {
      const { trace } = normalizeConversation(
        aConversationWithUsage(
          [
            aTokenUsage({
              warp_tokens: 1000,
              byok_tokens: 0,
              warp_token_usage_by_category: { primary_agent: 1000 },
              byok_token_usage_by_category: {},
            }),
          ],
          1,
        ),
        [anExchange()],
        [],
      );

      expect(trace.totalCostUsd).toBeCloseTo(0.012, 8);
      expect(trace.metadata?.creditCostUsd).toBeCloseTo(0.012, 8);
      expect(trace.metadata?.apiCostUsd).toBeCloseTo(0.003, 8);
      expect(trace.metadata?.costMarkupPct).toBeCloseTo(300, 8);
      expect(trace.metadata?.billingMode).toBe("credit");
    });

    it("charges only API-equivalent cost for BYOK-only sessions", () => {
      const { trace } = normalizeConversation(
        aConversationWithUsage(
          [
            aTokenUsage({
              warp_tokens: 0,
              byok_tokens: 2000,
              warp_token_usage_by_category: {},
              byok_token_usage_by_category: { primary_agent: 2000 },
            }),
          ],
          0,
        ),
        [anExchange()],
        [],
      );

      expect(trace.totalCostUsd).toBeCloseTo(0.006, 8);
      expect(trace.metadata?.creditCostUsd).toBe(0);
      expect(trace.metadata?.apiCostUsd).toBeCloseTo(0.006, 8);
      expect(trace.metadata?.costMarkupPct).toBeCloseTo(0, 8);
      expect(trace.metadata?.billingMode).toBe("byok");
    });

    it("uses selected warp plan rate for mixed Warp and BYOK sessions", () => {
      const { trace } = normalizeConversation(
        aConversationWithUsage(
          [
            aTokenUsage({
              warp_tokens: 1000,
              byok_tokens: 2000,
              warp_token_usage_by_category: { primary_agent: 1000 },
              byok_token_usage_by_category: { primary_agent: 2000 },
            }),
          ],
          1,
        ),
        [anExchange()],
        [],
        { warpPlan: "business" },
      );

      expect(trace.metadata?.effectiveCreditRateUsd).toBeCloseTo(0.03, 8);
      expect(trace.metadata?.creditCostUsd).toBeCloseTo(0.03, 8);
      expect(trace.metadata?.apiCostUsd).toBeCloseTo(0.009, 8);
      expect(trace.totalCostUsd).toBeCloseTo(0.036, 8);
      expect(trace.metadata?.costMarkupPct).toBeCloseTo(300, 8);
      expect(trace.metadata?.billingMode).toBe("mixed");
    });
  });

  describe("LLM spans", () => {
    it("creates one LLM span per exchange", () => {
      const exchanges = [
        anExchange({ exchange_id: "ex-1" }),
        anExchange({ exchange_id: "ex-2" }),
      ];
      const { spans } = normalizeConversation(aConversation(), exchanges, []);
      const llmSpans = spans.filter((s) => s.type === "llm");

      expect(llmSpans).toHaveLength(2);
    });

    it("normalizes exchange model ID", () => {
      const { spans } = normalizeConversation(aConversation(), [anExchange()], []);
      const llm = spans.find((s) => s.type === "llm");

      expect(llm?.model).toBe("claude-sonnet-4-6");
    });

    it("sets provider to anthropic for a Claude model", () => {
      const { spans } = normalizeConversation(aConversation(), [anExchange()], []);
      const llm = spans.find((s) => s.type === "llm");

      expect(llm?.provider).toBe("anthropic");
    });

    it("sets provider to openai for a GPT model", () => {
      const { spans } = normalizeConversation(
        aConversation(),
        [anExchange({ model_id: "gpt-4.1" })],
        [],
      );
      const llm = spans.find((s) => s.type === "llm");

      expect(llm?.provider).toBe("openai");
    });

    it("sets provider to null for an unrecognised model", () => {
      const { spans } = normalizeConversation(
        aConversation(),
        [anExchange({ model_id: "some-unknown-model" })],
        [],
      );
      const llm = spans.find((s) => s.type === "llm");

      expect(llm?.provider).toBeNull();
    });

    it("marks span ok for Completed — JSON-quoted value", () => {
      const { spans } = normalizeConversation(
        aConversation(),
        [anExchange({ output_status: '"Completed"' })],
        [],
      );
      expect(spans.find((s) => s.type === "llm")?.status).toBe("ok");
    });

    it("marks span error for Failed — JSON-quoted value", () => {
      const { spans } = normalizeConversation(
        aConversation(),
        [anExchange({ output_status: '"Failed"' })],
        [],
      );
      expect(spans.find((s) => s.type === "llm")?.status).toBe("error");
    });

    it("maps Cancelled exchange spans to ok while trace remains partial", () => {
      const { spans } = normalizeConversation(
        aConversation(),
        [anExchange({ output_status: '"Cancelled"' })],
        [],
      );
      expect(spans.find((s) => s.type === "llm")?.status).toBe("ok");
    });

    it("marks span ok for Completed — plain (non-quoted) value (defensive)", () => {
      const { spans } = normalizeConversation(
        aConversation(),
        [anExchange({ output_status: "Completed" })],
        [],
      );
      expect(spans.find((s) => s.type === "llm")?.status).toBe("ok");
    });

    it("sets estimatedTokens flag in span metadata", () => {
      const { spans } = normalizeConversation(aConversation(), [anExchange()], []);
      const llm = spans.find((s) => s.type === "llm");

      expect(llm?.metadata?.estimatedTokens).toBe(true);
    });

    it("stores working directory in span metadata", () => {
      const { spans } = normalizeConversation(
        aConversation(),
        [anExchange({ working_directory: "/Users/test/project" })],
        [],
      );
      const llm = spans.find((s) => s.type === "llm");

      expect(llm?.metadata?.workingDirectory).toBe("/Users/test/project");
    });

    it("stores raw Warp model ID in span metadata", () => {
      const { spans } = normalizeConversation(aConversation(), [anExchange()], []);
      const llm = spans.find((s) => s.type === "llm");

      expect(llm?.metadata?.rawModelId).toBe("claude-4-6-sonnet-high");
    });
  });

  describe("tool spans", () => {
    it("creates one tool span per block with a tool use ID", () => {
      const { spans } = normalizeConversation(
        aConversation(),
        [anExchange()],
        [aBlock({ block_id: "b-1" }), aBlock({ block_id: "b-2", ai_metadata: JSON.stringify({ requested_command_action_id: "toolu_02", conversation_id: CONVERSATION_ID }) })],
      );
      const toolSpans = spans.filter((s) => s.type === "tool");

      expect(toolSpans).toHaveLength(2);
    });

    it("does NOT create a span for a block without requested_command_action_id", () => {
      const noToolIdBlock = aBlock({
        ai_metadata: JSON.stringify({ conversation_id: CONVERSATION_ID }),
      });
      const { spans } = normalizeConversation(
        aConversation(),
        [anExchange()],
        [noToolIdBlock],
      );
      const toolSpans = spans.filter((s) => s.type === "tool");

      expect(toolSpans).toHaveLength(0);
    });

    it("does NOT create a span for a block with invalid ai_metadata JSON", () => {
      const badBlock = aBlock({ ai_metadata: "not-json{{" });
      const { spans } = normalizeConversation(aConversation(), [anExchange()], [badBlock]);
      const toolSpans = spans.filter((s) => s.type === "tool");

      expect(toolSpans).toHaveLength(0);
    });

    it("sets toolSuccess true when exit_code is 0", () => {
      const { spans } = normalizeConversation(
        aConversation(),
        [anExchange()],
        [aBlock({ exit_code: 0 })],
      );
      const tool = spans.find((s) => s.type === "tool");

      expect(tool?.toolSuccess).toBe(true);
      expect(tool?.status).toBe("ok");
    });

    it("sets toolSuccess false when exit_code is non-zero", () => {
      const { spans } = normalizeConversation(
        aConversation(),
        [anExchange()],
        [aBlock({ exit_code: 127 })],
      );
      const tool = spans.find((s) => s.type === "tool");

      expect(tool?.toolSuccess).toBe(false);
      expect(tool?.status).toBe("error");
      expect(tool?.errorMessage).toContain("127");
    });

    it("records exact timing from block timestamps", () => {
      const { spans } = normalizeConversation(
        aConversation(),
        [anExchange()],
        [aBlock({ start_ts: "2026-03-20 10:00:03", completed_ts: "2026-03-20 10:00:05" })],
      );
      const tool = spans.find((s) => s.type === "tool");

      expect(tool?.durationMs).toBe(2000);
    });

    it("strips ANSI escape sequences from toolInput", () => {
      const { spans } = normalizeConversation(
        aConversation(),
        [anExchange()],
        [aBlock({ stylized_command: ansiEncode("git status") })],
      );
      const tool = spans.find((s) => s.type === "tool");

      expect(tool?.toolInput).toBe("git status");
    });

    it("strips ANSI escape sequences from toolOutput", () => {
      const { spans } = normalizeConversation(
        aConversation(),
        [anExchange()],
        [aBlock({ stylized_output: ansiEncode("On branch main") })],
      );
      const tool = spans.find((s) => s.type === "tool");

      expect(tool?.toolOutput).toBe("On branch main");
    });

    it("attributes a block to the exchange immediately preceding it by timestamp", () => {
      const ex1 = anExchange({ exchange_id: "ex-1", start_ts: "2026-03-20 10:00:01" });
      const ex2 = anExchange({ exchange_id: "ex-2", start_ts: "2026-03-20 10:00:10" });
      const block = aBlock({ start_ts: "2026-03-20 10:00:05" }); // between ex-1 and ex-2

      const { spans } = normalizeConversation(aConversation(), [ex1, ex2], [block]);
      const toolSpan = spans.find((s) => s.type === "tool");
      const ex1SpanId = spans.find((s) => s.externalId === "ex-1")?.id;

      expect(toolSpan?.parentSpanId).toBe(ex1SpanId);
    });

    it("does NOT attribute a block to an exchange that starts after it", () => {
      const ex1 = anExchange({ exchange_id: "ex-1", start_ts: "2026-03-20 10:00:10" });
      const block = aBlock({ start_ts: "2026-03-20 10:00:01" }); // before all exchanges

      const { spans } = normalizeConversation(aConversation(), [ex1], [block]);
      const toolSpan = spans.find((s) => s.type === "tool");

      expect(toolSpan?.parentSpanId).toBeNull();
    });

    it("truncates stylized_output exceeding 64KB to prevent DB bloat", () => {
      const bigOutput = new Uint8Array(100_000).fill("x".charCodeAt(0));
      const { spans } = normalizeConversation(
        aConversation(),
        [anExchange()],
        [aBlock({ stylized_output: bigOutput })],
      );
      const tool = spans.find((s) => s.type === "tool");

      expect((tool?.toolOutput?.length ?? 0)).toBeLessThanOrEqual(65_536);
    });

    it("strips OSC escape sequences from toolOutput", () => {
      const osc = "\x1b]0;window title\x07On branch main";
      const { spans } = normalizeConversation(
        aConversation(),
        [anExchange()],
        [aBlock({ stylized_output: new TextEncoder().encode(osc) })],
      );
      const tool = spans.find((s) => s.type === "tool");

      expect(tool?.toolOutput).toBe("On branch main");
    });

    it("sets name to run_command", () => {
      const { spans } = normalizeConversation(aConversation(), [anExchange()], [aBlock()]);
      const tool = spans.find((s) => s.type === "tool");

      expect(tool?.name).toBe("run_command");
      expect(tool?.toolName).toBe("run_command");
    });

    it("stores the Claude tool_use.id as externalId", () => {
      const { spans } = normalizeConversation(aConversation(), [anExchange()], [aBlock()]);
      const tool = spans.find((s) => s.type === "tool");

      expect(tool?.externalId).toBe("toolu_01");
    });
  });

  describe("messages", () => {
    it("creates a user message from Query.text in exchange input", () => {
      const { messages } = normalizeConversation(aConversation(), [anExchange()], []);
      const userMsg = messages.find((m) => m.role === "user");

      expect(userMsg?.content).toBe("Fix this bug");
    });

    it("does NOT create a user message when input has no Query entry", () => {
      const emptyInputExchange = anExchange({ input: "[]" });
      const { messages } = normalizeConversation(
        aConversation(),
        [emptyInputExchange],
        [],
      );
      const userMessages = messages.filter((m) => m.role === "user");

      expect(userMessages).toHaveLength(0);
    });

    it("does NOT create a user message when Query.text is empty", () => {
      const noTextExchange = anExchange({
        input: JSON.stringify([{ Query: { text: "", context: [] } }]),
      });
      const { messages } = normalizeConversation(
        aConversation(),
        [noTextExchange],
        [],
      );
      const userMessages = messages.filter((m) => m.role === "user");

      expect(userMessages).toHaveLength(0);
    });

    it("creates a tool message from block output text", () => {
      const { messages } = normalizeConversation(
        aConversation(),
        [anExchange()],
        [aBlock({ stylized_output: new TextEncoder().encode("On branch main") })],
      );
      const toolMsg = messages.find((m) => m.role === "tool");

      expect(toolMsg?.content).toBe("On branch main");
    });

    it("does NOT create a tool message when block output is empty", () => {
      const { messages } = normalizeConversation(
        aConversation(),
        [anExchange()],
        [aBlock({ stylized_output: null })],
      );
      const toolMessages = messages.filter((m) => m.role === "tool");

      expect(toolMessages).toHaveLength(0);
    });

    it("attaches user message to the correct LLM span", () => {
      const exchange = anExchange({ exchange_id: "ex-abc" });
      const { spans, messages } = normalizeConversation(
        aConversation(),
        [exchange],
        [],
      );
      const llmSpan = spans.find((s) => s.externalId === "ex-abc");
      const userMsg = messages.find((m) => m.role === "user");

      expect(userMsg?.spanId).toBe(llmSpan?.id);
    });

    it("assigns sequential positions to messages on the same span", () => {
      const { messages } = normalizeConversation(
        aConversation(),
        [anExchange()],
        [aBlock()],
      );

      const llmMsg = messages.find((m) => m.role === "user");
      const toolMsg = messages.find((m) => m.role === "tool");

      expect(llmMsg?.position).toBe(0);
      expect(toolMsg?.position).toBe(0);
    });
  });
});
