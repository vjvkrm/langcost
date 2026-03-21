import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

const analysisRunStatusValues = ["running", "complete", "error"] as const;

export const analysisRuns = sqliteTable(
  "analysis_runs",
  {
    id: text("id").primaryKey(),
    analyzerName: text("analyzer_name").notNull(),
    startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
    completedAt: integer("completed_at", { mode: "timestamp_ms" }),
    tracesAnalyzed: integer("traces_analyzed").notNull(),
    findingsCount: integer("findings_count").notNull(),
    status: text("status", { enum: analysisRunStatusValues }).notNull(),
    errorMessage: text("error_message")
  },
  (table) => [
    index("idx_analysis_runs_analyzer_name").on(table.analyzerName),
    check("analysis_runs_status_check", sql`${table.status} in ('running', 'complete', 'error')`)
  ]
);
