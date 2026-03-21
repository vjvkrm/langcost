import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";

import * as schema from "./schema";

export type Db = BunSQLiteDatabase<typeof schema>;

export const DEFAULT_DB_DIRECTORY = join(process.env.HOME ?? ".", ".langcost");
export const DEFAULT_DB_PATH = join(DEFAULT_DB_DIRECTORY, "langcost.db");

export function resolveDbPath(path?: string): string {
  return path ?? DEFAULT_DB_PATH;
}

export function ensureDbDirectory(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
}

export function createDb(path?: string): Db {
  const dbPath = resolveDbPath(path);
  ensureDbDirectory(dbPath);

  const sqlite = new Database(dbPath, { create: true });
  sqlite.exec("PRAGMA journal_mode = WAL;");
  sqlite.exec("PRAGMA foreign_keys = ON;");
  return drizzle({ client: sqlite, schema });
}

export function getSqliteClient(db: Db): Database {
  return db.$client;
}
