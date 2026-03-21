import { desc, eq } from "drizzle-orm";

import type { Db } from "../client";
import { ingestionState } from "../schema";

export type IngestionStateRecord = typeof ingestionState.$inferInsert;
type IngestionStateRow = typeof ingestionState.$inferSelect;

function toRow(record: IngestionStateRecord): IngestionStateRecord {
  return {
    ...record,
    lastLineHash: record.lastLineHash ?? null,
    lastSessionId: record.lastSessionId ?? null
  };
}

function fromRow(row: IngestionStateRow): IngestionStateRow {
  return row;
}

export function createIngestionStateRepository(db: Db) {
  return {
    upsert(record: IngestionStateRecord): void {
      const row = toRow(record);
      db.insert(ingestionState)
        .values(row)
        .onConflictDoUpdate({
          target: ingestionState.sourcePath,
          set: {
            adapter: row.adapter,
            lastOffset: row.lastOffset,
            lastLineHash: row.lastLineHash,
            lastSessionId: row.lastSessionId,
            updatedAt: row.updatedAt
          }
        })
        .run();
    },
    getBySourcePath(sourcePath: string): IngestionStateRow | null {
      const row = db.select().from(ingestionState).where(eq(ingestionState.sourcePath, sourcePath)).get();
      return row ? fromRow(row) : null;
    },
    list(): IngestionStateRow[] {
      return db.select().from(ingestionState).orderBy(desc(ingestionState.updatedAt)).all().map(fromRow);
    }
  };
}
