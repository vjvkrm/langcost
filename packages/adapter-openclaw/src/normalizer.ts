import { calculateCost, estimateTokenCount } from "@langcost/core";
import type {
  IngestError,
  Message,
  Span,
  Trace
} from "@langcost/core";
import type {
  FaultReportRecord,
  IngestionStateRecord,
  MessageRecord,
  SegmentRecord,
  SpanRecord,
  TraceRecord,
  WasteReportRecord
} from "@langcost/db";

import type {
  DiscoveredSessionFile,
  OpenClawAssistantMessage,
  OpenClawCompactionEntry,
  OpenClawContentBlock,
  OpenClawEntry,
  OpenClawMessageEntry,
  OpenClawModelChangeEntry,
  OpenClawSessionEntry,
  OpenClawToolCallBlock,
  OpenClawToolResultMessage,
  OpenClawUsage,
  ReadSessionResult
} from "./types";

export interface NormalizedSession {
  trace: TraceRecord;
  spans: SpanRecord[];
  messages: MessageRecord[];
  errors: IngestError[];
}

function toTraceId(sessionId: string): string {
  return `openclaw:trace:${sessionId}`;
}

function toLlmSpanId(traceId: string, index: number): string {
  return `${traceId}:llm:${index}`;
}

function toToolSpanId(traceId: string, toolCallId: string): string {
  return `${traceId}:tool:${toolCallId}`;
}

function toMessageId(spanId: string, position: number): string {
  return `${spanId}:message:${position}`;
}

function parseTimestamp(value?: string | number | null): Date | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value);
  }

  if (typeof value === "string" && value.length > 0) {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      return new Date(parsed);
    }
  }

  return undefined;
}

function extractEntryTimestamp(entry: OpenClawEntry): Date | undefined {
  if (entry.type === "message") {
    return (
      parseTimestamp(entry.message.timestamp) ??
      parseTimestamp(entry.timestamp)
    );
  }

  return parseTimestamp(entry.timestamp);
}

function flattenContent(content?: OpenClawContentBlock[] | string): string {
  if (typeof content === "string") {
    return content;
  }

  if (!content || content.length === 0) {
    return "";
  }

  return content
    .map((block) => {
      if (block.type === "text") {
        return block.text ?? "";
      }

      if (block.type === "thinking") {
        return block.thinking ?? block.text ?? "";
      }

      if (block.type === "toolCall") {
        return `[tool:${block.name ?? "unknown"}] ${JSON.stringify(block.arguments ?? {})}`;
      }

      if (block.type === "image") {
        return `[image:${block.mimeType ?? block.mediaType ?? "unknown"}]`;
      }

      return "";
    })
    .filter((value) => value.length > 0)
    .join("\n");
}

function extractToolCalls(content?: OpenClawContentBlock[] | string): OpenClawToolCallBlock[] {
  if (!Array.isArray(content)) {
    return [];
  }

  return content.filter((block): block is OpenClawToolCallBlock => block.type === "toolCall");
}

function serializeValue(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}

function getUsageTotals(
  usage: OpenClawUsage | undefined,
  model: string | undefined,
  inputContent: string,
  outputContent: string
) {
  const hasUsage = usage !== undefined;
  const inputTokens = usage?.input ?? estimateTokenCount(inputContent);
  const outputTokens = usage?.output ?? estimateTokenCount(outputContent);

  if (usage?.cost?.total !== undefined) {
    return {
      costUsd: usage.cost.total,
      estimated: !hasUsage
    };
  }

  const calculated = model ? calculateCost(model, inputTokens, outputTokens) : { totalCost: 0 };
  return {
    costUsd: calculated.totalCost,
    estimated: !hasUsage || usage?.cost?.total === undefined
  };
}

function buildMessage(
  spanId: string,
  traceId: string,
  role: Message["role"],
  content: string,
  position: number,
  metadata?: Record<string, unknown>
): MessageRecord {
  return {
    id: toMessageId(spanId, position),
    spanId,
    traceId,
    role,
    content,
    tokenCount: content.length > 0 ? estimateTokenCount(content) : 0,
    position,
    metadata: metadata ?? null
  };
}

export function normalizeSession(
  sessionFile: DiscoveredSessionFile,
  readResult: ReadSessionResult
): NormalizedSession {
  const traceId = toTraceId(sessionFile.sessionId);
  const spans: SpanRecord[] = [];
  const messages: MessageRecord[] = [];
  const errors: IngestError[] = readResult.errors.map((error) => ({
    file: sessionFile.filePath,
    line: error.line,
    message: error.message
  }));

  let sessionHeader: OpenClawSessionEntry | undefined;
  let currentModel: string | undefined;
  let currentProvider: string | undefined;
  let lastActivityAt = sessionFile.modifiedAt;
  let hasError = false;
  let isPartial = errors.length > 0;
  let llmIndex = 0;
  let orphanToolIndex = 0;
  let compactionCount = 0;

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCostUsd = 0;

  let lastLlmSpanId: string | undefined;
  const pendingUserEntries: OpenClawMessageEntry[] = [];
  const toolSpanIdsByCallId = new Map<string, string>();
  const spanIndexesById = new Map<string, number>();
  const positionsBySpanId = new Map<string, number>();

  function nextPosition(spanId: string): number {
    const current = positionsBySpanId.get(spanId) ?? 0;
    positionsBySpanId.set(spanId, current + 1);
    return current;
  }

  function addSpan(span: SpanRecord): void {
    spanIndexesById.set(span.id, spans.length);
    spans.push(span);
  }

  function replaceSpan(span: SpanRecord): void {
    const index = spanIndexesById.get(span.id);
    if (index === undefined) {
      addSpan(span);
      return;
    }

    spans[index] = span;
  }

  for (const entry of readResult.entries) {
    const timestamp = extractEntryTimestamp(entry) ?? lastActivityAt;
    if (timestamp.getTime() > lastActivityAt.getTime()) {
      lastActivityAt = timestamp;
    }

    if (entry.type === "session") {
      sessionHeader = entry;
      currentModel = entry.modelId ?? currentModel;
      currentProvider = entry.provider ?? currentProvider;
      continue;
    }

    if (entry.type === "model_change") {
      const modelChange = entry as OpenClawModelChangeEntry;
      currentModel = modelChange.modelId ?? modelChange.model ?? currentModel;
      currentProvider = modelChange.provider ?? currentProvider;
      continue;
    }

    if (entry.type === "compaction") {
      compactionCount += 1;
      continue;
    }

    if (entry.type !== "message") {
      continue;
    }

    const messageEntry = entry as OpenClawMessageEntry;
    const role = messageEntry.message.role;

    if (role === "user") {
      pendingUserEntries.push(messageEntry);
      continue;
    }

    if (role === "assistant") {
      const assistantMessage = messageEntry.message as OpenClawAssistantMessage;
      const model = assistantMessage.model ?? currentModel ?? sessionHeader?.modelId;
      const provider = assistantMessage.provider ?? currentProvider ?? sessionHeader?.provider;
      const assistantContent = flattenContent(assistantMessage.content);
      const pendingUserContent = pendingUserEntries.map((pending) => flattenContent(pending.message.content)).join("\n");
      const usageTotals = getUsageTotals(assistantMessage.usage, model, pendingUserContent, assistantContent);

      currentModel = model ?? currentModel;
      currentProvider = provider ?? currentProvider;
      llmIndex += 1;
      const spanId = toLlmSpanId(traceId, llmIndex);
      const inputTokens = assistantMessage.usage?.input ?? estimateTokenCount(pendingUserContent);
      const outputTokens = assistantMessage.usage?.output ?? estimateTokenCount(assistantContent);
      const spanStatus = assistantMessage.errorMessage || assistantMessage.stopReason === "error" ? "error" : "ok";

      totalInputTokens += inputTokens;
      totalOutputTokens += outputTokens;
      totalCostUsd += usageTotals.costUsd;

      if (usageTotals.estimated) {
        isPartial = true;
      }

      if (spanStatus === "error") {
        hasError = true;
      }

      addSpan({
        id: spanId,
        traceId,
        parentSpanId: null,
        externalId: `${sessionFile.sessionId}:assistant:${llmIndex}`,
        type: "llm",
        name: "assistant",
        startedAt: timestamp,
        endedAt: timestamp,
        durationMs: 0,
        model: model ?? null,
        provider: provider ?? null,
        inputTokens,
        outputTokens,
        costUsd: usageTotals.costUsd,
        toolName: null,
        toolInput: null,
        toolOutput: null,
        toolSuccess: null,
        status: spanStatus,
        errorMessage: assistantMessage.errorMessage ?? null,
        metadata: {
          api: assistantMessage.api ?? null,
          estimatedUsage: usageTotals.estimated,
          stopReason: assistantMessage.stopReason ?? null
        }
      });

      for (const pendingUserEntry of pendingUserEntries) {
        const userContent = flattenContent(pendingUserEntry.message.content);
        messages.push(
          buildMessage(spanId, traceId, "user", userContent, nextPosition(spanId), {
            timestamp: extractEntryTimestamp(pendingUserEntry)?.toISOString() ?? null
          })
        );
      }

      pendingUserEntries.length = 0;
      messages.push(
        buildMessage(spanId, traceId, "assistant", assistantContent, nextPosition(spanId), {
          api: assistantMessage.api ?? null,
          stopReason: assistantMessage.stopReason ?? null,
          timestamp: timestamp.toISOString()
        })
      );

      for (const toolCall of extractToolCalls(assistantMessage.content)) {
        const toolCallId = toolCall.id ?? `${sessionFile.sessionId}:tool:${++orphanToolIndex}`;
        const toolSpanId = toToolSpanId(traceId, toolCallId);

        toolSpanIdsByCallId.set(toolCallId, toolSpanId);
        addSpan({
          id: toolSpanId,
          traceId,
          parentSpanId: spanId,
          externalId: toolCallId,
          type: "tool",
          name: toolCall.name ?? "tool",
          startedAt: timestamp,
          endedAt: null,
          durationMs: null,
          model: null,
          provider: null,
          inputTokens: null,
          outputTokens: null,
          costUsd: null,
          toolName: toolCall.name ?? null,
          toolInput: serializeValue(toolCall.arguments) ?? null,
          toolOutput: null,
          toolSuccess: null,
          status: "ok",
          errorMessage: null,
          metadata: {
            toolCallId
          }
        });
      }

      lastLlmSpanId = spanId;
      continue;
    }

    if (role === "toolResult") {
      const toolResult = messageEntry.message as OpenClawToolResultMessage;
      const toolCallId = toolResult.toolCallId ?? `orphan:${++orphanToolIndex}`;
      const toolSpanId = toolSpanIdsByCallId.get(toolCallId) ?? toToolSpanId(traceId, toolCallId);
      const existingSpanIndex = spanIndexesById.get(toolSpanId);
      const content = flattenContent(toolResult.content);

      if (existingSpanIndex === undefined) {
        addSpan({
          id: toolSpanId,
          traceId,
          parentSpanId: lastLlmSpanId ?? null,
          externalId: toolCallId,
          type: "tool",
          name: toolResult.toolName ?? "tool",
          startedAt: timestamp,
          endedAt: timestamp,
          durationMs: 0,
          model: null,
          provider: null,
          inputTokens: null,
          outputTokens: null,
          costUsd: null,
          toolName: toolResult.toolName ?? null,
          toolInput: null,
          toolOutput: content,
          toolSuccess: !(toolResult.isError ?? false),
          status: toolResult.isError ? "error" : "ok",
          errorMessage: toolResult.isError ? content || "Tool call failed" : null,
          metadata: toolResult.details ?? null
        });
      } else {
        const existingSpan = spans[existingSpanIndex];
        replaceSpan({
          ...existingSpan,
          endedAt: timestamp,
          durationMs: Math.max(0, timestamp.getTime() - existingSpan.startedAt.getTime()),
          toolOutput: content || existingSpan.toolOutput,
          toolSuccess: !(toolResult.isError ?? false),
          status: toolResult.isError ? "error" : existingSpan.status,
          errorMessage: toolResult.isError ? content || "Tool call failed" : existingSpan.errorMessage,
          metadata: toolResult.details ?? existingSpan.metadata
        });
      }

      if (toolResult.isError) {
        hasError = true;
      }

      if (content.length === 0) {
        isPartial = true;
      }

      messages.push(
        buildMessage(toolSpanId, traceId, "tool", content, nextPosition(toolSpanId), {
          isError: toolResult.isError ?? false,
          timestamp: timestamp.toISOString(),
          toolName: toolResult.toolName ?? null
        })
      );
    }
  }

  if (pendingUserEntries.length > 0) {
    isPartial = true;
  }

  const startedAt =
    parseTimestamp(sessionHeader?.timestamp) ??
    extractEntryTimestamp(readResult.entries[0] ?? { type: "unknown" }) ??
    sessionFile.modifiedAt;

  const trace: TraceRecord = {
    id: traceId,
    externalId: sessionHeader?.id ?? sessionFile.sessionId,
    source: "openclaw",
    sessionKey: sessionHeader?.id ?? sessionFile.sessionId,
    agentId: sessionFile.agentId ?? null,
    startedAt,
    endedAt: lastActivityAt,
    totalInputTokens,
    totalOutputTokens,
    totalCostUsd,
    model: currentModel ?? sessionHeader?.modelId ?? null,
    status: hasError ? "error" : isPartial ? "partial" : "complete",
    metadata: {
      branchedFrom: sessionHeader?.branchedFrom ?? null,
      compactionCount,
      cwd: sessionHeader?.cwd ?? null,
      provider: currentProvider ?? sessionHeader?.provider ?? null,
      sourceFile: sessionFile.filePath,
      thinkingLevel: sessionHeader?.thinkingLevel ?? null
    },
    ingestedAt: new Date()
  };

  return {
    trace,
    spans,
    messages,
    errors
  };
}
