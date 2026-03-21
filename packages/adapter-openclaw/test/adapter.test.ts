import { afterEach, describe, expect, it } from "bun:test";
import { appendFileSync, copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Database } from "bun:sqlite";

import {
  createDb,
  createIngestionStateRepository,
  createMessageRepository,
  createSpanRepository,
  createTraceRepository,
  getSqliteClient,
  migrate
} from "@langcost/db";

import openClawAdapter from "../src/index";

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
  const directory = mkdtempSync(join(tmpdir(), "langcost-openclaw-db-"));
  cleanupPaths.push(directory);

  const db = createDb(join(directory, "langcost.db"));
  migrate(db);
  cleanupDatabases.push(getSqliteClient(db));
  return db;
}

function copyFixtureToTempFile(fixtureName: string): string {
  const directory = mkdtempSync(join(tmpdir(), "langcost-openclaw-fixture-"));
  cleanupPaths.push(directory);

  const sourcePath = join(process.cwd(), "fixtures", "openclaw", fixtureName);
  const targetPath = join(directory, fixtureName);
  copyFileSync(sourcePath, targetPath);
  return targetPath;
}

describe("openClawAdapter", () => {
  it("exports a usable default adapter from the package entry point", async () => {
    const fixture = join(process.cwd(), "fixtures", "openclaw", "simple-session.jsonl");
    const validation = await openClawAdapter.validate({ file: fixture });

    expect(openClawAdapter.meta.name).toBe("openclaw");
    expect(validation.ok).toBe(true);
  });

  it("validates fixture-backed session files", async () => {
    const fixture = join(process.cwd(), "fixtures", "openclaw", "simple-session.jsonl");
    const validation = await openClawAdapter.validate({ file: fixture });

    expect(validation.ok).toBe(true);
    expect(validation.message.includes("Found OpenClaw session file")).toBe(true);
  });

  it("ingests a simple session and skips it on a second run", async () => {
    const db = createTempDb();
    const fixture = join(process.cwd(), "fixtures", "openclaw", "simple-session.jsonl");

    const firstResult = await openClawAdapter.ingest(db, { file: fixture });
    const secondResult = await openClawAdapter.ingest(db, { file: fixture });

    const traceRepository = createTraceRepository(db);
    const spanRepository = createSpanRepository(db);
    const trace = traceRepository.list(1, 0)[0];

    expect(firstResult.tracesIngested).toBe(1);
    expect(firstResult.spansIngested).toBe(3);
    expect(firstResult.messagesIngested).toBe(4);
    expect(secondResult.skipped).toBe(1);
    expect(trace?.source).toBe("openclaw");
    expect(trace?.status).toBe("complete");
    expect(spanRepository.listByTraceId(trace!.id)).toHaveLength(3);
  });

  it("re-ingests a session file after the source file changes", async () => {
    const db = createTempDb();
    const fixture = copyFixtureToTempFile("simple-session.jsonl");

    const firstResult = await openClawAdapter.ingest(db, { file: fixture });
    const firstState = createIngestionStateRepository(db).getBySourcePath(fixture);

    appendFileSync(
      fixture,
      `\n${JSON.stringify({
        type: "message",
        timestamp: "2026-03-20T10:00:05.000Z",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Follow-up after file change." }],
          api: "anthropic-messages",
          provider: "anthropic",
          model: "claude-sonnet-4-20250514",
          usage: {
            input: 10,
            output: 5,
            totalTokens: 15,
            cost: { input: 0.00003, output: 0.000075, total: 0.000105 }
          },
          stopReason: "stop",
          timestamp: 1760000005000
        }
      })}\n`
    );

    const secondResult = await openClawAdapter.ingest(db, { file: fixture });
    const trace = createTraceRepository(db).list(1, 0)[0];
    const spans = createSpanRepository(db).listByTraceId(trace!.id);
    const messages = createMessageRepository(db).listByTraceId(trace!.id);
    const secondState = createIngestionStateRepository(db).getBySourcePath(fixture);

    expect(firstResult.tracesIngested).toBe(1);
    expect(secondResult.skipped).toBe(0);
    expect(secondResult.tracesIngested).toBe(1);
    expect(spans.filter((span) => span.type === "llm")).toHaveLength(3);
    expect(messages.at(-1)?.content).toContain("Follow-up after file change.");
    expect(secondState?.lastOffset).toBeGreaterThan(firstState?.lastOffset ?? 0);
  });

  it("marks traces partial and estimates usage when assistant usage is missing", async () => {
    const db = createTempDb();
    const fixture = join(process.cwd(), "fixtures", "openclaw", "missing-usage.jsonl");

    await openClawAdapter.ingest(db, { file: fixture });

    const traceRepository = createTraceRepository(db);
    const spanRepository = createSpanRepository(db);
    const trace = traceRepository.list(1, 0)[0];
    const spans = spanRepository.listByTraceId(trace!.id);
    const estimatedLlmSpan = spans.find((span) => span.type === "llm" && (span.inputTokens ?? 0) > 0 && (span.costUsd ?? 0) > 0);

    expect(trace?.status).toBe("partial");
    expect(estimatedLlmSpan).toBeDefined();
    expect(estimatedLlmSpan?.model).toBe("gpt-4o-mini");
  });

  it("returns trace messages in chronological order", async () => {
    const db = createTempDb();
    const fixture = join(process.cwd(), "fixtures", "openclaw", "simple-session.jsonl");

    await openClawAdapter.ingest(db, { file: fixture });

    const trace = createTraceRepository(db).list(1, 0)[0];
    const messages = createMessageRepository(db).listByTraceId(trace!.id);

    expect(messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "tool",
      "assistant"
    ]);
  });

  it("tracks model changes across assistant turns", async () => {
    const db = createTempDb();
    const fixture = join(process.cwd(), "fixtures", "openclaw", "model-switch.jsonl");

    await openClawAdapter.ingest(db, { file: fixture });

    const traceRepository = createTraceRepository(db);
    const spanRepository = createSpanRepository(db);
    const trace = traceRepository.list(1, 0)[0];
    const llmSpans = spanRepository
      .listByTraceId(trace!.id)
      .filter((span) => span.type === "llm");

    expect(llmSpans).toHaveLength(2);
    expect(llmSpans.some((span) => span.model === "claude-sonnet-4-20250514")).toBe(true);
    expect(llmSpans.some((span) => span.model === "gpt-4o-mini")).toBe(true);
  });

  it("marks traces error when tool calls fail", async () => {
    const db = createTempDb();
    const fixture = join(process.cwd(), "fixtures", "openclaw", "tool-heavy.jsonl");

    await openClawAdapter.ingest(db, { file: fixture });

    const trace = createTraceRepository(db).list(1, 0)[0];
    const toolSpans = createSpanRepository(db)
      .listByTraceId(trace!.id)
      .filter((span) => span.type === "tool");
    const failedToolSpan = toolSpans.find((span) => span.toolName === "bash");

    expect(trace?.status).toBe("error");
    expect(toolSpans).toHaveLength(2);
    expect(failedToolSpan?.status).toBe("error");
    expect(failedToolSpan?.toolSuccess).toBe(false);
  });

  it("records compaction metadata on traces", async () => {
    const db = createTempDb();
    const fixture = join(process.cwd(), "fixtures", "openclaw", "with-compaction.jsonl");

    await openClawAdapter.ingest(db, { file: fixture });

    const trace = createTraceRepository(db).list(1, 0)[0];

    expect(trace?.status).toBe("complete");
    expect(trace?.metadata).toMatchObject({ compactionCount: 1 });
  });

  it("ingests the real pi-mono fixture shape without parse errors", async () => {
    const db = createTempDb();
    const fixture = join(process.cwd(), "fixtures", "openclaw", "before-compaction.jsonl");

    const result = await openClawAdapter.ingest(db, { file: fixture });
    const trace = createTraceRepository(db).list(1, 0)[0];

    expect(result.tracesIngested).toBe(1);
    expect(result.spansIngested).toBeGreaterThan(100);
    expect(result.messagesIngested).toBeGreaterThan(100);
    expect(result.errors).toHaveLength(0);
    expect(trace?.source).toBe("openclaw");
  });
});
