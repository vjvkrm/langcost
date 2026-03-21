import { describe, expect, it } from "bun:test";

import { estimateTokenCount } from "./tokens";

describe("estimateTokenCount", () => {
  it("returns zero for empty strings", () => {
    expect(estimateTokenCount("")).toBe(0);
  });

  it("uses a chars-divided-by-four fallback", () => {
    expect(estimateTokenCount("12345678")).toBe(2);
  });

  it("rounds up partial groups", () => {
    expect(estimateTokenCount("12345")).toBe(2);
  });
});
