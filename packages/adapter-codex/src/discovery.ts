import { readdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";

import type { IngestOptions } from "@langcost/core";

import type { DiscoveredRolloutFile } from "./types";

const DEFAULT_CODEX_ROOT = join(process.env.HOME ?? ".", ".codex");

function expandHomePath(path: string): string {
  const home = process.env.HOME;
  if (!home) return path;
  if (path === "~") return home;
  if (path.startsWith("~/")) return join(home, path.slice(2));
  return path;
}

function isWithinSince(modifiedAt: Date, since?: Date): boolean {
  return since ? modifiedAt.getTime() >= since.getTime() : true;
}

export function getCodexRoot(sourcePath?: string): string {
  return expandHomePath(sourcePath ?? DEFAULT_CODEX_ROOT);
}

export function getSessionsRoot(sourcePath?: string): string {
  return join(getCodexRoot(sourcePath), "sessions");
}

// Codex names rollouts: rollout-2026-05-17T11-12-13-<uuid>.jsonl
// The id we surface is the trailing uuid so it remains stable across renames.
function parseRolloutId(fileName: string): string {
  const base = basename(fileName, ".jsonl");
  const match = base.match(
    /^rollout-.*-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i,
  );
  return match?.[1] ?? base;
}

async function discoverFromSingleFile(
  filePath: string,
  since?: Date,
): Promise<DiscoveredRolloutFile[]> {
  const expanded = expandHomePath(filePath);
  const stats = await stat(expanded);

  if (!stats.isFile() || !expanded.endsWith(".jsonl") || !isWithinSince(stats.mtime, since)) {
    return [];
  }

  return [
    {
      filePath: expanded,
      fileSize: stats.size,
      modifiedAt: stats.mtime,
      rolloutId: parseRolloutId(expanded),
    },
  ];
}

async function* walkJsonlFiles(root: string): AsyncGenerator<string> {
  try {
    const entries = await readdir(root, { withFileTypes: true, encoding: "utf8" });
    for (const entry of entries) {
      const full = join(root, entry.name);
      if (entry.isDirectory()) {
        yield* walkJsonlFiles(full);
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        yield full;
      }
    }
  } catch {
    // unreadable dir — stop descending here
  }
}

async function discoverFromSessionsRoot(
  sourcePath: string | undefined,
  since: Date | undefined,
): Promise<DiscoveredRolloutFile[]> {
  const sessionsRoot = getSessionsRoot(sourcePath);
  const discovered: DiscoveredRolloutFile[] = [];

  for await (const filePath of walkJsonlFiles(sessionsRoot)) {
    const stats = await stat(filePath);
    if (!isWithinSince(stats.mtime, since)) continue;

    discovered.push({
      filePath,
      fileSize: stats.size,
      modifiedAt: stats.mtime,
      rolloutId: parseRolloutId(filePath),
    });
  }

  discovered.sort((left, right) => {
    const dateDelta = left.modifiedAt.getTime() - right.modifiedAt.getTime();
    return dateDelta !== 0 ? dateDelta : left.filePath.localeCompare(right.filePath);
  });

  return discovered;
}

export async function discoverRolloutFiles(
  options: Pick<IngestOptions, "file" | "since" | "sourcePath"> = {},
): Promise<DiscoveredRolloutFile[]> {
  if (options.file) {
    return discoverFromSingleFile(options.file, options.since);
  }
  return discoverFromSessionsRoot(options.sourcePath, options.since);
}
