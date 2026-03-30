import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createDb, createSettingsRepository, getSqliteClient, migrate } from "@langcost/db";
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
    expect(stdout.join("")).toContain("Trace");
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
