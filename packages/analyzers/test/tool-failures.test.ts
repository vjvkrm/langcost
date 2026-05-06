import { describe, expect, it } from "bun:test";
import type { SpanRecord, TraceRecord } from "@langcost/db";

import { buildTraceContext } from "../src/context";
import { toolFailuresRule } from "../src/rules/tool-failures";

const TRACE_ID = "trace-test";

function makeTrace(): TraceRecord {
  const now = new Date("2026-05-06T10:00:00Z");
  return {
    id: TRACE_ID,
    externalId: "ext-1",
    source: "test",
    sessionKey: "session-1",
    startedAt: now,
    endedAt: now,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCostUsd: 0,
    model: "claude-sonnet-4-6",
    status: "complete",
    metadata: {},
    ingestedAt: now,
  };
}

function makeLlmSpan(id: string, startMinutes: number, costUsd = 0.01): SpanRecord {
  const startedAt = new Date(`2026-05-06T10:${String(startMinutes).padStart(2, "0")}:00Z`);
  return {
    id,
    traceId: TRACE_ID,
    parentSpanId: null,
    externalId: id,
    type: "llm",
    name: "assistant",
    startedAt,
    endedAt: startedAt,
    durationMs: null,
    model: "claude-sonnet-4-6",
    provider: "anthropic",
    inputTokens: 100,
    outputTokens: 50,
    costUsd,
    toolName: null,
    toolInput: null,
    toolOutput: null,
    toolSuccess: null,
    status: "ok",
    errorMessage: null,
    metadata: null,
  };
}

interface ToolSpanInit {
  id: string;
  startMinutes: number;
  parentSpanId: string;
  toolName: string;
  command: string;
  failed?: boolean;
}

function makeToolSpan(init: ToolSpanInit): SpanRecord {
  const startedAt = new Date(`2026-05-06T10:${String(init.startMinutes).padStart(2, "0")}:00Z`);
  const failed = init.failed ?? false;
  return {
    id: init.id,
    traceId: TRACE_ID,
    parentSpanId: init.parentSpanId,
    externalId: init.id,
    type: "tool",
    name: init.toolName,
    startedAt,
    endedAt: startedAt,
    durationMs: 0,
    model: null,
    provider: null,
    inputTokens: null,
    outputTokens: null,
    costUsd: null,
    toolName: init.toolName,
    toolInput: JSON.stringify({ command: init.command }),
    toolOutput: null,
    toolSuccess: !failed,
    status: failed ? "error" : "ok",
    errorMessage: failed ? "exit 1" : null,
    metadata: null,
  };
}

function runRule(spans: SpanRecord[]) {
  const context = buildTraceContext(makeTrace(), spans, [], []);
  return toolFailuresRule.detect([context]);
}

describe("toolFailuresRule — recovery evidence requirement", () => {
  it("flags a real failure when the same command is retried within the window", () => {
    const reports = runRule([
      makeLlmSpan("llm-1", 1),
      makeToolSpan({
        id: "tool-1",
        startMinutes: 2,
        parentSpanId: "llm-1",
        toolName: "Bash",
        command: "npm test 2>&1",
        failed: true,
      }),
      makeLlmSpan("llm-2", 3),
      makeToolSpan({
        id: "tool-2",
        startMinutes: 4,
        parentSpanId: "llm-2",
        toolName: "Bash",
        command: "npm test",
      }),
    ]);

    expect(reports).toHaveLength(1);
    expect(reports[0]?.category).toBe("tool_failure_waste");
    const evidence = reports[0]?.evidence as Record<string, unknown>;
    expect(evidence.failedToolSpanIds).toEqual(["tool-1"]);
    expect(evidence.ignoredFailureCount).toBe(0);
  });

  it("ignores intentional non-zero exits when the agent moves on to a different tool", () => {
    const reports = runRule([
      makeLlmSpan("llm-1", 1),
      makeToolSpan({
        id: "tool-1",
        startMinutes: 2,
        parentSpanId: "llm-1",
        toolName: "Bash",
        command: "grep -c 'error TS' build.log",
        failed: true,
      }),
      makeLlmSpan("llm-2", 3),
      makeToolSpan({
        id: "tool-2",
        startMinutes: 4,
        parentSpanId: "llm-2",
        toolName: "Read",
        command: "/path/to/some-file.ts",
      }),
    ]);

    expect(reports).toHaveLength(0);
  });

  it("ignores Bash failure when next Bash uses a different binary (no retry)", () => {
    const reports = runRule([
      makeLlmSpan("llm-1", 1),
      makeToolSpan({
        id: "tool-1",
        startMinutes: 2,
        parentSpanId: "llm-1",
        toolName: "Bash",
        command: "grep -c 'error TS' build.log",
        failed: true,
      }),
      makeLlmSpan("llm-2", 3),
      makeToolSpan({
        id: "tool-2",
        startMinutes: 4,
        parentSpanId: "llm-2",
        toolName: "Bash",
        command: "ls -la",
      }),
    ]);

    expect(reports).toHaveLength(0);
  });

  it("ignores a failure with no follow-up at all", () => {
    const reports = runRule([
      makeLlmSpan("llm-1", 1),
      makeToolSpan({
        id: "tool-1",
        startMinutes: 2,
        parentSpanId: "llm-1",
        toolName: "Bash",
        command: "test -f /nope",
        failed: true,
      }),
    ]);

    expect(reports).toHaveLength(0);
  });

  it("ignores retries that arrive after the 5-minute window", () => {
    const reports = runRule([
      makeLlmSpan("llm-1", 1),
      makeToolSpan({
        id: "tool-1",
        startMinutes: 2,
        parentSpanId: "llm-1",
        toolName: "Bash",
        command: "npm test",
        failed: true,
      }),
      makeLlmSpan("llm-2", 10),
      makeToolSpan({
        id: "tool-2",
        startMinutes: 12,
        parentSpanId: "llm-2",
        toolName: "Bash",
        command: "npm test",
      }),
    ]);

    expect(reports).toHaveLength(0);
  });

  it("counts only the failures with retry evidence in mixed traces", () => {
    const reports = runRule([
      makeLlmSpan("llm-1", 1),
      makeToolSpan({
        id: "tool-real",
        startMinutes: 2,
        parentSpanId: "llm-1",
        toolName: "Bash",
        command: "npm test",
        failed: true,
      }),
      makeToolSpan({
        id: "tool-signal",
        startMinutes: 3,
        parentSpanId: "llm-1",
        toolName: "Bash",
        command: "grep -c 'foo' file.txt",
        failed: true,
      }),
      makeLlmSpan("llm-2", 4),
      makeToolSpan({
        id: "tool-retry",
        startMinutes: 5,
        parentSpanId: "llm-2",
        toolName: "Bash",
        command: "npm test --watchAll=false",
      }),
    ]);

    expect(reports).toHaveLength(1);
    const evidence = reports[0]?.evidence as Record<string, unknown>;
    expect(evidence.failedToolSpanIds).toEqual(["tool-real"]);
    expect(evidence.ignoredFailureCount).toBe(1);
  });

  it("treats Read failures as waste when the same file is read again (signal-vs-failure agnostic for non-shell)", () => {
    const reports = runRule([
      makeLlmSpan("llm-1", 1),
      {
        id: "read-1",
        traceId: TRACE_ID,
        parentSpanId: "llm-1",
        externalId: "read-1",
        type: "tool",
        name: "Read",
        startedAt: new Date("2026-05-06T10:02:00Z"),
        endedAt: new Date("2026-05-06T10:02:00Z"),
        durationMs: 0,
        model: null,
        provider: null,
        inputTokens: null,
        outputTokens: null,
        costUsd: null,
        toolName: "Read",
        toolInput: null,
        toolOutput: null,
        toolSuccess: false,
        status: "error",
        errorMessage: "ENOENT",
        metadata: null,
      },
      makeLlmSpan("llm-2", 3),
      {
        id: "read-2",
        traceId: TRACE_ID,
        parentSpanId: "llm-2",
        externalId: "read-2",
        type: "tool",
        name: "Read",
        startedAt: new Date("2026-05-06T10:04:00Z"),
        endedAt: new Date("2026-05-06T10:04:00Z"),
        durationMs: 0,
        model: null,
        provider: null,
        inputTokens: null,
        outputTokens: null,
        costUsd: null,
        toolName: "Read",
        toolInput: null,
        toolOutput: null,
        toolSuccess: true,
        status: "ok",
        errorMessage: null,
        metadata: null,
      },
    ]);

    expect(reports).toHaveLength(1);
  });
});
