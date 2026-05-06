import { Database } from "bun:sqlite";
import type { Database as BunDatabase } from "bun:sqlite";
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

import warpAdapter from "../src/index";

const cleanupPaths: string[] = [];
const cleanupDatabases: BunDatabase[] = [];

afterEach(() => {
  while (cleanupDatabases.length > 0) {
    cleanupDatabases.pop()?.close(false);
  }
  while (cleanupPaths.length > 0) {
    const path = cleanupPaths.pop();
    if (path) rmSync(path, { recursive: true, force: true });
  }
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "langcost-warp-test-"));
  cleanupPaths.push(dir);
  return dir;
}

function createLangcostDb() {
  const dir = tempDir();
  const db = createDb(join(dir, "langcost.db"));
  migrate(db);
  cleanupDatabases.push(getSqliteClient(db));
  return db;
}

type WarpFixtureOptions = {
  exitCode?: number;
  outputStatus?: string;
  blockCount?: number;
  conversationCount?: number;
  tokenUsage?: { model_id: string; byok_tokens: number; category: string }[];
};

function createWarpFixture(options: WarpFixtureOptions = {}): string {
  const dir = tempDir();
  const dbPath = join(dir, "warp.sqlite");
  const {
    exitCode = 0,
    outputStatus = '"Completed"',
    blockCount = 1,
    conversationCount = 1,
    tokenUsage = [
      { model_id: "Claude Sonnet 4.6", byok_tokens: 1000, category: "primary_agent" },
    ],
  } = options;

  const db = new Database(dbPath);

  db.exec(`
    CREATE TABLE agent_conversations (
      id INTEGER PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      conversation_data TEXT NOT NULL,
      last_modified_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE ai_queries (
      id INTEGER PRIMARY KEY,
      exchange_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      start_ts DATETIME NOT NULL,
      input TEXT NOT NULL DEFAULT '[]',
      working_directory TEXT,
      output_status TEXT NOT NULL DEFAULT '',
      model_id TEXT NOT NULL DEFAULT '',
      planning_model_id TEXT NOT NULL DEFAULT '',
      coding_model_id TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE blocks (
      id INTEGER PRIMARY KEY,
      block_id TEXT NOT NULL DEFAULT '',
      pane_leaf_uuid BLOB NOT NULL DEFAULT x'',
      stylized_command BLOB NOT NULL DEFAULT x'',
      stylized_output BLOB NOT NULL DEFAULT x'',
      exit_code INTEGER NOT NULL DEFAULT 0,
      did_execute BOOLEAN NOT NULL DEFAULT 1,
      completed_ts DATETIME,
      start_ts DATETIME,
      ai_metadata TEXT
    );
  `);

  const convData = {
    run_id: "run-test",
    conversation_usage_metadata: {
      credits_spent: 0,
      context_window_usage: 0.05,
      was_summarized: false,
      token_usage: tokenUsage.map(({ model_id, byok_tokens, category }) => ({
        model_id,
        warp_tokens: 0,
        byok_tokens,
        warp_token_usage_by_category: {},
        byok_token_usage_by_category: { [category]: byok_tokens },
      })),
    },
  };

  const insertConv = db.prepare(
    "INSERT INTO agent_conversations (conversation_id, conversation_data, last_modified_at) VALUES (?, ?, ?)",
  );
  const insertQuery = db.prepare(
    "INSERT INTO ai_queries (exchange_id, conversation_id, start_ts, input, output_status, model_id) VALUES (?, ?, ?, ?, ?, ?)",
  );
  const insertBlock = db.prepare(
    "INSERT INTO blocks (block_id, pane_leaf_uuid, stylized_command, stylized_output, exit_code, did_execute, start_ts, completed_ts, ai_metadata) VALUES (?, x'', ?, ?, ?, 1, ?, ?, ?)",
  );

  for (let c = 0; c < conversationCount; c++) {
    const convId = `conv-${c + 1}`;
    const modifiedAt = `2026-03-20 10:0${c}:10`;
    insertConv.run(convId, JSON.stringify(convData), modifiedAt);

    const exchangeInput = JSON.stringify([
      { Query: { text: `Task ${c + 1}`, context: [] } },
    ]);
    insertQuery.run(
      `ex-${c + 1}`,
      convId,
      `2026-03-20 10:0${c}:01`,
      exchangeInput,
      outputStatus,
      "claude-4-6-sonnet-high",
    );

    for (let b = 0; b < blockCount; b++) {
      insertBlock.run(
        `block-${c + 1}-${b + 1}`,
        Buffer.from("git status"),
        Buffer.from("On branch main"),
        exitCode,
        `2026-03-20 10:0${c}:03`,
        `2026-03-20 10:0${c}:04`,
        JSON.stringify({
          requested_command_action_id: `toolu_${c + 1}_${b + 1}`,
          conversation_id: convId,
          subagent_task_id: null,
        }),
      );
    }
  }

  db.close();
  return dbPath;
}

describe("warpAdapter", () => {
  describe("meta", () => {
    it("exports the correct adapter name", () => {
      expect(warpAdapter.meta.name).toBe("warp");
    });

    it("exports sourceType local", () => {
      expect(warpAdapter.meta.sourceType).toBe("local");
    });
  });

  describe("validate", () => {
    it("returns ok for a valid warp.sqlite with all required tables", async () => {
      const dbPath = createWarpFixture();

      const result = await warpAdapter.validate({ sourcePath: dbPath });

      expect(result.ok).toBe(true);
    });

    it("returns a friendly error when warp.sqlite is not found", async () => {
      const result = await warpAdapter.validate({
        sourcePath: join(tempDir(), "missing.sqlite"),
      });

      expect(result.ok).toBe(false);
      expect(result.message).toContain("not found");
    });
  });

  describe("ingest", () => {
    it("ingests one trace, one LLM span, one tool span, and one message per conversation", async () => {
      const db = createLangcostDb();
      const dbPath = createWarpFixture();

      const result = await warpAdapter.ingest(db, { sourcePath: dbPath });

      expect(result.tracesIngested).toBe(1);
      expect(result.spansIngested).toBe(2); // 1 llm + 1 tool
      expect(result.messagesIngested).toBe(2); // 1 user + 1 tool
      expect(result.errors).toHaveLength(0);
    });

    it("tags all ingested traces with source warp", async () => {
      const db = createLangcostDb();
      const dbPath = createWarpFixture();

      await warpAdapter.ingest(db, { sourcePath: dbPath });

      const trace = createTraceRepository(db).list(1, 0)[0];
      expect(trace?.source).toBe("warp");
    });

    it("ingests multiple conversations independently", async () => {
      const db = createLangcostDb();
      const dbPath = createWarpFixture({ conversationCount: 3 });

      const result = await warpAdapter.ingest(db, { sourcePath: dbPath });

      expect(result.tracesIngested).toBe(3);
    });

    it("ingests multiple blocks per conversation as separate tool spans", async () => {
      const db = createLangcostDb();
      const dbPath = createWarpFixture({ blockCount: 3 });

      await warpAdapter.ingest(db, { sourcePath: dbPath });

      const trace = createTraceRepository(db).list(1, 0)[0]!;
      const toolSpans = createSpanRepository(db)
        .listByTraceId(trace.id)
        .filter((s) => s.type === "tool");

      expect(toolSpans).toHaveLength(3);
    });

    it("marks trace as error when a block has non-zero exit code", async () => {
      const db = createLangcostDb();
      const dbPath = createWarpFixture({ exitCode: 1 });

      await warpAdapter.ingest(db, { sourcePath: dbPath });

      const trace = createTraceRepository(db).list(1, 0)[0];
      expect(trace?.status).toBe("error");
    });

    it("marks trace as error when exchange outputStatus is Failed", async () => {
      const db = createLangcostDb();
      const dbPath = createWarpFixture({ outputStatus: '"Failed"' });

      await warpAdapter.ingest(db, { sourcePath: dbPath });

      const trace = createTraceRepository(db).list(1, 0)[0];
      expect(trace?.status).toBe("error");
    });

    it("marks trace as partial when exchange outputStatus is Cancelled", async () => {
      const db = createLangcostDb();
      const dbPath = createWarpFixture({ outputStatus: '"Cancelled"' });

      await warpAdapter.ingest(db, { sourcePath: dbPath });

      const trace = createTraceRepository(db).list(1, 0)[0];
      expect(trace?.status).toBe("partial");
    });

    it("extracts user message text from the exchange prompt", async () => {
      const db = createLangcostDb();
      const dbPath = createWarpFixture();

      await warpAdapter.ingest(db, { sourcePath: dbPath });

      const trace = createTraceRepository(db).list(1, 0)[0]!;
      const messages = createMessageRepository(db).listByTraceId(trace.id);
      const userMsg = messages.find((m) => m.role === "user");

      expect(userMsg?.content).toBe("Task 1");
    });

    it("skips conversations not modified since the last ingest on second run", async () => {
      const db = createLangcostDb();
      const dbPath = createWarpFixture();

      const firstResult = await warpAdapter.ingest(db, { sourcePath: dbPath });
      const secondResult = await warpAdapter.ingest(db, { sourcePath: dbPath });

      expect(firstResult.tracesIngested).toBe(1);
      expect(secondResult.skipped).toBe(1);
      expect(secondResult.tracesIngested).toBe(0);
    });

    it("re-ingests everything when force is true", async () => {
      const db = createLangcostDb();
      const dbPath = createWarpFixture();

      await warpAdapter.ingest(db, { sourcePath: dbPath });
      const secondResult = await warpAdapter.ingest(db, { sourcePath: dbPath, force: true });

      expect(secondResult.skipped).toBe(0);
      expect(secondResult.tracesIngested).toBe(1);
    });

    it("returns a friendly error when warp.sqlite is not found", async () => {
      const db = createLangcostDb();

      const result = await warpAdapter.ingest(db, {
        sourcePath: join(tempDir(), "missing.sqlite"),
      });

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]?.message).toContain("not found");
    });

    it("normalizes Warp model ID on the ingested trace", async () => {
      const db = createLangcostDb();
      const dbPath = createWarpFixture();

      await warpAdapter.ingest(db, { sourcePath: dbPath });

      const trace = createTraceRepository(db).list(1, 0)[0];
      expect(trace?.model).toBe("claude-sonnet-4-6");
    });

    it("excludes full_terminal_use Haiku tokens from per-span estimates", async () => {
      const db = createLangcostDb();
      const dbPath = createWarpFixture({
        conversationCount: 1,
        tokenUsage: [
          { model_id: "Claude Sonnet 4.6", byok_tokens: 500, category: "primary_agent" },
          { model_id: "Claude Haiku 4.5", byok_tokens: 99999, category: "full_terminal_use" },
        ],
      });

      await warpAdapter.ingest(db, { sourcePath: dbPath });

      const trace = createTraceRepository(db).list(1, 0)[0]!;
      const llmSpan = createSpanRepository(db)
        .listByTraceId(trace.id)
        .find((s) => s.type === "llm");

      // Span tokens should reflect primary_agent (500) not the Haiku total (99999)
      const spanTotal = (llmSpan?.inputTokens ?? 0) + (llmSpan?.outputTokens ?? 0);
      expect(spanTotal).toBeLessThan(1000);
    });
  });
});
