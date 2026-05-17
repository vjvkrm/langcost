import { describe, expect, it } from "bun:test";
import { join } from "node:path";

import { normalizeTask } from "../src/normalizer";
import { readTaskFile } from "../src/reader";
import type { ClineUiMessage, DiscoveredClineTaskFile, ReadClineTaskResult } from "../src/types";

const rootPath = join(process.cwd(), "fixtures", "cline", "task-1778305767614");
const filePath = join(rootPath, "tasks", "1778305767614", "ui_messages.json");

function discovered(): DiscoveredClineTaskFile {
  return {
    filePath,
    fileSize: 1,
    modifiedAt: new Date("2026-05-01T00:00:00.000Z"),
    taskId: "1778305767614",
    rootPath,
  };
}

function normalizeInline(
  uiMessages: ClineUiMessage[],
  overrides: Partial<ReadClineTaskResult> = {},
) {
  return normalizeTask(
    {
      filePath: "/tmp/ui_messages.json",
      fileSize: 1,
      modifiedAt: new Date("2026-05-01T00:00:00.000Z"),
      taskId: "inline",
    },
    {
      taskId: "inline",
      sourceFile: "/tmp/ui_messages.json",
      uiMessages,
      lastOffset: 1,
      errors: [],
      ...overrides,
    },
  );
}

describe("normalizeTask", () => {
  it("creates one trace and llm spans from api_req_started messages", async () => {
    const readResult = await readTaskFile(filePath, rootPath);
    const normalized = normalizeTask(discovered(), readResult);

    expect(normalized.trace.id).toBe("cline:trace:1778305767614");
    expect(normalized.trace.source).toBe("cline");
    expect(normalized.spans).toHaveLength(2);
    expect(normalized.spans.every((span) => span.type === "llm")).toBe(true);
  });

  it("preserves OpenRouter provider and model", async () => {
    const readResult = await readTaskFile(filePath, rootPath);
    const normalized = normalizeTask(discovered(), readResult);

    expect(normalized.spans[0]?.provider).toBe("openrouter");
    expect(normalized.spans[0]?.model).toBe("anthropic/claude-sonnet-4.5");
    expect(normalized.trace.model).toBe("anthropic/claude-sonnet-4.5");
  });

  it("uses stored Cline costs instead of recalculating", async () => {
    const readResult = await readTaskFile(filePath, rootPath);
    const normalized = normalizeTask(discovered(), readResult);

    expect(normalized.spans[0]?.costUsd).toBe(0.082773);
    expect(normalized.spans[1]?.costUsd).toBe(0.1443534);
    expect(normalized.trace.totalCostUsd).toBeCloseTo(0.2271264);
  });

  it("preserves cache token metadata and aggregate context totals", async () => {
    const readResult = await readTaskFile(filePath, rootPath);
    const normalized = normalizeTask(discovered(), readResult);

    expect(normalized.spans[0]?.metadata).toMatchObject({
      cacheWrites: 10286,
      cacheReads: 0,
      totalContextTokens: 10476,
    });
    expect(normalized.spans[1]?.metadata).toMatchObject({
      cacheWrites: 12682,
      cacheReads: 49324,
      totalContextTokens: 62668,
    });
    expect(normalized.trace.metadata).toMatchObject({
      cacheWrites: 22968,
      cacheReads: 49324,
      totalContextTokens: 73144,
      costSource: "cline",
    });
    expect(normalized.trace.totalInputTokens + normalized.trace.totalOutputTokens).toBe(73144);
  });

  it("preserves non-OpenRouter provider and model from modelInfo", () => {
    const normalized = normalizeInline([
      {
        ts: 1,
        type: "say",
        say: "api_req_started",
        text: JSON.stringify({
          tokensIn: 10,
          tokensOut: 5,
          cacheWrites: 2,
          cacheReads: 3,
          cost: 0.1,
        }),
        modelInfo: { providerId: "anthropic", modelId: "claude-sonnet-4-5", mode: "act" },
      },
    ]);

    expect(normalized.spans[0]?.provider).toBe("anthropic");
    expect(normalized.spans[0]?.model).toBe("claude-sonnet-4-5");
    expect(normalized.spans[0]?.metadata).toMatchObject({ mode: "act", costSource: "cline" });
  });

  it("includes subagent_usage in trace totals using Cline getApiMetrics semantics", () => {
    const normalized = normalizeInline([
      {
        ts: 1,
        type: "say",
        say: "api_req_started",
        text: JSON.stringify({
          tokensIn: 10,
          tokensOut: 5,
          cacheWrites: 2,
          cacheReads: 3,
          cost: 0.1,
        }),
      },
      {
        ts: 2,
        type: "say",
        say: "subagent_usage",
        text: JSON.stringify({
          source: "subagents",
          tokensIn: 4,
          tokensOut: 7,
          cacheWrites: 1,
          cacheReads: 2,
          cost: 0.04,
        }),
      },
    ]);

    expect(normalized.spans).toHaveLength(2);
    expect(normalized.spans[1]?.name).toBe("subagent_usage");
    expect(normalized.spans[1]?.metadata).toMatchObject({ source: "subagent_usage" });
    expect(normalized.trace.metadata).toMatchObject({
      totalTokensIn: 14,
      totalTokensOut: 12,
      cacheWrites: 3,
      cacheReads: 5,
    });
    expect(normalized.trace.totalInputTokens).toBe(22);
    expect(normalized.trace.totalOutputTokens).toBe(12);
    expect(normalized.trace.totalCostUsd).toBeCloseTo(0.14);
  });

  it("creates synthetic deleted_api_reqs spans and includes their usage", () => {
    const normalized = normalizeInline([
      {
        ts: 1,
        type: "say",
        say: "deleted_api_reqs",
        text: JSON.stringify({
          tokensIn: 20,
          tokensOut: 3,
          cacheWrites: 0,
          cacheReads: 4,
          cost: 0.2,
        }),
      },
    ]);

    expect(normalized.spans).toHaveLength(1);
    expect(normalized.spans[0]?.name).toBe("deleted_api_reqs");
    expect(normalized.spans[0]?.metadata).toMatchObject({ source: "deleted_api_reqs" });
    expect(normalized.trace.totalInputTokens).toBe(24);
    expect(normalized.trace.totalOutputTokens).toBe(3);
    expect(normalized.trace.totalCostUsd).toBe(0.2);
  });

  it("pairs legacy api_req_finished usage with the preceding api_req_started", () => {
    const normalized = normalizeInline([
      {
        ts: 1,
        type: "say",
        say: "api_req_started",
        text: JSON.stringify({ request: "POST /chat/completions" }),
        modelInfo: { providerId: "openai", modelId: "gpt-4.1" },
      },
      {
        ts: 2,
        type: "say",
        say: "api_req_finished",
        text: JSON.stringify({
          tokensIn: 30,
          tokensOut: 10,
          cacheWrites: 0,
          cacheReads: 0,
          cost: 0.3,
        }),
      },
    ]);

    expect(normalized.spans).toHaveLength(1);
    expect(normalized.spans[0]?.name).toBe("api_req_started+finished");
    expect(normalized.spans[0]?.provider).toBe("openai");
    expect(normalized.spans[0]?.metadata).toMatchObject({
      source: "api_req_finished",
      pairedApiReqFinishedMessageIndex: 1,
    });
    expect(normalized.trace.totalInputTokens).toBe(30);
    expect(normalized.trace.totalCostUsd).toBe(0.3);
  });

  it("repairs missing modelInfo and usage from api_conversation_history without double counting", () => {
    const normalized = normalizeInline(
      [
        {
          ts: 1,
          type: "say",
          say: "api_req_started",
          conversationHistoryIndex: 0,
          text: JSON.stringify({ request: "POST /chat/completions", tokensIn: 11 }),
        },
      ],
      {
        apiConversationHistory: [
          { role: "user", content: "hello" },
          {
            role: "assistant",
            content: "hi",
            modelInfo: { providerId: "anthropic", modelId: "claude-3-5-haiku" },
            metrics: { tokens: { prompt: 11, completion: 6, cached: 5 }, cost: 0.01 },
          },
        ],
      },
    );

    expect(normalized.spans).toHaveLength(1);
    expect(normalized.spans[0]?.provider).toBe("anthropic");
    expect(normalized.spans[0]?.model).toBe("claude-3-5-haiku");
    expect(normalized.spans[0]?.metadata).toMatchObject({
      costSource: "apiConversationHistory",
      repairedFromApiConversationHistory: true,
    });
    expect(normalized.trace.totalInputTokens).toBe(16);
    expect(normalized.trace.totalOutputTokens).toBe(6);
    expect(normalized.trace.totalCostUsd).toBe(0.01);
  });

  it("does not mark api_conversation_history-only usage as repaired", () => {
    const normalized = normalizeInline(
      [
        {
          ts: 1,
          type: "say",
          say: "api_req_started",
          conversationHistoryIndex: 0,
          text: JSON.stringify({ request: "POST /chat/completions" }),
        },
      ],
      {
        apiConversationHistory: [
          { role: "user", content: "hello" },
          {
            role: "assistant",
            content: "hi",
            metrics: {
              tokens: { prompt: 11, completion: 6, cacheWrites: 2, cacheReads: 3 },
              cost: 0.01,
            },
          },
        ],
      },
    );

    expect(normalized.spans).toHaveLength(1);
    expect(normalized.spans[0]?.metadata).toMatchObject({
      costSource: "apiConversationHistory",
      repairedFromApiConversationHistory: false,
    });
    expect(normalized.trace.totalInputTokens).toBe(16);
    expect(normalized.trace.totalOutputTokens).toBe(6);
    expect(normalized.trace.totalCostUsd).toBe(0.01);
  });

  it("does not double count api_conversation_history metrics when UI usage is complete", () => {
    const normalized = normalizeInline(
      [
        {
          ts: 1,
          type: "say",
          say: "api_req_started",
          conversationHistoryIndex: 0,
          text: JSON.stringify({
            tokensIn: 10,
            tokensOut: 5,
            cacheWrites: 0,
            cacheReads: 0,
            cost: 0.1,
          }),
        },
      ],
      {
        apiConversationHistory: [
          { role: "user", content: "hello" },
          {
            role: "assistant",
            content: "hi",
            metrics: {
              tokens: { prompt: 99, completion: 99, cacheWrites: 99, cacheReads: 99 },
              cost: 9,
            },
          },
        ],
      },
    );

    expect(normalized.trace.totalInputTokens).toBe(10);
    expect(normalized.trace.totalOutputTokens).toBe(5);
    expect(normalized.trace.totalCostUsd).toBe(0.1);
  });

  it("attaches multi-turn assistant text messages to the nearest LLM span", () => {
    const normalized = normalizeInline([
      {
        ts: 1,
        type: "say",
        say: "api_req_started",
        text: JSON.stringify({
          tokensIn: 10,
          tokensOut: 5,
          cacheWrites: 0,
          cacheReads: 0,
          cost: 0.1,
        }),
      },
      { ts: 2, type: "say", say: "text", text: "first response" },
      {
        ts: 3,
        type: "say",
        say: "api_req_started",
        text: JSON.stringify({
          tokensIn: 4,
          tokensOut: 2,
          cacheWrites: 0,
          cacheReads: 0,
          cost: 0.05,
        }),
      },
      { ts: 4, type: "say", say: "text", text: "second response" },
    ]);

    const assistantMessages = normalized.messages.filter((message) => message.role === "assistant");
    expect(assistantMessages).toHaveLength(2);
    expect(assistantMessages[0]?.spanId).toBe(normalized.spans[0]?.id);
    expect(assistantMessages[1]?.spanId).toBe(normalized.spans[1]?.id);
  });
});
