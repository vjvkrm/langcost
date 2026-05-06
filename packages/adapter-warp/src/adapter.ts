import type { IAdapter, IngestOptions, IngestResult } from "@langcost/core";
import type { Db } from "@langcost/db";
import {
  createIngestionStateRepository,
  createMessageRepository,
  createSpanRepository,
  createTraceRepository,
} from "@langcost/db";

import { discoverWarpDb, validateSchema } from "./discovery";
import { normalizeConversation } from "./normalizer";
import { readWarpData } from "./reader";

export const warpAdapter: IAdapter<Db> = {
  meta: {
    name: "warp",
    version: "0.1.0",
    description: "Ingest Warp AI session data from warp.sqlite into langcost.",
    sourceType: "local",
  },

  async validate(options?: IngestOptions) {
    const dbPath = await discoverWarpDb(options?.sourcePath);
    if (!dbPath) {
      return {
        ok: false,
        message:
          "warp.sqlite not found. Make sure Warp is installed and has been used at least once.",
      };
    }

    const schema = validateSchema(dbPath);
    return { ok: schema.ok, message: schema.message };
  },

  async ingest(db: Db, options?: IngestOptions): Promise<IngestResult> {
    const startedAt = Date.now();

    const dbPath = await discoverWarpDb(options?.sourcePath);
    if (!dbPath) {
      return {
        tracesIngested: 0,
        spansIngested: 0,
        messagesIngested: 0,
        skipped: 0,
        errors: [{ file: "warp.sqlite", message: "warp.sqlite not found" }],
        durationMs: Date.now() - startedAt,
      };
    }

    const schemaCheck = validateSchema(dbPath);
    if (!schemaCheck.ok) {
      return {
        tracesIngested: 0,
        spansIngested: 0,
        messagesIngested: 0,
        skipped: 0,
        errors: [{ file: dbPath, message: schemaCheck.message }],
        durationMs: Date.now() - startedAt,
      };
    }

    const traceRepo = createTraceRepository(db);
    const spanRepo = createSpanRepository(db);
    const messageRepo = createMessageRepository(db);
    const ingestionRepo = createIngestionStateRepository(db);

    const rawData = readWarpData(dbPath, options?.since);

    options?.onProgress?.({
      phase: "discovering",
      current: rawData.conversations.length,
      total: rawData.conversations.length,
    });

    const queriesByConv = new Map<string, typeof rawData.queries>();
    for (const q of rawData.queries) {
      const list = queriesByConv.get(q.conversation_id) ?? [];
      list.push(q);
      queriesByConv.set(q.conversation_id, list);
    }

    const blocksByConv = new Map<string, typeof rawData.blocks>();
    for (const b of rawData.blocks) {
      const list = blocksByConv.get(b.conversation_id) ?? [];
      list.push(b);
      blocksByConv.set(b.conversation_id, list);
    }

    let tracesIngested = 0;
    let spansIngested = 0;
    let messagesIngested = 0;
    let skipped = 0;
    const errors: IngestResult["errors"] = [];

    for (const [index, conv] of rawData.conversations.entries()) {
      const stateKey = `warp:${conv.conversation_id}`;

      if (!options?.force) {
        const existing = ingestionRepo.getBySourcePath(stateKey);
        const convModifiedAt = new Date(conv.last_modified_at).getTime();
        if (existing && convModifiedAt <= existing.updatedAt.getTime()) {
          skipped += 1;
          continue;
        }
      }

      options?.onProgress?.({
        phase: "normalizing",
        current: index + 1,
        total: rawData.conversations.length,
        sessionId: conv.conversation_id,
      });

      try {
        const exchanges = queriesByConv.get(conv.conversation_id) ?? [];
        const blocks = blocksByConv.get(conv.conversation_id) ?? [];
        const warpPlan = options?.adapterOptions?.["warpPlan"] as string | undefined;
        const normalized = normalizeConversation(
          conv,
          exchanges,
          blocks,
          warpPlan ? { warpPlan } : {},
        );

        options?.onProgress?.({
          phase: "writing",
          current: index + 1,
          total: rawData.conversations.length,
          sessionId: conv.conversation_id,
        });

        traceRepo.upsert(normalized.trace);
        for (const span of normalized.spans) {
          spanRepo.upsert(span);
        }
        for (const message of normalized.messages) {
          messageRepo.upsert(message);
        }

        ingestionRepo.upsert({
          sourcePath: stateKey,
          adapter: "warp",
          lastOffset: 0,
          lastLineHash: null,
          lastSessionId: conv.conversation_id,
          updatedAt: new Date(),
        });

        tracesIngested += 1;
        spansIngested += normalized.spans.length;
        messagesIngested += normalized.messages.length;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        errors.push({ file: conv.conversation_id, message });
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
