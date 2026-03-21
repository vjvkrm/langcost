import { asc, count, eq, sql } from "drizzle-orm";

import type { Db } from "../client";
import { messages, spans } from "../schema";
import { numeric } from "./shared";

export type MessageRecord = typeof messages.$inferInsert;
type MessageRow = typeof messages.$inferSelect;

function toRow(record: MessageRecord): MessageRecord {
  return {
    ...record,
    tokenCount: record.tokenCount ?? null,
    metadata: record.metadata ?? null
  };
}

function fromRow(row: MessageRow): MessageRow {
  return row;
}

export function createMessageRepository(db: Db) {
  return {
    upsert(record: MessageRecord): void {
      const row = toRow(record);
      db.insert(messages)
        .values(row)
        .onConflictDoUpdate({
          target: messages.id,
          set: {
            spanId: row.spanId,
            traceId: row.traceId,
            role: row.role,
            content: row.content,
            tokenCount: row.tokenCount,
            position: row.position,
            metadata: row.metadata
          }
        })
        .run();
    },
    listByTraceId(traceId: string): MessageRow[] {
      return db
        .select({ message: messages })
        .from(messages)
        .innerJoin(spans, eq(messages.spanId, spans.id))
        .where(eq(messages.traceId, traceId))
        .orderBy(
          sql`case when json_extract(${messages.metadata}, '$.timestamp') is null then 1 else 0 end`,
          sql`json_extract(${messages.metadata}, '$.timestamp')`,
          asc(spans.startedAt),
          asc(messages.position),
          asc(messages.id)
        )
        .all()
        .map((row) => fromRow(row.message));
    },
    listBySpanId(spanId: string): MessageRow[] {
      return db
        .select()
        .from(messages)
        .where(eq(messages.spanId, spanId))
        .orderBy(asc(messages.position), asc(messages.id))
        .all()
        .map(fromRow);
    },
    count(): number {
      const row = db.select({ count: count() }).from(messages).get();
      return numeric(row?.count);
    }
  };
}
