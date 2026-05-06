import type {
  MessageRecord,
  SegmentRecord,
  SpanRecord,
  TraceRecord,
  WasteReportRecord,
} from "@langcost/db";

const INFORMATIONAL_WASTE_CATEGORIES = new Set(["model_overuse", "cache_expiry"]);

export function toDateKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function sumBy<T>(items: T[], project: (item: T) => number): number {
  return items.reduce((sum, item) => sum + project(item), 0);
}

export function groupBy<T, K extends string>(items: T[], keyOf: (item: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>();

  for (const item of items) {
    const key = keyOf(item);
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }

  return groups;
}

export function isActionableWasteReport(report: WasteReportRecord): boolean {
  return !INFORMATIONAL_WASTE_CATEGORIES.has(report.category);
}

export function getActionableWasteReports(reports: WasteReportRecord[]): WasteReportRecord[] {
  return reports.filter(isActionableWasteReport);
}

export function buildCostBreakdown(
  trace: TraceRecord,
  segments: SegmentRecord[],
  wasteReports: WasteReportRecord[],
) {
  const actionableWasteReports = getActionableWasteReports(wasteReports);
  const totalSegmentCost = sumBy(segments, (segment) => segment.costUsd);
  const totalWasteUsd = sumBy(actionableWasteReports, (report) => report.wastedCostUsd);
  const totalsByType = groupBy(segments, (segment) => segment.type);

  return {
    traceId: trace.id,
    totalCostUsd: totalSegmentCost,
    totalInputTokens: trace.totalInputTokens,
    totalOutputTokens: trace.totalOutputTokens,
    segments: [...totalsByType.entries()].map(([type, items]) => {
      const costUsd = sumBy(items, (item) => item.costUsd);
      return {
        type,
        tokenCount: sumBy(items, (item) => item.tokenCount),
        costUsd,
        percentOfTotal: totalSegmentCost > 0 ? (costUsd / totalSegmentCost) * 100 : 0,
      };
    }),
    wastePercentage:
      trace.totalCostUsd > 0
        ? (Math.min(totalWasteUsd, trace.totalCostUsd) / trace.totalCostUsd) * 100
        : 0,
    wastedCostUsd: Math.min(totalWasteUsd, trace.totalCostUsd),
  };
}

export function getTopSpans(spans: SpanRecord[], limit: number): SpanRecord[] {
  return [...spans]
    .sort((left, right) => (right.costUsd ?? 0) - (left.costUsd ?? 0))
    .slice(0, limit);
}

function readWarpArbitrageMetadata(trace: TraceRecord): {
  creditCostUsd: number;
  apiCostUsd: number;
  billingMode: string;
} | null {
  if (trace.source !== "warp") return null;
  const meta = trace.metadata as Record<string, unknown> | null;
  if (!meta) return null;
  const apiCostUsd = typeof meta.apiCostUsd === "number" ? meta.apiCostUsd : null;
  const creditCostUsd = typeof meta.creditCostUsd === "number" ? meta.creditCostUsd : null;
  const billingMode = typeof meta.billingMode === "string" ? meta.billingMode : "unknown";
  if (apiCostUsd === null || creditCostUsd === null) return null;
  return { creditCostUsd, apiCostUsd, billingMode };
}

function buildWarpArbitrageAggregate(traces: TraceRecord[]) {
  const eligible = traces
    .map((trace) => readWarpArbitrageMetadata(trace))
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null && entry.apiCostUsd > 0);

  if (eligible.length === 0) return null;

  const totalPaidUsd = sumBy(eligible, (entry) => entry.creditCostUsd);
  const totalApiEquivalentUsd = sumBy(eligible, (entry) => entry.apiCostUsd);
  const markupPct =
    totalApiEquivalentUsd > 0
      ? ((totalPaidUsd - totalApiEquivalentUsd) / totalApiEquivalentUsd) * 100
      : 0;

  return {
    totalPaidUsd,
    totalApiEquivalentUsd,
    markupPct,
    comparedTraces: eligible.length,
    totalWarpTraces: traces.filter((trace) => trace.source === "warp").length,
  };
}

export function buildOverviewPayload(
  traces: TraceRecord[],
  wasteReports: WasteReportRecord[],
  turnsByTraceId?: Map<string, number>,
) {
  const actionableWasteReports = getActionableWasteReports(wasteReports);
  const totalCostUsd = sumBy(traces, (trace) => trace.totalCostUsd);
  const tracesWithWaste = new Set(actionableWasteReports.map((report) => report.traceId)).size;

  // Cap waste per trace at actual trace cost to avoid waste > cost from overlapping rules
  const traceCostById = new Map(traces.map((trace) => [trace.id, trace.totalCostUsd]));
  const rawWasteByTraceId = new Map<string, number>();
  for (const report of actionableWasteReports) {
    rawWasteByTraceId.set(
      report.traceId,
      (rawWasteByTraceId.get(report.traceId) ?? 0) + report.wastedCostUsd,
    );
  }
  const wasteByTraceId = new Map<string, number>();
  for (const [traceId, rawWaste] of rawWasteByTraceId) {
    const traceCost = traceCostById.get(traceId) ?? 0;
    wasteByTraceId.set(traceId, Math.min(rawWaste, traceCost));
  }
  const totalWastedUsd = sumBy([...wasteByTraceId.values()], (v) => v);

  const topWasteCategories = [
    ...groupBy(actionableWasteReports, (report) => report.category).entries(),
  ]
    .map(([category, reports]) => ({
      category,
      count: reports.length,
      totalWasted: sumBy(reports, (report) => report.wastedCostUsd),
    }))
    .sort((left, right) => right.totalWasted - left.totalWasted)
    .slice(0, 5);

  const costByDay = [...groupBy(traces, (trace) => toDateKey(trace.startedAt)).entries()]
    .map(([date, dayTraces]) => ({
      date,
      costUsd: sumBy(dayTraces, (trace) => trace.totalCostUsd),
      wastedUsd: sumBy(dayTraces, (trace) => wasteByTraceId.get(trace.id) ?? 0),
    }))
    .sort((left, right) => left.date.localeCompare(right.date));

  const costByModel = [...groupBy(traces, (trace) => trace.model ?? "unknown").entries()]
    .map(([model, items]) => ({
      model,
      costUsd: sumBy(items, (item) => item.totalCostUsd),
      inputTokens: sumBy(items, (item) => item.totalInputTokens),
      outputTokens: sumBy(items, (item) => item.totalOutputTokens),
      traceCount: items.length,
    }))
    .sort(
      (left, right) =>
        right.inputTokens + right.outputTokens - (left.inputTokens + left.outputTokens),
    );

  return {
    totalTraces: traces.length,
    totalCostUsd,
    totalWastedUsd,
    wastePercentage: totalCostUsd > 0 ? (totalWastedUsd / totalCostUsd) * 100 : 0,
    tracesWithWaste,
    topWasteCategories,
    costByDay,
    costByModel,
    // Success rate
    successRate: {
      complete: traces.filter((t) => t.status === "complete").length,
      error: traces.filter((t) => t.status === "error").length,
      partial: traces.filter((t) => t.status === "partial").length,
      completePercent:
        traces.length > 0
          ? (traces.filter((t) => t.status === "complete").length / traces.length) * 100
          : 0,
    },
    // Turns (LLM spans per session)
    turns: (() => {
      if (!turnsByTraceId || turnsByTraceId.size === 0) return { avg: 0, min: 0, max: 0, total: 0 };
      const values = [...turnsByTraceId.values()].filter((v) => v > 0);
      if (values.length === 0) return { avg: 0, min: 0, max: 0, total: 0 };
      const total = values.reduce((s, v) => s + v, 0);
      return {
        avg: Math.round(total / values.length),
        min: Math.min(...values),
        max: Math.max(...values),
        total,
      };
    })(),
    // Project breakdown
    byProject: (() => {
      const projectMap = new Map<string, TraceRecord[]>();
      for (const trace of traces) {
        const meta = trace.metadata as Record<string, unknown> | null;
        const project = (meta?.project as string) ?? "unknown";
        const list = projectMap.get(project) ?? [];
        list.push(trace);
        projectMap.set(project, list);
      }

      return [...projectMap.entries()]
        .map(([project, projectTraces]) => {
          const totalTokens = sumBy(projectTraces, (t) => t.totalInputTokens + t.totalOutputTokens);
          const totalTurns = projectTraces.reduce(
            (sum, t) => sum + (turnsByTraceId?.get(t.id) ?? 0),
            0,
          );
          const complete = projectTraces.filter((t) => t.status === "complete").length;
          return {
            project,
            sessions: projectTraces.length,
            totalTokens,
            totalInputTokens: sumBy(projectTraces, (t) => t.totalInputTokens),
            totalOutputTokens: sumBy(projectTraces, (t) => t.totalOutputTokens),
            totalCostUsd: sumBy(projectTraces, (t) => t.totalCostUsd),
            avgTurns: projectTraces.length > 0 ? Math.round(totalTurns / projectTraces.length) : 0,
            successRate: projectTraces.length > 0 ? (complete / projectTraces.length) * 100 : 0,
          };
        })
        .sort((a, b) => b.totalTokens - a.totalTokens);
    })(),
    totalCacheReadTokens: traces.reduce((sum, t) => {
      const meta = t.metadata as Record<string, unknown> | null;
      return sum + (typeof meta?.totalCacheReadTokens === "number" ? meta.totalCacheReadTokens : 0);
    }, 0),
    totalCacheWriteTokens: traces.reduce((sum, t) => {
      const meta = t.metadata as Record<string, unknown> | null;
      return (
        sum +
        (typeof meta?.totalCacheCreationTokens === "number" ? meta.totalCacheCreationTokens : 0)
      );
    }, 0),
    lastScanAt:
      traces.length > 0
        ? new Date(Math.max(...traces.map((trace) => trace.ingestedAt.getTime()))).toISOString()
        : null,
    warpArbitrage: buildWarpArbitrageAggregate(traces),
  };
}

const CATEGORY_DESCRIPTIONS: Record<string, string> = {
  tool_failure_waste:
    "Tool calls are failing and triggering extra model work to recover. Review failing tool paths and error handling.",
  agent_loop:
    "Sub-agents are repeating the same tool calls in loops. Add loop guards or stopping conditions.",
  retry_waste:
    "Duplicate or near-duplicate prompts are being sent. Improve initial prompt clarity.",
  low_cache_utilization:
    "Some spans have low cache hit rates. Consider restructuring prompts to maximize cache reuse.",
  high_output: "Some LLM responses are unusually verbose. Consider stricter output limits.",
  cache_expiry: "Idle gaps are causing cache expiry. Keep the cache warm during long pauses.",
};

export function buildRecommendations(wasteReports: WasteReportRecord[]) {
  const actionableWasteReports = getActionableWasteReports(wasteReports);

  return [...groupBy(actionableWasteReports, (report) => report.category).entries()]
    .map(([category, reports]) => {
      const severities = ["low", "medium", "high", "critical"] as const;
      const priority =
        reports
          .map((report) => report.severity)
          .sort((left, right) => severities.indexOf(right) - severities.indexOf(left))[0] ?? "low";

      return {
        category,
        description: CATEGORY_DESCRIPTIONS[category] ?? reports[0]?.recommendation ?? category,
        affectedTraces: new Set(reports.map((report) => report.traceId)).size,
        estimatedSavingsUsd: sumBy(
          reports,
          (report) => report.estimatedSavingsUsd ?? report.wastedCostUsd,
        ),
        priority,
      };
    })
    .sort((left, right) => right.estimatedSavingsUsd - left.estimatedSavingsUsd);
}

function cacheCost(t: { metadata?: Record<string, unknown> }): number {
  const m = t.metadata ?? {};
  const read = typeof m.totalCacheReadTokens === "number" ? m.totalCacheReadTokens : 0;
  const write = typeof m.totalCacheCreationTokens === "number" ? m.totalCacheCreationTokens : 0;
  return (read / 1_000_000) * 0.5 + (write / 1_000_000) * 10;
}

export function sortTraces(
  traces: Array<TraceRecord & { wasteUsd: number; spanCount: number }>,
  sort: string,
) {
  return [...traces].sort((left, right) => {
    switch (sort) {
      case "cost_asc":
        return left.totalCostUsd - right.totalCostUsd;
      case "cost_desc":
        return right.totalCostUsd - left.totalCostUsd;
      case "waste_desc":
        return right.wasteUsd - left.wasteUsd;
      case "waste_asc":
        return left.wasteUsd - right.wasteUsd;
      case "date_asc":
        return left.startedAt.getTime() - right.startedAt.getTime();
      case "spans_desc":
        return right.spanCount - left.spanCount;
      case "spans_asc":
        return left.spanCount - right.spanCount;
      case "input_desc":
        return right.totalInputTokens - left.totalInputTokens;
      case "input_asc":
        return left.totalInputTokens - right.totalInputTokens;
      case "output_desc":
        return right.totalOutputTokens - left.totalOutputTokens;
      case "output_asc":
        return left.totalOutputTokens - right.totalOutputTokens;
      case "cache_desc":
        return cacheCost(right) - cacheCost(left);
      case "cache_asc":
        return cacheCost(left) - cacheCost(right);
      default:
        return right.startedAt.getTime() - left.startedAt.getTime();
    }
  });
}

export function serializeTraceSummary(
  trace: TraceRecord,
  wasteReports: WasteReportRecord[],
  spanCount: number,
) {
  const actionableWasteReports = getActionableWasteReports(wasteReports);
  const rawWaste = sumBy(actionableWasteReports, (report) => report.wastedCostUsd);
  return {
    ...trace,
    spanCount,
    wasteUsd: Math.min(rawWaste, trace.totalCostUsd),
    wasteCount: actionableWasteReports.length,
  };
}

export function normalizeTraceDetail(
  trace: TraceRecord,
  spans: SpanRecord[],
  segments: SegmentRecord[],
  wasteReports: WasteReportRecord[],
) {
  return {
    trace: serializeTraceSummary(trace, wasteReports, spans.length),
    spans,
    segments,
    costBreakdown: buildCostBreakdown(trace, segments, wasteReports),
    wasteReports,
    topSpans: getTopSpans(spans, 5),
  };
}

export function getTraceMessages(messages: MessageRecord[]) {
  return messages;
}
