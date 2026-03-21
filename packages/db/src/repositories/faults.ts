import { desc, eq } from "drizzle-orm";

import type { Db } from "../client";
import { faultReports } from "../schema";

export type FaultReportRecord = typeof faultReports.$inferInsert;
type FaultReportRow = typeof faultReports.$inferSelect;

function toRow(record: FaultReportRecord): FaultReportRecord {
  return {
    ...record,
    rootCauseSpanId: record.rootCauseSpanId ?? null
  };
}

function fromRow(row: FaultReportRow): FaultReportRow {
  return row;
}

export function createFaultReportRepository(db: Db) {
  return {
    upsert(record: FaultReportRecord): void {
      const row = toRow(record);
      db.insert(faultReports)
        .values(row)
        .onConflictDoUpdate({
          target: faultReports.id,
          set: {
            traceId: row.traceId,
            faultSpanId: row.faultSpanId,
            rootCauseSpanId: row.rootCauseSpanId,
            faultType: row.faultType,
            description: row.description,
            cascadeDepth: row.cascadeDepth,
            affectedSpanIds: row.affectedSpanIds,
            detectedAt: row.detectedAt
          }
        })
        .run();
    },
    listByTraceId(traceId: string): FaultReportRow[] {
      return db
        .select()
        .from(faultReports)
        .where(eq(faultReports.traceId, traceId))
        .orderBy(desc(faultReports.detectedAt))
        .all()
        .map(fromRow);
    }
  };
}
