import { afterEach, describe, expect, it } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createApiApp } from "../src/index";

const cleanupPaths: string[] = [];

afterEach(() => {
  while (cleanupPaths.length > 0) {
    const path = cleanupPaths.pop();
    if (path) {
      rmSync(path, { recursive: true, force: true });
    }
  }
});

function createTempDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  cleanupPaths.push(directory);
  return directory;
}

function createTempDbPath(): string {
  return join(createTempDirectory("langcost-api-db-"), "langcost.db");
}

function createFixtureSourcePath(files: string[]): string {
  const root = createTempDirectory("langcost-api-source-");
  const sessionsPath = join(root, "agents", "demo", "sessions");
  mkdirSync(sessionsPath, { recursive: true });

  const fixturesRoot = join(import.meta.dir, "..", "..", "..", "fixtures");
  for (const file of files) {
    copyFileSync(join(fixturesRoot, "openclaw", file), join(sessionsPath, file));
  }

  return root;
}

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

describe("@langcost/api", () => {
  it("returns setup state and health metadata on an empty database", async () => {
    const app = createApiApp({ dbPath: createTempDbPath() });

    const settingsResponse = await app.request("/api/v1/settings");
    expect(settingsResponse.status).toBe(200);
    const settings = await readJson<{ hasApiKey: boolean }>(settingsResponse);
    expect(settings).toEqual({ hasApiKey: false });

    const healthResponse = await app.request("/api/v1/health");
    expect(healthResponse.status).toBe(200);

    const health = await readJson<{
      status: string;
      dbPath: string;
      version: string;
      dbSizeBytes: number;
      traceCount: number;
      spanCount: number;
      messageCount: number;
      traceLimit: number;
    }>(healthResponse);

    expect(health.status).toBe("ok");
    expect(health.version).toBe("0.0.1");
    expect(health.dbPath.endsWith("langcost.db")).toBe(true);
    expect(health.dbSizeBytes).toBeGreaterThanOrEqual(0);
    expect(health.traceCount).toBe(0);
    expect(health.spanCount).toBe(0);
    expect(health.messageCount).toBe(0);
    expect(health.traceLimit).toBe(500);
  });

  it("lists known adapters with installed status, version, and install commands", async () => {
    const app = createApiApp({ dbPath: createTempDbPath() });

    const response = await app.request("/api/v1/adapters");
    expect(response.status).toBe(200);

    type AdapterEntryBase = {
      name: string;
      label: string;
      traceCount: number;
      lastScanAt: string | null;
    };
    type AdapterEntry =
      | (AdapterEntryBase & { installed: true; version: string; installType: "npm" | "workspace" })
      | (AdapterEntryBase & { installed: false; installCommand: string });

    const payload = await readJson<{ adapters: AdapterEntry[] }>(response);

    // Catalog must at least cover the adapter packages shipped in the monorepo.
    // Asserting `toContain` (not strict equality) lets new adapters land without
    // editing this test — only forgetting to register one in KNOWN_ADAPTERS fails it.
    const names = new Set(payload.adapters.map((entry) => entry.name));
    for (const expected of ["openclaw", "claude-code", "warp", "cline"]) {
      expect(names.has(expected)).toBe(true);
    }

    for (const entry of payload.adapters) {
      expect(typeof entry.label).toBe("string");
      expect(entry.label.length).toBeGreaterThan(0);
      expect(typeof entry.traceCount).toBe("number");

      if (entry.installed) {
        expect(typeof entry.version).toBe("string");
        expect(entry.version.length).toBeGreaterThan(0);
        expect(["npm", "workspace"]).toContain(entry.installType);
        expect("installCommand" in entry).toBe(false);
      } else {
        expect(entry.installCommand).toBe(`npm install -g @langcost/adapter-${entry.name}`);
        expect("version" in entry).toBe(false);
      }
    }

    // In the workspace dev environment every known adapter resolves via the
    // workspace fallback in tryLoadAdapter, so all of them should report installed.
    expect(payload.adapters.every((entry) => entry.installed)).toBe(true);
  });

  it("returns a friendly error when a scan is triggered before settings are saved", async () => {
    const app = createApiApp({ dbPath: createTempDbPath() });

    const response = await app.request("/api/v1/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(400);
    const errorResponse = await readJson<{ error: string }>(response);
    expect(errorResponse).toEqual({
      error: "No source configured. Save settings before triggering a scan.",
    });
  });

  it("scans configured fixtures and serves the dashboard API payloads", async () => {
    const dbPath = createTempDbPath();
    const sourcePath = createFixtureSourcePath([
      "model-overuse-session.jsonl",
      "retry-session.jsonl",
    ]);
    const app = createApiApp({ dbPath });

    const saveSettingsResponse = await app.request("/api/v1/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source: "openclaw",
        sourcePath,
        apiKey: "secret-token",
      }),
    });
    expect(saveSettingsResponse.status).toBe(200);
    const saveSettings = await readJson<{ ok: boolean }>(saveSettingsResponse);
    expect(saveSettings).toEqual({ ok: true });

    const settingsResponse = await app.request("/api/v1/settings");
    expect(settingsResponse.status).toBe(200);
    const savedSettings = await readJson<{
      source: string;
      sourcePath: string;
      hasApiKey: boolean;
    }>(settingsResponse);
    expect(savedSettings).toEqual({
      source: "openclaw",
      sourcePath,
      hasApiKey: true,
    });

    const scanResponse = await app.request("/api/v1/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ force: false }),
    });
    expect(scanResponse.status).toBe(200);

    const scan = await readJson<{
      tracesIngested: number;
      spansIngested: number;
      messagesIngested: number;
      skipped: number;
      durationMs: number;
    }>(scanResponse);

    expect(scan.tracesIngested).toBe(2);
    expect(scan.spansIngested).toBeGreaterThan(0);
    expect(scan.messagesIngested).toBeGreaterThan(0);
    expect(scan.skipped).toBe(0);
    expect(scan.durationMs).toBeGreaterThanOrEqual(0);

    const overviewResponse = await app.request("/api/v1/overview");
    expect(overviewResponse.status).toBe(200);

    const overview = await readJson<{
      totalTraces: number;
      totalCostUsd: number;
      totalWastedUsd: number;
      wastePercentage: number;
      tracesWithWaste: number;
      topWasteCategories: Array<{ category: string; count: number; totalWasted: number }>;
      costByDay: Array<{ date: string; costUsd: number; wastedUsd: number }>;
      lastScanAt: string | null;
    }>(overviewResponse);

    expect(overview.totalTraces).toBe(2);
    expect(overview.totalCostUsd).toBeGreaterThan(0);
    expect(overview.totalWastedUsd).toBeGreaterThan(0);
    expect(overview.wastePercentage).toBeGreaterThan(0);
    expect(overview.tracesWithWaste).toBeGreaterThan(0);
    expect(overview.topWasteCategories.length).toBeGreaterThan(0);
    expect(overview.topWasteCategories.some((entry) => entry.category === "model_overuse")).toBe(
      false,
    );
    expect(overview.costByDay.length).toBeGreaterThan(0);
    expect(overview.lastScanAt).not.toBeNull();

    const tracesResponse = await app.request("/api/v1/traces?limit=20&offset=0&sort=cost_desc");
    expect(tracesResponse.status).toBe(200);

    const traces = await readJson<{
      traces: Array<{
        id: string;
        externalId: string;
        spanCount: number;
        totalCostUsd: number;
        wasteUsd: number;
      }>;
      total: number;
    }>(tracesResponse);

    expect(traces.total).toBe(2);
    expect(traces.traces).toHaveLength(2);
    expect(traces.traces.every((trace) => trace.spanCount > 0)).toBe(true);

    const modelOveruseTrace = traces.traces.find(
      (trace) => trace.externalId === "model-overuse-session",
    );
    expect(modelOveruseTrace).toBeDefined();
    if (!modelOveruseTrace) {
      throw new Error("Expected a model-overuse trace summary.");
    }

    expect(modelOveruseTrace.totalCostUsd).toBeGreaterThan(0);

    const traceDetailResponse = await app.request(`/api/v1/traces/${modelOveruseTrace.id}`);
    expect(traceDetailResponse.status).toBe(200);

    const traceDetail = await readJson<{
      trace: { id: string; spanCount: number; wasteUsd: number };
      spans: Array<{ id: string }>;
      segments: Array<{ id: string }>;
      wasteReports: Array<{ id: string; category: string; wastedCostUsd: number }>;
      topSpans: Array<{ id: string }>;
      messages: Array<{ id: string }>;
      costBreakdown: { totalCostUsd: number; wastedCostUsd: number };
    }>(traceDetailResponse);

    expect(traceDetail.trace.id).toBe(modelOveruseTrace.id);
    expect(traceDetail.trace.spanCount).toBeGreaterThan(0);
    expect(traceDetail.spans.length).toBeGreaterThan(0);
    expect(traceDetail.segments.length).toBeGreaterThan(0);
    expect(traceDetail.wasteReports.length).toBeGreaterThan(0);
    expect(traceDetail.wasteReports.some((report) => report.category === "model_overuse")).toBe(
      true,
    );
    expect(traceDetail.topSpans.length).toBeGreaterThan(0);
    expect(traceDetail.messages.length).toBeGreaterThan(0);
    expect(traceDetail.costBreakdown.totalCostUsd).toBeGreaterThan(0);

    const rawReportedWaste = traceDetail.wasteReports.reduce(
      (total, report) => total + report.wastedCostUsd,
      0,
    );
    expect(traceDetail.trace.wasteUsd).toBe(traceDetail.costBreakdown.wastedCostUsd);
    expect(traceDetail.costBreakdown.wastedCostUsd).toBeLessThan(rawReportedWaste);

    const wasteResponse = await app.request("/api/v1/waste?limit=10&offset=0");
    expect(wasteResponse.status).toBe(200);

    const waste = await readJson<{
      reports: Array<{ id: string }>;
      total: number;
      summary: {
        totalWastedTokens: number;
        totalWastedUsd: number;
        byCategory: Array<{ category: string; count: number; wastedUsd: number }>;
      };
    }>(wasteResponse);

    expect(waste.total).toBeGreaterThan(0);
    expect(waste.reports.length).toBeGreaterThan(0);
    expect(waste.summary.totalWastedTokens).toBeGreaterThan(0);
    expect(waste.summary.totalWastedUsd).toBeGreaterThan(0);
    expect(waste.summary.byCategory.length).toBeGreaterThan(0);

    const recommendationsResponse = await app.request("/api/v1/waste/recommendations");
    expect(recommendationsResponse.status).toBe(200);

    const recommendations = await readJson<{
      recommendations: Array<{
        category: string;
        description: string;
        affectedTraces: number;
        estimatedSavingsUsd: number;
        priority: string;
      }>;
    }>(recommendationsResponse);

    expect(recommendations.recommendations.length).toBeGreaterThan(0);
    expect(recommendations.recommendations.some((item) => item.category === "model_overuse")).toBe(
      false,
    );
    const firstRecommendation = recommendations.recommendations[0];
    expect(firstRecommendation).toBeDefined();
    if (!firstRecommendation) {
      throw new Error("Expected at least one recommendation.");
    }

    expect(firstRecommendation.estimatedSavingsUsd).toBeGreaterThan(0);

    const segmentsResponse = await app.request("/api/v1/segments/breakdown");
    expect(segmentsResponse.status).toBe(200);

    const segments = await readJson<{
      byType: Array<{
        type: string;
        totalTokens: number;
        totalCostUsd: number;
        percentage: number;
      }>;
      totalTokens: number;
      totalCostUsd: number;
    }>(segmentsResponse);

    expect(segments.byType.length).toBeGreaterThan(0);
    expect(segments.totalTokens).toBeGreaterThan(0);
    expect(segments.totalCostUsd).toBeGreaterThan(0);

    const healthResponse = await app.request("/api/v1/health");
    expect(healthResponse.status).toBe(200);

    const health = await readJson<{
      traceCount: number;
      spanCount: number;
      messageCount: number;
      traceLimit: number;
    }>(healthResponse);

    expect(health.traceCount).toBe(2);
    expect(health.spanCount).toBeGreaterThan(0);
    expect(health.messageCount).toBeGreaterThan(0);
    expect(health.traceLimit).toBe(500);
  });
});
