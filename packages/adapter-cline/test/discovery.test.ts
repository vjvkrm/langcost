import { afterEach, describe, expect, it } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { discoverTaskFiles } from "../src/discovery";

const cleanupPaths: string[] = [];

afterEach(() => {
  while (cleanupPaths.length > 0) {
    const path = cleanupPaths.pop();
    if (path) rmSync(path, { recursive: true, force: true });
  }
});

function createFixtureRoot() {
  const root = mkdtempSync(join(tmpdir(), "langcost-cline-discovery-"));
  cleanupPaths.push(root);
  const taskDir = join(root, "tasks", "1778305767614");
  mkdirSync(taskDir, { recursive: true });
  return { root, taskDir };
}

describe("discoverTaskFiles", () => {
  it("finds Cline ui_messages.json files under tasks/*", async () => {
    const { root, taskDir } = createFixtureRoot();
    const fixturePath = join(
      process.cwd(),
      "fixtures",
      "cline",
      "task-1778305767614",
      "tasks",
      "1778305767614",
      "ui_messages.json",
    );
    const copiedPath = join(taskDir, "ui_messages.json");
    copyFileSync(fixturePath, copiedPath);

    const discovered = await discoverTaskFiles({ sourcePath: root });

    expect(discovered).toHaveLength(1);
    expect(discovered[0]?.taskId).toBe("1778305767614");
    expect(discovered[0]?.filePath).toBe(copiedPath);
    expect(discovered[0]?.rootPath).toBe(root);
  });

  it("supports options.file pointing at a task directory", async () => {
    const { taskDir } = createFixtureRoot();
    const fixturePath = join(
      process.cwd(),
      "fixtures",
      "cline",
      "task-1778305767614",
      "tasks",
      "1778305767614",
      "ui_messages.json",
    );
    const copiedPath = join(taskDir, "ui_messages.json");
    copyFileSync(fixturePath, copiedPath);

    const discovered = await discoverTaskFiles({ file: taskDir });

    expect(discovered).toHaveLength(1);
    expect(discovered[0]?.filePath).toBe(copiedPath);
  });

  it("filters files by the since date", async () => {
    const root = mkdtempSync(join(tmpdir(), "langcost-cline-since-"));
    cleanupPaths.push(root);
    const oldTaskDir = join(root, "tasks", "old");
    const newTaskDir = join(root, "tasks", "new");
    mkdirSync(oldTaskDir, { recursive: true });
    mkdirSync(newTaskDir, { recursive: true });

    const fixturePath = join(
      process.cwd(),
      "fixtures",
      "cline",
      "task-1778305767614",
      "tasks",
      "1778305767614",
      "ui_messages.json",
    );
    const oldPath = join(oldTaskDir, "ui_messages.json");
    const newPath = join(newTaskDir, "ui_messages.json");
    copyFileSync(fixturePath, oldPath);
    copyFileSync(fixturePath, newPath);

    const oldDate = new Date("2026-01-01T00:00:00.000Z");
    const newDate = new Date("2026-03-20T00:00:00.000Z");
    utimesSync(oldPath, oldDate, oldDate);
    utimesSync(newPath, newDate, newDate);

    const discovered = await discoverTaskFiles({
      sourcePath: root,
      since: new Date("2026-03-01T00:00:00.000Z"),
    });

    expect(discovered).toHaveLength(1);
    expect(discovered[0]?.filePath).toBe(newPath);
  });
});
