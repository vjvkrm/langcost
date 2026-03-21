import type { SpanType } from "@langcost/core";
import { asc, count, eq, sql } from "drizzle-orm";

import type { Db } from "../client";
import { spans } from "../schema";
import { numeric } from "./shared";

export type SpanRecord = typeof spans.$inferInsert;
type SpanRow = typeof spans.$inferSelect;

function toRow(record: typeof spans.$inferInsert): typeof spans.$inferInsert {
  return {
    ...record,
    parentSpanId: record.parentSpanId ?? null,
    name: record.name ?? null,
    endedAt: record.endedAt ?? null,
    durationMs: record.durationMs ?? null,
    model: record.model ?? null,
    provider: record.provider ?? null,
    inputTokens: record.inputTokens ?? null,
    outputTokens: record.outputTokens ?? null,
    costUsd: record.costUsd ?? null,
    toolName: record.toolName ?? null,
    toolInput: record.toolInput ?? null,
    toolOutput: record.toolOutput ?? null,
    toolSuccess: record.toolSuccess ?? null,
    errorMessage: record.errorMessage ?? null,
    metadata: record.metadata ?? null
  };
}

function fromRow(row: SpanRow): SpanRow {
  return row;
}

export function createSpanRepository(db: Db) {
  return {
    upsert(record: SpanRecord): void {
      const row = toRow(record);
      db.insert(spans)
        .values(row)
        .onConflictDoUpdate({
          target: spans.id,
          set: {
            traceId: row.traceId,
            parentSpanId: row.parentSpanId,
            externalId: row.externalId,
            type: row.type,
            name: row.name,
            startedAt: row.startedAt,
            endedAt: row.endedAt,
            durationMs: row.durationMs,
            model: row.model,
            provider: row.provider,
            inputTokens: row.inputTokens,
            outputTokens: row.outputTokens,
            costUsd: row.costUsd,
            toolName: row.toolName,
            toolInput: row.toolInput,
            toolOutput: row.toolOutput,
            toolSuccess: row.toolSuccess,
            status: row.status,
            errorMessage: row.errorMessage,
            metadata: row.metadata
          }
        })
        .run();
    },
    listByTraceId(traceId: string): SpanRow[] {
      return db.select().from(spans).where(eq(spans.traceId, traceId)).orderBy(asc(spans.startedAt)).all().map(fromRow);
    },
    count(): number {
      const row = db.select({ count: count() }).from(spans).get();
      return numeric(row?.count);
    },
    countByType(): Record<SpanType, number> {
      const rows = db
        .select({
          type: spans.type,
          count: sql<number>`count(*)`
        })
        .from(spans)
        .groupBy(spans.type)
        .all();

      return rows.reduce<Record<SpanType, number>>(
        (counts, row) => {
          counts[row.type] = numeric(row.count);
          return counts;
        },
        { agent: 0, llm: 0, retrieval: 0, tool: 0 }
      );
    }
  };
}
