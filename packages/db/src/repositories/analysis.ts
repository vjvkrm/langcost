import { count, desc } from "drizzle-orm";

import type { Db } from "../client";
import { analysisRuns } from "../schema";
import { numeric } from "./shared";

export type AnalysisRunRecord = typeof analysisRuns.$inferInsert;
type AnalysisRunRow = typeof analysisRuns.$inferSelect;

function toRow(record: AnalysisRunRecord): AnalysisRunRecord {
  return {
    ...record,
    completedAt: record.completedAt ?? null,
    errorMessage: record.errorMessage ?? null
  };
}

function fromRow(row: AnalysisRunRow): AnalysisRunRow {
  return row;
}

export function createAnalysisRunRepository(db: Db) {
  return {
    upsert(record: AnalysisRunRecord): void {
      const row = toRow(record);
      db.insert(analysisRuns)
        .values(row)
        .onConflictDoUpdate({
          target: analysisRuns.id,
          set: {
            analyzerName: row.analyzerName,
            startedAt: row.startedAt,
            completedAt: row.completedAt,
            tracesAnalyzed: row.tracesAnalyzed,
            findingsCount: row.findingsCount,
            status: row.status,
            errorMessage: row.errorMessage
          }
        })
        .run();
    },
    listLatest(limit = 20): AnalysisRunRow[] {
      return db.select().from(analysisRuns).orderBy(desc(analysisRuns.startedAt)).limit(limit).all().map(fromRow);
    },
    count(): number {
      const row = db.select({ count: count() }).from(analysisRuns).get();
      return numeric(row?.count);
    }
  };
}
