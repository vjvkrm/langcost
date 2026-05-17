import type { IngestError } from "@langcost/core";
import { calculateCostWithCache, estimateTokenCount } from "@langcost/core";
import type { MessageRecord, SpanRecord, TraceRecord } from "@langcost/db";

import type {
  CodexAgentMessagePayload,
  CodexFunctionCallOutputResponseItem,
  CodexFunctionCallResponseItem,
  CodexMessageResponseItem,
  CodexResponseItemContentBlock,
  CodexRolloutEntry,
  CodexSessionMetaPayload,
  CodexTaskStartedPayload,
  CodexTokenCountPayload,
  CodexTokenUsage,
  CodexTurnContextPayload,
  CodexUserMessagePayload,
  DiscoveredRolloutFile,
  ReadRolloutResult,
} from "./types";

export interface NormalizedRollout {
  trace: TraceRecord;
  spans: SpanRecord[];
  messages: MessageRecord[];
  errors: IngestError[];
}

// ── ID helpers ──

function toTraceId(rolloutId: string): string {
  return `codex:trace:${rolloutId}`;
}

function toLlmSpanId(traceId: string, llmCallIndex: number): string {
  return `${traceId}:llm:${llmCallIndex}`;
}

function toToolSpanId(traceId: string, callId: string): string {
  return `${traceId}:tool:${callId}`;
}

function toMessageId(spanId: string, position: number): string {
  return `${spanId}:message:${position}`;
}

// ── Parsing helpers ──

function parseTimestamp(value?: string): Date | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : new Date(parsed);
}

function flattenBlocks(blocks: CodexResponseItemContentBlock[] | undefined): string {
  if (!Array.isArray(blocks)) return "";
  return blocks
    .map((block) => (typeof block.text === "string" ? block.text : ""))
    .filter(Boolean)
    .join("\n");
}

// OpenAI pricing semantics (per `calculateCostWithCache`):
//   inputCost      = inputTokens         × inputPricePerMToken
//   cacheReadCost  = cacheReadTokens     × cachedInputPricePerMToken
// Codex's `input_tokens` already INCLUDES `cached_input_tokens`, so subtract
// the cached portion before passing to the calculator to avoid double-billing.
function computeCost(model: string | undefined, usage: CodexTokenUsage) {
  const cachedInput = Math.max(0, usage.cached_input_tokens ?? 0);
  const totalInput = Math.max(0, usage.input_tokens ?? 0);
  const freshInput = Math.max(0, totalInput - cachedInput);
  const output = Math.max(0, usage.output_tokens ?? 0);
  const reasoning = Math.max(0, usage.reasoning_output_tokens ?? 0);

  if (!model) {
    return {
      inputTokens: totalInput,
      outputTokens: output,
      cachedInputTokens: cachedInput,
      reasoningOutputTokens: reasoning,
      costUsd: null as number | null,
      inputCostUsd: 0,
      outputCostUsd: 0,
      cacheReadCostUsd: 0,
    };
  }

  const cost = calculateCostWithCache(model, freshInput, output, 0, cachedInput);
  return {
    inputTokens: totalInput,
    outputTokens: output,
    cachedInputTokens: cachedInput,
    reasoningOutputTokens: reasoning,
    costUsd: cost?.totalCost ?? null,
    inputCostUsd: cost?.inputCost ?? 0,
    outputCostUsd: cost?.outputCost ?? 0,
    cacheReadCostUsd: cost?.cacheReadCost ?? 0,
  };
}

function buildMessage(
  spanId: string,
  traceId: string,
  role: "system" | "user" | "assistant" | "tool",
  content: string,
  position: number,
  metadata?: Record<string, unknown>,
): MessageRecord {
  return {
    id: toMessageId(spanId, position),
    spanId,
    traceId,
    role,
    content,
    tokenCount: content.length > 0 ? estimateTokenCount(content) : 0,
    position,
    metadata: metadata ?? null,
  };
}

// Treat trim+equal strings as duplicates so the three sources of assistant text
// (response_item.message / event_msg.agent_message / task_complete.last_agent_message)
// don't get concatenated when Codex echoes the same text.
function dedupeAssistantText(parts: string[]): string {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const part of parts) {
    const normalized = part.trim();
    if (normalized.length === 0 || seen.has(normalized)) continue;
    seen.add(normalized);
    unique.push(normalized);
  }
  return unique.join("\n").trim();
}

// ── Type guards ──

function isSessionMeta(entry: CodexRolloutEntry): entry is CodexRolloutEntry & {
  type: "session_meta";
  payload: CodexSessionMetaPayload;
} {
  return entry.type === "session_meta";
}

function isTurnContext(entry: CodexRolloutEntry): entry is CodexRolloutEntry & {
  type: "turn_context";
  payload: CodexTurnContextPayload;
} {
  return entry.type === "turn_context";
}

function isEventMsg(
  entry: CodexRolloutEntry,
): entry is CodexRolloutEntry & { type: "event_msg"; payload: { type: string } } {
  return entry.type === "event_msg";
}

function isResponseItem(
  entry: CodexRolloutEntry,
): entry is CodexRolloutEntry & { type: "response_item"; payload: { type: string } } {
  return entry.type === "response_item";
}

// ── Main normalizer ──

// Event model (verified against real ~/.codex rollouts):
//   task_started ─┐
//                 │  reasoning, message, function_call(s), token_count(usage)   ← 1 LLM round-trip
//                 │  function_call_output(s) — arrive AFTER the token_count
//                 │  reasoning, message, function_call(s), token_count(usage)   ← next round-trip
//                 │  function_call_output(s)
//                 │  ... (repeats)
//   task_complete ┘
//
// One LLM span per token_count event with `info.last_token_usage` set.
// Tool spans are children of the LLM span whose round-trip emitted the call.
// Function-call outputs that arrive AFTER the round-trip flush attach to the
// existing tool span by call_id.
export function normalizeRollout(
  rolloutFile: DiscoveredRolloutFile,
  readResult: ReadRolloutResult,
): NormalizedRollout {
  const traceId = toTraceId(rolloutFile.rolloutId);
  const spans: SpanRecord[] = [];
  const messages: MessageRecord[] = [];
  const errors: IngestError[] = readResult.errors.map((error) => ({
    file: rolloutFile.filePath,
    line: error.line,
    message: error.message,
  }));

  // Session-level
  let sessionStart: Date | undefined;
  let sessionEnd: Date | undefined;
  let provider = "openai";
  let systemPrompt: string | undefined;
  let cwd: string | undefined;
  let cliVersion: string | undefined;
  let dynamicTools: string[] = [];

  // Turn-level
  let currentModel: string | undefined;
  let currentTurnId: string | undefined;
  let currentTurnStartedAt: Date | undefined;
  let turnIndex = 0;
  let hasOpenTurn = false;

  // Round-trip-level (resets after each token_count flush)
  let roundTripStartedAt: Date | undefined;
  let llmCallIndex = 0;
  let pendingFunctionCalls: CodexFunctionCallResponseItem[] = [];
  let pendingAssistantText: string[] = [];
  const pendingUserContent: string[] = [];

  // call_id → tool span id, used to attach outputs that arrive after the round-trip flush
  const toolSpanIdByCallId = new Map<string, string>();
  // call_id → LLM span id, so we can preserve parent on retroactive output updates
  const positionsBySpanId = new Map<string, number>();

  // Trace-level totals
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCostUsd = 0;
  let totalCachedInputTokens = 0;
  let totalReasoningOutputTokens = 0;
  let totalInputCostUsd = 0;
  let totalOutputCostUsd = 0;
  let totalCacheReadCostUsd = 0;
  let wasForceFlushed = false;

  function nextPosition(spanId: string): number {
    const current = positionsBySpanId.get(spanId) ?? 0;
    positionsBySpanId.set(spanId, current + 1);
    return current;
  }

  function emitLlmRoundTrip(eventTime: Date, usage: CodexTokenUsage | undefined): void {
    if (!currentTurnId) return; // token_count outside of any turn — drop

    const startedAt = roundTripStartedAt ?? currentTurnStartedAt ?? eventTime;
    llmCallIndex += 1;
    const spanId = toLlmSpanId(traceId, llmCallIndex);

    const cost = computeCost(currentModel, usage ?? { input_tokens: 0, output_tokens: 0 });
    totalInputTokens += cost.inputTokens;
    totalOutputTokens += cost.outputTokens;
    totalCachedInputTokens += cost.cachedInputTokens;
    totalReasoningOutputTokens += cost.reasoningOutputTokens;
    totalCostUsd += cost.costUsd ?? 0;
    totalInputCostUsd += cost.inputCostUsd;
    totalOutputCostUsd += cost.outputCostUsd;
    totalCacheReadCostUsd += cost.cacheReadCostUsd;

    spans.push({
      id: spanId,
      traceId,
      parentSpanId: null,
      externalId: `${rolloutFile.rolloutId}:llm:${llmCallIndex}`,
      type: "llm",
      name: "llm_call",
      startedAt,
      endedAt: eventTime,
      durationMs: Math.max(0, eventTime.getTime() - startedAt.getTime()),
      model: currentModel ?? null,
      provider,
      inputTokens: cost.inputTokens,
      outputTokens: cost.outputTokens,
      costUsd: cost.costUsd,
      toolName: null,
      toolInput: null,
      toolOutput: null,
      toolSuccess: null,
      status: "ok",
      errorMessage: null,
      metadata: {
        turnId: currentTurnId,
        turnIndex,
        llmCallIndex,
        cachedInputTokens: cost.cachedInputTokens,
        reasoningOutputTokens: cost.reasoningOutputTokens,
        inputCostUsd: cost.inputCostUsd,
        outputCostUsd: cost.outputCostUsd,
        cacheReadCostUsd: cost.cacheReadCostUsd,
      },
    });

    // Attach buffered user input (only relevant on the first round-trip of a turn).
    for (const text of pendingUserContent) {
      messages.push(
        buildMessage(spanId, traceId, "user", text, nextPosition(spanId), {
          timestamp: startedAt.toISOString(),
        }),
      );
    }
    pendingUserContent.length = 0;

    // Attach assistant text, deduped across the three event sources.
    const assistantText = dedupeAssistantText(pendingAssistantText);
    if (assistantText.length > 0) {
      messages.push(
        buildMessage(spanId, traceId, "assistant", assistantText, nextPosition(spanId), {
          timestamp: eventTime.toISOString(),
        }),
      );
    }

    // Create tool spans for function_calls emitted during this round-trip.
    for (const fnCall of pendingFunctionCalls) {
      const toolSpanId = toToolSpanId(traceId, fnCall.call_id);
      toolSpanIdByCallId.set(fnCall.call_id, toolSpanId);
      spans.push({
        id: toolSpanId,
        traceId,
        parentSpanId: spanId,
        externalId: fnCall.call_id,
        type: "tool",
        name: fnCall.name,
        startedAt: eventTime,
        endedAt: null,
        durationMs: null,
        model: null,
        provider: null,
        inputTokens: null,
        outputTokens: null,
        costUsd: null,
        toolName: fnCall.name,
        toolInput: fnCall.arguments,
        toolOutput: null,
        toolSuccess: null,
        status: "ok",
        errorMessage: null,
        metadata: { callId: fnCall.call_id, turnId: currentTurnId, llmCallIndex },
      });
    }

    pendingFunctionCalls = [];
    pendingAssistantText = [];
    // Next round-trip starts right after this token_count fires.
    roundTripStartedAt = eventTime;
  }

  function applyToolOutput(item: CodexFunctionCallOutputResponseItem, eventTime: Date): void {
    const toolSpanId = toolSpanIdByCallId.get(item.call_id);
    if (toolSpanId) {
      const index = spans.findIndex((s) => s.id === toolSpanId);
      const existing = index >= 0 ? spans[index] : undefined;
      if (existing) {
        spans[index] = {
          ...existing,
          endedAt: eventTime,
          durationMs: Math.max(0, eventTime.getTime() - existing.startedAt.getTime()),
          toolOutput: item.output,
          toolSuccess: true,
        };
        messages.push(
          buildMessage(toolSpanId, traceId, "tool", item.output, nextPosition(toolSpanId), {
            timestamp: eventTime.toISOString(),
          }),
        );
        return;
      }
    }

    // Output without a matching call (or before any round-trip emitted) — orphan it.
    const orphanSpanId = toToolSpanId(traceId, item.call_id);
    spans.push({
      id: orphanSpanId,
      traceId,
      parentSpanId: null,
      externalId: item.call_id,
      type: "tool",
      name: "tool",
      startedAt: eventTime,
      endedAt: eventTime,
      durationMs: 0,
      model: null,
      provider: null,
      inputTokens: null,
      outputTokens: null,
      costUsd: null,
      toolName: null,
      toolInput: null,
      toolOutput: item.output,
      toolSuccess: true,
      status: "ok",
      errorMessage: null,
      metadata: { callId: item.call_id, orphan: true, turnId: currentTurnId ?? null },
    });
    messages.push(
      buildMessage(orphanSpanId, traceId, "tool", item.output, nextPosition(orphanSpanId), {
        timestamp: eventTime.toISOString(),
      }),
    );
  }

  for (const entry of readResult.entries) {
    const eventTime = parseTimestamp(entry.timestamp);
    if (!eventTime) continue;

    if (!sessionStart || eventTime.getTime() < sessionStart.getTime()) sessionStart = eventTime;
    if (!sessionEnd || eventTime.getTime() > sessionEnd.getTime()) sessionEnd = eventTime;

    if (isSessionMeta(entry)) {
      const payload = entry.payload;
      provider = payload.model_provider ?? provider;
      systemPrompt = payload.base_instructions?.text ?? systemPrompt;
      cwd = payload.cwd ?? cwd;
      cliVersion = payload.cli_version ?? cliVersion;
      dynamicTools = (payload.dynamic_tools ?? []).map((tool) => tool.name);
      continue;
    }

    if (isTurnContext(entry)) {
      currentModel =
        entry.payload.collaboration_mode?.settings?.model ?? entry.payload.model ?? currentModel;
      continue;
    }

    if (isEventMsg(entry)) {
      const payload = entry.payload;

      if (payload.type === "task_started") {
        const started = payload as CodexTaskStartedPayload;
        currentTurnId = started.turn_id;
        currentTurnStartedAt = eventTime;
        roundTripStartedAt = eventTime;
        turnIndex += 1;
        hasOpenTurn = true;
        continue;
      }

      if (payload.type === "task_complete") {
        // task_complete arrives AFTER the final token_count, so the assistant text
        // was already captured during the round-trip flush via response_item.message
        // or agent_message. `last_agent_message` is intentionally ignored — using it
        // as a fallback caused cross-turn leaks because it appends to the buffer that
        // belongs to the *next* turn, not the one just closed.
        hasOpenTurn = false;
        currentTurnId = undefined;
        currentTurnStartedAt = undefined;
        continue;
      }

      if (payload.type === "token_count") {
        const tokenCount = payload as CodexTokenCountPayload;
        const usage = tokenCount.info?.last_token_usage;
        // Many real rollouts emit a leading token_count with info=null before any model
        // work has happened. Skip those — they're not LLM round-trips.
        if (!usage) continue;
        emitLlmRoundTrip(eventTime, usage);
        continue;
      }

      if (payload.type === "user_message") {
        const userMsg = payload as CodexUserMessagePayload;
        if (userMsg.message && userMsg.message.trim().length > 0) {
          pendingUserContent.push(userMsg.message);
        }
        continue;
      }

      if (payload.type === "agent_message") {
        const agentMsg = payload as CodexAgentMessagePayload;
        if (agentMsg.message && agentMsg.message.trim().length > 0) {
          pendingAssistantText.push(agentMsg.message);
        }
        continue;
      }

      continue;
    }

    if (isResponseItem(entry)) {
      const payload = entry.payload;

      if (payload.type === "function_call") {
        pendingFunctionCalls.push(payload as CodexFunctionCallResponseItem);
        continue;
      }

      if (payload.type === "function_call_output") {
        applyToolOutput(payload as CodexFunctionCallOutputResponseItem, eventTime);
        continue;
      }

      if (payload.type === "message") {
        const message = payload as CodexMessageResponseItem;
        const text = flattenBlocks(message.content);
        if (text.length === 0) continue;
        if (message.role === "user") {
          pendingUserContent.push(text);
        } else if (message.role === "assistant") {
          pendingAssistantText.push(text);
        }
        // developer/system: captured at session_meta — skip duplicates.
      }

      // reasoning / web_search_call — accounted for via reasoning_output_tokens in usage.
    }
  }

  // Truncated rollout (no final task_complete + token_count): force a partial flush
  // so the in-flight work isn't silently dropped, and mark the trace as partial.
  if (hasOpenTurn && currentTurnId && currentTurnStartedAt) {
    wasForceFlushed = true;
    emitLlmRoundTrip(sessionEnd ?? currentTurnStartedAt, undefined);
    hasOpenTurn = false;
    currentTurnId = undefined;
    currentTurnStartedAt = undefined;
  }

  // Attach the system prompt as the first message of the first LLM span, if any.
  if (systemPrompt && spans.length > 0) {
    const firstLlm = spans.find((span) => span.type === "llm");
    if (firstLlm) {
      const onSpan = messages.filter((m) => m.spanId === firstLlm.id);
      const others = messages.filter((m) => m.spanId !== firstLlm.id);
      const reindexed = onSpan.map((m, i) => ({
        ...m,
        position: i + 1,
        id: toMessageId(firstLlm.id, i + 1),
      }));
      const systemMessage = buildMessage(firstLlm.id, traceId, "system", systemPrompt, 0, {
        source: "session_meta.base_instructions",
      });
      messages.length = 0;
      messages.push(systemMessage, ...reindexed, ...others);
    }
  }

  const startedAt = sessionStart ?? rolloutFile.modifiedAt;
  const endedAt = sessionEnd ?? rolloutFile.modifiedAt;

  const trace: TraceRecord = {
    id: traceId,
    externalId: rolloutFile.rolloutId,
    source: "codex",
    startedAt,
    endedAt,
    totalInputTokens,
    totalOutputTokens,
    totalCostUsd,
    ...(currentModel ? { model: currentModel } : {}),
    status: errors.length > 0 || wasForceFlushed ? "partial" : "complete",
    metadata: {
      cwd: cwd ?? null,
      cliVersion: cliVersion ?? null,
      dynamicTools,
      totalCachedInputTokens,
      totalReasoningOutputTokens,
      totalInputCostUsd,
      totalOutputCostUsd,
      totalCacheReadCostUsd,
      sourceFile: rolloutFile.filePath,
    },
    ingestedAt: new Date(),
  };

  return { trace, spans, messages, errors };
}
