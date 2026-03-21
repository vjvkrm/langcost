import { afterEach, describe, expect, it } from "bun:test";
import { copyFileSync, mkdtempSync, mkdirSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { discoverSessionFiles } from "../src/discovery";

const cleanupPaths: string[] = [];

afterEach(() => {
  while (cleanupPaths.length > 0) {
    const path = cleanupPaths.pop();
    if (path) {
      rmSync(path, { recursive: true, force: true });
    }
  }
});

function createFixtureRoot() {
  const root = mkdtempSync(join(tmpdir(), "langcost-openclaw-discovery-"));
  cleanupPaths.push(root);

  const sessionsDir = join(root, "agents", "agent-1", "sessions");
  mkdirSync(sessionsDir, { recursive: true });
  return { root, sessionsDir };
}

describe("discoverSessionFiles", () => {
  it("finds OpenClaw session files under agents/*/sessions", async () => {
    const { root, sessionsDir } = createFixtureRoot();
    const fixturePath = join(process.cwd(), "fixtures", "openclaw", "simple-session.jsonl");
    const copiedPath = join(sessionsDir, "simple-session.jsonl");
    copyFileSync(fixturePath, copiedPath);

    const discovered = await discoverSessionFiles({ sourcePath: root });

    expect(discovered).toHaveLength(1);
    expect(discovered[0]?.agentId).toBe("agent-1");
    expect(discovered[0]?.sessionId).toBe("simple-session");
    expect(discovered[0]?.filePath).toBe(copiedPath);
  });

  it("filters files by the since date", async () => {
    const { root, sessionsDir } = createFixtureRoot();
    const fixturePath = join(process.cwd(), "fixtures", "openclaw", "simple-session.jsonl");
    const oldPath = join(sessionsDir, "old-session.jsonl");
    const newPath = join(sessionsDir, "new-session.jsonl");

    copyFileSync(fixturePath, oldPath);
    copyFileSync(fixturePath, newPath);

    const oldDate = new Date("2026-01-01T00:00:00.000Z");
    const newDate = new Date("2026-03-20T00:00:00.000Z");
    utimesSync(oldPath, oldDate, oldDate);
    utimesSync(newPath, newDate, newDate);

    const discovered = await discoverSessionFiles({
      sourcePath: root,
      since: new Date("2026-03-01T00:00:00.000Z")
    });

    expect(discovered).toHaveLength(1);
    expect(discovered[0]?.filePath).toBe(newPath);
  });
});
