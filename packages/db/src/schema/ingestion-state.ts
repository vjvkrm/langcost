import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const ingestionState = sqliteTable("ingestion_state", {
  sourcePath: text("source_path").primaryKey(),
  adapter: text("adapter").notNull(),
  lastOffset: integer("last_offset").notNull(),
  lastLineHash: text("last_line_hash"),
  lastSessionId: text("last_session_id"),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull()
});
