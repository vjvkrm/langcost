export const WARP_INCLUDED_CREDITS_PER_MONTH = 1_500;
export const WARP_BUILD_MONTHLY_PRICE_USD = 18;
export const WARP_BUSINESS_MONTHLY_PRICE_USD = 45;

export const WARP_ADD_ON_CREDIT_RATE_USD_BOUNDS = {
  low: 0.0153,
  high: 0.025,
} as const;

export const WARP_PLAN_CREDIT_RATE_USD = {
  build: WARP_BUILD_MONTHLY_PRICE_USD / WARP_INCLUDED_CREDITS_PER_MONTH,
  business: WARP_BUSINESS_MONTHLY_PRICE_USD / WARP_INCLUDED_CREDITS_PER_MONTH,
  "add-on-low": WARP_ADD_ON_CREDIT_RATE_USD_BOUNDS.low,
  "add-on-high": WARP_ADD_ON_CREDIT_RATE_USD_BOUNDS.high,
  byok: 0,
} as const;

export type WarpPlan = keyof typeof WARP_PLAN_CREDIT_RATE_USD;

export const DEFAULT_WARP_PLAN: WarpPlan = "build";
export const WARP_PLAN_OPTIONS = Object.keys(WARP_PLAN_CREDIT_RATE_USD) as WarpPlan[];

export function isWarpPlan(value: string): value is WarpPlan {
  return WARP_PLAN_OPTIONS.includes(value as WarpPlan);
}

export function resolveWarpCreditRateUsd(plan: string | undefined): {
  warpPlan: WarpPlan;
  effectiveCreditRateUsd: number;
} {
  if (plan && isWarpPlan(plan)) {
    return {
      warpPlan: plan,
      effectiveCreditRateUsd: WARP_PLAN_CREDIT_RATE_USD[plan],
    };
  }

  return {
    warpPlan: DEFAULT_WARP_PLAN,
    effectiveCreditRateUsd: WARP_PLAN_CREDIT_RATE_USD[DEFAULT_WARP_PLAN],
  };
}
