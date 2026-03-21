import type { WasteCategory } from "@langcost/core";
import { count, desc, eq, sql } from "drizzle-orm";

import type { Db } from "../client";
import { wasteReports } from "../schema";
import { numeric } from "./shared";

export type WasteReportRecord = typeof wasteReports.$inferInsert;
type WasteReportRow = typeof wasteReports.$inferSelect;

function toRow(record: WasteReportRecord): WasteReportRecord {
  return {
    ...record,
    spanId: record.spanId ?? null,
    estimatedSavingsUsd: record.estimatedSavingsUsd ?? null
  };
}

function fromRow(row: WasteReportRow): WasteReportRow {
  return row;
}

export function createWasteReportRepository(db: Db) {
  return {
    upsert(record: WasteReportRecord): void {
      const row = toRow(record);
      db.insert(wasteReports)
        .values(row)
        .onConflictDoUpdate({
          target: wasteReports.id,
          set: {
            traceId: row.traceId,
            spanId: row.spanId,
            category: row.category,
            severity: row.severity,
            wastedTokens: row.wastedTokens,
            wastedCostUsd: row.wastedCostUsd,
            description: row.description,
            recommendation: row.recommendation,
            estimatedSavingsUsd: row.estimatedSavingsUsd,
            evidence: row.evidence,
            detectedAt: row.detectedAt
          }
        })
        .run();
    },
    list(): WasteReportRow[] {
      return db.select().from(wasteReports).orderBy(desc(wasteReports.detectedAt)).all().map(fromRow);
    },
    listByTraceId(traceId: string): WasteReportRow[] {
      return db
        .select()
        .from(wasteReports)
        .where(eq(wasteReports.traceId, traceId))
        .orderBy(desc(wasteReports.detectedAt))
        .all()
        .map(fromRow);
    },
    summarizeByCategory(): Array<{
      category: WasteCategory;
      count: number;
      totalWastedTokens: number;
      totalWastedCostUsd: number;
    }> {
      return db
        .select({
          category: wasteReports.category,
          count: count(),
          totalWastedTokens: sql<number>`coalesce(sum(${wasteReports.wastedTokens}), 0)`,
          totalWastedCostUsd: sql<number>`coalesce(sum(${wasteReports.wastedCostUsd}), 0)`
        })
        .from(wasteReports)
        .groupBy(wasteReports.category)
        .orderBy(desc(sql`coalesce(sum(${wasteReports.wastedCostUsd}), 0)`))
        .all()
        .map((row) => ({
          category: row.category,
          count: numeric(row.count),
          totalWastedTokens: numeric(row.totalWastedTokens),
          totalWastedCostUsd: numeric(row.totalWastedCostUsd)
        }));
    }
  };
}
