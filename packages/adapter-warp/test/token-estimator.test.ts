import { describe, expect, it } from "bun:test";

import { estimateSpanTokens } from "../src/token-estimator";
import type { WarpConversationUsageMetadata, WarpQueryRow } from "../src/types";

function anExchange(id: string, inputLength = 100): WarpQueryRow {
  return {
    exchange_id: id,
    conversation_id: "conv-1",
    start_ts: "2026-03-20 10:00:01",
    input: "x".repeat(inputLength),
    output_status: '"Completed"',
    model_id: "claude-4-6-sonnet-high",
    working_directory: null,
  };
}

function withPrimaryAgentTokens(tokens: number): WarpConversationUsageMetadata {
  return {
    token_usage: [
      {
        model_id: "Claude Sonnet 4.6",
        warp_tokens: 0,
        byok_tokens: tokens,
        warp_token_usage_by_category: {},
        byok_token_usage_by_category: { primary_agent: tokens },
      },
    ],
  };
}

function withFullTerminalUseTokens(tokens: number): WarpConversationUsageMetadata {
  return {
    token_usage: [
      {
        model_id: "Claude Haiku 4.5",
        warp_tokens: 0,
        byok_tokens: tokens,
        warp_token_usage_by_category: {},
        byok_token_usage_by_category: { full_terminal_use: tokens },
      },
    ],
  };
}

describe("estimateSpanTokens", () => {
  describe("empty inputs", () => {
    it("returns empty array when there are no exchanges", () => {
      const result = estimateSpanTokens([], withPrimaryAgentTokens(1000));

      expect(result).toHaveLength(0);
    });

    it("returns zero tokens when there are no primary_agent tokens", () => {
      const result = estimateSpanTokens(
        [anExchange("ex-1")],
        withFullTerminalUseTokens(1000),
      );

      expect(result[0]?.inputTokens).toBe(0);
      expect(result[0]?.outputTokens).toBe(0);
    });

    it("returns zero tokens when metadata has no token_usage", () => {
      const result = estimateSpanTokens([anExchange("ex-1")], {});

      expect(result[0]?.inputTokens).toBe(0);
      expect(result[0]?.outputTokens).toBe(0);
    });
  });

  describe("primary_agent filtering", () => {
    it("includes primary_agent byok tokens in normalisation denominator", () => {
      const result = estimateSpanTokens(
        [anExchange("ex-1", 100)],
        withPrimaryAgentTokens(400),
      );

      expect((result[0]?.inputTokens ?? 0) + (result[0]?.outputTokens ?? 0)).toBe(400);
    });

    it("excludes full_terminal_use tokens from per-span estimates", () => {
      const metadata: WarpConversationUsageMetadata = {
        token_usage: [
          {
            model_id: "Claude Sonnet 4.6",
            warp_tokens: 0,
            byok_tokens: 300,
            warp_token_usage_by_category: {},
            byok_token_usage_by_category: { primary_agent: 300 },
          },
          {
            model_id: "Claude Haiku 4.5",
            warp_tokens: 0,
            byok_tokens: 999,
            warp_token_usage_by_category: {},
            byok_token_usage_by_category: { full_terminal_use: 999 },
          },
        ],
      };

      const result = estimateSpanTokens([anExchange("ex-1", 100)], metadata);

      // Haiku full_terminal_use (999) must not inflate the estimate
      const total = (result[0]?.inputTokens ?? 0) + (result[0]?.outputTokens ?? 0);
      expect(total).toBe(300);
    });

    it("includes warp_token_usage_by_category primary_agent tokens", () => {
      const metadata: WarpConversationUsageMetadata = {
        token_usage: [
          {
            model_id: "Claude Sonnet 4.6",
            warp_tokens: 200,
            byok_tokens: 0,
            warp_token_usage_by_category: { primary_agent: 200 },
            byok_token_usage_by_category: {},
          },
        ],
      };

      const result = estimateSpanTokens([anExchange("ex-1", 100)], metadata);

      const total = (result[0]?.inputTokens ?? 0) + (result[0]?.outputTokens ?? 0);
      expect(total).toBe(200);
    });
  });

  describe("proportional distribution", () => {
    it("gives more tokens to the exchange with more input", () => {
      const exchanges = [anExchange("ex-small", 100), anExchange("ex-large", 300)];
      const result = estimateSpanTokens(exchanges, withPrimaryAgentTokens(1000));

      const smallTotal = (result[0]?.inputTokens ?? 0) + (result[0]?.outputTokens ?? 0);
      const largeTotal = (result[1]?.inputTokens ?? 0) + (result[1]?.outputTokens ?? 0);

      expect(largeTotal).toBeGreaterThan(smallTotal);
    });

    it("all span totals sum to the primary_agent token total", () => {
      const exchanges = [
        anExchange("ex-1", 100),
        anExchange("ex-2", 200),
        anExchange("ex-3", 150),
      ];
      const agentTotal = 1200;
      const result = estimateSpanTokens(exchanges, withPrimaryAgentTokens(agentTotal));

      const sum = result.reduce((s, e) => s + e.inputTokens + e.outputTokens, 0);
      // Allow ±N rounding error proportional to exchange count
      expect(Math.abs(sum - agentTotal)).toBeLessThanOrEqual(exchanges.length);
    });
  });

  describe("input / output split", () => {
    it("all scaled tokens go to inputTokens; outputTokens is 0 (output split unavailable)", () => {
      const result = estimateSpanTokens(
        [anExchange("ex-1", 100)],
        withPrimaryAgentTokens(1000),
      );

      expect(result[0]?.outputTokens).toBe(0);
      expect(result[0]?.inputTokens).toBe(1000);
    });
  });

  describe("result shape", () => {
    it("returns one estimate per exchange, preserving exchange IDs", () => {
      const exchanges = [anExchange("ex-a"), anExchange("ex-b"), anExchange("ex-c")];
      const result = estimateSpanTokens(exchanges, withPrimaryAgentTokens(1000));

      expect(result.map((r) => r.exchangeId)).toEqual(["ex-a", "ex-b", "ex-c"]);
    });
  });
});
