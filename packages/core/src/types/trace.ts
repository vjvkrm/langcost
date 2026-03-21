export type TraceStatus = "complete" | "error" | "partial";

export interface Trace {
  id: string;
  externalId: string;
  source: string;
  sessionKey?: string;
  agentId?: string;
  startedAt: Date;
  endedAt?: Date;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  model?: string;
  status: TraceStatus;
  metadata?: Record<string, unknown>;
}

export type SpanType = "llm" | "tool" | "retrieval" | "agent";
export type SpanStatus = "ok" | "error";

export interface Span {
  id: string;
  traceId: string;
  parentSpanId?: string;
  externalId: string;
  type: SpanType;
  name?: string;
  startedAt: Date;
  endedAt?: Date;
  durationMs?: number;
  model?: string;
  provider?: string;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  toolName?: string;
  toolInput?: string;
  toolOutput?: string;
  toolSuccess?: boolean;
  status: SpanStatus;
  errorMessage?: string;
  metadata?: Record<string, unknown>;
}

export type MessageRole = "system" | "user" | "assistant" | "tool";

export interface Message {
  id: string;
  spanId: string;
  traceId: string;
  role: MessageRole;
  content: string;
  tokenCount?: number;
  position: number;
  metadata?: Record<string, unknown>;
}
