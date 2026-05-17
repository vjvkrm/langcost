import { createTraceRepository } from "@langcost/db";
import { Hono } from "hono";

import { type AdapterInstallType, tryLoadAdapterWithSource } from "../lib/adapter-loader";
import { installAdapterPackage, uninstallAdapterPackage } from "../lib/adapter-package";
import { withDb } from "../lib/db";

interface KnownAdapter {
  name: string;
  label: string;
}

const KNOWN_ADAPTERS: KnownAdapter[] = [
  { name: "openclaw", label: "OpenClaw" },
  { name: "claude-code", label: "Claude Code" },
  { name: "warp", label: "Warp" },
  { name: "cline", label: "Cline" },
];

interface AdapterStatusBase {
  name: string;
  label: string;
  traceCount: number;
  lastScanAt: string | null;
}

interface AdapterStatusInstalled extends AdapterStatusBase {
  installed: true;
  version: string;
  installType: AdapterInstallType;
}

interface AdapterStatusMissing extends AdapterStatusBase {
  installed: false;
  installCommand: string;
}

type AdapterStatus = AdapterStatusInstalled | AdapterStatusMissing;

interface SourceStats {
  count: number;
  lastScanAt: Date;
}

async function buildAdapterStatus(
  known: KnownAdapter,
  stats: SourceStats | undefined,
): Promise<AdapterStatus> {
  const loaded = await tryLoadAdapterWithSource(known.name);
  const base: AdapterStatusBase = {
    name: known.name,
    label: known.label,
    traceCount: stats?.count ?? 0,
    lastScanAt: stats?.lastScanAt.toISOString() ?? null,
  };

  if (loaded) {
    return {
      ...base,
      installed: true,
      version: loaded.adapter.meta.version,
      installType: loaded.installType,
    };
  }

  return {
    ...base,
    installed: false,
    installCommand: `npm install -g @langcost/adapter-${known.name}`,
  };
}

function collectSourceStats(dbPath?: string): Promise<Map<string, SourceStats>> {
  return withDb(dbPath, (db) => {
    const traceRepository = createTraceRepository(db);
    const stats = new Map<string, SourceStats>();

    for (const trace of traceRepository.listForAnalysis()) {
      const existing = stats.get(trace.source);
      if (!existing) {
        stats.set(trace.source, { count: 1, lastScanAt: trace.ingestedAt });
      } else {
        existing.count += 1;
        if (trace.ingestedAt.getTime() > existing.lastScanAt.getTime()) {
          existing.lastScanAt = trace.ingestedAt;
        }
      }
    }

    return stats;
  });
}

export function createAdaptersRoute(options: { dbPath?: string } = {}) {
  const route = new Hono();

  route.get("/", async (c) => {
    const stats = await collectSourceStats(options.dbPath);
    const adapters = await Promise.all(
      KNOWN_ADAPTERS.map((known) => buildAdapterStatus(known, stats.get(known.name))),
    );
    return c.json({ adapters });
  });

  route.post("/:name", async (c) => {
    const name = c.req.param("name");
    const known = KNOWN_ADAPTERS.find((a) => a.name === name);
    if (!known) {
      return c.json({ error: `Unknown adapter "${name}"` }, 404);
    }

    try {
      await installAdapterPackage(name);
      return c.json({ ok: true });
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : "Failed to install adapter." },
        500,
      );
    }
  });

  route.delete("/:name", async (c) => {
    const name = c.req.param("name");
    const known = KNOWN_ADAPTERS.find((a) => a.name === name);
    if (!known) {
      return c.json({ error: `Unknown adapter "${name}"` }, 404);
    }

    const loaded = await tryLoadAdapterWithSource(name);
    if (!loaded) {
      return c.json({ error: `Adapter "${name}" is not installed.` }, 400);
    }
    if (loaded.installType === "workspace") {
      return c.json(
        {
          error: `Adapter "${name}" is linked from the workspace and cannot be uninstalled from the UI.`,
        },
        400,
      );
    }

    try {
      await uninstallAdapterPackage(name);
      return c.json({ ok: true });
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : "Failed to uninstall adapter." },
        500,
      );
    }
  });

  return route;
}
