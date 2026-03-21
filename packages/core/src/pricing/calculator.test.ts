import { describe, expect, it } from "bun:test";

import { calculateCost, findPricing } from "./calculator";

describe("findPricing", () => {
  it("matches canonical model names", () => {
    expect(findPricing("gpt-4o")?.provider).toBe("openai");
  });

  it("matches aliases case-insensitively", () => {
    expect(findPricing("SONNET-4")?.model).toBe("claude-sonnet-4-20250514");
  });
});

describe("calculateCost", () => {
  it("calculates input and output cost", () => {
    expect(calculateCost("gpt-4o", 1_000_000, 500_000)).toEqual({
      inputCost: 2.5,
      outputCost: 5,
      totalCost: 7.5
    });
  });

  it("returns zero cost for unknown models", () => {
    expect(calculateCost("unknown-model", 100, 200)).toEqual({
      inputCost: 0,
      outputCost: 0,
      totalCost: 0
    });
  });
});
