import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Database } from "bun:sqlite";

import { createDb, getSqliteClient, migrate } from "./index";
import { createAnalysisRunRepository } from "./repositories/analysis";
import { createFaultReportRepository } from "./repositories/faults";
import { createIngestionStateRepository } from "./repositories/ingestion";
import { createMessageRepository } from "./repositories/messages";
import { createSegmentRepository } from "./repositories/segments";
import { createSpanRepository } from "./repositories/spans";
import { createTraceRepository } from "./repositories/traces";
import { createWasteReportRepository } from "./repositories/waste";

const cleanupPaths: string[] = [];
const cleanupDatabases: Database[] = [];

afterEach(() => {
  while (cleanupDatabases.length > 0) {
    cleanupDatabases.pop()?.close(false);
  }

  while (cleanupPaths.length > 0) {
    const path = cleanupPaths.pop();
    if (path) {
      rmSync(path, { force: true, recursive: true });
    }
  }
});

function createTempDatabase() {
  const directory = mkdtempSync(join(tmpdir(), "langcost-db-"));
  cleanupPaths.push(directory);

  const dbPath = join(directory, "langcost.db");
  const db = createDb(dbPath);
  migrate(db);
  cleanupDatabases.push(getSqliteClient(db));
  return db;
}

describe("database client", () => {
  it("enables WAL mode and foreign keys", () => {
    const db = createTempDatabase();

    const sqlite = getSqliteClient(db);
    const journalMode = sqlite.query("PRAGMA journal_mode").get() as { journal_mode: string };
    const foreignKeys = sqlite.query("PRAGMA foreign_keys").get() as { foreign_keys: number };

    expect(journalMode.journal_mode.toLowerCase()).toBe("wal");
    expect(foreignKeys.foreign_keys).toBe(1);
  });

  it("round-trips rows across all foundation tables", () => {
    const db = createTempDatabase();

    const traceRepository = createTraceRepository(db);
    const spanRepository = createSpanRepository(db);
    const messageRepository = createMessageRepository(db);
    const segmentRepository = createSegmentRepository(db);
    const wasteRepository = createWasteReportRepository(db);
    const faultRepository = createFaultReportRepository(db);
    const ingestionRepository = createIngestionStateRepository(db);
    const analysisRepository = createAnalysisRunRepository(db);

    const startedAt = new Date("2026-03-21T09:00:00.000Z");
    const endedAt = new Date("2026-03-21T09:02:00.000Z");
    const analyzedAt = new Date("2026-03-21T09:03:00.000Z");
    const detectedAt = new Date("2026-03-21T09:04:00.000Z");
    const updatedAt = new Date("2026-03-21T09:05:00.000Z");

    traceRepository.upsert({
      id: "trace-1",
      externalId: "ext-trace-1",
      source: "openclaw",
      sessionKey: "session-1",
      agentId: "agent-1",
      startedAt,
      endedAt,
      totalInputTokens: 120,
      totalOutputTokens: 80,
      totalCostUsd: 0.42,
      model: "claude-sonnet-4",
      status: "complete",
      metadata: { cwd: "/workspace" },
      ingestedAt: updatedAt
    });

    spanRepository.upsert({
      id: "span-1",
      traceId: "trace-1",
      externalId: "ext-span-1",
      type: "llm",
      name: "Main call",
      startedAt,
      endedAt,
      durationMs: 120000,
      model: "claude-sonnet-4",
      provider: "anthropic",
      inputTokens: 120,
      outputTokens: 80,
      costUsd: 0.42,
      status: "ok",
      metadata: { turn: 1 }
    });

    messageRepository.upsert({
      id: "message-1",
      spanId: "span-1",
      traceId: "trace-1",
      role: "user",
      content: "Fix the bug",
      tokenCount: 3,
      position: 0,
      metadata: { source: "prompt" }
    });

    segmentRepository.upsert({
      id: "segment-1",
      spanId: "span-1",
      traceId: "trace-1",
      type: "user_query",
      tokenCount: 3,
      costUsd: 0.01,
      percentOfSpan: 0.025,
      contentHash: "abc123",
      analyzedAt
    });

    wasteRepository.upsert({
      id: "waste-1",
      traceId: "trace-1",
      spanId: "span-1",
      category: "agent_loop",
      severity: "medium",
      wastedTokens: 20,
      wastedCostUsd: 0.05,
      description: "Repeated tool sequence detected.",
      recommendation: "Add loop guards.",
      estimatedSavingsUsd: 1.25,
      evidence: { sequence: ["bash", "read"] },
      detectedAt
    });

    faultRepository.upsert({
      id: "fault-1",
      traceId: "trace-1",
      faultSpanId: "span-1",
      faultType: "tool_failure",
      description: "The tool call failed upstream.",
      cascadeDepth: 1,
      affectedSpanIds: ["span-1"],
      detectedAt
    });

    ingestionRepository.upsert({
      sourcePath: "/tmp/session.jsonl",
      adapter: "openclaw",
      lastOffset: 512,
      lastLineHash: "line-hash",
      lastSessionId: "session-1",
      updatedAt
    });

    analysisRepository.upsert({
      id: "analysis-1",
      analyzerName: "cost-analyzer",
      startedAt,
      completedAt: detectedAt,
      tracesAnalyzed: 1,
      findingsCount: 1,
      status: "complete"
    });

    expect(traceRepository.count()).toBe(1);
    expect(spanRepository.count()).toBe(1);
    expect(messageRepository.count()).toBe(1);
    expect(traceRepository.getById("trace-1")?.metadata).toEqual({ cwd: "/workspace" });
    expect(spanRepository.listByTraceId("trace-1")[0]?.provider).toBe("anthropic");
    expect(messageRepository.listBySpanId("span-1")[0]?.content).toBe("Fix the bug");
    expect(segmentRepository.listByTraceId("trace-1")[0]?.type).toBe("user_query");
    expect(wasteRepository.listByTraceId("trace-1")[0]?.category).toBe("agent_loop");
    expect(faultRepository.listByTraceId("trace-1")[0]?.faultType).toBe("tool_failure");
    expect(ingestionRepository.getBySourcePath("/tmp/session.jsonl")?.lastOffset).toBe(512);
    expect(analysisRepository.listLatest(1)[0]?.analyzerName).toBe("cost-analyzer");
    expect(traceRepository.totals()).toEqual({
      totalCostUsd: 0.42,
      totalInputTokens: 120,
      totalOutputTokens: 80
    });
    expect(segmentRepository.summarizeByType()[0]).toEqual({
      type: "user_query",
      totalTokens: 3,
      totalCostUsd: 0.01
    });
    expect(wasteRepository.summarizeByCategory()[0]).toEqual({
      category: "agent_loop",
      count: 1,
      totalWastedTokens: 20,
      totalWastedCostUsd: 0.05
    });
  });
});
