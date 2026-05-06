import { calculateCost, estimateTokenCount, findPricing } from "@langcost/core";
import type { MessageRecord, SpanRecord, TraceRecord } from "@langcost/db";

import { normalizeModelId } from "./model-map";
import { resolveWarpCreditRateUsd } from "./pricing";
import { estimateSpanTokens } from "./token-estimator";
import type {
  WarpBlockMetadata,
  WarpBlockRow,
  WarpConversationData,
  WarpConversationRow,
  WarpInputEntry,
  WarpQueryRow,
  WarpTokenUsageEntry,
} from "./types";

export interface NormalizedConversation {
  trace: TraceRecord;
  spans: SpanRecord[];
  messages: MessageRecord[];
}

// Blobs larger than this are truncated before ANSI stripping to prevent DB bloat
// (e.g. `cat big.log` tool calls).
const ANSI_BLOB_CAP_BYTES = 65_536;

function stripAnsiEscapes(text: string): string {
  let result = "";
  let i = 0;
  while (i < text.length) {
    if (text.charCodeAt(i) !== 0x1b) {
      result += text[i++];
      continue;
    }
    const next = text[i + 1];
    if (next === "[") {
      // CSI — skip parameter/intermediate bytes, then the final byte (0x40–0x7E)
      i += 2;
      while (i < text.length && (text.charCodeAt(i) < 0x40 || text.charCodeAt(i) > 0x7e)) i++;
      i++;
    } else if (next === "]") {
      // OSC — skip until BEL (0x07) or ST (ESC \)
      i += 2;
      while (i < text.length) {
        if (text.charCodeAt(i) === 0x07) { i++; break; }
        if (text.charCodeAt(i) === 0x1b && text[i + 1] === "\\") { i += 2; break; }
        i++;
      }
    } else if (next === "P" || next === "^" || next === "_") {
      // DCS / PM / APC — skip until ST (ESC \)
      i += 2;
      while (i < text.length) {
        if (text.charCodeAt(i) === 0x1b && text[i + 1] === "\\") { i += 2; break; }
        i++;
      }
    } else {
      // All other two-char escapes (ESC M, ESC 7, ESC 8, etc.)
      i += 2;
    }
  }
  return result;
}

function stripAnsi(bytes: Uint8Array | null): string {
  if (!bytes || bytes.length === 0) return "";
  const capped = bytes.length > ANSI_BLOB_CAP_BYTES ? bytes.subarray(0, ANSI_BLOB_CAP_BYTES) : bytes;
  return stripAnsiEscapes(new TextDecoder().decode(capped));
}

function parseOutputStatus(raw: string): "ok" | "error" | "partial" {
  let value = raw;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === "string") value = parsed;
  } catch {}
  if (value === "Completed") return "ok";
  if (value === "Failed") return "error";
  return "partial";
}

function parseTs(value: string | null | undefined): Date | undefined {
  if (!value) return undefined;
  const withT = value.includes("T") ? value : value.replace(" ", "T");
  const withZ = withT.endsWith("Z") ? withT : `${withT}Z`;
  const ms = Date.parse(withZ);
  return Number.isNaN(ms) ? undefined : new Date(ms);
}

// ── ID helpers ──

function traceId(conversationId: string): string {
  return `warp:trace:${conversationId}`;
}

function llmSpanId(conversationId: string, exchangeId: string): string {
  return `warp:span:llm:${conversationId}:${exchangeId}`;
}

function toolSpanId(blockId: string): string {
  return `warp:span:tool:${blockId}`;
}

function messageId(spanId: string, position: number): string {
  return `${spanId}:msg:${position}`;
}

// ── Token / cost helpers ──
type TokenKind = "all" | "warp" | "byok";
type WarpBillingMode = "credit" | "byok" | "mixed" | "unknown";

function tokensByKind(entry: WarpTokenUsageEntry, kind: TokenKind): number {
  if (kind === "warp") {
    return entry.warp_tokens ?? 0;
  }

  if (kind === "byok") {
    return entry.byok_tokens ?? 0;
  }

  return (entry.warp_tokens ?? 0) + (entry.byok_tokens ?? 0);
}

function totalTokensByKind(entries: WarpTokenUsageEntry[], kind: TokenKind): number {
  return entries.reduce((sum, entry) => sum + tokensByKind(entry, kind), 0);
}

function calculateEquivalentApiCostUsd(entries: WarpTokenUsageEntry[], kind: TokenKind): number {
  return entries.reduce((sum, entry) => {
    const tokenCount = tokensByKind(entry, kind);
    if (tokenCount <= 0) {
      return sum;
    }

    const model = normalizeModelId(entry.model_id);
    return sum + calculateCost(model, tokenCount, 0).totalCost;
  }, 0);
}

function resolveBillingMode(totalWarpTokens: number, totalByokTokens: number): WarpBillingMode {
  if (totalWarpTokens > 0 && totalByokTokens > 0) {
    return "mixed";
  }

  if (totalWarpTokens > 0) {
    return "credit";
  }

  if (totalByokTokens > 0) {
    return "byok";
  }

  return "unknown";
}

function primaryModel(entries: WarpTokenUsageEntry[]): string | undefined {
  if (entries.length === 0) return undefined;
  return [...entries].sort(
    (a, b) =>
      (b.byok_tokens ?? 0) + (b.warp_tokens ?? 0) - ((a.byok_tokens ?? 0) + (a.warp_tokens ?? 0)),
  )[0]?.model_id;
}

// ── Input text extraction ──

function extractUserText(inputJson: string): string {
  try {
    const entries = JSON.parse(inputJson) as WarpInputEntry[];
    if (!Array.isArray(entries) || entries.length === 0) return "";
    return entries[0]?.Query?.text ?? "";
  } catch {
    return "";
  }
}

// ── Parent LLM span attribution for tool blocks ──
// A block belongs to the LLM exchange with the highest start_ts < block.start_ts.

function attributeBlockToExchange(
  blockStartMs: number,
  exchangeTimestamps: { exchangeId: string; startMs: number }[],
): string | undefined {
  let best: string | undefined;
  let bestMs = -1;

  for (const { exchangeId, startMs } of exchangeTimestamps) {
    if (startMs < blockStartMs && startMs > bestMs) {
      best = exchangeId;
      bestMs = startMs;
    }
  }

  return best;
}

// ── Main normalizer ──

export interface NormalizeConversationOptions {
  warpPlan?: string;
}

export function normalizeConversation(
  conv: WarpConversationRow,
  exchanges: WarpQueryRow[],
  blocks: WarpBlockRow[],
  options: NormalizeConversationOptions = {},
): NormalizedConversation {
  const tid = traceId(conv.conversation_id);
  const spans: SpanRecord[] = [];
  const messages: MessageRecord[] = [];

  let convData: WarpConversationData = {};
  try {
    convData = JSON.parse(conv.conversation_data) as WarpConversationData;
  } catch {}

  const usageMeta = convData.conversation_usage_metadata ?? {};
  const tokenUsage = usageMeta.token_usage ?? [];
  const totalTokens = totalTokensByKind(tokenUsage, "all");
  const totalWarpTokens = totalTokensByKind(tokenUsage, "warp");
  const totalByokTokens = totalTokensByKind(tokenUsage, "byok");
  const dominantModel = primaryModel(tokenUsage);
  const creditsSpent = usageMeta.credits_spent ?? 0;
  const { warpPlan, effectiveCreditRateUsd } = resolveWarpCreditRateUsd(options.warpPlan);
  const creditCostUsd = totalWarpTokens > 0 ? creditsSpent * effectiveCreditRateUsd : 0;
  const byokApiCostUsd = calculateEquivalentApiCostUsd(tokenUsage, "byok");
  const apiCostUsd = calculateEquivalentApiCostUsd(tokenUsage, "all");
  const totalCostUsd = creditCostUsd + byokApiCostUsd;
  const costMarkupPct =
    apiCostUsd > 0 ? ((totalCostUsd - apiCostUsd) / apiCostUsd) * 100 : null;
  const billingMode = resolveBillingMode(totalWarpTokens, totalByokTokens);

  const tokenEstimates = estimateSpanTokens(exchanges, usageMeta);
  const tokenEstimateMap = new Map(tokenEstimates.map((e) => [e.exchangeId, e]));

  const exchangeTimestamps = exchanges.map((ex) => ({
    exchangeId: ex.exchange_id,
    startMs: parseTs(ex.start_ts)?.getTime() ?? 0,
  }));

  const positionCounter = new Map<string, number>();
  const nextPosition = (spanId: string): number => {
    const pos = positionCounter.get(spanId) ?? 0;
    positionCounter.set(spanId, pos + 1);
    return pos;
  };

  let hasError = false;
  let hasPartial = false;

  for (const ex of exchanges) {
    const spanId = llmSpanId(conv.conversation_id, ex.exchange_id);
    const startedAt = parseTs(ex.start_ts) ?? new Date(conv.last_modified_at);
    const outputStatus = parseOutputStatus(ex.output_status);
    const status = outputStatus === "partial" ? "ok" : outputStatus;
    const model = normalizeModelId(ex.model_id);
    const tokens = tokenEstimateMap.get(ex.exchange_id);
    const inputTokens = tokens?.inputTokens ?? 0;
    const outputTokens = tokens?.outputTokens ?? 0;
    const costUsd = calculateCost(model, inputTokens, outputTokens).totalCost;
    const provider = findPricing(model)?.provider ?? null;
    if (outputStatus === "error") hasError = true;
    if (outputStatus === "partial") hasPartial = true;

    spans.push({
      id: spanId,
      traceId: tid,
      parentSpanId: null,
      externalId: ex.exchange_id,
      type: "llm",
      name: "assistant",
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
      status,
      errorMessage: outputStatus === "error" ? `output_status: ${ex.output_status}` : null,
      metadata: {
        estimatedTokens: true,
        workingDirectory: ex.working_directory ?? null,
        rawModelId: ex.model_id,
      },
    });

    const userText = extractUserText(ex.input);
    if (userText.length > 0) {
      const pos = nextPosition(spanId);
      messages.push({
        id: messageId(spanId, pos),
        spanId,
        traceId: tid,
        role: "user",
        content: userText,
        tokenCount: estimateTokenCount(userText),
        position: pos,
        metadata: null,
      });
    }
  }

  for (const block of blocks) {
    let blockMeta: WarpBlockMetadata = {};
    try {
      blockMeta = JSON.parse(block.ai_metadata) as WarpBlockMetadata;
    } catch {
      continue;
    }

    const toolUseId = blockMeta.requested_command_action_id;
    if (!toolUseId) continue;

    const blockStartMs = parseTs(block.start_ts)?.getTime() ?? 0;
    const parentExchangeId = attributeBlockToExchange(blockStartMs, exchangeTimestamps);
    const parentSpanId = parentExchangeId
      ? llmSpanId(conv.conversation_id, parentExchangeId)
      : null;

    const startedAt = parseTs(block.start_ts) ?? new Date(conv.last_modified_at);
    const endedAt = parseTs(block.completed_ts) ?? startedAt;
    const durationMs = Math.max(0, endedAt.getTime() - startedAt.getTime());

    const commandText = stripAnsi(block.stylized_command);
    const outputText = stripAnsi(block.stylized_output);
    const success = block.exit_code === 0;
    const spanId = toolSpanId(block.block_id);

    spans.push({
      id: spanId,
      traceId: tid,
      parentSpanId,
      externalId: toolUseId,
      type: "tool",
      name: "run_command",
      startedAt,
      endedAt,
      durationMs,
      model: null,
      provider: null,
      inputTokens: null,
      outputTokens: null,
      costUsd: null,
      toolName: "run_command",
      toolInput: commandText || null,
      toolOutput: outputText || null,
      toolSuccess: success,
      status: success ? "ok" : "error",
      errorMessage: success ? null : `exit_code: ${block.exit_code}`,
      metadata: {
        blockId: block.block_id,
        toolUseId,
        exitCode: block.exit_code,
        subagentTaskId: blockMeta.subagent_task_id ?? null,
      },
    });

    if (!success) hasError = true;

    if (outputText.length > 0) {
      const pos = nextPosition(spanId);
      messages.push({
        id: messageId(spanId, pos),
        spanId,
        traceId: tid,
        role: "tool",
        content: outputText,
        tokenCount: estimateTokenCount(outputText),
        position: pos,
        metadata: { exitCode: block.exit_code },
      });
    }
  }

  const startedAt =
    parseTs(exchanges[0]?.start_ts) ?? parseTs(conv.last_modified_at) ?? new Date();
  const endedAt = parseTs(conv.last_modified_at) ?? startedAt;

  const trace: TraceRecord = {
    id: tid,
    externalId: conv.conversation_id,
    source: "warp",
    sessionKey: conv.conversation_id,
    startedAt,
    endedAt,
    totalInputTokens: totalTokens,
    totalOutputTokens: 0,
    totalCostUsd,
    ...(dominantModel ? { model: normalizeModelId(dominantModel) } : {}),
    status: hasError ? "error" : hasPartial ? "partial" : "complete",
    metadata: {
      creditsSpent,
      estimatedCost: true,
      warpPlan,
      effectiveCreditRateUsd,
      billingMode,
      creditCostUsd,
      byokApiCostUsd,
      apiCostUsd,
      costMarkupPct,
      toolUsageMetadata: usageMeta.tool_usage_metadata ?? null,
      wasSummarized: usageMeta.was_summarized ?? false,
      contextWindowUsage: usageMeta.context_window_usage ?? null,
      runId: convData.run_id ?? null,
    },
    ingestedAt: new Date(),
  };

  return { trace, spans, messages };
}
