// ──────────────────────────────────────────
// Codex rollout JSONL entry types
//
// Format: ~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl
// Each line: {timestamp, type, payload}
// type ∈ {session_meta, turn_context, response_item, event_msg}
// ──────────────────────────────────────────

export interface CodexTokenUsage {
  input_tokens: number;
  cached_input_tokens?: number;
  output_tokens: number;
  reasoning_output_tokens?: number;
  total_tokens?: number;
}

export interface CodexDynamicTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  deferLoading?: boolean;
}

export interface CodexBaseInstructions {
  text?: string;
}

// ── Payloads ──

export interface CodexSessionMetaPayload {
  id: string;
  timestamp: string;
  cwd?: string;
  cli_version?: string;
  originator?: string;
  source?: string;
  model_provider?: string;
  base_instructions?: CodexBaseInstructions;
  dynamic_tools?: CodexDynamicTool[];
}

export interface CodexTurnContextPayload {
  turn_id: string;
  cwd?: string;
  current_date?: string;
  timezone?: string;
  approval_policy?: string;
  sandbox_policy?: Record<string, unknown>;
  model?: string;
  personality?: string;
  collaboration_mode?: { mode?: string; settings?: { model?: string; reasoning_effort?: string } };
  effort?: string;
  summary?: string;
  developer_instructions?: string;
}

export interface CodexTaskStartedPayload {
  type: "task_started";
  turn_id: string;
  model_context_window?: number;
  collaboration_mode_kind?: string;
}

export interface CodexTaskCompletePayload {
  type: "task_complete";
  turn_id: string;
  last_agent_message?: string;
}

export interface CodexTokenCountInfo {
  total_token_usage?: CodexTokenUsage;
  last_token_usage?: CodexTokenUsage;
  model_context_window?: number;
}

export interface CodexTokenCountPayload {
  type: "token_count";
  info: CodexTokenCountInfo | null;
  rate_limits?: Record<string, unknown>;
}

export interface CodexAgentMessagePayload {
  type: "agent_message";
  message?: string;
}

export interface CodexUserMessagePayload {
  type: "user_message";
  message?: string;
  images?: unknown[];
  local_images?: unknown[];
  text_elements?: unknown[];
}

export type CodexEventMsgPayload =
  | CodexAgentMessagePayload
  | CodexTaskCompletePayload
  | CodexTaskStartedPayload
  | CodexTokenCountPayload
  | CodexUserMessagePayload
  | { type: string; [key: string]: unknown };

// ── Response items (per LLM API response shape) ──

export interface CodexResponseItemContentBlock {
  type: string;
  text?: string;
  [key: string]: unknown;
}

export interface CodexMessageResponseItem {
  type: "message";
  role: "user" | "assistant" | "developer" | "system";
  content?: CodexResponseItemContentBlock[];
  phase?: string;
}

export interface CodexReasoningResponseItem {
  type: "reasoning";
  content?: unknown;
  summary?: unknown;
  encrypted_content?: string;
}

export interface CodexFunctionCallResponseItem {
  type: "function_call";
  name: string;
  arguments: string;
  call_id: string;
}

export interface CodexFunctionCallOutputResponseItem {
  type: "function_call_output";
  call_id: string;
  output: string;
}

export interface CodexWebSearchCallResponseItem {
  type: "web_search_call";
  [key: string]: unknown;
}

export type CodexResponseItemPayload =
  | CodexFunctionCallOutputResponseItem
  | CodexFunctionCallResponseItem
  | CodexMessageResponseItem
  | CodexReasoningResponseItem
  | CodexWebSearchCallResponseItem
  | { type: string; [key: string]: unknown };

// ── Top-level rollout entries ──

export interface CodexRolloutBaseEntry {
  timestamp: string;
  type: string;
}

export interface CodexSessionMetaEntry extends CodexRolloutBaseEntry {
  type: "session_meta";
  payload: CodexSessionMetaPayload;
}

export interface CodexTurnContextEntry extends CodexRolloutBaseEntry {
  type: "turn_context";
  payload: CodexTurnContextPayload;
}

export interface CodexEventMsgEntry extends CodexRolloutBaseEntry {
  type: "event_msg";
  payload: CodexEventMsgPayload;
}

export interface CodexResponseItemEntry extends CodexRolloutBaseEntry {
  type: "response_item";
  payload: CodexResponseItemPayload;
}

export type CodexRolloutEntry =
  | CodexEventMsgEntry
  | CodexResponseItemEntry
  | CodexSessionMetaEntry
  | CodexTurnContextEntry
  | (CodexRolloutBaseEntry & { payload: Record<string, unknown> });

// ── Discovery + reader return types ──

export interface DiscoveredRolloutFile {
  filePath: string;
  fileSize: number;
  modifiedAt: Date;
  rolloutId: string;
}

export interface ReadRolloutResult {
  entries: CodexRolloutEntry[];
  lastLineHash?: string;
  lastOffset: number;
  errors: Array<{ line: number; message: string }>;
}
