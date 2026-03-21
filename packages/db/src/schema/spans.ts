import { sql } from "drizzle-orm";
import {
  type AnySQLiteColumn,
  check,
  index,
  integer,
  real,
  sqliteTable,
  text
} from "drizzle-orm/sqlite-core";

import { traces } from "./traces";

const spanTypeValues = ["llm", "tool", "retrieval", "agent"] as const;
const spanStatusValues = ["ok", "error"] as const;

export const spans = sqliteTable(
  "spans",
  {
    id: text("id").primaryKey(),
    traceId: text("trace_id")
      .notNull()
      .references(() => traces.id, { onDelete: "cascade" }),
    parentSpanId: text("parent_span_id").references((): AnySQLiteColumn => spans.id, {
      onDelete: "set null"
    }),
    externalId: text("external_id").notNull(),
    type: text("type", { enum: spanTypeValues }).notNull(),
    name: text("name"),
    startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
    endedAt: integer("ended_at", { mode: "timestamp_ms" }),
    durationMs: integer("duration_ms"),
    model: text("model"),
    provider: text("provider"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    costUsd: real("cost_usd"),
    toolName: text("tool_name"),
    toolInput: text("tool_input"),
    toolOutput: text("tool_output"),
    toolSuccess: integer("tool_success", { mode: "boolean" }),
    status: text("status", { enum: spanStatusValues }).notNull(),
    errorMessage: text("error_message"),
    metadata: text("metadata", { mode: "json" }).$type<Record<string, unknown> | null>()
  },
  (table) => [
    index("idx_spans_trace_id").on(table.traceId),
    check("spans_type_check", sql`${table.type} in ('llm', 'tool', 'retrieval', 'agent')`),
    check("spans_status_check", sql`${table.status} in ('ok', 'error')`)
  ]
);
