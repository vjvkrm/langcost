import { runPipeline } from "@langcost/analyzers";
import { MAX_SINCE_MS } from "@langcost/core";
import {
  createSettingsRepository,
  createTraceRepository,
  type Db,
  type SourceSettings,
} from "@langcost/db";

import { loadAdapter } from "./adapter-loader";
import { withDb } from "./db";

export interface ScanResultPayload {
  tracesIngested: number;
  spansIngested: number;
  messagesIngested: number;
  skipped: number;
  durationMs: number;
}

function toAdapterOptions(sourceConfig: SourceSettings & { source: string }, force = false) {
  return {
    ...(sourceConfig.sourcePath ? { sourcePath: sourceConfig.sourcePath } : {}),
    since: new Date(Date.now() - MAX_SINCE_MS),
    force,
    ...(sourceConfig.apiKey ? { apiKey: sourceConfig.apiKey } : {}),
    ...(sourceConfig.apiUrl ? { apiUrl: sourceConfig.apiUrl } : {}),
  };
}

function requireSourceConfig(
  settings: SourceSettings | null,
  sourceOverride?: string,
): SourceSettings & { source: string } {
  const source = sourceOverride ?? settings?.source;
  if (!source) {
    throw new Error("No source configured. Save settings before triggering a scan.");
  }

  // Only carry stored credentials when the override matches the saved source,
  // otherwise the adapter will use its own defaults (e.g. claude-code falls
  // back to ~/.claude/projects).
  const useStoredCreds = !sourceOverride || sourceOverride === settings?.source;

  return {
    source,
    ...(useStoredCreds && settings?.sourcePath ? { sourcePath: settings.sourcePath } : {}),
    ...(useStoredCreds && settings?.apiKey ? { apiKey: settings.apiKey } : {}),
    ...(useStoredCreds && settings?.apiUrl ? { apiUrl: settings.apiUrl } : {}),
  };
}

function pruneToTraceLimit(db: Db, limit: number): void {
  const traceRepository = createTraceRepository(db);
  const traces = traceRepository.listForAnalysis();

  if (traces.length <= limit) {
    return;
  }

  const idsToDelete = traces.slice(limit).map((trace) => trace.id);
  traceRepository.deleteByIds(idsToDelete);
}

export async function runConfiguredScan(
  dbPath?: string,
  force = false,
  sourceOverride?: string,
): Promise<ScanResultPayload> {
  return withDb(dbPath, async (db) => {
    const settingsRepository = createSettingsRepository(db);
    const sourceConfig = requireSourceConfig(settingsRepository.getSourceConfig(), sourceOverride);
    const adapter = await loadAdapter(sourceConfig.source);

    const validation = await adapter.validate(toAdapterOptions(sourceConfig));

    if (!validation.ok) {
      throw new Error(validation.message);
    }

    const startedAt = new Date();
    const ingestResult = await adapter.ingest(db, toAdapterOptions(sourceConfig, force));

    const traceRepository = createTraceRepository(db);
    const traceIds = traceRepository
      .listForAnalysis()
      .filter((trace) => trace.ingestedAt.getTime() >= startedAt.getTime())
      .map((trace) => trace.id);

    if (traceIds.length > 0) {
      await runPipeline(db, undefined, { traceIds, force });
    }

    pruneToTraceLimit(db, 500);

    return {
      tracesIngested: ingestResult.tracesIngested,
      spansIngested: ingestResult.spansIngested,
      messagesIngested: ingestResult.messagesIngested,
      skipped: ingestResult.skipped,
      durationMs: ingestResult.durationMs,
    };
  });
}
