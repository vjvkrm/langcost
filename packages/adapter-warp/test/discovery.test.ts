import { Database } from "bun:sqlite";
import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { discoverWarpDb, validateSchema } from "../src/discovery";

const cleanupPaths: string[] = [];

afterEach(() => {
  while (cleanupPaths.length > 0) {
    const path = cleanupPaths.pop();
    if (path) rmSync(path, { recursive: true, force: true });
  }
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "langcost-warp-discovery-"));
  cleanupPaths.push(dir);
  return dir;
}

function createSqliteWithTables(dbPath: string, tables: string[]): void {
  const db = new Database(dbPath);
  for (const table of tables) {
    db.exec(`CREATE TABLE ${table} (id INTEGER PRIMARY KEY)`);
  }
  db.close();
}

const REQUIRED_TABLES = ["agent_conversations", "ai_queries", "blocks"];

describe("validateSchema", () => {
  it("returns ok when all three required tables exist", () => {
    const dbPath = join(tempDir(), "warp.sqlite");
    createSqliteWithTables(dbPath, REQUIRED_TABLES);

    const result = validateSchema(dbPath);

    expect(result.ok).toBe(true);
    expect(result.message).toContain("warp.sqlite");
  });

  it("returns error when agent_conversations is missing", () => {
    const dbPath = join(tempDir(), "warp.sqlite");
    createSqliteWithTables(dbPath, ["ai_queries", "blocks"]);

    const result = validateSchema(dbPath);

    expect(result.ok).toBe(false);
    expect(result.message).toContain("agent_conversations");
    expect(result.missingTables).toContain("agent_conversations");
  });

  it("returns error when ai_queries is missing", () => {
    const dbPath = join(tempDir(), "warp.sqlite");
    createSqliteWithTables(dbPath, ["agent_conversations", "blocks"]);

    const result = validateSchema(dbPath);

    expect(result.ok).toBe(false);
    expect(result.missingTables).toContain("ai_queries");
  });

  it("returns error when blocks is missing", () => {
    const dbPath = join(tempDir(), "warp.sqlite");
    createSqliteWithTables(dbPath, ["agent_conversations", "ai_queries"]);

    const result = validateSchema(dbPath);

    expect(result.ok).toBe(false);
    expect(result.missingTables).toContain("blocks");
  });

  it("returns error for a non-existent path", () => {
    const result = validateSchema(join(tempDir(), "does-not-exist.sqlite"));

    expect(result.ok).toBe(false);
    expect(result.message).toContain("Cannot open");
  });

  it("lists all missing tables when multiple are absent", () => {
    const dbPath = join(tempDir(), "warp.sqlite");
    createSqliteWithTables(dbPath, ["agent_conversations"]);

    const result = validateSchema(dbPath);

    expect(result.ok).toBe(false);
    expect(result.missingTables).toContain("ai_queries");
    expect(result.missingTables).toContain("blocks");
  });

  it("does NOT list tables that are present", () => {
    const dbPath = join(tempDir(), "warp.sqlite");
    createSqliteWithTables(dbPath, ["agent_conversations", "ai_queries"]);

    const result = validateSchema(dbPath);

    expect(result.missingTables).not.toContain("agent_conversations");
    expect(result.missingTables).not.toContain("ai_queries");
  });
});

describe("discoverWarpDb", () => {
  it("returns the given path when the file exists", async () => {
    const dbPath = join(tempDir(), "warp.sqlite");
    createSqliteWithTables(dbPath, REQUIRED_TABLES);

    const result = await discoverWarpDb(dbPath);

    expect(result).toBe(dbPath);
  });

  it("returns null when the given path does not exist", async () => {
    const result = await discoverWarpDb(join(tempDir(), "missing.sqlite"));

    expect(result).toBeNull();
  });

  it("returns null when no Warp installation is found at default paths", async () => {
    const fakeHome = tempDir();
    const previousHome = process.env.HOME;
    process.env.HOME = fakeHome;

    try {
      const result = await discoverWarpDb();
      expect(result).toBeNull();
    } finally {
      process.env.HOME = previousHome;
    }
  });

  it("finds Warp Stable at the default macOS path when it exists", async () => {
    const fakeHome = tempDir();
    const stableDir = join(
      fakeHome,
      "Library",
      "Group Containers",
      "2BBY89MBSN.dev.warp",
      "Library",
      "Application Support",
      "dev.warp.Warp-Stable",
    );
    const { mkdirSync } = await import("node:fs");
    mkdirSync(stableDir, { recursive: true });
    const dbPath = join(stableDir, "warp.sqlite");
    createSqliteWithTables(dbPath, REQUIRED_TABLES);

    const previousHome = process.env.HOME;
    process.env.HOME = fakeHome;

    try {
      const result = await discoverWarpDb();
      expect(result).toBe(dbPath);
    } finally {
      process.env.HOME = previousHome;
    }
  });
});
