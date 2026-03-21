import { sql } from "drizzle-orm";
import { check, index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { spans } from "./spans";
import { traces } from "./traces";

const wasteCategoryValues = [
  "low_cache_utilization",
  "model_overuse",
  "unused_tools",
  "duplicate_rag",
  "unbounded_history",
  "uncached_prompt",
  "agent_loop",
  "retry_waste",
  "tool_failure_waste",
  "high_output",
  "oversized_context"
] as const;

const severityValues = ["low", "medium", "high", "critical"] as const;

export const wasteReports = sqliteTable(
  "waste_reports",
  {
    id: text("id").primaryKey(),
    traceId: text("trace_id")
      .notNull()
      .references(() => traces.id, { onDelete: "cascade" }),
    spanId: text("span_id").references(() => spans.id, { onDelete: "set null" }),
    category: text("category", { enum: wasteCategoryValues }).notNull(),
    severity: text("severity", { enum: severityValues }).notNull(),
    wastedTokens: integer("wasted_tokens").notNull(),
    wastedCostUsd: real("wasted_cost_usd").notNull(),
    description: text("description").notNull(),
    recommendation: text("recommendation").notNull(),
    estimatedSavingsUsd: real("estimated_savings_usd"),
    evidence: text("evidence", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    detectedAt: integer("detected_at", { mode: "timestamp_ms" }).notNull()
  },
  (table) => [
    index("idx_waste_reports_trace_id_category").on(table.traceId, table.category),
    check(
      "waste_reports_category_check",
      sql`${table.category} in (
        'low_cache_utilization',
        'model_overuse',
        'unused_tools',
        'duplicate_rag',
        'unbounded_history',
        'uncached_prompt',
        'agent_loop',
        'retry_waste',
        'tool_failure_waste',
        'high_output',
        'oversized_context'
      )`
    ),
    check("waste_reports_severity_check", sql`${table.severity} in ('low', 'medium', 'high', 'critical')`)
  ]
);
