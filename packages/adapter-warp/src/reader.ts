import { Database } from "bun:sqlite";

import type { WarpBlockRow, WarpConversationRow, WarpQueryRow, WarpReadResult } from "./types";

export function readWarpData(dbPath: string, since?: Date): WarpReadResult {
  const db = new Database(dbPath, { readonly: true });

  try {
    // The >= comparison works because Warp stores DATETIME as "YYYY-MM-DD HH:MM:SS", which
    // sorts correctly as a lexicographic string. If Warp ever changes the format, this would
    // silently stop filtering correctly.
    const sinceStr = since ? since.toISOString().slice(0, 19).replace("T", " ") : "1970-01-01";

    const conversations = db
      .query<WarpConversationRow, [string]>(
        `SELECT conversation_id, conversation_data, last_modified_at
         FROM agent_conversations
         WHERE last_modified_at >= ?
         ORDER BY last_modified_at ASC`,
      )
      .all(sinceStr);

    if (conversations.length === 0) {
      return { conversations: [], queries: [], blocks: [] };
    }

    const ids = conversations.map((c) => c.conversation_id);
    const placeholders = ids.map(() => "?").join(", ");

    const queries = db
      .query<WarpQueryRow, string[]>(
        `SELECT exchange_id, conversation_id, start_ts, input, output_status, model_id, working_directory
         FROM ai_queries
         WHERE conversation_id IN (${placeholders})
         ORDER BY start_ts ASC`,
      )
      .all(...ids);

    const blocks = db
      .query<WarpBlockRow, string[]>(
        `SELECT block_id,
                json_extract(ai_metadata, '$.conversation_id') as conversation_id,
                start_ts, completed_ts, exit_code,
                stylized_command, stylized_output, ai_metadata
         FROM blocks
         WHERE json_extract(ai_metadata, '$.conversation_id') IN (${placeholders})
           AND ai_metadata IS NOT NULL AND ai_metadata != ''
         ORDER BY start_ts ASC`,
      )
      .all(...ids);

    return { conversations, queries, blocks };
  } finally {
    db.close();
  }
}
