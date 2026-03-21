import { sql } from "drizzle-orm";
import { check, index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

const traceStatusValues = ["complete", "error", "partial"] as const;

export const traces = sqliteTable(
  "traces",
  {
    id: text("id").primaryKey(),
    externalId: text("external_id").notNull(),
    source: text("source").notNull(),
    sessionKey: text("session_key"),
    agentId: text("agent_id"),
    startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
    endedAt: integer("ended_at", { mode: "timestamp_ms" }),
    totalInputTokens: integer("total_input_tokens").notNull().default(0),
    totalOutputTokens: integer("total_output_tokens").notNull().default(0),
    totalCostUsd: real("total_cost_usd").notNull().default(0),
    model: text("model"),
    status: text("status", { enum: traceStatusValues }).notNull(),
    metadata: text("metadata", { mode: "json" }).$type<Record<string, unknown> | null>(),
    ingestedAt: integer("ingested_at", { mode: "timestamp_ms" }).notNull()
  },
  (table) => [
    index("idx_traces_started_at").on(table.startedAt),
    check("traces_status_check", sql`${table.status} in ('complete', 'error', 'partial')`)
  ]
);
