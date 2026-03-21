export interface ModelPricing {
  provider: string;
  model: string;
  aliases: string[];
  inputPricePerMToken: number;
  outputPricePerMToken: number;
  cachedInputPricePerMToken?: number;
  updatedAt: string;
}

export const MODEL_PRICING: ModelPricing[] = [
  {
    provider: "anthropic",
    model: "claude-opus-4-20250514",
    aliases: ["claude-opus-4", "opus-4"],
    inputPricePerMToken: 15,
    outputPricePerMToken: 75,
    cachedInputPricePerMToken: 1.5,
    updatedAt: "2025-05-14"
  },
  {
    provider: "anthropic",
    model: "claude-sonnet-4-20250514",
    aliases: ["claude-sonnet-4", "sonnet-4"],
    inputPricePerMToken: 3,
    outputPricePerMToken: 15,
    cachedInputPricePerMToken: 0.3,
    updatedAt: "2025-05-14"
  },
  {
    provider: "anthropic",
    model: "claude-haiku-3-5-20241022",
    aliases: ["claude-haiku-3.5", "haiku-3.5"],
    inputPricePerMToken: 0.8,
    outputPricePerMToken: 4,
    cachedInputPricePerMToken: 0.08,
    updatedAt: "2024-10-22"
  },
  {
    provider: "openai",
    model: "gpt-4o",
    aliases: ["gpt-4o-2024-08-06"],
    inputPricePerMToken: 2.5,
    outputPricePerMToken: 10,
    cachedInputPricePerMToken: 1.25,
    updatedAt: "2024-08-06"
  },
  {
    provider: "openai",
    model: "gpt-4o-mini",
    aliases: ["gpt-4o-mini-2024-07-18"],
    inputPricePerMToken: 0.15,
    outputPricePerMToken: 0.6,
    cachedInputPricePerMToken: 0.075,
    updatedAt: "2024-07-18"
  },
  {
    provider: "google",
    model: "gemini-2.0-flash",
    aliases: ["gemini-flash", "gemini-2-flash"],
    inputPricePerMToken: 0.1,
    outputPricePerMToken: 0.4,
    updatedAt: "2025-02-01"
  },
  {
    provider: "google",
    model: "gemini-2.0-pro",
    aliases: ["gemini-pro", "gemini-2-pro"],
    inputPricePerMToken: 1.25,
    outputPricePerMToken: 10,
    updatedAt: "2025-02-01"
  }
];
