import { stat } from "node:fs/promises";
import { join } from "node:path";

import type { IAdapter, IngestOptions, IngestResult } from "@langcost/core";
import type { Db } from "@langcost/db";
import {
  createIngestionStateRepository,
  createMessageRepository,
  createSpanRepository,
  createTraceRepository,
} from "@langcost/db";

import { discoverTaskFiles, resolveClineRoot } from "./discovery";
import { normalizeTask } from "./normalizer";
import { readTaskFile } from "./reader";

async function filterAlreadyIngested(db: Db, options: IngestOptions | undefined) {
  const ingestionRepository = createIngestionStateRepository(db);
  const discovered = await discoverTaskFiles(options);

  if (options?.force) {
    return { discovered, skipped: 0 };
  }

  const pending = [];
  let skipped = 0;

  for (const task of discovered) {
    const existing = ingestionRepository.getBySourcePath(task.filePath);
    if (
      existing &&
      existing.lastOffset === task.fileSize &&
      task.modifiedAt.getTime() <= existing.updatedAt.getTime()
    ) {
      skipped += 1;
      continue;
    }

    pending.push(task);
  }

  return { discovered: pending, skipped };
}

export const clineAdapter: IAdapter<Db> = {
  meta: {
    name: "cline",
    version: "0.1.0",
    description: "Ingest Cline VS Code task history from local disk into langcost SQLite.",
    sourceType: "local",
  },

  async validate(options?: IngestOptions) {
    try {
      if (options?.file) {
        const discovered = await discoverTaskFiles(options);
        return discovered.length > 0
          ? { ok: true, message: `Found Cline task file at ${options.file}` }
          : { ok: false, message: `Cline ui_messages.json not found: ${options.file}` };
      }

      const resolved = await resolveClineRoot(options?.sourcePath);

      if (!options?.sourcePath && !resolved.autoDiscovered) {
        return {
          ok: false,
          message: `Cline not found in default locations (${resolved.tried.join(", ")}). If you have it installed elsewhere, set the path in Settings.`,
        };
      }

      if (options?.sourcePath) {
        const tasksPath = join(resolved.root, "tasks");
        try {
          const info = await stat(tasksPath);
          if (!info.isDirectory()) {
            return {
              ok: false,
              message: `Cline tasks directory not found: ${tasksPath}. Check your source path in Settings.`,
            };
          }
        } catch (error) {
          if (error instanceof Error && "code" in error && error.code === "ENOENT") {
            return {
              ok: false,
              message: `Cline tasks directory not found: ${tasksPath}. Check your source path in Settings.`,
            };
          }
          throw error;
        }
      }

      const discovered = await discoverTaskFiles(options);
      return discovered.length > 0
        ? { ok: true, message: `Found ${discovered.length} Cline task files under ${resolved.root}` }
        : { ok: false, message: `No Cline task files found under ${resolved.root}` };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown validation failure";
      return { ok: false, message };
    }
  },

  async ingest(db: Db, options?: IngestOptions): Promise<IngestResult> {
    const startedAt = Date.now();
    const traceRepository = createTraceRepository(db);
    const spanRepository = createSpanRepository(db);
    const messageRepository = createMessageRepository(db);
    const ingestionRepository = createIngestionStateRepository(db);

    const { discovered, skipped } = await filterAlreadyIngested(db, options);
    const errors: IngestResult["errors"] = [];

    let tracesIngested = 0;
    let spansIngested = 0;
    let messagesIngested = 0;

    options?.onProgress?.({
      phase: "discovering",
      current: discovered.length,
      total: discovered.length,
    });

    for (const [index, task] of discovered.entries()) {
      options?.onProgress?.({
        phase: "reading",
        current: index + 1,
        total: discovered.length,
        sessionId: task.taskId,
      });

      const readResult = await readTaskFile(task.filePath, task.rootPath);

      options?.onProgress?.({
        phase: "normalizing",
        current: index + 1,
        total: discovered.length,
        sessionId: task.taskId,
      });

      const normalized = normalizeTask(task, readResult);
      errors.push(...normalized.errors);

      options?.onProgress?.({
        phase: "writing",
        current: index + 1,
        total: discovered.length,
        sessionId: task.taskId,
      });

      traceRepository.upsert(normalized.trace);
      for (const span of normalized.spans) {
        spanRepository.upsert(span);
      }
      for (const message of normalized.messages) {
        messageRepository.upsert(message);
      }
      ingestionRepository.upsert({
        sourcePath: task.filePath,
        adapter: "cline",
        lastOffset: readResult.lastOffset,
        lastLineHash: readResult.lastLineHash ?? null,
        lastSessionId: task.taskId,
        updatedAt: new Date(),
      });

      tracesIngested += 1;
      spansIngested += normalized.spans.length;
      messagesIngested += normalized.messages.length;
    }

    return {
      tracesIngested,
      spansIngested,
      messagesIngested,
      skipped,
      errors,
      durationMs: Date.now() - startedAt,
    };
  },
};
