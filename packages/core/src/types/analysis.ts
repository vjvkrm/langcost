import type { SegmentType } from "./segment";

export type WasteCategory =
  | "low_cache_utilization"
  | "model_overuse"
  | "unused_tools"
  | "duplicate_rag"
  | "unbounded_history"
  | "uncached_prompt"
  | "agent_loop"
  | "retry_waste"
  | "tool_failure_waste"
  | "high_output"
  | "oversized_context";

export type Severity = "low" | "medium" | "high" | "critical";

export interface WasteReport {
  id: string;
  traceId: string;
  spanId?: string;
  category: WasteCategory;
  severity: Severity;
  wastedTokens: number;
  wastedCostUsd: number;
  description: string;
  recommendation: string;
  estimatedSavingsUsd?: number;
  evidence: Record<string, unknown>;
  detectedAt: Date;
}

export interface CostBreakdown {
  traceId: string;
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  segments: {
    type: SegmentType;
    tokenCount: number;
    costUsd: number;
    percentOfTotal: number;
  }[];
  wastePercentage: number;
  wastedCostUsd: number;
}

export type FaultType = "upstream_data" | "model_error" | "tool_failure" | "loop" | "timeout" | "unknown";

export interface FaultReport {
  id: string;
  traceId: string;
  faultSpanId: string;
  rootCauseSpanId?: string;
  faultType: FaultType;
  description: string;
  cascadeDepth: number;
  affectedSpanIds: string[];
  detectedAt: Date;
}
