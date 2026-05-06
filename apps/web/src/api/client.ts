const BASE = "/api/v1";

export type Severity = "low" | "medium" | "high" | "critical";
export type TraceStatus = "complete" | "error" | "partial";
export type SpanType = "llm" | "tool" | "retrieval" | "agent";
export type SegmentType =
  | "system_prompt"
  | "tool_schema"
  | "conversation_history"
  | "rag_context"
  | "user_query"
  | "assistant_response"
  | "tool_result"
  | "unknown";

export interface SettingsResponse {
  source?: string;
  sourcePath?: string;
  apiUrl?: string;
  hasApiKey: boolean;
}

export interface SaveSettingsInput {
  source: string;
  sourcePath?: string;
  apiKey?: string;
  apiUrl?: string;
}

export interface ScanResponse {
  tracesIngested: number;
  spansIngested: number;
  messagesIngested: number;
  skipped: number;
  durationMs: number;
}

export interface HealthResponse {
  status: "ok";
  dbPath: string;
  version: string;
  dbSizeBytes: number;
  lastScanAt: string | null;
  traceCount: number;
  spanCount: number;
  messageCount: number;
  traceLimit: number;
}

export interface OverviewResponse {
  totalTraces: number;
  totalCostUsd: number;
  totalWastedUsd: number;
  wastePercentage: number;
  tracesWithWaste: number;
  topWasteCategories: Array<{
    category: string;
    count: number;
    totalWasted: number;
  }>;
  costByDay: Array<{
    date: string;
    costUsd: number;
    wastedUsd: number;
  }>;
  costByModel: Array<{
    model: string;
    costUsd: number;
    inputTokens: number;
    outputTokens: number;
    traceCount: number;
  }>;
  successRate: {
    complete: number;
    error: number;
    partial: number;
    completePercent: number;
  };
  turns: {
    avg: number;
    min: number;
    max: number;
    total: number;
  };
  byProject: Array<{
    project: string;
    sessions: number;
    totalTokens: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCostUsd: number;
    avgTurns: number;
    successRate: number;
  }>;
  totalCacheReadTokens: number;
  totalCacheWriteTokens: number;
  lastScanAt: string | null;
  warpArbitrage: WarpArbitrageAggregate | null;
}

export interface WarpArbitrageAggregate {
  totalPaidUsd: number;
  totalApiEquivalentUsd: number;
  markupPct: number;
  comparedTraces: number;
  totalWarpTraces: number;
}

export interface WarpArbitrageMetadata {
  creditCostUsd: number;
  apiCostUsd: number;
  costMarkupPct: number | null;
  warpPlan: string;
  effectiveCreditRateUsd: number;
  creditsSpent: number;
  billingMode: "credit" | "byok" | "mixed" | "unknown";
}

export interface ClaudeCodeTokenBreakdown {
  freshInputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  inputCostUsd: number;
  cacheWriteCostUsd: number;
  cacheReadCostUsd: number;
  outputCostUsd: number;
  totalCostUsd: number;
  cacheHitRate: number;
  cacheRoi: number | null;
}

export function readClaudeCodeTokens(trace: TraceSummary): ClaudeCodeTokenBreakdown | null {
  if (trace.source !== "claude-code" || !trace.metadata) return null;
  const meta = trace.metadata;
  const num = (key: string): number => {
    const v = meta[key];
    return typeof v === "number" && Number.isFinite(v) ? v : 0;
  };

  const cacheWriteTokens = num("totalCacheCreationTokens");
  const cacheReadTokens = num("totalCacheReadTokens");
  const freshInputTokens = trace.totalInputTokens;
  const outputTokens = trace.totalOutputTokens;

  const inputCostUsd = num("totalInputCostUsd");
  const cacheWriteCostUsd = num("totalCacheWriteCostUsd");
  const cacheReadCostUsd = num("totalCacheReadCostUsd");
  const outputCostUsd = num("totalOutputCostUsd");
  const totalCostUsd = inputCostUsd + cacheWriteCostUsd + cacheReadCostUsd + outputCostUsd;

  const totalContextTokens = freshInputTokens + cacheWriteTokens + cacheReadTokens;
  const cacheHitRate = totalContextTokens > 0 ? cacheReadTokens / totalContextTokens : 0;
  const cacheRoi = cacheWriteCostUsd > 0 ? cacheReadCostUsd / cacheWriteCostUsd : null;

  if (totalContextTokens === 0 && outputTokens === 0) return null;

  return {
    freshInputTokens,
    cacheWriteTokens,
    cacheReadTokens,
    outputTokens,
    inputCostUsd,
    cacheWriteCostUsd,
    cacheReadCostUsd,
    outputCostUsd,
    totalCostUsd,
    cacheHitRate,
    cacheRoi,
  };
}

export function readWarpArbitrage(trace: TraceSummary): WarpArbitrageMetadata | null {
  if (trace.source !== "warp" || !trace.metadata) return null;
  const meta = trace.metadata;
  const creditCostUsd = typeof meta.creditCostUsd === "number" ? meta.creditCostUsd : null;
  const apiCostUsd = typeof meta.apiCostUsd === "number" ? meta.apiCostUsd : null;
  if (creditCostUsd === null || apiCostUsd === null) return null;
  if (creditCostUsd === 0 && apiCostUsd === 0) return null;
  return {
    creditCostUsd,
    apiCostUsd,
    costMarkupPct: typeof meta.costMarkupPct === "number" ? meta.costMarkupPct : null,
    warpPlan: typeof meta.warpPlan === "string" ? meta.warpPlan : "unknown",
    effectiveCreditRateUsd:
      typeof meta.effectiveCreditRateUsd === "number" ? meta.effectiveCreditRateUsd : 0,
    creditsSpent: typeof meta.creditsSpent === "number" ? meta.creditsSpent : 0,
    billingMode:
      meta.billingMode === "credit" ||
      meta.billingMode === "byok" ||
      meta.billingMode === "mixed"
        ? meta.billingMode
        : "unknown",
  };
}

export interface Recommendation {
  category: string;
  description: string;
  affectedTraces: number;
  estimatedSavingsUsd: number;
  priority: Severity;
}

export interface TraceSummary {
  id: string;
  externalId: string;
  source: string;
  spanCount: number;
  sessionKey?: string;
  agentId?: string;
  startedAt: string;
  endedAt?: string | null;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  model?: string | null;
  status: TraceStatus;
  metadata?: Record<string, unknown> | null;
  ingestedAt: string;
  wasteUsd: number;
  wasteCount: number;
}

export interface TraceListResponse {
  traces: TraceSummary[];
  total: number;
}

export interface SpanRecord {
  id: string;
  traceId: string;
  parentSpanId?: string | null;
  externalId: string;
  type: SpanType;
  name?: string | null;
  startedAt: string;
  endedAt?: string | null;
  durationMs?: number | null;
  model?: string | null;
  provider?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  costUsd?: number | null;
  toolName?: string | null;
  toolInput?: string | null;
  toolOutput?: string | null;
  toolSuccess?: boolean | null;
  status: "ok" | "error";
  errorMessage?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface SegmentRecord {
  id: string;
  spanId: string;
  traceId: string;
  type: SegmentType;
  tokenCount: number;
  costUsd: number;
  percentOfSpan: number;
  contentHash?: string | null;
  charStart?: number | null;
  charEnd?: number | null;
  analyzedAt: string;
}

export interface WasteReportRecord {
  id: string;
  traceId: string;
  spanId?: string | null;
  category: string;
  severity: Severity;
  wastedTokens: number;
  wastedCostUsd: number;
  description: string;
  recommendation: string;
  estimatedSavingsUsd?: number | null;
  evidence: Record<string, unknown>;
  detectedAt: string;
}

export interface MessageRecord {
  id: string;
  spanId: string;
  traceId: string;
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tokenCount?: number | null;
  position: number;
  metadata?: Record<string, unknown> | null;
}

export interface TraceDetailResponse {
  trace: TraceSummary;
  spans: SpanRecord[];
  segments: SegmentRecord[];
  costBreakdown: {
    traceId: string;
    totalCostUsd: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    segments: Array<{
      type: SegmentType;
      tokenCount: number;
      costUsd: number;
      percentOfTotal: number;
    }>;
    wastePercentage: number;
    wastedCostUsd: number;
  };
  wasteReports: WasteReportRecord[];
  topSpans: SpanRecord[];
  messages: MessageRecord[];
}

export interface WasteListResponse {
  reports: WasteReportRecord[];
  total: number;
  summary: {
    totalWastedTokens: number;
    totalWastedUsd: number;
    byCategory: Array<{
      category: string;
      count: number;
      wastedUsd: number;
    }>;
  };
}

export interface SegmentBreakdownResponse {
  byType: Array<{
    type: SegmentType;
    totalTokens: number;
    totalCostUsd: number;
    percentage: number;
  }>;
  totalTokens: number;
  totalCostUsd: number;
}

export interface SourceInfo {
  name: string;
  traceCount: number;
  lastScanAt: string;
}

export interface SourcesResponse {
  sources: SourceInfo[];
}

class ApiError extends Error {}

function buildQuery(params: Record<string, string | number | undefined>): string {
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && `${value}`.length > 0) {
      query.set(key, `${value}`);
    }
  }

  const serialized = query.toString();
  return serialized.length > 0 ? `?${serialized}` : "";
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  const payload = await response.json().catch(() => null as Record<string, unknown> | null);

  if (!response.ok) {
    const message =
      payload && typeof payload.error === "string"
        ? payload.error
        : `API request failed with status ${response.status}`;
    throw new ApiError(message);
  }

  return payload as T;
}

export async function getSettings(): Promise<SettingsResponse> {
  return request<SettingsResponse>("/settings");
}

export async function saveSettings(input: SaveSettingsInput): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>("/settings", {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export async function triggerScan(force = false): Promise<ScanResponse> {
  return request<ScanResponse>("/scan", {
    method: "POST",
    body: JSON.stringify({ force }),
  });
}

export async function getSources(): Promise<SourcesResponse> {
  return request<SourcesResponse>("/sources");
}

export async function getOverview(source?: string): Promise<OverviewResponse> {
  return request<OverviewResponse>(`/overview${buildQuery({ source })}`);
}

export async function getRecommendations(
  source?: string,
): Promise<{ recommendations: Recommendation[] }> {
  return request<{ recommendations: Recommendation[] }>(
    `/waste/recommendations${buildQuery({ source })}`,
  );
}

export async function getTraces(
  params: {
    limit?: number;
    offset?: number;
    sort?: string;
    since?: string;
    model?: string;
    status?: string;
    source?: string;
  } = {},
): Promise<TraceListResponse> {
  return request<TraceListResponse>(
    `/traces${buildQuery({
      limit: params.limit,
      offset: params.offset,
      sort: params.sort,
      since: params.since,
      model: params.model,
      status: params.status,
      source: params.source,
    })}`,
  );
}

export async function getTraceDetail(traceId: string): Promise<TraceDetailResponse> {
  return request<TraceDetailResponse>(`/traces/${encodeURIComponent(traceId)}`);
}

export async function getWaste(
  params: {
    category?: string;
    severity?: string;
    limit?: number;
    offset?: number;
    source?: string;
  } = {},
): Promise<WasteListResponse> {
  return request<WasteListResponse>(
    `/waste${buildQuery({
      category: params.category,
      severity: params.severity,
      limit: params.limit,
      offset: params.offset,
      source: params.source,
    })}`,
  );
}

export async function getSegmentBreakdown(
  params: { since?: string; model?: string } = {},
): Promise<SegmentBreakdownResponse> {
  return request<SegmentBreakdownResponse>(
    `/segments/breakdown${buildQuery({
      since: params.since,
      model: params.model,
    })}`,
  );
}

export async function getHealth(): Promise<HealthResponse> {
  return request<HealthResponse>("/health");
}
