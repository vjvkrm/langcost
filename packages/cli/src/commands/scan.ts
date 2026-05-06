import { runPipeline } from "@langcost/analyzers";
import {
  createDb,
  createMessageRepository,
  createSpanRepository,
  createTraceRepository,
  createWasteReportRepository,
  getSqliteClient,
  migrate,
  type TraceRecord,
  type WasteReportRecord,
} from "@langcost/db";

import { loadAdapter } from "../adapter-loader";
import { MAX_TRACES_OSS } from "../config";
import { createPalette } from "../output/colors";
import { formatCurrency, formatPercent, pluralize, renderTree } from "../output/summary";
import type { CliRuntime, ScanCommandOptions } from "../types";

function isActionableWaste(report: WasteReportRecord): boolean {
  return report.category !== "model_overuse";
}

function toValidateOptions(options: ScanCommandOptions) {
  return {
    ...(options.sourcePath ? { sourcePath: options.sourcePath } : {}),
    ...(options.file ? { file: options.file } : {}),
    ...(options.warpPlan ? { adapterOptions: { warpPlan: options.warpPlan } } : {}),
    ...(options.since ? { since: options.since } : {}),
    ...(options.apiKey ? { apiKey: options.apiKey } : {}),
    ...(options.apiUrl ? { apiUrl: options.apiUrl } : {}),
  };
}

function toIngestOptions(options: ScanCommandOptions) {
  return {
    ...toValidateOptions(options),
    ...(options.force ? { force: true } : {}),
  };
}

function summarizeTopWaste(reports: WasteReportRecord[], totalWasteUsd: number): string {
  const actionableReports = reports.filter(isActionableWaste);
  if (actionableReports.length === 0) {
    return "none detected";
  }

  const totalsByCategory = new Map<string, number>();
  for (const report of actionableReports) {
    totalsByCategory.set(
      report.category,
      (totalsByCategory.get(report.category) ?? 0) + report.wastedCostUsd,
    );
  }

  return [...totalsByCategory.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 3)
    .map(([category, costUsd]) => {
      const percent = totalWasteUsd > 0 ? (costUsd / totalWasteUsd) * 100 : 0;
      return `${category} (${formatPercent(percent)})`;
    })
    .join(", ");
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

function summarizeWarpArbitrage(traces: TraceRecord[]): string | null {
  const warpTraces = traces.filter((trace) => trace.source === "warp");
  if (warpTraces.length === 0) {
    return null;
  }

  let paidCostUsd = 0;
  let equivalentApiCostUsd = 0;
  let comparedTraces = 0;

  for (const trace of warpTraces) {
    const metadata = trace.metadata as Record<string, unknown> | undefined;
    const apiCostUsd = getNumberMetadataField(metadata, "apiCostUsd");
    if (apiCostUsd === null || apiCostUsd <= 0) {
      continue;
    }

    paidCostUsd += trace.totalCostUsd;
    equivalentApiCostUsd += apiCostUsd;
    comparedTraces += 1;
  }

  if (comparedTraces === 0 || equivalentApiCostUsd <= 0) {
    return null;
  }

  const markupPct = ((paidCostUsd - equivalentApiCostUsd) / equivalentApiCostUsd) * 100;
  const direction = markupPct >= 0 ? "higher" : "lower";

  return `Warp arbitrage: paid ${formatCurrency(paidCostUsd)} vs API-equivalent ${formatCurrency(
    equivalentApiCostUsd,
  )} (${formatPercent(Math.abs(markupPct))} ${direction})`;
}

export async function runScanCommand(
  options: ScanCommandOptions,
  runtime: CliRuntime,
): Promise<number> {
  const palette = createPalette(runtime.io);
  const db = createDb(options.dbPath);
  const commandStartedAt = runtime.now();

  try {
    migrate(db);

    const adapter = await loadAdapter(options.source);
    const validation = await adapter.validate(toValidateOptions(options));

    if (!validation.ok) {
      runtime.io.error(`${palette.red("Error:")} ${validation.message}\n`);
      return 1;
    }

    const ingestResult = await adapter.ingest(db, toIngestOptions(options));

    const traceRepository = createTraceRepository(db);
    const spanRepository = createSpanRepository(db);
    const messageRepository = createMessageRepository(db);
    const wasteReportRepository = createWasteReportRepository(db);

    const scannedTraces = traceRepository
      .listForAnalysis()
      .filter((trace) => trace.ingestedAt.getTime() >= commandStartedAt.getTime());
    const traceIds = scannedTraces.map((trace) => trace.id);

    if (traceIds.length > 0) {
      await runPipeline(db, undefined, {
        traceIds,
        force: options.force,
      });
    }

    // Enforce OSS trace limit — keep most recent 500, delete oldest
    const allTraces = traceRepository.listForAnalysis();
    if (allTraces.length > MAX_TRACES_OSS) {
      const tracesToDelete = allTraces
        .sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime())
        .slice(0, allTraces.length - MAX_TRACES_OSS);
      traceRepository.deleteByIds(tracesToDelete.map((t) => t.id));
    }

    const spansCount = traceIds.reduce(
      (total, traceId) => total + spanRepository.listByTraceId(traceId).length,
      0,
    );
    const messagesCount = traceIds.reduce(
      (total, traceId) => total + messageRepository.listByTraceId(traceId).length,
      0,
    );
    const reports = traceIds.flatMap((traceId) => wasteReportRepository.listByTraceId(traceId));
    const actionableReports = reports.filter(isActionableWaste);
    const totalCostUsd = scannedTraces.reduce((total, trace) => total + trace.totalCostUsd, 0);
    // Cap waste per trace at trace cost to avoid waste > cost from overlapping rules
    const cappedWasteUsd = scannedTraces.reduce((total, trace) => {
      const traceReports = actionableReports.filter((report) => report.traceId === trace.id);
      const rawWaste = traceReports.reduce((sum, r) => sum + r.wastedCostUsd, 0);
      return total + Math.min(rawWaste, trace.totalCostUsd);
    }, 0);
    const wastePercent = totalCostUsd > 0 ? (cappedWasteUsd / totalCostUsd) * 100 : 0;
    const wasteLine = `Estimated waste: ${formatCurrency(cappedWasteUsd)} (${formatPercent(wastePercent)})`;

    const lines = [
      `${pluralize(scannedTraces.length, "trace")}, ${pluralize(spansCount, "span")}, ${pluralize(messagesCount, "message")}`,
      `Total cost: ${formatCurrency(totalCostUsd)}`,
      ...(options.source === "warp"
        ? (() => {
            const warpArbitrage = summarizeWarpArbitrage(scannedTraces);
            return warpArbitrage ? [warpArbitrage] : [];
          })()
        : []),
      wasteLine,
      `Top waste: ${summarizeTopWaste(actionableReports, cappedWasteUsd)}`,
    ];

    const title = `Scanned ${pluralize(
      ingestResult.tracesIngested + ingestResult.skipped,
      "session",
    )} from ${options.source}`;

    runtime.io.write(`${renderTree(title, lines)}\n`);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown scan failure";
    runtime.io.error(`${palette.red("Error:")} ${message}\n`);
    return 1;
  } finally {
    getSqliteClient(db).close(false);
  }
}
