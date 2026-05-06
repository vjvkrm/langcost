import { Database } from "bun:sqlite";
import { join } from "node:path";

const WARP_GROUP_CONTAINER = "2BBY89MBSN.dev.warp";
const WARP_STABLE_BUNDLE_ID = "dev.warp.Warp-Stable";
const WARP_PREVIEW_BUNDLE_ID = "dev.warp.Warp-Preview";

const REQUIRED_TABLES = ["agent_conversations", "ai_queries", "blocks"];

function warpDbPath(bundleId: string): string {
  const home = process.env.HOME ?? ".";
  return join(
    home,
    "Library",
    "Group Containers",
    WARP_GROUP_CONTAINER,
    "Library",
    "Application Support",
    bundleId,
    "warp.sqlite",
  );
}

export function defaultWarpDbPath(): string {
  return warpDbPath(WARP_STABLE_BUNDLE_ID);
}

export function previewWarpDbPath(): string {
  return warpDbPath(WARP_PREVIEW_BUNDLE_ID);
}

export interface SchemaValidationResult {
  ok: boolean;
  message: string;
  missingTables?: string[];
}

export function validateSchema(dbPath: string): SchemaValidationResult {
  let db: Database | undefined;
  try {
    db = new Database(dbPath, { readonly: true });

    const existingTables = db
      .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((r) => r.name);

    const missing = REQUIRED_TABLES.filter((t) => !existingTables.includes(t));
    if (missing.length > 0) {
      return {
        ok: false,
        message: `warp.sqlite schema is missing expected tables: ${missing.join(", ")}. The adapter may be incompatible with this Warp version.`,
        missingTables: missing,
      };
    }

    return { ok: true, message: `Found warp.sqlite with all required tables at ${dbPath}` };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return { ok: false, message: `Cannot open warp.sqlite: ${message}` };
  } finally {
    db?.close();
  }
}

export async function discoverWarpDb(sourcePath?: string): Promise<string | null> {
  const candidates = sourcePath
    ? [sourcePath]
    : [defaultWarpDbPath(), previewWarpDbPath()];

  for (const candidate of candidates) {
    try {
      const file = Bun.file(candidate);
      if (await file.exists()) {
        return candidate;
      }
    } catch {}
  }

  return null;
}
