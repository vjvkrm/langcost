import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { spans } from "./spans";
import { traces } from "./traces";

const messageRoleValues = ["system", "user", "assistant", "tool"] as const;

export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey(),
    spanId: text("span_id")
      .notNull()
      .references(() => spans.id, { onDelete: "cascade" }),
    traceId: text("trace_id")
      .notNull()
      .references(() => traces.id, { onDelete: "cascade" }),
    role: text("role", { enum: messageRoleValues }).notNull(),
    content: text("content").notNull(),
    tokenCount: integer("token_count"),
    position: integer("position").notNull(),
    metadata: text("metadata", { mode: "json" }).$type<Record<string, unknown> | null>()
  },
  (table) => [
    index("idx_messages_trace_id_position").on(table.traceId, table.position),
    check("messages_role_check", sql`${table.role} in ('system', 'user', 'assistant', 'tool')`)
  ]
);
