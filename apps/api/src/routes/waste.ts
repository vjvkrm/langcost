import { createTraceRepository, createWasteReportRepository } from "@langcost/db";
import { Hono } from "hono";

import { buildRecommendations, groupBy, sumBy } from "../lib/aggregations";
import { withDb } from "../lib/db";

export function createWasteRoute(options: { dbPath?: string } = {}) {
  const route = new Hono();

  route.get("/", async (c) => {
    const category = c.req.query("category");
    const severity = c.req.query("severity");
    const source = c.req.query("source");
    const limit = Number(c.req.query("limit") ?? "20");
    const offset = Number(c.req.query("offset") ?? "0");

    const payload = await withDb(options.dbPath, (db) => {
      let reports = createWasteReportRepository(db).list();

      if (source) {
        const traceIds = new Set(
          createTraceRepository(db)
            .listForAnalysis()
            .filter((t) => t.source === source)
            .map((t) => t.id),
        );
        reports = reports.filter((r) => traceIds.has(r.traceId));
      }

      if (category) {
        reports = reports.filter((report) => report.category === category);
      }

      if (severity) {
        reports = reports.filter((report) => report.severity === severity);
      }

      const byCategory = [...groupBy(reports, (report) => report.category).entries()].map(
        ([categoryName, items]) => ({
          category: categoryName,
          count: items.length,
          wastedUsd: sumBy(items, (item) => item.wastedCostUsd),
        }),
      );

      return {
        reports: reports.slice(offset, offset + limit),
        total: reports.length,
        summary: {
          totalWastedTokens: sumBy(reports, (report) => report.wastedTokens),
          totalWastedUsd: sumBy(reports, (report) => report.wastedCostUsd),
          byCategory,
        },
      };
    });

    return c.json(payload);
  });

  route.get("/recommendations", async (c) => {
    const source = c.req.query("source");

    const payload = await withDb(options.dbPath, (db) => {
      let reports = createWasteReportRepository(db).list();

      if (source) {
        const traceIds = new Set(
          createTraceRepository(db)
            .listForAnalysis()
            .filter((t) => t.source === source)
            .map((t) => t.id),
        );
        reports = reports.filter((r) => traceIds.has(r.traceId));
      }

      return { recommendations: buildRecommendations(reports) };
    });

    return c.json(payload);
  });

  return route;
}
