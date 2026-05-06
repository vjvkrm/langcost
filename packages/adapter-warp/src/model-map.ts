// Warp uses two model ID formats: snake_case in ai_queries and display names in token_usage.
// Both must resolve to aliases recognised by calculateCost() in @langcost/core.
const WARP_MODEL_MAP: Record<string, string> = {
  "claude-4-6-sonnet-high": "claude-sonnet-4-6",
  "claude-4-6-sonnet": "claude-sonnet-4-6",
  "Claude Sonnet 4.6": "claude-sonnet-4-6",
  "claude-4-5-sonnet": "claude-sonnet-4-5",
  "Claude Sonnet 4.5": "claude-sonnet-4-5",
  "claude-4-6-haiku": "claude-haiku-4-5",
  "claude-4-5-haiku": "claude-haiku-4-5",
  "Claude Haiku 4.5": "claude-haiku-4-5",
  "claude-3-5-haiku": "claude-haiku-3-5",
  "Claude Haiku 3.5": "claude-haiku-3-5",
  "claude-4-6-opus": "claude-opus-4-6",
  "Claude Opus 4.6": "claude-opus-4-6",
  "claude-4-opus": "claude-opus-4",
  "Claude Opus 4": "claude-opus-4",
};

export function normalizeModelId(warpModelId: string): string {
  return WARP_MODEL_MAP[warpModelId] ?? warpModelId;
}
