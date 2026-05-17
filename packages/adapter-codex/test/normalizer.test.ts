import { describe, expect, it } from "bun:test";
import { join } from "node:path";

import { normalizeRollout } from "../src/normalizer";
import { readRolloutFile } from "../src/reader";
import type { DiscoveredRolloutFile } from "../src/types";

function makeRolloutFile(
  fixtureName: string,
  overrides?: Partial<DiscoveredRolloutFile>,
): DiscoveredRolloutFile {
  return {
    filePath: join(process.cwd(), "fixtures", "codex", fixtureName),
    fileSize: 0,
    modifiedAt: new Date("2026-05-17T10:00:00.000Z"),
    rolloutId: overrides?.rolloutId ?? "019d05b8-0a09-7d61-a091-b15f60154601",
    ...overrides,
  };
}

async function normalizeFixture(fixtureName: string, overrides?: Partial<DiscoveredRolloutFile>) {
  const rollout = makeRolloutFile(fixtureName, overrides);
  const readResult = await readRolloutFile(rollout.filePath);
  return normalizeRollout(rollout, readResult);
}

describe("normalizeRollout — simple 2-turn rollout", () => {
  it("creates a complete trace with codex source and session metadata", async () => {
    const result = await normalizeFixture("sample-rollout.jsonl");

    expect(result.trace.source).toBe("codex");
    expect(result.trace.externalId).toBe("019d05b8-0a09-7d61-a091-b15f60154601");
    expect(result.trace.model).toBe("gpt-5.4");
    expect(result.trace.status).toBe("complete");
    expect(result.trace.metadata?.cwd).toBe("/Users/test/project");
    expect(result.trace.metadata?.cliVersion).toBe("0.116.0");
    expect(result.trace.metadata?.dynamicTools).toEqual(["read_thread_terminal"]);
  });

  it("emits one LLM span per token_count round-trip", async () => {
    const result = await normalizeFixture("sample-rollout.jsonl");
    const llmSpans = result.spans.filter((s) => s.type === "llm");

    expect(llmSpans).toHaveLength(2);
    expect(llmSpans[0]?.name).toBe("llm_call");
    expect(llmSpans[0]?.model).toBe("gpt-5.4");
    expect(llmSpans[0]?.provider).toBe("openai");
    expect(llmSpans[0]?.metadata?.turnId).toBe("turn-1");
    expect(llmSpans[1]?.metadata?.turnId).toBe("turn-2");
  });

  it("dedupes assistant text between response_item.message and task_complete.last_agent_message", async () => {
    const result = await normalizeFixture("sample-rollout.jsonl");
    const assistant = result.messages.filter((m) => m.role === "assistant");

    expect(assistant).toHaveLength(2);
    // Exact match — previously the same string was concatenated twice.
    expect(assistant[0]?.content).toBe("Found 2 files: adapter.ts and index.ts.");
    expect(assistant[1]?.content).toBe("I am Codex on GPT-5.4.");
  });

  it("captures user messages from event_msg.user_message", async () => {
    const result = await normalizeFixture("sample-rollout.jsonl");
    const userMessages = result.messages.filter((m) => m.role === "user");
    expect(userMessages.map((m) => m.content)).toEqual([
      "List files in src/",
      "What model are you?",
    ]);
  });

  it("captures the system prompt as the first message of the first LLM span", async () => {
    const result = await normalizeFixture("sample-rollout.jsonl");
    const firstLlm = result.spans.find((s) => s.type === "llm");
    const systemMessages = result.messages.filter((m) => m.role === "system");

    expect(systemMessages).toHaveLength(1);
    expect(systemMessages[0]?.content).toBe("You are Codex, a coding agent based on GPT-5.");
    expect(systemMessages[0]?.spanId).toBe(firstLlm?.id);
    expect(systemMessages[0]?.position).toBe(0);
  });

  it("creates a tool span paired with its function_call_output", async () => {
    const result = await normalizeFixture("sample-rollout.jsonl");
    const toolSpans = result.spans.filter((s) => s.type === "tool");

    expect(toolSpans).toHaveLength(1);
    expect(toolSpans[0]?.toolName).toBe("exec_command");
    expect(toolSpans[0]?.toolInput).toBe('{"cmd":"ls src"}');
    expect(toolSpans[0]?.toolOutput).toBe("adapter.ts\nindex.ts");
    expect(toolSpans[0]?.toolSuccess).toBe(true);
  });

  it("nests the tool span under the LLM round-trip that emitted the call", async () => {
    const result = await normalizeFixture("sample-rollout.jsonl");
    const llmSpan = result.spans.find((s) => s.type === "llm");
    const toolSpan = result.spans.find((s) => s.type === "tool");
    expect(toolSpan?.parentSpanId).toBe(llmSpan?.id);
  });

  it("calculates cost using fresh-input + cache-read semantics", async () => {
    const result = await normalizeFixture("sample-rollout.jsonl");
    // gpt-5.4: $2.5/M input, $15/M output, $0.25/M cached input
    // Turn1: fresh=800, output=85, cached=400 → 0.002 + 0.001275 + 0.0001 = 0.003375
    // Turn2: fresh=200, output=12, cached=300 → 0.0005 + 0.00018 + 0.000075 = 0.000755
    // Total = 0.00413
    expect(result.trace.totalCostUsd).toBeCloseTo(0.00413, 5);
  });

  it("aggregates trace totals across round-trips", async () => {
    const result = await normalizeFixture("sample-rollout.jsonl");
    expect(result.trace.totalInputTokens).toBe(1700);
    expect(result.trace.totalOutputTokens).toBe(97);
    expect(result.trace.metadata?.totalCachedInputTokens).toBe(700);
    expect(result.trace.metadata?.totalReasoningOutputTokens).toBe(50);
  });
});

describe("normalizeRollout — multi-round-trip turn", () => {
  it("emits one LLM span per token_count event within the same turn", async () => {
    const result = await normalizeFixture("multi-roundtrip.jsonl", {
      rolloutId: "019d05b8-1111-7d61-a091-b15f60154601",
    });
    const llmSpans = result.spans.filter((s) => s.type === "llm");

    // 3 token_count events with usage (the leading info:null one is skipped).
    expect(llmSpans).toHaveLength(3);
    expect(new Set(llmSpans.map((s) => s.metadata?.turnId))).toEqual(new Set(["turn-A"]));
    expect(llmSpans.map((s) => s.metadata?.llmCallIndex)).toEqual([1, 2, 3]);
  });

  it("attaches each function_call to the LLM span whose round-trip emitted it", async () => {
    const result = await normalizeFixture("multi-roundtrip.jsonl", {
      rolloutId: "019d05b8-1111-7d61-a091-b15f60154601",
    });
    const llmSpans = result.spans.filter((s) => s.type === "llm");
    const toolSpans = result.spans.filter((s) => s.type === "tool");
    const byId = new Map(llmSpans.map((s, i) => [s.id, i + 1]));

    // call_A1 was emitted during round-trip 1, A2+A3 during round-trip 2.
    const a1 = toolSpans.find((s) => s.externalId === "call_A1");
    const a2 = toolSpans.find((s) => s.externalId === "call_A2");
    const a3 = toolSpans.find((s) => s.externalId === "call_A3");
    expect(a1 && byId.get(a1.parentSpanId ?? "")).toBe(1);
    expect(a2 && byId.get(a2.parentSpanId ?? "")).toBe(2);
    expect(a3 && byId.get(a3.parentSpanId ?? "")).toBe(2);
  });

  it("captures all function_call outputs (no events dropped within a long turn)", async () => {
    const result = await normalizeFixture("multi-roundtrip.jsonl", {
      rolloutId: "019d05b8-1111-7d61-a091-b15f60154601",
    });
    const toolSpans = result.spans.filter((s) => s.type === "tool");

    expect(toolSpans).toHaveLength(3);
    expect(toolSpans.find((s) => s.externalId === "call_A1")?.toolOutput).toBe(
      "adapter.ts\nindex.ts",
    );
    expect(toolSpans.find((s) => s.externalId === "call_A2")?.toolOutput).toBe("// adapter source");
    expect(toolSpans.find((s) => s.externalId === "call_A3")?.toolOutput).toBe("// barrel export");
  });

  it("sums tokens across all round-trips into trace totals", async () => {
    const result = await normalizeFixture("multi-roundtrip.jsonl", {
      rolloutId: "019d05b8-1111-7d61-a091-b15f60154601",
    });
    // last_token_usage: (500 + 800 + 1200) = 2500 input, (30 + 40 + 60) = 130 output
    expect(result.trace.totalInputTokens).toBe(2500);
    expect(result.trace.totalOutputTokens).toBe(130);
    expect(result.trace.metadata?.totalCachedInputTokens).toBe(1300);
    expect(result.trace.status).toBe("complete");
  });
});

describe("normalizeRollout — truncated rollout", () => {
  it("marks status as partial when task_complete never arrives", async () => {
    const result = await normalizeFixture("truncated.jsonl", {
      rolloutId: "019d05b8-2222-7d61-a091-b15f60154601",
    });
    expect(result.trace.status).toBe("partial");
  });

  it("force-flushes a 0-usage LLM span so user input isn't silently dropped", async () => {
    const result = await normalizeFixture("truncated.jsonl", {
      rolloutId: "019d05b8-2222-7d61-a091-b15f60154601",
    });
    const llmSpans = result.spans.filter((s) => s.type === "llm");
    const userMessages = result.messages.filter((m) => m.role === "user");

    expect(llmSpans).toHaveLength(1);
    expect(llmSpans[0]?.inputTokens).toBe(0);
    expect(llmSpans[0]?.outputTokens).toBe(0);
    expect(userMessages.map((m) => m.content)).toEqual(["What can you do?"]);
  });
});
