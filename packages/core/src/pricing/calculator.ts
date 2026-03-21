import type { ModelPricing } from "./providers";
import { MODEL_PRICING } from "./providers";

function normalizeModelName(model: string): string {
  return model.trim().toLowerCase();
}

function validateTokenCount(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative number.`);
  }
}

export function findPricing(model: string): ModelPricing | undefined {
  const normalizedModel = normalizeModelName(model);

  return MODEL_PRICING.find((entry) => {
    if (normalizeModelName(entry.model) === normalizedModel) {
      return true;
    }

    return entry.aliases.some((alias) => normalizeModelName(alias) === normalizedModel);
  });
}

export function calculateCost(model: string, inputTokens: number, outputTokens: number) {
  validateTokenCount(inputTokens, "inputTokens");
  validateTokenCount(outputTokens, "outputTokens");

  const pricing = findPricing(model);
  if (!pricing) {
    return {
      inputCost: 0,
      outputCost: 0,
      totalCost: 0
    };
  }

  const inputCost = (inputTokens / 1_000_000) * pricing.inputPricePerMToken;
  const outputCost = (outputTokens / 1_000_000) * pricing.outputPricePerMToken;

  return {
    inputCost,
    outputCost,
    totalCost: inputCost + outputCost
  };
}
