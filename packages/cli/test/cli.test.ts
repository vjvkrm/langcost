import { Database } from "bun:sqlite";
import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createDb,
  createSettingsRepository,
  createTraceRepository,
  getSqliteClient,
  migrate,
} from "@langcost/db";
import { loadAdapter } from "../src/adapter-loader";
import { runDashboardCommand } from "../src/commands/dashboard";
import { parseArgv, parseSinceArgument } from "../src/config";
import { main } from "../src/index";

const cleanupPaths: string[] = [];

afterEach(() => {
  while (cleanupPaths.length > 0) {
    const path = cleanupPaths.pop();
    if (path) {
      rmSync(path, { recursive: true, force: true });
    }
  }
});

function createBufferRuntime() {
  const stdout: string[] = [];
  const stderr: string[] = [];

  return {
    stdout,
    stderr,
    runtime: {
      io: {
        write(message: string) {
          stdout.push(message);
        },
        error(message: string) {
          stderr.push(message);
        },
        useColor: false,
      },
      now: () => new Date("2026-03-21T12:00:00.000Z"),
    },
  };
}

function createTempDbPath(): string {
  const directory = mkdtempSync(join(tmpdir(), "langcost-cli-test-"));
  cleanupPaths.push(directory);
  return join(directory, "langcost.db");
}

function createWarpFixturePath(): string {
  const directory = mkdtempSync(join(tmpdir(), "langcost-cli-warp-fixture-"));
  cleanupPaths.push(directory);
  const dbPath = join(directory, "warp.sqlite");
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

  db.prepare(
    "INSERT INTO agent_conversations (conversation_id, conversation_data, last_modified_at) VALUES (?, ?, ?)",
  ).run(
    "warp-conv-1",
    JSON.stringify({
      run_id: "run-test",
      conversation_usage_metadata: {
        credits_spent: 1,
        context_window_usage: 0.05,
        was_summarized: false,
        token_usage: [
          {
            model_id: "Claude Sonnet 4.6",
            warp_tokens: 1000,
            byok_tokens: 2000,
            warp_token_usage_by_category: { primary_agent: 1000 },
            byok_token_usage_by_category: { primary_agent: 2000 },
          },
        ],
      },
    }),
    "2026-03-20 10:00:10",
  );

  db.prepare(
    "INSERT INTO ai_queries (exchange_id, conversation_id, start_ts, input, output_status, model_id) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(
    "warp-ex-1",
    "warp-conv-1",
    "2026-03-20 10:00:01",
    JSON.stringify([{ Query: { text: "Do the thing", context: [] } }]),
    '"Completed"',
    "claude-4-6-sonnet-high",
  );

  db.prepare(
    "INSERT INTO blocks (block_id, pane_leaf_uuid, stylized_command, stylized_output, exit_code, did_execute, start_ts, completed_ts, ai_metadata) VALUES (?, x'', ?, ?, ?, 1, ?, ?, ?)",
  ).run(
    "warp-block-1",
    Buffer.from("git status"),
    Buffer.from("On branch main"),
    0,
    "2026-03-20 10:00:03",
    "2026-03-20 10:00:04",
    JSON.stringify({
      requested_command_action_id: "toolu_warp_1",
      conversation_id: "warp-conv-1",
      subagent_task_id: null,
    }),
  );

  db.close();
  return dbPath;
}

describe("langcost", () => {
  it("parses shorthand scan args", () => {
    const parsed = parseArgv(["--source", "openclaw"]);

    expect(parsed.command).toBe("scan");
    if (parsed.command === "scan") {
      expect(parsed.source).toBe("openclaw");
    }
  });

  it("parses --since with a 30 day default and allows all", () => {
    const now = new Date("2026-03-21T12:00:00.000Z");
    const parsed = parseSinceArgument(undefined, now);

    expect(parsed?.toISOString()).toBe("2026-02-19T12:00:00.000Z");
    expect(parseSinceArgument("90d", now)?.toISOString()).toBeDefined();
    expect(parseSinceArgument("all", now)).toBeUndefined();
  });

  it("parses --warp-plan for Warp scans", () => {
    const parsed = parseArgv(["scan", "--source", "warp", "--warp-plan", "business"]);

    expect(parsed.command).toBe("scan");
    if (parsed.command === "scan") {
      expect(parsed.warpPlan).toBe("business");
    }
  });

  it("rejects invalid --warp-plan values", () => {
    expect(() =>
      parseArgv(["scan", "--source", "warp", "--warp-plan", "not-a-plan"]),
    ).toThrow("Invalid --warp-plan value: not-a-plan");
  });

  it("returns a friendly error when an adapter is missing", async () => {
    await expect(loadAdapter("missing-adapter")).rejects.toThrow(
      'Adapter "missing-adapter" not found.',
    );
  });

  it("runs scan end to end through the dynamic adapter loader", async () => {
    const { stdout, stderr, runtime } = createBufferRuntime();
    const dbPath = createTempDbPath();
    const fixture = join(process.cwd(), "fixtures", "openclaw", "simple-session.jsonl");

    const exitCode = await main(
      ["scan", "--source", "openclaw", "--file", fixture, "--db", dbPath],
      runtime,
    );

    expect(exitCode).toBe(0);
    expect(stderr.join("")).toBe("");
    expect(stdout.join("")).toContain("Scanned 1 session from openclaw");
    expect(stdout.join("")).toContain("Total cost:");
  });

  it("renders report output from the database", async () => {
    const dbPath = createTempDbPath();
    const fixture = join(process.cwd(), "fixtures", "openclaw", "simple-session.jsonl");
    const setupRuntime = createBufferRuntime();
    await main(
      ["scan", "--source", "openclaw", "--file", fixture, "--db", dbPath],
      setupRuntime.runtime,
    );

    const { stdout, runtime } = createBufferRuntime();
    const exitCode = await main(["report", "--db", dbPath], runtime);

    expect(exitCode).toBe(0);
    expect(stdout.join("")).toContain("Project");
    expect(stdout.join("")).toContain("Cost");
  });

  it("renders status output from the database", async () => {
    const dbPath = createTempDbPath();
    const fixture = join(process.cwd(), "fixtures", "openclaw", "simple-session.jsonl");
    const setupRuntime = createBufferRuntime();
    await main(
      ["scan", "--source", "openclaw", "--file", fixture, "--db", dbPath],
      setupRuntime.runtime,
    );

    const { stdout, runtime } = createBufferRuntime();
    const exitCode = await main(["status", "--db", dbPath], runtime);

    expect(exitCode).toBe(0);
    expect(stdout.join("")).toContain("Database:");
    expect(stdout.join("")).toContain("Traces:");
    expect(stdout.join("")).toContain("Adapters used: openclaw");
  });

  it("accepts --since beyond 60 days without error", async () => {
    const { stdout, stderr, runtime } = createBufferRuntime();
    const dbPath = createTempDbPath();
    const fixture = join(process.cwd(), "fixtures", "openclaw", "simple-session.jsonl");

    const exitCode = await main(
      ["scan", "--source", "openclaw", "--file", fixture, "--since", "90d", "--db", dbPath],
      runtime,
    );

    expect(exitCode).toBe(0);
    expect(stderr.join("")).toBe("");
    expect(stdout.join("")).toContain("Scanned");
  });

  it("threads --warp-plan through scan ingestion and shows Warp arbitrage output", async () => {
    const dbPath = createTempDbPath();
    const warpFixturePath = createWarpFixturePath();
    const scanRuntime = createBufferRuntime();

    const scanExitCode = await main(
      [
        "scan",
        "--source",
        "warp",
        "--path",
        warpFixturePath,
        "--warp-plan",
        "business",
        "--db",
        dbPath,
      ],
      scanRuntime.runtime,
    );

    expect(scanExitCode).toBe(0);
    expect(scanRuntime.stderr.join("")).toBe("");
    expect(scanRuntime.stdout.join("")).toContain("Warp arbitrage:");

    const db = createDb(dbPath);
    const trace = createTraceRepository(db).listForAnalysis()[0];
    getSqliteClient(db).close(false);

    expect(trace?.source).toBe("warp");
    expect(trace?.metadata?.effectiveCreditRateUsd).toBe(50 / 1500);
    expect(trace?.metadata?.creditCostUsd).toBeCloseTo(50 / 1500, 8);
    expect(trace?.metadata?.apiCostUsd).toBeCloseTo(0.009, 8);

    const reportRuntime = createBufferRuntime();
    const reportExitCode = await main(
      ["report", "--trace", trace?.id ?? "", "--db", dbPath],
      reportRuntime.runtime,
    );

    expect(reportExitCode).toBe(0);
    expect(reportRuntime.stdout.join("")).toContain("Warp arbitrage:");
  });

  it("excludes model_overuse from scan waste totals", async () => {
    const { stdout, stderr, runtime } = createBufferRuntime();
    const dbPath = createTempDbPath();
    const fixture = join(process.cwd(), "fixtures", "openclaw", "model-overuse-session.jsonl");

    const exitCode = await main(
      ["scan", "--source", "openclaw", "--file", fixture, "--db", dbPath],
      runtime,
    );

    expect(exitCode).toBe(0);
    expect(stderr.join("")).toBe("");
    expect(stdout.join("")).not.toContain("model_overuse");
  });

  it("starts the dashboard, auto-scans configured data, and opens the browser URL", async () => {
    const { stdout, stderr, runtime } = createBufferRuntime();
    const dbPath = createTempDbPath();

    const db = createDb(dbPath);
    migrate(db);
    createSettingsRepository(db).setSourceConfig({
      source: "openclaw",
      sourcePath: join(process.cwd(), "fixtures", "openclaw"),
    });
    getSqliteClient(db).close(false);

    let openedUrl = "";
    let serverStopped = false;

    const exitCode = await runDashboardCommand(
      {
        command: "dashboard",
        port: 4040,
        noOpen: false,
        dbPath,
      },
      {
        ...runtime,
        dashboard: {
          loadModule: async () => ({
            startApiServer(port) {
              return {
                port: port ?? 4040,
                stop() {
                  serverStopped = true;
                },
              };
            },
            async runConfiguredScan() {
              return {
                tracesIngested: 3,
                spansIngested: 9,
                messagesIngested: 18,
                skipped: 0,
                durationMs: 12,
              };
            },
          }),
          async openUrl(url) {
            openedUrl = url;
          },
          async waitForShutdown(server) {
            server.stop(true);
          },
        },
      },
    );

    expect(exitCode).toBe(0);
    expect(stderr.join("")).toBe("");
    expect(stdout.join("")).toContain("Dashboard running:");
    expect(stdout.join("")).toContain("Auto-scan complete:");
    expect(openedUrl).toBe("http://localhost:4040");
    expect(serverStopped).toBe(true);
  });
});
