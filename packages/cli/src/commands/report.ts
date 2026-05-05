import {
  createDb,
  createSegmentRepository,
  createSpanRepository,
  createTraceRepository,
  createWasteReportRepository,
  getSqliteClient,
  migrate,
  type TraceRecord,
} from "@langcost/db";

import { createPalette } from "../output/colors";
import { formatCurrency, formatDateTime, formatPercent, pluralize } from "../output/summary";
import { renderMarkdownTable, renderTable, type TableColumn } from "../output/table";
import type { CliRuntime, ReportCommandOptions } from "../types";

function formatReportRows(
  rows: Array<Record<string, string>>,
  columns: TableColumn[],
  format: ReportCommandOptions["format"],
): string {
  switch (format) {
    case "json":
      return JSON.stringify(rows, null, 2);
    case "markdown":
      return renderMarkdownTable(columns, rows);
    default:
      return renderTable(columns, rows);
  }
}

function getNumberMetadataField(
  metadata: Record<string, unknown> | undefined,
  fieldName: string,
): number | null {
  const value = metadata?.[fieldName];
  if (typeof value !== "number" || Number.isNaN(value)) {
    return null;
  }
  return value;
}

function formatWarpArbitrage(trace: TraceRecord): string | null {
  if (trace.source !== "warp") {
    return null;
  }

  const metadata = trace.metadata as Record<string, unknown> | undefined;
  const apiCostUsd = getNumberMetadataField(metadata, "apiCostUsd");
  if (apiCostUsd === null || apiCostUsd <= 0) {
    return null;
  }

  const markupPct = ((trace.totalCostUsd - apiCostUsd) / apiCostUsd) * 100;
  const direction = markupPct >= 0 ? "higher" : "lower";
  return `Warp arbitrage: paid ${formatCurrency(trace.totalCostUsd)} vs API-equivalent ${formatCurrency(
    apiCostUsd,
  )} (${formatPercent(Math.abs(markupPct))} ${direction})`;
}

export async function runReportCommand(
  options: ReportCommandOptions,
  runtime: CliRuntime,
): Promise<number> {
  const palette = createPalette(runtime.io);
  const db = createDb(options.dbPath);

  try {
    migrate(db);

    const traceRepository = createTraceRepository(db);
    const spanRepository = createSpanRepository(db);
    const segmentRepository = createSegmentRepository(db);
    const wasteRepository = createWasteReportRepository(db);

    if (options.traceId) {
      const trace = traceRepository.getById(options.traceId);
      if (!trace) {
        runtime.io.error(`${palette.red("Error:")} Trace not found: ${options.traceId}\n`);
        return 1;
      }

      const spans = spanRepository.listByTraceId(trace.id);
      const segments = segmentRepository.listByTraceId(trace.id);
      const wasteReports = wasteRepository
        .listByTraceId(trace.id)
        .filter((report) => !options.category || report.category === options.category);

      if (options.format === "json") {
        runtime.io.write(
          `${JSON.stringify({ trace, spans, segments, reports: wasteReports }, null, 2)}\n`,
        );
        return 0;
      }

      const spanColumns: TableColumn[] = [
        { key: "type", label: "Type" },
        { key: "name", label: "Name" },
        { key: "model", label: "Model" },
        { key: "cost", label: "Cost", align: "right" },
        { key: "status", label: "Status" },
      ];
      const spanRows = spans.map((span) => ({
        type: span.type,
        name: span.name ?? span.toolName ?? "-",
        model: span.model ?? "-",
        cost: formatCurrency(span.costUsd ?? 0),
        status: span.status,
      }));

      const wasteColumns: TableColumn[] = [
        { key: "category", label: "Category" },
        { key: "severity", label: "Severity" },
        { key: "waste", label: "Waste", align: "right" },
        { key: "recommendation", label: "Recommendation" },
      ];
      const wasteRows = wasteReports.map((report) => ({
        category: report.category,
        severity: report.severity,
        waste: formatCurrency(report.wastedCostUsd),
        recommendation: report.recommendation,
      }));
      const warpArbitrage = formatWarpArbitrage(trace);

      const sections = [
        `${palette.bold("Trace")} ${trace.id}`,
        `Started: ${formatDateTime(trace.startedAt)}`,
        `Cost: ${formatCurrency(trace.totalCostUsd)}`,
        ...(warpArbitrage ? [warpArbitrage] : []),
        `Status: ${trace.status}`,
        "",
        `${palette.bold("Spans")} (${pluralize(spans.length, "span")})`,
        formatReportRows(spanRows, spanColumns, options.format),
        "",
        `${palette.bold("Waste Reports")} (${pluralize(wasteReports.length, "report")})`,
        wasteRows.length > 0
          ? formatReportRows(wasteRows, wasteColumns, options.format)
          : "No waste reports.",
      ];

      runtime.io.write(`${sections.join("\n")}\n`);
      return 0;
    }

    const wasteByTrace = new Map<string, number>();
    for (const report of wasteRepository.list()) {
      if (options.category && report.category !== options.category) {
        continue;
      }

      wasteByTrace.set(
        report.traceId,
        (wasteByTrace.get(report.traceId) ?? 0) + report.wastedCostUsd,
      );
    }

    let traces = traceRepository.listForAnalysis();
    if (options.category) {
      traces = traces.filter((trace) => wasteByTrace.has(trace.id));
    }

    // Group subagent traces under their parent for claude-code sessions
    const parentTraces: typeof traces = [];
    const subagentsByParent = new Map<string, typeof traces>();

    for (const trace of traces) {
      const metadata = trace.metadata as Record<string, unknown> | null;
      const parentId = metadata?.parentConversationId as string | null;

      if (parentId && trace.source === "claude-code") {
        const parentTraceId = `claude-code:trace:${parentId}`;
        if (!subagentsByParent.has(parentTraceId)) {
          subagentsByParent.set(parentTraceId, []);
        }
        subagentsByParent.get(parentTraceId)?.push(trace);
      } else {
        parentTraces.push(trace);
      }
    }

    // Roll up subagent totals into parent trace rows
    parentTraces.sort((left, right) => {
      switch (options.sort) {
        case "cost":
          return right.totalCostUsd - left.totalCostUsd;
        case "waste":
          return (wasteByTrace.get(right.id) ?? 0) - (wasteByTrace.get(left.id) ?? 0);
        default:
          return right.startedAt.getTime() - left.startedAt.getTime();
      }
    });

    function formatTokens(count: number): string {
      if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
      if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`;
      return String(count);
    }

    function getProject(trace: (typeof traces)[0]): string {
      const metadata = trace.metadata as Record<string, unknown> | null;
      return (metadata?.project as string) ?? "-";
    }

    const rows = parentTraces.slice(0, options.limit).map((trace) => {
      const subagents = subagentsByParent.get(trace.id) ?? [];
      const totalCost =
        trace.totalCostUsd + subagents.reduce((sum, sa) => sum + sa.totalCostUsd, 0);
      const totalWaste =
        (wasteByTrace.get(trace.id) ?? 0) +
        subagents.reduce((sum, sa) => sum + (wasteByTrace.get(sa.id) ?? 0), 0);
      const totalInput =
        trace.totalInputTokens + subagents.reduce((sum, sa) => sum + sa.totalInputTokens, 0);
      const totalOutput =
        trace.totalOutputTokens + subagents.reduce((sum, sa) => sum + sa.totalOutputTokens, 0);

      return {
        project: getProject(trace),
        started: formatDateTime(trace.startedAt),
        model: trace.model ?? "-",
        status: trace.status,
        input: formatTokens(totalInput),
        output: formatTokens(totalOutput),
        cost: formatCurrency(totalCost),
        waste: formatCurrency(totalWaste),
        agents: subagents.length > 0 ? `+${subagents.length}` : "",
      };
    });

    const columns: TableColumn[] = [
      { key: "project", label: "Project" },
      { key: "started", label: "Started" },
      { key: "model", label: "Model" },
      { key: "status", label: "Status" },
      { key: "input", label: "Input", align: "right" },
      { key: "output", label: "Output", align: "right" },
      { key: "cost", label: "Cost", align: "right" },
      { key: "waste", label: "Waste", align: "right" },
      { key: "agents", label: "Sub" },
    ];

    runtime.io.write(`${formatReportRows(rows, columns, options.format)}\n`);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown report failure";
    runtime.io.error(`${palette.red("Error:")} ${message}\n`);
    return 1;
  } finally {
    getSqliteClient(db).close(false);
  }
}
