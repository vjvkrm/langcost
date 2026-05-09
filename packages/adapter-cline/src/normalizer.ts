import { estimateTokenCount } from "@langcost/core";
import type { IngestError } from "@langcost/core";
import type { MessageRecord, SpanRecord, TraceRecord } from "@langcost/db";

import type {
  ClineApiRequestUsage,
  ClineModelInfo,
  ClineUiMessage,
  DiscoveredClineTaskFile,
  ReadClineTaskResult,
} from "./types";

export interface NormalizedClineTask {
  trace: TraceRecord;
  spans: SpanRecord[];
  messages: MessageRecord[];
  errors: IngestError[];
}

function traceId(taskId: string): string {
  return `cline:trace:${taskId}`;
}

function llmSpanId(taskId: string, index: number): string {
  return `cline:span:llm:${taskId}:${index}`;
}

function messageId(spanId: string, position: number): string {
  return `${spanId}:msg:${position}`;
}

function messageTimestamp(message: ClineUiMessage, fallback: Date): Date {
  return typeof message.ts === "number" ? new Date(message.ts) : fallback;
}

function parseApiRequestUsage(message: ClineUiMessage): ClineApiRequestUsage | undefined {
  if (message.type !== "say" || message.say !== "api_req_started" || !message.text) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(message.text) as ClineApiRequestUsage;
    const hasUsage =
      typeof parsed.tokensIn === "number" ||
      typeof parsed.tokensOut === "number" ||
      typeof parsed.cacheWrites === "number" ||
      typeof parsed.cacheReads === "number" ||
      typeof parsed.cost === "number";
    return hasUsage ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function parseProvider(modelInfo: ClineModelInfo | undefined): string | undefined {
  return typeof modelInfo?.providerId === "string" && modelInfo.providerId.length > 0
    ? modelInfo.providerId
    : undefined;
}

function parseModel(
  modelInfo: ClineModelInfo | undefined,
  fallbackModel: string | undefined,
): string | undefined {
  return typeof modelInfo?.modelId === "string" && modelInfo.modelId.length > 0
    ? modelInfo.modelId
    : fallbackModel;
}

function countUsageTotal(usage: ClineApiRequestUsage): number {
  return (
    (usage.tokensIn ?? 0) +
    (usage.tokensOut ?? 0) +
    (usage.cacheWrites ?? 0) +
    (usage.cacheReads ?? 0)
  );
}

function usageIsComplete(usage: ClineApiRequestUsage): boolean {
  return (
    typeof usage.tokensIn === "number" &&
    typeof usage.tokensOut === "number" &&
    typeof usage.cacheWrites === "number" &&
    typeof usage.cacheReads === "number" &&
    typeof usage.cost === "number"
  );
}

function taskHistoryInputTotal(readResult: ReadClineTaskResult): number {
  const item = readResult.taskHistoryItem;
  return (item?.tokensIn ?? 0) + (item?.cacheWrites ?? 0) + (item?.cacheReads ?? 0);
}

function latestModel(spans: SpanRecord[], fallback: string | undefined): string | undefined {
  for (let index = spans.length - 1; index >= 0; index -= 1) {
    const model = spans[index]?.model;
    if (model) return model;
  }
  return fallback;
}

function firstNonEmptyText(messages: ClineUiMessage[], say: string): ClineUiMessage | undefined {
  return messages.find(
    (message) => message.type === "say" && message.say === say && typeof message.text === "string",
  );
}

function assistantTextMessages(messages: ClineUiMessage[]): ClineUiMessage[] {
  return messages.filter(
    (message) =>
      message.type === "say" &&
      message.say === "text" &&
      typeof message.text === "string" &&
      message.text.length > 0,
  );
}

export function normalizeTask(
  discovered: DiscoveredClineTaskFile,
  readResult: ReadClineTaskResult,
): NormalizedClineTask {
  const taskId = readResult.taskId;
  const tid = traceId(taskId);
  const fallbackDate = discovered.modifiedAt;
  const fallbackModel = readResult.taskHistoryItem?.modelId;
  const spans: SpanRecord[] = [];
  const messages: MessageRecord[] = [];
  const errors: IngestError[] = readResult.errors.map((error) => ({
    file: readResult.sourceFile,
    ...(error.line ? { line: error.line } : {}),
    message: error.message,
  }));

  let llmIndex = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCacheWrites = 0;
  let totalCacheReads = 0;
  let totalCostUsd = 0;
  let incompleteSpanData = false;

  for (const [messageIndex, message] of readResult.uiMessages.entries()) {
    const usage = parseApiRequestUsage(message);
    if (!usage) {
      if (message.type === "say" && message.say === "api_req_started") {
        incompleteSpanData = true;
      }
      continue;
    }

    const spanId = llmSpanId(taskId, llmIndex);
    const inputTokens = usage.tokensIn ?? 0;
    const outputTokens = usage.tokensOut ?? 0;
    const cacheWrites = usage.cacheWrites ?? 0;
    const cacheReads = usage.cacheReads ?? 0;
    const costUsd = usage.cost ?? 0;
    const provider = parseProvider(message.modelInfo);
    const model = parseModel(message.modelInfo, fallbackModel);
    const startedAt = messageTimestamp(message, fallbackDate);
    const totalContextTokens = countUsageTotal(usage);

    if (!usageIsComplete(usage)) incompleteSpanData = true;

    totalInputTokens += inputTokens + cacheWrites + cacheReads;
    totalOutputTokens += outputTokens;
    totalCacheWrites += cacheWrites;
    totalCacheReads += cacheReads;
    totalCostUsd += costUsd;

    spans.push({
      id: spanId,
      traceId: tid,
      parentSpanId: null,
      externalId: `${taskId}:${messageIndex}`,
      type: "llm",
      name: "api_req_started",
      startedAt,
      endedAt: startedAt,
      durationMs: null,
      model,
      provider,
      inputTokens,
      outputTokens,
      costUsd,
      toolName: null,
      toolInput: null,
      toolOutput: null,
      toolSuccess: null,
      status: "ok",
      errorMessage: null,
      metadata: {
        cacheWrites,
        cacheReads,
        totalContextTokens,
        costSource: typeof usage.cost === "number" ? "cline" : "missing",
        mode: message.modelInfo?.mode ?? null,
        request: usage.request ?? null,
      },
    });

    llmIndex += 1;
  }

  const anchorSpan = spans[0];
  if (anchorSpan) {
    let position = 0;
    const taskMessage = firstNonEmptyText(readResult.uiMessages, "task");
    const taskContent = taskMessage?.text ?? readResult.taskHistoryItem?.task;

    if (taskContent) {
      messages.push({
        id: messageId(anchorSpan.id, position),
        spanId: anchorSpan.id,
        traceId: tid,
        role: "user",
        content: taskContent,
        tokenCount: estimateTokenCount(taskContent),
        position,
        metadata: {
          source: taskMessage ? "ui_messages" : "taskHistory",
          ...(taskMessage?.ts ? { timestamp: taskMessage.ts } : {}),
        },
      });
      position += 1;
    }

    for (const textMessage of assistantTextMessages(readResult.uiMessages)) {
      const content = textMessage.text ?? "";
      messages.push({
        id: messageId(anchorSpan.id, position),
        spanId: anchorSpan.id,
        traceId: tid,
        role: "assistant",
        content,
        tokenCount: estimateTokenCount(content),
        position,
        metadata: {
          source: "ui_messages",
          ...(textMessage.ts ? { timestamp: textMessage.ts } : {}),
        },
      });
      position += 1;
    }
  }

  const history = readResult.taskHistoryItem;
  if (incompleteSpanData || spans.length === 0) {
    totalInputTokens = taskHistoryInputTotal(readResult);
    totalOutputTokens = history?.tokensOut ?? totalOutputTokens;
    totalCostUsd = history?.totalCost ?? totalCostUsd;
    totalCacheWrites = history?.cacheWrites ?? totalCacheWrites;
    totalCacheReads = history?.cacheReads ?? totalCacheReads;
  }

  const startedAt =
    typeof history?.ts === "number"
      ? new Date(history.ts)
      : messageTimestamp(readResult.uiMessages[0] ?? {}, fallbackDate);
  const endedAt = discovered.modifiedAt;
  const traceModel = latestModel(spans, fallbackModel);

  const trace: TraceRecord = {
    id: tid,
    externalId: taskId,
    source: "cline",
    ...(history?.cwdOnTaskInitialization
      ? { sessionKey: history.cwdOnTaskInitialization }
      : {}),
    startedAt,
    endedAt,
    totalInputTokens,
    totalOutputTokens,
    totalCostUsd,
    ...(traceModel ? { model: traceModel } : {}),
    status: errors.length > 0 ? "partial" : "complete",
    metadata: {
      taskId,
      ulid: history?.ulid ?? null,
      sourceFile: readResult.sourceFile,
      cwdOnTaskInitialization: history?.cwdOnTaskInitialization ?? null,
      cacheWrites: totalCacheWrites,
      cacheReads: totalCacheReads,
      totalContextTokens: totalInputTokens + totalOutputTokens,
      costSource: incompleteSpanData || spans.length === 0 ? "taskHistory" : "cline",
      hasApiConversationHistory: Array.isArray(readResult.apiConversationHistory),
    },
    ingestedAt: new Date(),
  };

  return { trace, spans, messages, errors };
}
