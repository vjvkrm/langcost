import type { Database } from "bun:sqlite";
import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createAnalysisRunRepository,
  createDb,
  createSegmentRepository,
  createTraceRepository,
  createWasteReportRepository,
  getSqliteClient,
  migrate,
} from "@langcost/db";

import { openClawAdapter } from "../../adapter-openclaw/src/index";
import { costAnalyzer, runPipeline, wasteDetector } from "../src/index";

const cleanupPaths: string[] = [];
const cleanupDatabases: Database[] = [];

afterEach(() => {
  while (cleanupDatabases.length > 0) {
    cleanupDatabases.pop()?.close(false);
  }

  while (cleanupPaths.length > 0) {
    const path = cleanupPaths.pop();
    if (path) {
      rmSync(path, { recursive: true, force: true });
    }
  }
});

function createTempDb() {
  const directory = mkdtempSync(join(tmpdir(), "langcost-analyzers-db-"));
  cleanupPaths.push(directory);

  const db = createDb(join(directory, "langcost.db"));
  migrate(db);
  cleanupDatabases.push(getSqliteClient(db));
  return db;
}

async function ingestFixture(db: ReturnType<typeof createDb>, fixtureName: string) {
  const fixture = join(process.cwd(), "fixtures", "openclaw", fixtureName);
  await openClawAdapter.ingest(db, { file: fixture });

  const trace = createTraceRepository(db)
    .listForAnalysis()
    .find((candidate) => String(candidate.metadata?.sourceFile ?? "").endsWith(fixtureName));

  if (!trace) {
    throw new Error(`Trace not found for fixture ${fixtureName}`);
  }

  return trace;
}

function readSourceFiles(rootPath: string): string[] {
  const entries = readdirSync(rootPath, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const path = join(rootPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...readSourceFiles(path));
      continue;
    }

    if (entry.isFile() && path.endsWith(".ts")) {
      files.push(path);
    }
  }

  return files;
}

describe("@langcost/analyzers", () => {
  it("costAnalyzer aggregates span usage into coarse segments", async () => {
    const db = createTempDb();
    const trace = await ingestFixture(db, "simple-session.jsonl");

    const result = await costAnalyzer.analyze(db, { traceIds: [trace.id] });
    const segments = createSegmentRepository(db).listByTraceId(trace.id);
    const totalSegmentCost = segments.reduce((sum, segment) => sum + segment.costUsd, 0);

    expect(result.tracesAnalyzed).toBe(1);
    expect(result.findingsCount).toBeGreaterThan(0);
    expect(segments.some((segment) => segment.type === "user_query")).toBe(true);
    expect(segments.some((segment) => segment.type === "assistant_response")).toBe(true);
    expect(segments.some((segment) => segment.type === "tool_result")).toBe(true);
    expect(totalSegmentCost).toBeCloseTo(trace.totalCostUsd, 8);
  });

  it("detects low cache utilization", async () => {
    const db = createTempDb();
    const trace = await ingestFixture(db, "expensive-session.jsonl");

    await wasteDetector.analyze(db, { traceIds: [trace.id] });

    const reports = createWasteReportRepository(db).listByTraceId(trace.id);
    expect(reports.some((report) => report.category === "low_cache_utilization")).toBe(true);
  });

  it("detects expensive model overuse", async () => {
    const db = createTempDb();
    const trace = await ingestFixture(db, "model-overuse-session.jsonl");

    await wasteDetector.analyze(db, { traceIds: [trace.id] });

    const reports = createWasteReportRepository(db).listByTraceId(trace.id);
    expect(reports.some((report) => report.category === "model_overuse")).toBe(true);
  });

  it("detects agent loops", async () => {
    const db = createTempDb();
    const trace = await ingestFixture(db, "agent-loop.jsonl");

    await wasteDetector.analyze(db, { traceIds: [trace.id] });

    const reports = createWasteReportRepository(db).listByTraceId(trace.id);
    expect(reports.some((report) => report.category === "agent_loop")).toBe(true);
  });

  it("detects retry patterns", async () => {
    const db = createTempDb();
    const trace = await ingestFixture(db, "retry-session.jsonl");

    await wasteDetector.analyze(db, { traceIds: [trace.id] });

    const reports = createWasteReportRepository(db).listByTraceId(trace.id);
    expect(reports.some((report) => report.category === "retry_waste")).toBe(true);
  });

  it("does not flag tool failures the agent treated as a signal (no retry)", async () => {
    const db = createTempDb();
    const trace = await ingestFixture(db, "tool-heavy.jsonl");

    await wasteDetector.analyze(db, { traceIds: [trace.id] });

    const reports = createWasteReportRepository(db).listByTraceId(trace.id);
    expect(reports.some((report) => report.category === "tool_failure_waste")).toBe(false);
  });

  it("detects unusually high output spans", async () => {
    const db = createTempDb();
    const trace = await ingestFixture(db, "high-output-session.jsonl");

    await wasteDetector.analyze(db, { traceIds: [trace.id] });

    const reports = createWasteReportRepository(db).listByTraceId(trace.id);
    expect(reports.some((report) => report.category === "high_output")).toBe(true);
  });

  it("runs analyzers in priority order and records analysis_runs", async () => {
    const db = createTempDb();
    const simpleTrace = await ingestFixture(db, "simple-session.jsonl");
    const toolTrace = await ingestFixture(db, "tool-heavy.jsonl");

    const result = await runPipeline(db, undefined, {
      traceIds: [simpleTrace.id, toolTrace.id],
    });

    const runs = createAnalysisRunRepository(db).listAll();

    expect(result.analyzerResults.map((entry) => entry.analyzerName)).toEqual([
      "cost-analyzer",
      "waste-detector",
    ]);
    expect(runs).toHaveLength(2);
    expect(runs.map((run) => run.analyzerName)).toEqual(["cost-analyzer", "waste-detector"]);
    expect(runs.every((run) => run.status === "complete")).toBe(true);
  });

  it("keeps analyzer source free of adapter-specific references", () => {
    const sourceFiles = readSourceFiles(join(process.cwd(), "packages", "analyzers", "src"));

    for (const sourceFile of sourceFiles) {
      const content = readFileSync(sourceFile, "utf8");
      expect(content.toLowerCase().includes("openclaw")).toBe(false);
    }
  });
});
