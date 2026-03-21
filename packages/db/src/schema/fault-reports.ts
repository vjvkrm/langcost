import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { spans } from "./spans";
import { traces } from "./traces";

const faultTypeValues = [
  "upstream_data",
  "model_error",
  "tool_failure",
  "loop",
  "timeout",
  "unknown"
] as const;

export const faultReports = sqliteTable(
  "fault_reports",
  {
    id: text("id").primaryKey(),
    traceId: text("trace_id")
      .notNull()
      .references(() => traces.id, { onDelete: "cascade" }),
    faultSpanId: text("fault_span_id")
      .notNull()
      .references(() => spans.id, { onDelete: "cascade" }),
    rootCauseSpanId: text("root_cause_span_id").references(() => spans.id, {
      onDelete: "set null"
    }),
    faultType: text("fault_type", { enum: faultTypeValues }).notNull(),
    description: text("description").notNull(),
    cascadeDepth: integer("cascade_depth").notNull(),
    affectedSpanIds: text("affected_span_ids", { mode: "json" }).$type<string[]>().notNull(),
    detectedAt: integer("detected_at", { mode: "timestamp_ms" }).notNull()
  },
  (table) => [
    index("idx_fault_reports_trace_id").on(table.traceId),
    check(
      "fault_reports_fault_type_check",
      sql`${table.faultType} in ('upstream_data', 'model_error', 'tool_failure', 'loop', 'timeout', 'unknown')`
    )
  ]
);
