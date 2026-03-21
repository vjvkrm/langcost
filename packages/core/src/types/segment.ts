export type SegmentType =
  | "system_prompt"
  | "tool_schema"
  | "conversation_history"
  | "rag_context"
  | "user_query"
  | "assistant_response"
  | "tool_result"
  | "unknown";

export interface TokenSegment {
  id: string;
  spanId: string;
  traceId: string;
  type: SegmentType;
  tokenCount: number;
  costUsd: number;
  percentOfSpan: number;
  contentHash?: string;
  charStart?: number;
  charEnd?: number;
}
