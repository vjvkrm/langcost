import { describe, expect, it } from "bun:test";
import { join } from "node:path";

import { normalizeTask } from "../src/normalizer";
import { readTaskFile } from "../src/reader";
import type { DiscoveredClineTaskFile } from "../src/types";

const rootPath = join(process.cwd(), "fixtures", "cline", "task-1778305767614");
const filePath = join(rootPath, "tasks", "1778305767614", "ui_messages.json");

function discovered(): DiscoveredClineTaskFile {
  return {
    filePath,
    fileSize: 1,
    modifiedAt: new Date("2026-05-01T00:00:00.000Z"),
    taskId: "1778305767614",
    rootPath,
  };
}

describe("normalizeTask", () => {
  it("creates one trace and llm spans from api_req_started messages", async () => {
    const readResult = await readTaskFile(filePath, rootPath);
    const normalized = normalizeTask(discovered(), readResult);

    expect(normalized.trace.id).toBe("cline:trace:1778305767614");
    expect(normalized.trace.source).toBe("cline");
    expect(normalized.spans).toHaveLength(2);
    expect(normalized.spans.every((span) => span.type === "llm")).toBe(true);
  });

  it("preserves OpenRouter provider and model", async () => {
    const readResult = await readTaskFile(filePath, rootPath);
    const normalized = normalizeTask(discovered(), readResult);

    expect(normalized.spans[0]?.provider).toBe("openrouter");
    expect(normalized.spans[0]?.model).toBe("anthropic/claude-sonnet-4.5");
    expect(normalized.trace.model).toBe("anthropic/claude-sonnet-4.5");
  });

  it("uses stored Cline costs instead of recalculating", async () => {
    const readResult = await readTaskFile(filePath, rootPath);
    const normalized = normalizeTask(discovered(), readResult);

    expect(normalized.spans[0]?.costUsd).toBe(0.082773);
    expect(normalized.spans[1]?.costUsd).toBe(0.1443534);
    expect(normalized.trace.totalCostUsd).toBeCloseTo(0.2271264);
  });

  it("preserves cache token metadata and aggregate context totals", async () => {
    const readResult = await readTaskFile(filePath, rootPath);
    const normalized = normalizeTask(discovered(), readResult);

    expect(normalized.spans[0]?.metadata).toMatchObject({
      cacheWrites: 10286,
      cacheReads: 0,
      totalContextTokens: 10476,
    });
    expect(normalized.spans[1]?.metadata).toMatchObject({
      cacheWrites: 12682,
      cacheReads: 49324,
      totalContextTokens: 62668,
    });
    expect(normalized.trace.metadata).toMatchObject({
      cacheWrites: 22968,
      cacheReads: 49324,
      totalContextTokens: 73144,
      costSource: "cline",
    });
    expect(normalized.trace.totalInputTokens + normalized.trace.totalOutputTokens).toBe(73144);
  });
});
