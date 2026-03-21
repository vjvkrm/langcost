import type { IAdapter, IngestOptions, IngestResult } from "@langcost/core";
import type { Db } from "@langcost/db";
import {
  createIngestionStateRepository,
  createMessageRepository,
  createSpanRepository,
  createTraceRepository
} from "@langcost/db";

import { discoverSessionFiles, getOpenClawRoot } from "./discovery";
import { normalizeSession } from "./normalizer";
import { readSessionFile } from "./reader";

async function filterAlreadyIngested(db: Db, options: IngestOptions | undefined) {
  const ingestionRepository = createIngestionStateRepository(db);
  const discovered = await discoverSessionFiles(options);

  if (options?.force) {
    return { discovered, skipped: 0 };
  }

  const pending = [];
  let skipped = 0;

  for (const session of discovered) {
    const existing = ingestionRepository.getBySourcePath(session.filePath);
    if (
      existing &&
      existing.lastOffset === session.fileSize &&
      session.modifiedAt.getTime() <= existing.updatedAt.getTime()
    ) {
      skipped += 1;
      continue;
    }

    pending.push(session);
  }

  return { discovered: pending, skipped };
}

export const openClawAdapter: IAdapter<Db> = {
  meta: {
    name: "openclaw",
    version: "0.0.1",
    description: "Ingest OpenClaw JSONL sessions from local disk into langcost SQLite.",
    sourceType: "local"
  },

  async validate(options?: IngestOptions) {
    try {
      const discovered = await discoverSessionFiles(options);
      if (options?.file) {
        return discovered.length > 0
          ? { ok: true, message: `Found OpenClaw session file at ${options.file}` }
          : { ok: false, message: `OpenClaw session file not found: ${options.file}` };
      }

      const root = getOpenClawRoot(options?.sourcePath);
      return discovered.length > 0
        ? { ok: true, message: `Found ${discovered.length} OpenClaw session files under ${root}` }
        : { ok: false, message: `No OpenClaw session files found under ${root}` };
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

    options?.onProgress?.({ phase: "discovering", current: discovered.length, total: discovered.length });

    for (const [index, session] of discovered.entries()) {
      options?.onProgress?.({
        phase: "reading",
        current: index + 1,
        total: discovered.length,
        sessionId: session.sessionId
      });

      const readResult = await readSessionFile(session.filePath);

      options?.onProgress?.({
        phase: "normalizing",
        current: index + 1,
        total: discovered.length,
        sessionId: session.sessionId
      });

      const normalized = normalizeSession(session, readResult);
      errors.push(...normalized.errors);

      options?.onProgress?.({
        phase: "writing",
        current: index + 1,
        total: discovered.length,
        sessionId: session.sessionId
      });

      traceRepository.upsert(normalized.trace);
      for (const span of normalized.spans) {
        spanRepository.upsert(span);
      }
      for (const message of normalized.messages) {
        messageRepository.upsert(message);
      }
      ingestionRepository.upsert({
        sourcePath: session.filePath,
        adapter: "openclaw",
        lastOffset: readResult.lastOffset,
        lastLineHash: readResult.lastLineHash,
        lastSessionId: session.sessionId,
        updatedAt: new Date()
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
      durationMs: Date.now() - startedAt
    };
  }
};
