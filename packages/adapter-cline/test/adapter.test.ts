import type { Database } from "bun:sqlite";
import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createDb,
  createMessageRepository,
  createSpanRepository,
  createTraceRepository,
  getSqliteClient,
  migrate,
} from "@langcost/db";

import clineAdapter from "../src/index";

const cleanupPaths: string[] = [];
const cleanupDatabases: Database[] = [];

afterEach(() => {
  while (cleanupDatabases.length > 0) {
    cleanupDatabases.pop()?.close(false);
  }

  while (cleanupPaths.length > 0) {
    const path = cleanupPaths.pop();
    if (path) rmSync(path, { recursive: true, force: true });
  }
});

function createTempDb() {
  const directory = mkdtempSync(join(tmpdir(), "langcost-cline-db-"));
  cleanupPaths.push(directory);

  const db = createDb(join(directory, "langcost.db"));
  migrate(db);
  cleanupDatabases.push(getSqliteClient(db));
  return db;
}

const fixtureRoot = join(process.cwd(), "fixtures", "cline", "task-1778305767614");

describe("clineAdapter", () => {
  it("exports local Cline adapter metadata", async () => {
    const validation = await clineAdapter.validate({ sourcePath: fixtureRoot });

    expect(clineAdapter.meta.name).toBe("cline");
    expect(clineAdapter.meta.sourceType).toBe("local");
    expect(validation.ok).toBe(true);
  });

  it("ingests a fixture task and skips it on a second run", async () => {
    const db = createTempDb();

    const firstResult = await clineAdapter.ingest(db, { sourcePath: fixtureRoot });
    const secondResult = await clineAdapter.ingest(db, { sourcePath: fixtureRoot });
    const trace = createTraceRepository(db).list(1, 0)[0];

    expect(firstResult.tracesIngested).toBe(1);
    expect(firstResult.spansIngested).toBe(2);
    expect(firstResult.messagesIngested).toBe(3);
    expect(secondResult.skipped).toBe(1);
    expect(trace?.source).toBe("cline");
    expect(trace?.totalCostUsd).toBeCloseTo(0.2271264);

    const spans = createSpanRepository(db).listByTraceId(trace?.id ?? "");
    const messages = createMessageRepository(db).listByTraceId(trace?.id ?? "");
    expect(spans).toHaveLength(2);
    expect(messages.map((message) => message.role)).toEqual(["user", "assistant", "assistant"]);
  });
});
