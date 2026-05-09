import { readdir, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import type { IngestOptions } from "@langcost/core";

import type { ClineTaskHistoryItem, DiscoveredClineTaskFile } from "./types";

function candidateRoots(): string[] {
  const home = process.env.HOME ?? ".";
  return [
    join(
      home,
      "Library",
      "Application Support",
      "Code",
      "User",
      "globalStorage",
      "saoudrizwan.claude-dev",
    ),
    join(
      home,
      "Library",
      "Application Support",
      "Code - Insiders",
      "User",
      "globalStorage",
      "saoudrizwan.claude-dev",
    ),
    join(
      home,
      "Library",
      "Application Support",
      "Cursor",
      "User",
      "globalStorage",
      "saoudrizwan.claude-dev",
    ),
    join(
      home,
      "Library",
      "Application Support",
      "Cursor - Insiders",
      "User",
      "globalStorage",
      "saoudrizwan.claude-dev",
    ),
  ];
}

const DEFAULT_CLINE_ROOT = candidateRoots()[0]!;

function expandHomePath(path: string): string {
  const home = process.env.HOME;
  if (!home) return path;
  if (path === "~") return home;
  if (path.startsWith("~/")) return join(home, path.slice(2));
  return path;
}

async function hasTasksDir(root: string): Promise<boolean> {
  try {
    const info = await stat(join(root, "tasks"));
    return info.isDirectory();
  } catch {
    return false;
  }
}

async function autoDiscoverRoot(): Promise<string | null> {
  for (const root of candidateRoots()) {
    if (await hasTasksDir(root)) return root;
  }
  return null;
}

function isWithinSince(timestamp: Date | number | undefined, since?: Date): boolean {
  if (!since) return true;
  const value = timestamp instanceof Date ? timestamp.getTime() : timestamp;
  return value !== undefined ? value >= since.getTime() : true;
}

async function readTaskHistory(rootPath: string): Promise<Map<string, ClineTaskHistoryItem>> {
  try {
    const text = await Bun.file(join(rootPath, "state", "taskHistory.json")).text();
    const parsed = JSON.parse(text) as unknown;
    const items: ClineTaskHistoryItem[] = Array.isArray(parsed)
      ? (parsed as ClineTaskHistoryItem[])
      : Array.isArray((parsed as { taskHistory?: unknown }).taskHistory)
        ? ((parsed as { taskHistory: ClineTaskHistoryItem[] }).taskHistory)
        : [];
    return new Map(items.filter((item) => item.id).map((item) => [item.id, item]));
  } catch {
    return new Map();
  }
}

function taskIdFromUiMessagesPath(filePath: string): string {
  return basename(dirname(filePath));
}

function rootFromUiMessagesPath(filePath: string): string | undefined {
  const taskDir = dirname(filePath);
  const tasksDir = dirname(taskDir);
  return basename(tasksDir) === "tasks" ? dirname(tasksDir) : undefined;
}

export function getClineRoot(sourcePath?: string): string {
  return expandHomePath(sourcePath ?? DEFAULT_CLINE_ROOT);
}

export async function resolveClineRoot(
  sourcePath?: string,
): Promise<{ root: string; autoDiscovered: boolean; tried: string[] }> {
  if (sourcePath) {
    return { root: expandHomePath(sourcePath), autoDiscovered: false, tried: [] };
  }

  const tried = candidateRoots();
  const found = await autoDiscoverRoot();
  return found
    ? { root: found, autoDiscovered: true, tried }
    : { root: DEFAULT_CLINE_ROOT, autoDiscovered: false, tried };
}

async function discoverFromUiMessagesFile(
  filePath: string,
  since?: Date,
): Promise<DiscoveredClineTaskFile[]> {
  const stats = await stat(filePath);
  const modifiedAt = stats.mtime;
  const rootPath = rootFromUiMessagesPath(filePath);

  if (!stats.isFile() || basename(filePath) !== "ui_messages.json" || !isWithinSince(modifiedAt, since)) {
    return [];
  }

  return [
    {
      filePath,
      fileSize: stats.size,
      modifiedAt,
      taskId: taskIdFromUiMessagesPath(filePath),
      ...(rootPath ? { rootPath } : {}),
    },
  ];
}

async function discoverFromTaskDirectory(
  taskDir: string,
  since?: Date,
): Promise<DiscoveredClineTaskFile[]> {
  return discoverFromUiMessagesFile(join(taskDir, "ui_messages.json"), since).catch(() => []);
}

async function discoverFromRoot(rootPath: string, since?: Date): Promise<DiscoveredClineTaskFile[]> {
  const tasksPath = join(rootPath, "tasks");
  const historyById = await readTaskHistory(rootPath);
  const discovered: DiscoveredClineTaskFile[] = [];

  let entries;
  try {
    entries = await readdir(tasksPath, { withFileTypes: true, encoding: "utf8" });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const filePath = join(tasksPath, entry.name, "ui_messages.json");
    try {
      const stats = await stat(filePath);
      const modifiedAt = stats.mtime;
      const historyItem = historyById.get(entry.name);
      if (!isWithinSince(historyItem?.ts ?? modifiedAt, since)) continue;

      discovered.push({
        filePath,
        fileSize: stats.size,
        modifiedAt,
        taskId: entry.name,
        rootPath,
      });
    } catch {}
  }

  discovered.sort((left, right) => {
    const dateDelta = left.modifiedAt.getTime() - right.modifiedAt.getTime();
    return dateDelta !== 0 ? dateDelta : left.filePath.localeCompare(right.filePath);
  });

  return discovered;
}

export async function discoverTaskFiles(
  options: Pick<IngestOptions, "file" | "since" | "sourcePath"> = {},
): Promise<DiscoveredClineTaskFile[]> {
  if (options.file) {
    const expanded = expandHomePath(options.file);
    const stats = await stat(expanded);
    if (stats.isDirectory()) return discoverFromTaskDirectory(expanded, options.since);
    return discoverFromUiMessagesFile(expanded, options.since);
  }

  const { root } = await resolveClineRoot(options.sourcePath);
  return discoverFromRoot(root, options.since);
}
