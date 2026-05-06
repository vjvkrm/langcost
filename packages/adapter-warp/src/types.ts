// ──────────────────────────────────────────
// Raw SQLite row types (as returned by bun:sqlite)
// ──────────────────────────────────────────

export interface WarpConversationRow {
  conversation_id: string;
  conversation_data: string; // JSON text
  last_modified_at: string; // DATETIME as string
}

export interface WarpQueryRow {
  exchange_id: string;
  conversation_id: string;
  start_ts: string; // DATETIME as string
  input: string; // JSON text
  output_status: string; // JSON-quoted: '"Completed"' | '"Cancelled"' | '"Failed"'
  model_id: string;
  working_directory: string | null;
}

export interface WarpBlockRow {
  block_id: string;
  conversation_id: string;
  start_ts: string; // DATETIME as string
  completed_ts: string | null;
  exit_code: number;
  stylized_command: Uint8Array | null;
  stylized_output: Uint8Array | null;
  ai_metadata: string; // JSON text
}

// ──────────────────────────────────────────
// Parsed JSON shapes from conversation_data
// ──────────────────────────────────────────

export interface WarpTokenUsageEntry {
  model_id: string;
  warp_tokens: number;
  byok_tokens: number;
  warp_token_usage_by_category: Record<string, number>;
  byok_token_usage_by_category: Record<string, number>;
}

export interface WarpToolUsageMetadata {
  run_command_stats?: { count?: number; commands_executed?: number };
  read_files_stats?: { count?: number };
  grep_stats?: { count?: number };
  apply_file_diff_stats?: { count?: number };
  [key: string]: unknown;
}

export interface WarpConversationUsageMetadata {
  was_summarized?: boolean;
  context_window_usage?: number;
  credits_spent?: number;
  credits_spent_for_last_block?: number;
  token_usage?: WarpTokenUsageEntry[];
  tool_usage_metadata?: WarpToolUsageMetadata;
}

export interface WarpConversationData {
  server_conversation_token?: string;
  run_id?: string;
  autoexecute_override?: string;
  conversation_usage_metadata?: WarpConversationUsageMetadata;
}

// ──────────────────────────────────────────
// Parsed JSON shapes from ai_queries.input
// ──────────────────────────────────────────

export interface WarpInputQuery {
  text?: string;
  context?: unknown[];
}

export interface WarpInputEntry {
  Query?: WarpInputQuery;
  [key: string]: unknown;
}

// ──────────────────────────────────────────
// Parsed JSON from blocks.ai_metadata
// ──────────────────────────────────────────

export interface WarpBlockMetadata {
  requested_command_action_id?: string;
  conversation_id?: string;
  subagent_task_id?: string | null;
}

// ──────────────────────────────────────────
// Reader result
// ──────────────────────────────────────────

export interface WarpReadResult {
  conversations: WarpConversationRow[];
  queries: WarpQueryRow[];
  blocks: WarpBlockRow[];
}
