import { basename, join } from "node:path";
import { readdir, stat } from "node:fs/promises";

import type { IngestOptions } from "@langcost/core";

import type { DiscoveredSessionFile } from "./types";

const DEFAULT_OPENCLAW_ROOT = join(process.env.HOME ?? ".", ".openclaw");

function isWithinSince(modifiedAt: Date, since?: Date): boolean {
  return since ? modifiedAt.getTime() >= since.getTime() : true;
}

function extractAgentId(filePath: string): string | undefined {
  const parts = filePath.split("/");
  const agentsIndex = parts.lastIndexOf("agents");
  if (agentsIndex === -1 || agentsIndex + 1 >= parts.length) {
    return undefined;
  }

  return parts[agentsIndex + 1];
}

export function getOpenClawRoot(sourcePath?: string): string {
  return sourcePath ?? DEFAULT_OPENCLAW_ROOT;
}

async function discoverFromSingleFile(filePath: string, since?: Date): Promise<DiscoveredSessionFile[]> {
  const stats = await stat(filePath);
  const modifiedAt = stats.mtime;

  if (!stats.isFile() || !filePath.endsWith(".jsonl") || !isWithinSince(modifiedAt, since)) {
    return [];
  }

  return [
    {
      agentId: extractAgentId(filePath),
      filePath,
      fileSize: stats.size,
      modifiedAt,
      sessionId: basename(filePath, ".jsonl")
    }
  ];
}

async function discoverFromRoot(rootPath: string, since?: Date): Promise<DiscoveredSessionFile[]> {
  const agentsPath = join(rootPath, "agents");
  const agentDirectories = await readdir(agentsPath, { withFileTypes: true });
  const discovered: DiscoveredSessionFile[] = [];

  for (const entry of agentDirectories) {
    if (!entry.isDirectory()) {
      continue;
    }

    const sessionsPath = join(agentsPath, entry.name, "sessions");
    let sessionFiles: Awaited<ReturnType<typeof readdir>>;
    try {
      sessionFiles = await readdir(sessionsPath, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const sessionFile of sessionFiles) {
      if (!sessionFile.isFile() || !sessionFile.name.endsWith(".jsonl")) {
        continue;
      }

      const filePath = join(sessionsPath, sessionFile.name);
      const stats = await stat(filePath);
      const modifiedAt = stats.mtime;
      if (!isWithinSince(modifiedAt, since)) {
        continue;
      }

      discovered.push({
        agentId: entry.name,
        filePath,
        fileSize: stats.size,
        modifiedAt,
        sessionId: basename(sessionFile.name, ".jsonl")
      });
    }
  }

  discovered.sort((left, right) => {
    const dateDelta = left.modifiedAt.getTime() - right.modifiedAt.getTime();
    return dateDelta !== 0 ? dateDelta : left.filePath.localeCompare(right.filePath);
  });

  return discovered;
}

export async function discoverSessionFiles(options: Pick<IngestOptions, "file" | "since" | "sourcePath"> = {}): Promise<DiscoveredSessionFile[]> {
  if (options.file) {
    return discoverFromSingleFile(options.file, options.since);
  }

  return discoverFromRoot(getOpenClawRoot(options.sourcePath), options.since);
}
