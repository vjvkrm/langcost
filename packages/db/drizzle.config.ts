import { join } from "node:path";

import { defineConfig } from "drizzle-kit";

const dbPath = process.env.LANGCOST_DB_PATH ?? join(process.env.HOME ?? ".", ".langcost", "langcost.db");

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  dbCredentials: {
    url: dbPath
  }
});
