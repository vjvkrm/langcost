import type { IngestError } from "@langcost/core";
import { estimateTokenCount } from "@langcost/core";
import type { MessageRecord, SpanRecord, TraceRecord } from "@langcost/db";

import type {
  ClineApiConversationMessage,
  ClineApiRequestUsage,
  ClineModelInfo,
  ClineUiMessage,
  DiscoveredClineTaskFile,
  ReadClineTaskResult,
} from "./types";

type CostSource = "cline" | "taskHistory" | "apiConversationHistory" | "missing" | "zeroStored";

interface UsageRepairResult {
  usage: ClineApiRequestUsage | undefined;
  repaired: boolean;
  costSource?: CostSource;
}

interface PresentUsageRepairResult extends UsageRepairResult {
  usage: ClineApiRequestUsage;
}

interface UsageEvent {
  message: ClineUiMessage;
  messageIndex: number;
  name: string;
  source: string;
  usage: ClineApiRequestUsage;
  costSource?: CostSource;
  repairedFromApiHistory?: boolean;
  apiHistoryMessage?: ClineApiConversationMessage;
  pairedFinishIndex?: number;
}

interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  cacheWrites: number;
  cacheReads: number;
  costUsd: number;
  costSource: CostSource;
  complete: boolean;
}

export interface NormalizedClineTask {
  trace: TraceRecord;
  spans: SpanRecord[];
  messages: MessageRecord[];
  errors: IngestError[];
}

const USAGE_SAY_TYPES = new Set(["api_req_started", "deleted_api_reqs", "subagent_usage"]);

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

function parseJsonObject(text: string | undefined): Record<string, unknown> | undefined {
  if (!text) return undefined;
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function parseUsage(message: ClineUiMessage): ClineApiRequestUsage | undefined {
  if (message.type !== "say" || !message.say || !message.text) return undefined;
  if (!USAGE_SAY_TYPES.has(message.say) && message.say !== "api_req_finished") return undefined;

  const parsed = parseJsonObject(message.text) as ClineApiRequestUsage | undefined;
  if (!parsed) return undefined;

  const hasUsage =
    typeof parsed.tokensIn === "number" ||
    typeof parsed.tokensOut === "number" ||
    typeof parsed.cacheWrites === "number" ||
    typeof parsed.cacheReads === "number" ||
    typeof parsed.cost === "number";

  return hasUsage ? parsed : undefined;
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

function assistantTextMessages(messages: ClineUiMessage[]): Array<{
  message: ClineUiMessage;
  messageIndex: number;
}> {
  return messages
    .map((message, messageIndex) => ({ message, messageIndex }))
    .filter(
      ({ message }) =>
        message.type === "say" &&
        message.say === "text" &&
        typeof message.text === "string" &&
        message.text.length > 0,
    );
}

function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .map((block) => {
      if (!block || typeof block !== "object") return "";
      const candidate = block as { text?: unknown; content?: unknown; type?: unknown };
      if (typeof candidate.text === "string") return candidate.text;
      if (typeof candidate.content === "string") return candidate.content;
      return "";
    })
    .filter((value) => value.length > 0)
    .join("\n");
}

function metricNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function repairUsageFromApiHistory(
  usage: ClineApiRequestUsage,
  apiHistoryMessage: ClineApiConversationMessage | undefined,
): PresentUsageRepairResult {
  const metrics = apiHistoryMessage?.metrics;
  if (!metrics) return { usage, repaired: false };

  const tokens = metrics.tokens;
  const repaired = { ...usage };
  let changed = false;

  if (typeof repaired.tokensIn !== "number") {
    const prompt = metricNumber(tokens?.prompt);
    if (prompt !== undefined) {
      repaired.tokensIn = prompt;
      changed = true;
    }
  }
  if (typeof repaired.tokensOut !== "number") {
    const completion = metricNumber(tokens?.completion);
    if (completion !== undefined) {
      repaired.tokensOut = completion;
      changed = true;
    }
  }
  if (typeof repaired.cacheWrites !== "number") {
    const cacheWrites = metricNumber(tokens?.cacheWrites);
    if (cacheWrites !== undefined) {
      repaired.cacheWrites = cacheWrites;
      changed = true;
    }
  }
  if (typeof repaired.cacheReads !== "number") {
    const cacheReads = metricNumber(tokens?.cacheReads);
    if (cacheReads !== undefined) {
      repaired.cacheReads = cacheReads;
      changed = true;
    }
  }
  if (typeof repaired.cacheWrites !== "number" && typeof repaired.cacheReads !== "number") {
    const cached = metricNumber(tokens?.cached);
    if (cached !== undefined) {
      repaired.cacheReads = cached;
      changed = true;
    }
  }
  if (typeof repaired.cost !== "number") {
    const cost = metricNumber(metrics.cost);
    if (cost !== undefined) {
      repaired.cost = cost;
      changed = true;
    }
  }

  return { usage: repaired, repaired: changed };
}

function usageFromApiHistory(
  apiHistoryMessage: ClineApiConversationMessage | undefined,
): UsageRepairResult {
  const repaired = repairUsageFromApiHistory({}, apiHistoryMessage);
  return repaired.repaired
    ? { usage: repaired.usage, repaired: false, costSource: "apiConversationHistory" }
    : { usage: undefined, repaired: false };
}

function apiHistoryForMessage(
  message: ClineUiMessage,
  usageOrdinal: number,
  apiConversationHistory: ClineApiConversationMessage[],
): ClineApiConversationMessage | undefined {
  if (typeof message.conversationHistoryIndex === "number") {
    const assistantIndex = message.conversationHistoryIndex + 1;
    const candidate = apiConversationHistory[assistantIndex];
    if (candidate?.role === "assistant") return candidate;
    if (candidate?.modelInfo || candidate?.metrics) return candidate;
  }

  return apiConversationHistory.filter((entry) => entry.role === "assistant")[usageOrdinal];
}

function nearbyModelInfo(
  messages: ClineUiMessage[],
  messageIndex: number,
): ClineModelInfo | undefined {
  for (let offset = 0; offset <= 3; offset += 1) {
    const before = messages[messageIndex - offset]?.modelInfo;
    if (before) return before;
    const after = messages[messageIndex + offset]?.modelInfo;
    if (after) return after;
  }
  return undefined;
}

function modelInfoForEvent(
  event: UsageEvent,
  messages: ClineUiMessage[],
): ClineModelInfo | undefined {
  return (
    event.message.modelInfo ??
    event.apiHistoryMessage?.modelInfo ??
    nearbyModelInfo(messages, event.messageIndex)
  );
}

function combineStartedWithLegacyFinish(
  started: ClineUiMessage,
  finished: ClineUiMessage | undefined,
): ClineApiRequestUsage | undefined {
  const startedUsage = parseUsage(started);
  const startedPayload = parseJsonObject(started.text) as ClineApiRequestUsage | undefined;
  const finishedUsage = finished ? parseUsage(finished) : undefined;
  const finishedPayload = finished
    ? (parseJsonObject(finished.text) as ClineApiRequestUsage | undefined)
    : undefined;

  const combined = { ...(startedPayload ?? startedUsage), ...(finishedPayload ?? finishedUsage) };
  return parseUsage({ ...started, text: JSON.stringify(combined) });
}

function collectUsageEvents(
  messages: ClineUiMessage[],
  apiConversationHistory: ClineApiConversationMessage[],
): UsageEvent[] {
  const events: UsageEvent[] = [];
  const pairedFinishIndexes = new Set<number>();
  let apiOrdinal = 0;

  for (const [messageIndex, message] of messages.entries()) {
    if (message.type !== "say") continue;

    if (message.say === "api_req_started") {
      let finishIndex: number | undefined;
      let finishMessage: ClineUiMessage | undefined;
      for (let index = messageIndex + 1; index < messages.length; index += 1) {
        const candidate = messages[index];
        if (candidate?.type === "say" && candidate.say === "api_req_started") break;
        if (candidate?.type === "say" && candidate.say === "api_req_finished") {
          finishIndex = index;
          finishMessage = candidate;
          pairedFinishIndexes.add(index);
          break;
        }
      }

      const apiHistoryMessage = apiHistoryForMessage(message, apiOrdinal, apiConversationHistory);
      const usage = combineStartedWithLegacyFinish(message, finishMessage);
      const repairResult = usage
        ? repairUsageFromApiHistory(usage, apiHistoryMessage)
        : usageFromApiHistory(apiHistoryMessage);
      const repaired = repairResult.usage;
      if (repaired) {
        const event: UsageEvent = {
          message,
          messageIndex,
          name: finishMessage ? "api_req_started+finished" : "api_req_started",
          source: finishMessage ? "api_req_finished" : "api_req_started",
          usage: repaired,
          ...(repairResult.costSource ? { costSource: repairResult.costSource } : {}),
          repairedFromApiHistory: repairResult.repaired,
          ...(apiHistoryMessage ? { apiHistoryMessage } : {}),
          ...(finishIndex !== undefined ? { pairedFinishIndex: finishIndex } : {}),
        };
        events.push(event);
      }
      apiOrdinal += 1;
      continue;
    }

    if (message.say === "api_req_finished" && !pairedFinishIndexes.has(messageIndex)) {
      const usage = parseUsage(message);
      if (usage) {
        const apiHistoryMessage = apiHistoryForMessage(message, apiOrdinal, apiConversationHistory);
        events.push({
          message,
          messageIndex,
          name: "api_req_finished",
          source: "api_req_finished",
          usage,
          ...(apiHistoryMessage ? { apiHistoryMessage } : {}),
        });
        apiOrdinal += 1;
      }
      continue;
    }

    if (message.say === "deleted_api_reqs" || message.say === "subagent_usage") {
      const usage = parseUsage(message);
      if (usage) {
        events.push({
          message,
          messageIndex,
          name: message.say,
          source: message.say,
          usage,
        });
      }
    }
  }

  return events;
}

function totalsFromUsage(
  usage: ClineApiRequestUsage,
  repairedFromApiHistory: boolean,
  costSource?: CostSource,
): UsageTotals {
  const costIsStored = typeof usage.cost === "number";
  return {
    inputTokens: usage.tokensIn ?? 0,
    outputTokens: usage.tokensOut ?? 0,
    cacheWrites: usage.cacheWrites ?? 0,
    cacheReads: usage.cacheReads ?? 0,
    costUsd: usage.cost ?? 0,
    costSource:
      costSource ??
      (costIsStored
        ? usage.cost === 0
          ? "zeroStored"
          : repairedFromApiHistory
            ? "apiConversationHistory"
            : "cline"
        : "missing"),
    complete: usageIsComplete(usage),
  };
}

function addTotals(accumulator: UsageTotals, value: UsageTotals): UsageTotals {
  return {
    inputTokens: accumulator.inputTokens + value.inputTokens,
    outputTokens: accumulator.outputTokens + value.outputTokens,
    cacheWrites: accumulator.cacheWrites + value.cacheWrites,
    cacheReads: accumulator.cacheReads + value.cacheReads,
    costUsd: accumulator.costUsd + value.costUsd,
    costSource: aggregateCostSource([accumulator.costSource, value.costSource], "missing"),
    complete: accumulator.complete && value.complete,
  };
}

function eventConversationIndex(event: UsageEvent): number {
  return event.message.conversationHistoryIndex ?? event.messageIndex;
}

function spanForTextMessage(
  textMessage: ClineUiMessage,
  textMessageIndex: number,
  spanEvents: Array<{ span: SpanRecord; event: UsageEvent }>,
): SpanRecord | undefined {
  if (spanEvents.length === 0) return undefined;

  const textConversationIndex = textMessage.conversationHistoryIndex;
  if (typeof textConversationIndex === "number") {
    const byConversation = [...spanEvents]
      .reverse()
      .find(({ event }) => eventConversationIndex(event) <= textConversationIndex);
    if (byConversation) return byConversation.span;
  }

  if (typeof textMessage.ts === "number") {
    const textTimestamp = textMessage.ts;
    const byTime = [...spanEvents]
      .reverse()
      .find(({ event }) => (event.message.ts ?? 0) <= textTimestamp);
    if (byTime) return byTime.span;
  }

  return (
    [...spanEvents].reverse().find(({ event }) => event.messageIndex <= textMessageIndex)?.span ??
    spanEvents[0]?.span
  );
}

function aggregateCostSource(spanCostSources: CostSource[], fallback: CostSource): CostSource {
  if (spanCostSources.length === 0) return fallback;
  if (spanCostSources.every((source) => source === "cline" || source === "zeroStored")) {
    return spanCostSources.some((source) => source === "cline") ? "cline" : "zeroStored";
  }
  if (spanCostSources.includes("apiConversationHistory")) return "apiConversationHistory";
  if (spanCostSources.includes("taskHistory")) return "taskHistory";
  return "missing";
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

  const apiConversationHistory = readResult.apiConversationHistory ?? [];
  const events = collectUsageEvents(readResult.uiMessages, apiConversationHistory);
  const uiAssistantTextMessages = assistantTextMessages(readResult.uiMessages);
  const hasUiAssistantText = uiAssistantTextMessages.length > 0;
  const spanEvents: Array<{ span: SpanRecord; event: UsageEvent }> = [];
  const spanCostSources: CostSource[] = [];
  let aggregate: UsageTotals = {
    inputTokens: 0,
    outputTokens: 0,
    cacheWrites: 0,
    cacheReads: 0,
    costUsd: 0,
    costSource: "missing",
    complete: true,
  };
  let incompleteSpanData = false;

  for (const [index, event] of events.entries()) {
    const modelInfo = modelInfoForEvent(event, readResult.uiMessages);
    const repaired = event.repairedFromApiHistory
      ? { usage: event.usage, repaired: true }
      : repairUsageFromApiHistory(event.usage, event.apiHistoryMessage);
    const usage = repaired.usage;
    const totals = totalsFromUsage(usage, repaired.repaired, event.costSource);
    const spanId = llmSpanId(taskId, index);
    const provider = parseProvider(modelInfo);
    const model = parseModel(modelInfo, fallbackModel);
    const startedAt = messageTimestamp(event.message, fallbackDate);
    const totalContextTokens =
      totals.inputTokens + totals.outputTokens + totals.cacheWrites + totals.cacheReads;

    if (!totals.complete) incompleteSpanData = true;
    aggregate = addTotals(aggregate, totals);
    spanCostSources.push(totals.costSource);

    const span: SpanRecord = {
      id: spanId,
      traceId: tid,
      parentSpanId: null,
      externalId: `${taskId}:${event.messageIndex}`,
      type: "llm",
      name: event.name,
      startedAt,
      endedAt: startedAt,
      durationMs: null,
      model,
      provider,
      inputTokens: totals.inputTokens,
      outputTokens: totals.outputTokens,
      costUsd: totals.costUsd,
      toolName: null,
      toolInput: null,
      toolOutput: null,
      toolSuccess: null,
      status: "ok",
      errorMessage: null,
      metadata: {
        cacheWrites: totals.cacheWrites,
        cacheReads: totals.cacheReads,
        totalContextTokens,
        costSource: totals.costSource,
        mode: modelInfo?.mode ?? null,
        request: usage.request ?? null,
        source: event.source,
        usageComplete: totals.complete,
        repairedFromApiConversationHistory: repaired.repaired,
        ...(event.pairedFinishIndex !== undefined
          ? { pairedApiReqFinishedMessageIndex: event.pairedFinishIndex }
          : {}),
      },
    };

    spans.push(span);
    spanEvents.push({ span, event });
  }

  const positionBySpanId = new Map<string, number>();
  const firstSpan = spans[0];
  if (firstSpan) {
    const taskMessage = firstNonEmptyText(readResult.uiMessages, "task");
    const taskContent = taskMessage?.text ?? readResult.taskHistoryItem?.task;

    if (taskContent) {
      messages.push({
        id: messageId(firstSpan.id, 0),
        spanId: firstSpan.id,
        traceId: tid,
        role: "user",
        content: taskContent,
        tokenCount: estimateTokenCount(taskContent),
        position: 0,
        metadata: {
          source: taskMessage ? "ui_messages" : "taskHistory",
          ...(taskMessage?.ts ? { timestamp: taskMessage.ts } : {}),
        },
      });
      positionBySpanId.set(firstSpan.id, 1);
    }

    for (const { message, messageIndex } of uiAssistantTextMessages) {
      const span = spanForTextMessage(message, messageIndex, spanEvents) ?? firstSpan;
      const position = positionBySpanId.get(span.id) ?? 0;
      const content = message.text ?? "";
      messages.push({
        id: messageId(span.id, position),
        spanId: span.id,
        traceId: tid,
        role: "assistant",
        content,
        tokenCount: estimateTokenCount(content),
        position,
        metadata: {
          source: "ui_messages",
          messageIndex,
          ...(message.conversationHistoryIndex !== undefined
            ? { conversationHistoryIndex: message.conversationHistoryIndex }
            : {}),
          ...(message.ts ? { timestamp: message.ts } : {}),
        },
      });
      positionBySpanId.set(span.id, position + 1);
    }

    for (const event of events) {
      if (event.apiHistoryMessage?.role !== "assistant") continue;
      if (hasUiAssistantText) break;
      const span = spanEvents.find((candidate) => candidate.event === event)?.span;
      if (!span) continue;
      const content = contentToText(event.apiHistoryMessage.content);
      if (!content) continue;
      const position = positionBySpanId.get(span.id) ?? 0;
      messages.push({
        id: messageId(span.id, position),
        spanId: span.id,
        traceId: tid,
        role: "assistant",
        content,
        tokenCount: estimateTokenCount(content),
        position,
        metadata: {
          source: "apiConversationHistory",
          ...(event.apiHistoryMessage.ts ? { timestamp: event.apiHistoryMessage.ts } : {}),
        },
      });
      positionBySpanId.set(span.id, position + 1);
    }
  }

  const history = readResult.taskHistoryItem;
  let totalInputTokens = aggregate.inputTokens + aggregate.cacheWrites + aggregate.cacheReads;
  let totalOutputTokens = aggregate.outputTokens;
  let totalCostUsd = aggregate.costUsd;
  let totalCacheWrites = aggregate.cacheWrites;
  let totalCacheReads = aggregate.cacheReads;
  let traceCostSource = aggregateCostSource(spanCostSources, aggregate.costSource);

  if ((spans.length === 0 || incompleteSpanData) && history) {
    totalInputTokens = taskHistoryInputTotal(readResult);
    totalOutputTokens = history.tokensOut ?? totalOutputTokens;
    totalCostUsd = history.totalCost ?? totalCostUsd;
    totalCacheWrites = history.cacheWrites ?? totalCacheWrites;
    totalCacheReads = history.cacheReads ?? totalCacheReads;
    traceCostSource = "taskHistory";
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
    ...(history?.cwdOnTaskInitialization ? { sessionKey: history.cwdOnTaskInitialization } : {}),
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
      totalTokensIn: totalInputTokens - totalCacheWrites - totalCacheReads,
      totalTokensOut: totalOutputTokens,
      totalContextTokens: totalInputTokens + totalOutputTokens,
      costSource: traceCostSource,
      hasApiConversationHistory: Array.isArray(readResult.apiConversationHistory),
      incompleteSpanData,
      usageSources: [...new Set(events.map((event) => event.source))],
    },
    ingestedAt: new Date(),
  };

  return { trace, spans, messages, errors };
}
