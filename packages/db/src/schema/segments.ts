import { sql } from "drizzle-orm";
import { check, index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { spans } from "./spans";
import { traces } from "./traces";

const segmentTypeValues = [
  "system_prompt",
  "tool_schema",
  "conversation_history",
  "rag_context",
  "user_query",
  "assistant_response",
  "tool_result",
  "unknown"
] as const;

export const segments = sqliteTable(
  "segments",
  {
    id: text("id").primaryKey(),
    spanId: text("span_id")
      .notNull()
      .references(() => spans.id, { onDelete: "cascade" }),
    traceId: text("trace_id")
      .notNull()
      .references(() => traces.id, { onDelete: "cascade" }),
    type: text("type", { enum: segmentTypeValues }).notNull(),
    tokenCount: integer("token_count").notNull(),
    costUsd: real("cost_usd").notNull(),
    percentOfSpan: real("percent_of_span").notNull(),
    contentHash: text("content_hash"),
    charStart: integer("char_start"),
    charEnd: integer("char_end"),
    analyzedAt: integer("analyzed_at", { mode: "timestamp_ms" }).notNull()
  },
  (table) => [
    index("idx_segments_trace_id_type").on(table.traceId, table.type),
    check(
      "segments_type_check",
      sql`${table.type} in (
        'system_prompt',
        'tool_schema',
        'conversation_history',
        'rag_context',
        'user_query',
        'assistant_response',
        'tool_result',
        'unknown'
      )`
    )
  ]
);
