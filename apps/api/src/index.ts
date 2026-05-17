import { existsSync, statSync } from "node:fs";
import { join } from "node:path";

import { Hono } from "hono";

import { createAdaptersRoute } from "./routes/adapters";
import { createHealthRoute } from "./routes/health";
import { createOverviewRoute } from "./routes/overview";
import { createScanRoute } from "./routes/scan";
import { createSegmentsRoute } from "./routes/segments";
import { createSettingsRoute } from "./routes/settings";
import { createSourcesRoute } from "./routes/sources";
import { createTracesRoute } from "./routes/traces";
import { createWasteRoute } from "./routes/waste";

export { runConfiguredScan } from "./lib/scan";

export interface ApiAppOptions {
  dbPath?: string;
  webDistPath?: string;
}

function resolveWebDistPath(path?: string) {
  if (path) return path;

  // Try each candidate location and pick the first that exists. Order matters:
  // when bundled into the langcost CLI, the file is at packages/cli/dashboard/api/index.ts
  // and the web build sits next to it at packages/cli/dashboard/web/.
  const candidates = [
    new URL("../web", import.meta.url), // bundled CLI: packages/cli/dashboard/web
    new URL("../../web/dist", import.meta.url), // workspace dev: apps/web/dist
  ];

  for (const candidate of candidates) {
    if (candidate.protocol !== "file:") continue;
    if (existsSync(candidate.pathname)) {
      return candidate.pathname;
    }
  }

  return join(process.cwd(), "apps", "web", "dist");
}

function inferContentType(path: string): string | undefined {
  if (path.endsWith(".js")) {
    return "text/javascript; charset=utf-8";
  }

  if (path.endsWith(".css")) {
    return "text/css; charset=utf-8";
  }

  if (path.endsWith(".svg")) {
    return "image/svg+xml";
  }

  if (path.endsWith(".json")) {
    return "application/json; charset=utf-8";
  }

  return undefined;
}

async function serveWebAsset(path: string, distPath: string): Promise<Response> {
  const relativePath = path === "/" ? "index.html" : path.replace(/^\/+/, "");
  const assetPath = join(distPath, relativePath);

  if (existsSync(assetPath) && statSync(assetPath).isFile()) {
    const contentType = inferContentType(assetPath);

    return contentType
      ? new Response(Bun.file(assetPath), {
          headers: { "Content-Type": contentType },
        })
      : new Response(Bun.file(assetPath));
  }

  const indexPath = join(distPath, "index.html");
  if (existsSync(indexPath)) {
    return new Response(Bun.file(indexPath), {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  return new Response(
    `<!doctype html><html><body style="font-family: sans-serif; background:#0f1117; color:#e4e4e7; padding:2rem;"><h1>langcost dashboard</h1><p>Web build not found. Run <code>bun run build</code> in <code>apps/web</code>.</p></body></html>`,
    {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    },
  );
}

export function createApiApp(options: ApiAppOptions = {}) {
  const app = new Hono();
  const routeOptions = options.dbPath ? { dbPath: options.dbPath } : {};
  const distPath = resolveWebDistPath(options.webDistPath);

  app.route("/api/v1/adapters", createAdaptersRoute(routeOptions));
  app.route("/api/v1/health", createHealthRoute(routeOptions));
  app.route("/api/v1/settings", createSettingsRoute(routeOptions));
  app.route("/api/v1/sources", createSourcesRoute(routeOptions));
  app.route("/api/v1/overview", createOverviewRoute(routeOptions));
  app.route("/api/v1/traces", createTracesRoute(routeOptions));
  app.route("/api/v1/waste", createWasteRoute(routeOptions));
  app.route("/api/v1/segments", createSegmentsRoute(routeOptions));
  app.route("/api/v1/scan", createScanRoute(routeOptions));

  app.get("*", async (c) => serveWebAsset(c.req.path, distPath));

  return app;
}

export function startApiServer(port = 3737, options: ApiAppOptions = {}) {
  const app = createApiApp(options);
  return Bun.serve({
    port,
    fetch: app.fetch,
  });
}

if (import.meta.main) {
  const port = Number(process.env.PORT ?? "3737");
  const server = startApiServer(port);
  console.log(`API running at http://localhost:${server.port}`);
}
