import type { SpanRecord, WasteReportRecord } from "@langcost/db";

import { getSpanCost, getSpanTotalTokens } from "../context";
import { createWasteReport, severityFromCost } from "./shared";
import type { WasteRule } from "./types";

const RETRY_WINDOW_MS = 5 * 60 * 1000;

// For shell tool calls (Bash, run_command, etc.) the toolInput holds a command — either
// raw or as JSON ({command:"..."}). Extract the leading executable token so we can compare
// "npm test" to "npm test 2>&1" without false-matching unrelated Bash calls.
function getCommandFirstToken(toolInput: string | null | undefined): string | null {
  if (!toolInput) return null;
  let command = toolInput;
  try {
    const parsed = JSON.parse(toolInput);
    if (parsed && typeof parsed === "object" && typeof (parsed as { command?: unknown }).command === "string") {
      command = (parsed as { command: string }).command;
    }
  } catch {}
  const trimmed = command.trim();
  if (trimmed.length === 0) return null;
  return trimmed.split(/\s+/)[0] ?? null;
}

// A tool failure is only "waste" if the agent had to spend additional model work recovering.
// Recovery looks like: a later tool span of the same tool name within RETRY_WINDOW_MS, and —
// for shell tools — sharing the same command first token. Without this, the failure was
// almost certainly an intentional signal (e.g., `grep -c` exit 1 = "no matches found").
function hasRetryEvidence(failedSpan: SpanRecord, toolSpans: SpanRecord[]): boolean {
  const failedAt = failedSpan.startedAt.getTime();
  const failedToken = getCommandFirstToken(failedSpan.toolInput);

  return toolSpans.some((candidate) => {
    if (candidate.id === failedSpan.id) return false;
    if (candidate.toolName !== failedSpan.toolName) return false;

    const startedAt = candidate.startedAt.getTime();
    if (startedAt <= failedAt) return false;
    if (startedAt - failedAt > RETRY_WINDOW_MS) return false;

    if (failedToken !== null) {
      const candidateToken = getCommandFirstToken(candidate.toolInput);
      return candidateToken === failedToken;
    }

    return true;
  });
}

export const toolFailuresRule: WasteRule = {
  name: "tool-failures",
  tier: 1,
  detect(contexts): WasteReportRecord[] {
    return contexts.flatMap((context) => {
      const candidateFailures = context.toolSpans.filter(
        (span) => span.status === "error" || span.toolSuccess === false,
      );

      if (candidateFailures.length === 0) {
        return [];
      }

      const failedToolSpans = candidateFailures.filter((span) =>
        hasRetryEvidence(span, context.toolSpans),
      );

      if (failedToolSpans.length === 0) {
        return [];
      }

      const spansById = new Map(context.spans.map((span) => [span.id, span]));
      const failedParentSpans = failedToolSpans
        .map((span) => (span.parentSpanId ? spansById.get(span.parentSpanId) : undefined))
        .filter((span): span is NonNullable<typeof span> => span !== undefined);

      const retryLlmSpanIds = new Set<string>();
      for (const failedToolSpan of failedToolSpans) {
        const nextLlmSpan = context.llmSpans.find(
          (span) =>
            span.startedAt.getTime() > failedToolSpan.startedAt.getTime() &&
            span.id !== failedToolSpan.parentSpanId,
        );

        if (nextLlmSpan) {
          retryLlmSpanIds.add(nextLlmSpan.id);
        }
      }

      const retryLlmSpans = [...retryLlmSpanIds]
        .map((spanId) => spansById.get(spanId))
        .filter((span): span is NonNullable<typeof span> => span !== undefined);

      const wastedSpans = [...failedParentSpans, ...retryLlmSpans];
      const wastedCostUsd = wastedSpans.reduce((total, span) => total + getSpanCost(span), 0);
      const wastedTokens = wastedSpans.reduce((total, span) => total + getSpanTotalTokens(span), 0);
      const firstFailedToolSpan = failedToolSpans[0];

      return [
        createWasteReport({
          traceId: context.trace.id,
          ...(firstFailedToolSpan ? { spanId: firstFailedToolSpan.id } : {}),
          category: "tool_failure_waste",
          severity: severityFromCost(wastedCostUsd),
          wastedTokens,
          wastedCostUsd,
          description: `${failedToolSpans.length} tool call(s) failed and triggered additional model work in this trace.`,
          recommendation: `Inspect the failing tool paths and error handling. These failures cost about $${wastedCostUsd.toFixed(4)} in this trace.`,
          evidence: {
            failedToolSpanIds: failedToolSpans.map((span) => span.id),
            retryLlmSpanIds: retryLlmSpans.map((span) => span.id),
            ignoredFailureCount: candidateFailures.length - failedToolSpans.length,
          },
        }),
      ];
    });
  },
};
