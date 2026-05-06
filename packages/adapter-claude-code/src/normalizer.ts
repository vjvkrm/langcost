import type { IngestError, Message } from "@langcost/core";
import { calculateCostWithCache, estimateTokenCount } from "@langcost/core";
import type { MessageRecord, SpanRecord, TraceRecord } from "@langcost/db";

import type {
  ClaudeCodeAssistantEntry,
  ClaudeCodeContentBlock,
  ClaudeCodeEntry,
  ClaudeCodeSystemEntry,
  ClaudeCodeTextBlock,
  ClaudeCodeThinkingBlock,
  ClaudeCodeToolResultBlock,
  ClaudeCodeToolUseBlock,
  ClaudeCodeUsage,
  ClaudeCodeUserEntry,
  DiscoveredConversationFile,
  ReadConversationResult,
} from "./types";

export interface NormalizedConversation {
  trace: TraceRecord;
  spans: SpanRecord[];
  messages: MessageRecord[];
  errors: IngestError[];
}

// ── ID generation ──

function toTraceId(conversationId: string): string {
  return `claude-code:trace:${conversationId}`;
}

function toLlmSpanId(traceId: string, index: number): string {
  return `${traceId}:llm:${index}`;
}

function toToolSpanId(traceId: string, toolUseId: string): string {
  return `${traceId}:tool:${toolUseId}`;
}

function toMessageId(spanId: string, position: number): string {
  return `${spanId}:message:${position}`;
}

// ── Type guards ──

function isUserEntry(entry: ClaudeCodeEntry): entry is ClaudeCodeUserEntry {
  return entry.type === "user" && "message" in entry;
}

function isAssistantEntry(entry: ClaudeCodeEntry): entry is ClaudeCodeAssistantEntry {
  return entry.type === "assistant" && "message" in entry;
}

function isSystemEntry(entry: ClaudeCodeEntry): entry is ClaudeCodeSystemEntry {
  return entry.type === "system";
}

function isTextBlock(block: ClaudeCodeContentBlock): block is ClaudeCodeTextBlock {
  return block.type === "text";
}

function isThinkingBlock(block: ClaudeCodeContentBlock): block is ClaudeCodeThinkingBlock {
  return block.type === "thinking";
}

function isToolUseBlock(block: ClaudeCodeContentBlock): block is ClaudeCodeToolUseBlock {
  return block.type === "tool_use";
}

function isToolResultBlock(block: ClaudeCodeContentBlock): block is ClaudeCodeToolResultBlock {
  return block.type === "tool_result";
}

// ── Helpers ──

function parseTimestamp(value?: string | null): Date | undefined {
  if (typeof value === "string" && value.length > 0) {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      return new Date(parsed);
    }
  }

  return undefined;
}

function flattenContent(content?: string | ClaudeCodeContentBlock[]): string {
  if (typeof content === "string") {
    return content;
  }

  if (!content || content.length === 0) {
    return "";
  }

  return content
    .map((block) => {
      if (isTextBlock(block)) {
        return block.text ?? "";
      }

      if (isThinkingBlock(block)) {
        return block.thinking ?? "";
      }

      if (isToolUseBlock(block)) {
        return `[tool:${block.name}] ${JSON.stringify(block.input ?? {})}`;
      }

      if (isToolResultBlock(block)) {
        const resultContent = block.content;
        if (typeof resultContent === "string") {
          return resultContent;
        }
        if (Array.isArray(resultContent)) {
          return resultContent.map((c) => c.text ?? "").join("\n");
        }
        return "";
      }

      return "";
    })
    .filter((value) => value.length > 0)
    .join("\n");
}

function extractToolUseBlocks(content?: ClaudeCodeContentBlock[]): ClaudeCodeToolUseBlock[] {
  if (!Array.isArray(content)) {
    return [];
  }

  return content.filter(isToolUseBlock);
}

function extractToolResultBlocks(
  content?: string | ClaudeCodeContentBlock[],
): ClaudeCodeToolResultBlock[] {
  if (!Array.isArray(content)) {
    return [];
  }

  return content.filter(isToolResultBlock);
}

function toolResultContent(block: ClaudeCodeToolResultBlock): string {
  if (typeof block.content === "string") {
    return block.content;
  }

  if (Array.isArray(block.content)) {
    return block.content.map((c) => c.text ?? "").join("\n");
  }

  return "";
}

/**
 * Calculate cost from Claude Code usage data.
 *
 * Claude Code reports:
 * - input_tokens: base input tokens (non-cached)
 * - cache_creation_input_tokens: tokens written to cache (charged at 1.25x input)
 * - cache_read_input_tokens: tokens read from cache (charged at 0.1x input)
 * - output_tokens: output tokens
 */
// API-equivalent cost using full cache pricing. Claude Code uses 1h cache TTL
// (write at 2× input rate). This is the rate users would pay if they ran the
// same workload through the Claude API directly.
function calculateCostFromUsage(usage: ClaudeCodeUsage, model: string) {
  const inputTokens = usage.input_tokens ?? 0;
  const outputTokens = usage.output_tokens ?? 0;
  const cacheCreationTokens = usage.cache_creation_input_tokens ?? 0;
  const cacheReadTokens = usage.cache_read_input_tokens ?? 0;

  const cost = calculateCostWithCache(
    model,
    inputTokens,
    outputTokens,
    cacheCreationTokens,
    cacheReadTokens,
    "1h",
  );

  return {
    inputTokens,
    outputTokens,
    cacheCreationTokens,
    cacheReadTokens,
    costUsd: cost.totalCost,
    inputCostUsd: cost.inputCost,
    outputCostUsd: cost.outputCost,
    cacheWriteCostUsd: cost.cacheWriteCost,
    cacheReadCostUsd: cost.cacheReadCost,
  };
}

function buildMessage(
  spanId: string,
  traceId: string,
  role: Message["role"],
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

// ── Deduplication ──

/**
 * Claude Code writes multiple assistant entries for the same API request (streaming updates).
 * We group by requestId and keep only the final entry (the one with a non-null stop_reason,
 * or the last entry in the group).
 */
function deduplicateEntries(entries: ClaudeCodeEntry[]): ClaudeCodeEntry[] {
  // Group assistant entries by requestId
  const assistantGroups = new Map<string, ClaudeCodeAssistantEntry[]>();

  for (const entry of entries) {
    if (!isAssistantEntry(entry)) {
      continue;
    }

    const groupKey = entry.requestId ?? entry.uuid ?? crypto.randomUUID();
    if (!assistantGroups.has(groupKey)) {
      assistantGroups.set(groupKey, []);
    }
    assistantGroups.get(groupKey)?.push(entry);
  }

  // Build a set of entries to keep (best from each group)
  const keepSet = new Set<ClaudeCodeEntry>();
  for (const group of assistantGroups.values()) {
    const last = group[group.length - 1];
    if (!last) continue;
    const best = group.findLast((g) => g.message.stop_reason !== null) ?? last;
    keepSet.add(best);
  }

  // Filter: keep all non-assistant entries, and only the best assistant per group
  return entries.filter((entry) => {
    if (!isAssistantEntry(entry)) {
      return true;
    }
    return keepSet.has(entry);
  });
}

// ── Main normalizer ──

export function normalizeConversation(
  conversationFile: DiscoveredConversationFile,
  readResult: ReadConversationResult,
): NormalizedConversation {
  const traceId = toTraceId(conversationFile.conversationId);
  const spans: SpanRecord[] = [];
  const messages: MessageRecord[] = [];
  const errors: IngestError[] = readResult.errors.map((error) => ({
    file: conversationFile.filePath,
    line: error.line,
    message: error.message,
  }));

  let currentModel: string | undefined;
  let firstTimestamp: Date | undefined;
  let lastTimestamp: Date | undefined;
  let hasError = false;
  let isPartial = errors.length > 0;
  let llmIndex = 0;
  let orphanToolIndex = 0;

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCostUsd = 0;
  let totalCacheCreationTokens = 0;
  let totalCacheReadTokens = 0;
  let totalInputCostUsd = 0;
  let totalOutputCostUsd = 0;
  let totalCacheWriteCostUsd = 0;
  let totalCacheReadCostUsd = 0;
  let totalDurationMs = 0;

  let lastLlmSpanId: string | undefined;
  const pendingUserContent: string[] = [];
  const toolSpanIdsByCallId = new Map<string, string>();
  const spanIndexesById = new Map<string, number>();
  const positionsBySpanId = new Map<string, number>();

  // Session metadata from first entry
  let cwd: string | undefined;
  let version: string | undefined;
  let gitBranch: string | undefined;
  let entrypoint: string | undefined;

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

  const deduplicated = deduplicateEntries(readResult.entries);

  for (const entry of deduplicated) {
    const timestamp = parseTimestamp(entry.timestamp);
    if (!timestamp) {
      continue;
    }

    if (!firstTimestamp || timestamp.getTime() < firstTimestamp.getTime()) {
      firstTimestamp = timestamp;
    }
    if (!lastTimestamp || timestamp.getTime() > lastTimestamp.getTime()) {
      lastTimestamp = timestamp;
    }

    // Capture session metadata from first user entry
    if (isUserEntry(entry) && !cwd) {
      cwd = entry.cwd;
      version = entry.version;
      gitBranch = entry.gitBranch;
      entrypoint = entry.entrypoint;
    }

    // Accumulate turn durations from system entries
    if (isSystemEntry(entry) && entry.subtype === "turn_duration" && entry.durationMs) {
      totalDurationMs += entry.durationMs;
      continue;
    }

    // Skip non-message entries
    if (!isUserEntry(entry) && !isAssistantEntry(entry)) {
      continue;
    }

    // ── User entry ──
    if (isUserEntry(entry)) {
      const content = entry.message.content;

      // Check for tool results inside user messages
      if (Array.isArray(content)) {
        const toolResults = extractToolResultBlocks(content);

        for (const toolResult of toolResults) {
          const toolCallId = toolResult.tool_use_id ?? `orphan:${++orphanToolIndex}`;
          const toolSpanId =
            toolSpanIdsByCallId.get(toolCallId) ?? toToolSpanId(traceId, toolCallId);
          const existingSpanIndex = spanIndexesById.get(toolSpanId);
          const resultContent = toolResultContent(toolResult);

          if (existingSpanIndex === undefined) {
            addSpan({
              id: toolSpanId,
              traceId,
              parentSpanId: lastLlmSpanId ?? null,
              externalId: toolCallId,
              type: "tool",
              name: "tool",
              startedAt: timestamp,
              endedAt: timestamp,
              durationMs: 0,
              model: null,
              provider: null,
              inputTokens: null,
              outputTokens: null,
              costUsd: null,
              toolName: null,
              toolInput: null,
              toolOutput: resultContent,
              toolSuccess: !(toolResult.is_error ?? false),
              status: toolResult.is_error ? "error" : "ok",
              errorMessage: toolResult.is_error ? resultContent || "Tool call failed" : null,
              metadata: null,
            });
          } else {
            const existingSpan = spans[existingSpanIndex];
            if (!existingSpan) {
              continue;
            }

            replaceSpan({
              ...existingSpan,
              endedAt: timestamp,
              durationMs: Math.max(0, timestamp.getTime() - existingSpan.startedAt.getTime()),
              toolOutput: resultContent || existingSpan.toolOutput,
              toolSuccess: !(toolResult.is_error ?? false),
              status: toolResult.is_error ? "error" : existingSpan.status,
              errorMessage: toolResult.is_error
                ? resultContent || "Tool call failed"
                : existingSpan.errorMessage,
            });
          }

          if (toolResult.is_error) {
            hasError = true;
          }

          messages.push(
            buildMessage(toolSpanId, traceId, "tool", resultContent, nextPosition(toolSpanId), {
              isError: toolResult.is_error ?? false,
              timestamp: timestamp.toISOString(),
            }),
          );
        }

        // Non-tool-result content from user
        const textContent = (content as ClaudeCodeContentBlock[])
          .filter((block) => !isToolResultBlock(block))
          .map((block) => {
            if (isTextBlock(block)) return block.text;
            return "";
          })
          .filter(Boolean)
          .join("\n");

        if (textContent.length > 0) {
          pendingUserContent.push(textContent);
        }
      } else {
        const text = flattenContent(content);
        if (text.length > 0) {
          pendingUserContent.push(text);
        }
      }

      continue;
    }

    // ── Assistant entry ──
    if (isAssistantEntry(entry)) {
      const assistantMessage = entry.message;
      const model = assistantMessage.model ?? currentModel;
      currentModel = model ?? currentModel;

      const assistantContent = flattenContent(assistantMessage.content);
      const usage = assistantMessage.usage;

      llmIndex += 1;
      const spanId = toLlmSpanId(traceId, llmIndex);

      const costData = model
        ? calculateCostFromUsage(usage, model)
        : {
            inputTokens:
              (usage.input_tokens ?? 0) +
              (usage.cache_creation_input_tokens ?? 0) +
              (usage.cache_read_input_tokens ?? 0),
            outputTokens: usage.output_tokens ?? 0,
            cacheCreationTokens: usage.cache_creation_input_tokens ?? 0,
            cacheReadTokens: usage.cache_read_input_tokens ?? 0,
            costUsd: 0,
            inputCostUsd: 0,
            outputCostUsd: 0,
            cacheWriteCostUsd: 0,
            cacheReadCostUsd: 0,
          };

      const spanStatus = assistantMessage.stop_reason === "error" ? "error" : "ok";

      totalInputTokens += costData.inputTokens;
      totalOutputTokens += costData.outputTokens;
      totalCostUsd += costData.costUsd;
      totalCacheCreationTokens += costData.cacheCreationTokens;
      totalCacheReadTokens += costData.cacheReadTokens;
      totalInputCostUsd += costData.inputCostUsd;
      totalOutputCostUsd += costData.outputCostUsd;
      totalCacheWriteCostUsd += costData.cacheWriteCostUsd;
      totalCacheReadCostUsd += costData.cacheReadCostUsd;

      if (spanStatus === "error") {
        hasError = true;
      }

      addSpan({
        id: spanId,
        traceId,
        parentSpanId: null,
        externalId: `${conversationFile.conversationId}:assistant:${llmIndex}`,
        type: "llm",
        name: "assistant",
        startedAt: timestamp,
        endedAt: timestamp,
        durationMs: 0,
        model: model ?? null,
        provider: "anthropic",
        inputTokens: costData.inputTokens,
        outputTokens: costData.outputTokens,
        costUsd: costData.costUsd,
        toolName: null,
        toolInput: null,
        toolOutput: null,
        toolSuccess: null,
        status: spanStatus,
        errorMessage: null,
        metadata: {
          cacheCreationTokens: costData.cacheCreationTokens,
          cacheReadTokens: costData.cacheReadTokens,
          serviceTier: usage.service_tier ?? null,
          stopReason: assistantMessage.stop_reason ?? null,
          speed: usage.speed ?? null,
          requestId: entry.requestId ?? null,
        },
      });

      // Flush pending user content as messages on this LLM span
      for (const userContent of pendingUserContent) {
        messages.push(
          buildMessage(spanId, traceId, "user", userContent, nextPosition(spanId), {
            timestamp: timestamp.toISOString(),
          }),
        );
      }
      pendingUserContent.length = 0;

      // Add assistant message
      messages.push(
        buildMessage(spanId, traceId, "assistant", assistantContent, nextPosition(spanId), {
          stopReason: assistantMessage.stop_reason ?? null,
          timestamp: timestamp.toISOString(),
        }),
      );

      // Create tool spans for tool_use blocks
      for (const toolUse of extractToolUseBlocks(assistantMessage.content)) {
        const toolSpanId = toToolSpanId(traceId, toolUse.id);
        toolSpanIdsByCallId.set(toolUse.id, toolSpanId);

        addSpan({
          id: toolSpanId,
          traceId,
          parentSpanId: spanId,
          externalId: toolUse.id,
          type: "tool",
          name: toolUse.name,
          startedAt: timestamp,
          endedAt: null,
          durationMs: null,
          model: null,
          provider: null,
          inputTokens: null,
          outputTokens: null,
          costUsd: null,
          toolName: toolUse.name,
          toolInput: JSON.stringify(toolUse.input) ?? null,
          toolOutput: null,
          toolSuccess: null,
          status: "ok",
          errorMessage: null,
          metadata: { toolCallId: toolUse.id },
        });
      }

      lastLlmSpanId = spanId;
    }
  }

  if (pendingUserContent.length > 0) {
    isPartial = true;
  }

  const startedAt = firstTimestamp ?? conversationFile.modifiedAt;
  const endedAt = lastTimestamp ?? conversationFile.modifiedAt;

  const trace: TraceRecord = {
    id: traceId,
    externalId: conversationFile.conversationId,
    source: "claude-code",
    sessionKey: conversationFile.project.projectPath,
    startedAt,
    endedAt,
    totalInputTokens,
    totalOutputTokens,
    totalCostUsd,
    ...(currentModel ? { model: currentModel } : {}),
    status: hasError ? "error" : isPartial ? "partial" : "complete",
    metadata: {
      project: conversationFile.project.projectName,
      projectPath: conversationFile.project.originalPath,
      cwd: cwd ?? null,
      version: version ?? null,
      gitBranch: gitBranch ?? null,
      entrypoint: entrypoint ?? null,
      totalDurationMs,
      totalCacheCreationTokens,
      totalCacheReadTokens,
      totalInputCostUsd,
      totalOutputCostUsd,
      totalCacheWriteCostUsd,
      totalCacheReadCostUsd,
      interactive: true,
      sourceFile: conversationFile.filePath,
      parentConversationId: conversationFile.parentConversationId ?? null,
      subagentId: conversationFile.subagentId ?? null,
    },
    ingestedAt: new Date(),
  };

  return {
    trace,
    spans,
    messages,
    errors,
  };
}
