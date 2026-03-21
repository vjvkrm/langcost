import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { migrate as drizzleMigrate } from "drizzle-orm/bun-sqlite/migrator";

import type { Db } from "./client";

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), "..", "drizzle");

export function migrate(db: Db): void {
  drizzleMigrate(db, { migrationsFolder });
}
