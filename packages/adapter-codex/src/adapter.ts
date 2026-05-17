import { stat } from "node:fs/promises";

import type { IAdapter, IngestOptions, IngestResult } from "@langcost/core";
import {
  createIngestionStateRepository,
  createMessageRepository,
  createSpanRepository,
  createTraceRepository,
  type Db,
  getSqliteClient,
} from "@langcost/db";

import { discoverRolloutFiles, getSessionsRoot } from "./discovery";
import { normalizeRollout } from "./normalizer";
import { readRolloutFile } from "./reader";

async function filterAlreadyIngested(db: Db, options: IngestOptions | undefined) {
  const ingestionRepository = createIngestionStateRepository(db);
  const discovered = await discoverRolloutFiles({
    file: options?.file,
    since: options?.since,
    sourcePath: options?.sourcePath,
  });

  if (options?.force) {
    return { discovered, skipped: 0 };
  }

  const pending = [];
  let skipped = 0;

  for (const rollout of discovered) {
    const existing = ingestionRepository.getBySourcePath(rollout.filePath);
    if (
      existing &&
      existing.lastOffset === rollout.fileSize &&
      rollout.modifiedAt.getTime() <= existing.updatedAt.getTime()
    ) {
      skipped += 1;
      continue;
    }
    pending.push(rollout);
  }

  return { discovered: pending, skipped };
}

export const codexAdapter: IAdapter<Db> = {
  meta: {
    name: "codex",
    version: "0.1.0",
    description: "Ingest OpenAI Codex CLI rollouts from local disk into langcost SQLite.",
    sourceType: "local",
  },

  async validate(options?: IngestOptions) {
    try {
      if (options?.file) {
        const discovered = await discoverRolloutFiles({ file: options.file });
        return discovered.length > 0
          ? { ok: true, message: `Found Codex rollout file at ${options.file}` }
          : { ok: false, message: `Codex rollout file not found: ${options.file}` };
      }

      const sessionsRoot = getSessionsRoot(options?.sourcePath);
      try {
        const dir = await stat(sessionsRoot);
        if (!dir.isDirectory()) {
          return { ok: false, message: `Codex sessions directory not found: ${sessionsRoot}` };
        }
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") {
          return {
            ok: false,
            message: `Codex sessions directory not found: ${sessionsRoot}. Is the Codex CLI installed?`,
          };
        }
        throw error;
      }

      const discovered = await discoverRolloutFiles({
        ...(options?.sourcePath ? { sourcePath: options.sourcePath } : {}),
        ...(options?.since ? { since: options.since } : {}),
      });
      return discovered.length > 0
        ? { ok: true, message: `Found ${discovered.length} Codex rollout files` }
        : { ok: false, message: `No Codex rollout files found under ${sessionsRoot}` };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "Unknown validation failure",
      };
    }
  },

  async ingest(db: Db, options?: IngestOptions): Promise<IngestResult> {
    const startedAt = Date.now();
    const traceRepository = createTraceRepository(db);
    const spanRepository = createSpanRepository(db);
    const messageRepository = createMessageRepository(db);
    const ingestionRepository = createIngestionStateRepository(db);
    const sqlite = getSqliteClient(db);

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

    for (const [index, rollout] of discovered.entries()) {
      try {
        options?.onProgress?.({
          phase: "reading",
          current: index + 1,
          total: discovered.length,
          sessionId: rollout.rolloutId,
        });

        const readResult = await readRolloutFile(rollout.filePath);

        options?.onProgress?.({
          phase: "normalizing",
          current: index + 1,
          total: discovered.length,
          sessionId: rollout.rolloutId,
        });

        const normalized = normalizeRollout(rollout, readResult);
        errors.push(...normalized.errors);

        options?.onProgress?.({
          phase: "writing",
          current: index + 1,
          total: discovered.length,
          sessionId: rollout.rolloutId,
        });

        // Per-session transaction — holds the SQLite writer lock for ms, not seconds.
        // Mirrors the issue-#23 pattern used in every other adapter.
        sqlite.transaction(() => {
          traceRepository.upsert(normalized.trace);
          for (const span of normalized.spans) {
            spanRepository.upsert(span);
          }
          for (const message of normalized.messages) {
            messageRepository.upsert(message);
          }
          ingestionRepository.upsert({
            sourcePath: rollout.filePath,
            adapter: "codex",
            lastOffset: readResult.lastOffset,
            lastLineHash: readResult.lastLineHash,
            lastSessionId: rollout.rolloutId,
            updatedAt: new Date(),
          });
        })();

        tracesIngested += 1;
        spansIngested += normalized.spans.length;
        messagesIngested += normalized.messages.length;
      } catch (cause) {
        // One bad rollout shouldn't kill the whole scan. Record it and move on.
        errors.push({
          file: rollout.filePath,
          message: cause instanceof Error ? cause.message : "Unknown rollout failure",
        });
      }
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
