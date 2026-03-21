import type { SegmentType } from "@langcost/core";
import { asc, count, desc, eq, sql } from "drizzle-orm";

import type { Db } from "../client";
import { segments } from "../schema";
import { numeric } from "./shared";

export type SegmentRecord = typeof segments.$inferInsert;
type SegmentRow = typeof segments.$inferSelect;

function toRow(record: SegmentRecord): SegmentRecord {
  return {
    ...record,
    contentHash: record.contentHash ?? null,
    charStart: record.charStart ?? null,
    charEnd: record.charEnd ?? null
  };
}

function fromRow(row: SegmentRow): SegmentRow {
  return row;
}

export function createSegmentRepository(db: Db) {
  return {
    upsert(record: SegmentRecord): void {
      const row = toRow(record);
      db.insert(segments)
        .values(row)
        .onConflictDoUpdate({
          target: segments.id,
          set: {
            spanId: row.spanId,
            traceId: row.traceId,
            type: row.type,
            tokenCount: row.tokenCount,
            costUsd: row.costUsd,
            percentOfSpan: row.percentOfSpan,
            contentHash: row.contentHash,
            charStart: row.charStart,
            charEnd: row.charEnd,
            analyzedAt: row.analyzedAt
          }
        })
        .run();
    },
    listByTraceId(traceId: string): SegmentRow[] {
      return db.select().from(segments).where(eq(segments.traceId, traceId)).orderBy(asc(segments.analyzedAt)).all().map(fromRow);
    },
    summarizeByType(): Array<{ type: SegmentType; totalTokens: number; totalCostUsd: number }> {
      return db
        .select({
          type: segments.type,
          totalTokens: sql<number>`coalesce(sum(${segments.tokenCount}), 0)`,
          totalCostUsd: sql<number>`coalesce(sum(${segments.costUsd}), 0)`
        })
        .from(segments)
        .groupBy(segments.type)
        .orderBy(desc(sql`coalesce(sum(${segments.costUsd}), 0)`))
        .all()
        .map((row) => ({
          type: row.type,
          totalTokens: numeric(row.totalTokens),
          totalCostUsd: numeric(row.totalCostUsd)
        }));
    },
    count(): number {
      const row = db.select({ count: count() }).from(segments).get();
      return numeric(row?.count);
    }
  };
}
