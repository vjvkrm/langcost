export interface ModelPricing {
  provider: string;
  model: string;
  aliases: string[];
  inputPricePerMToken: number;
  outputPricePerMToken: number;
  cachedInputPricePerMToken?: number;
  cacheWrite5mInputPricePerMToken?: number;
  cacheWrite1hInputPricePerMToken?: number;
  updatedAt: string;
}

export const MODEL_PRICING: ModelPricing[] = [
  // ──────────────────────────────────────────
  // Anthropic — Opus 4.7 ($5 input)
  // Same per-token rates as 4.6, but a new tokenizer that may use
  // up to 35% more tokens for the same text. Source: docs.claude.com/pricing.
  // ──────────────────────────────────────────
  {
    provider: "anthropic",
    model: "claude-opus-4-7",
    aliases: ["opus-4-7", "claude-opus-4.7", "opus-4.7"],
    inputPricePerMToken: 5,
    outputPricePerMToken: 25,
    cachedInputPricePerMToken: 0.5,
    cacheWrite5mInputPricePerMToken: 6.25,
    cacheWrite1hInputPricePerMToken: 10,
    updatedAt: "2026-05-06",
  },
  // ──────────────────────────────────────────
  // Anthropic — Opus 4.5 / 4.6 ($5 input)
  // ──────────────────────────────────────────
  {
    provider: "anthropic",
    model: "claude-opus-4-6",
    aliases: ["claude-opus-4-5", "opus-4-5", "opus-4-6"],
    inputPricePerMToken: 5,
    outputPricePerMToken: 25,
    cachedInputPricePerMToken: 0.5,
    cacheWrite5mInputPricePerMToken: 6.25,
    cacheWrite1hInputPricePerMToken: 10,
    updatedAt: "2026-05-06",
  },
  // ──────────────────────────────────────────
  // Anthropic — Opus 4.0 / 4.1 ($15 input)
  // ──────────────────────────────────────────
  {
    provider: "anthropic",
    model: "claude-opus-4-20250514",
    aliases: ["claude-opus-4", "claude-opus-4-1", "opus-4", "opus-4-1"],
    inputPricePerMToken: 15,
    outputPricePerMToken: 75,
    cachedInputPricePerMToken: 1.5,
    cacheWrite5mInputPricePerMToken: 18.75,
    cacheWrite1hInputPricePerMToken: 30,
    updatedAt: "2026-04-03",
  },
  // ──────────────────────────────────────────
  // Anthropic — Sonnet 4.x ($3 input)
  // ──────────────────────────────────────────
  {
    provider: "anthropic",
    model: "claude-sonnet-4-20250514",
    aliases: [
      "claude-sonnet-4",
      "claude-sonnet-4-5",
      "claude-sonnet-4-6",
      "sonnet-4",
      "sonnet-4-5",
      "sonnet-4-6",
    ],
    inputPricePerMToken: 3,
    outputPricePerMToken: 15,
    cachedInputPricePerMToken: 0.3,
    cacheWrite5mInputPricePerMToken: 3.75,
    cacheWrite1hInputPricePerMToken: 6,
    updatedAt: "2026-04-03",
  },
  // ──────────────────────────────────────────
  // Anthropic — Haiku
  // ──────────────────────────────────────────
  {
    provider: "anthropic",
    model: "claude-haiku-4-5-20251001",
    aliases: ["claude-haiku-4.5", "claude-haiku-4-5", "haiku-4.5", "haiku-4-5"],
    inputPricePerMToken: 1,
    outputPricePerMToken: 5,
    cachedInputPricePerMToken: 0.1,
    cacheWrite5mInputPricePerMToken: 1.25,
    cacheWrite1hInputPricePerMToken: 2,
    updatedAt: "2026-04-03",
  },
  {
    provider: "anthropic",
    model: "claude-haiku-3-5-20241022",
    aliases: ["claude-haiku-3.5", "claude-haiku-3-5", "haiku-3.5", "haiku-3-5"],
    inputPricePerMToken: 0.8,
    outputPricePerMToken: 4,
    cachedInputPricePerMToken: 0.08,
    cacheWrite5mInputPricePerMToken: 1,
    cacheWrite1hInputPricePerMToken: 1.6,
    updatedAt: "2026-04-03",
  },

  // ──────────────────────────────────────────
  // OpenAI
  // ──────────────────────────────────────────
  {
    provider: "openai",
    model: "gpt-4.1",
    aliases: ["gpt-4.1-2025-04-14"],
    inputPricePerMToken: 2,
    outputPricePerMToken: 8,
    cachedInputPricePerMToken: 0.5,
    updatedAt: "2026-03-21",
  },
  {
    provider: "openai",
    model: "gpt-4.1-mini",
    aliases: ["gpt-4.1-mini-2025-04-14"],
    inputPricePerMToken: 0.4,
    outputPricePerMToken: 1.6,
    cachedInputPricePerMToken: 0.1,
    updatedAt: "2026-03-21",
  },
  {
    provider: "openai",
    model: "gpt-4.1-nano",
    aliases: ["gpt-4.1-nano-2025-04-14"],
    inputPricePerMToken: 0.1,
    outputPricePerMToken: 0.4,
    cachedInputPricePerMToken: 0.025,
    updatedAt: "2026-03-21",
  },
  {
    provider: "openai",
    model: "gpt-4o",
    aliases: ["gpt-4o-2024-08-06"],
    inputPricePerMToken: 2.5,
    outputPricePerMToken: 10,
    cachedInputPricePerMToken: 1.25,
    updatedAt: "2026-03-21",
  },
  {
    provider: "openai",
    model: "gpt-4o-mini",
    aliases: ["gpt-4o-mini-2024-07-18"],
    inputPricePerMToken: 0.15,
    outputPricePerMToken: 0.6,
    cachedInputPricePerMToken: 0.075,
    updatedAt: "2026-03-21",
  },
  {
    provider: "openai",
    model: "o3",
    aliases: ["o3-2025-04-16"],
    inputPricePerMToken: 2,
    outputPricePerMToken: 8,
    cachedInputPricePerMToken: 0.5,
    updatedAt: "2026-03-21",
  },
  {
    provider: "openai",
    model: "o3-mini",
    aliases: ["o3-mini-2025-01-31"],
    inputPricePerMToken: 1.1,
    outputPricePerMToken: 4.4,
    cachedInputPricePerMToken: 0.55,
    updatedAt: "2026-03-21",
  },
  {
    provider: "openai",
    model: "o4-mini",
    aliases: ["o4-mini-2025-04-16"],
    inputPricePerMToken: 1.1,
    outputPricePerMToken: 4.4,
    cachedInputPricePerMToken: 0.275,
    updatedAt: "2026-03-21",
  },

  // ──────────────────────────────────────────
  // Google
  // ──────────────────────────────────────────
  {
    provider: "google",
    model: "gemini-2.5-pro",
    aliases: ["gemini-2.5-pro-preview-03-25"],
    inputPricePerMToken: 1.25,
    outputPricePerMToken: 10,
    cachedInputPricePerMToken: 0.31,
    updatedAt: "2026-03-21",
  },
  {
    provider: "google",
    model: "gemini-2.5-flash",
    aliases: ["gemini-2.5-flash-preview-04-17"],
    inputPricePerMToken: 0.15,
    outputPricePerMToken: 0.6,
    cachedInputPricePerMToken: 0.0375,
    updatedAt: "2026-03-21",
  },
  {
    provider: "google",
    model: "gemini-2.0-flash",
    aliases: ["gemini-flash", "gemini-2-flash"],
    inputPricePerMToken: 0.1,
    outputPricePerMToken: 0.4,
    cachedInputPricePerMToken: 0.025,
    updatedAt: "2026-03-21",
  },
  {
    provider: "google",
    model: "gemini-2.0-flash-lite",
    aliases: ["gemini-flash-lite", "gemini-2-flash-lite"],
    inputPricePerMToken: 0.075,
    outputPricePerMToken: 0.3,
    updatedAt: "2026-03-21",
  },

  // ──────────────────────────────────────────
  // DeepSeek
  // ──────────────────────────────────────────
  {
    provider: "deepseek",
    model: "deepseek-chat",
    aliases: ["deepseek-v3", "deepseek-chat-v3"],
    inputPricePerMToken: 0.27,
    outputPricePerMToken: 1.1,
    cachedInputPricePerMToken: 0.07,
    updatedAt: "2026-03-21",
  },
  {
    provider: "deepseek",
    model: "deepseek-reasoner",
    aliases: ["deepseek-r1"],
    inputPricePerMToken: 0.55,
    outputPricePerMToken: 2.19,
    cachedInputPricePerMToken: 0.14,
    updatedAt: "2026-03-21",
  },

  // ──────────────────────────────────────────
  // Mistral
  // ──────────────────────────────────────────
  {
    provider: "mistral",
    model: "mistral-large-latest",
    aliases: ["mistral-large", "mistral-large-2"],
    inputPricePerMToken: 2,
    outputPricePerMToken: 6,
    updatedAt: "2026-03-21",
  },
  {
    provider: "mistral",
    model: "mistral-small-latest",
    aliases: ["mistral-small"],
    inputPricePerMToken: 0.1,
    outputPricePerMToken: 0.3,
    updatedAt: "2026-03-21",
  },
  {
    provider: "mistral",
    model: "codestral-latest",
    aliases: ["codestral"],
    inputPricePerMToken: 0.3,
    outputPricePerMToken: 0.9,
    updatedAt: "2026-03-21",
  },
];
