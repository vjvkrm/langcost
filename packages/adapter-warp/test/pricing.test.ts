import { describe, expect, it } from "bun:test";

import { resolveWarpCreditRateUsd } from "../src/pricing";

describe("resolveWarpCreditRateUsd", () => {
  it("uses monthly Build pricing for credit rate", () => {
    const { warpPlan, effectiveCreditRateUsd } = resolveWarpCreditRateUsd("build");

    expect(warpPlan).toBe("build");
    expect(effectiveCreditRateUsd).toBeCloseTo(20 / 1500, 8);
  });

  it("uses monthly Business pricing for credit rate", () => {
    const { warpPlan, effectiveCreditRateUsd } = resolveWarpCreditRateUsd("business");

    expect(warpPlan).toBe("business");
    expect(effectiveCreditRateUsd).toBeCloseTo(50 / 1500, 8);
  });
});
