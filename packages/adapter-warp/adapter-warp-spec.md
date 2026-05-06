# Spec: `@langcost/adapter-warp`

**Status:** Implemented (v3 spec — all acceptance criteria met)  
**Date:** 2026-05-04  
**Author:** Amirault

---

## What

A langcost adapter that reads Warp AI session data from its local SQLite database and ingests it
into the langcost SQLite, enabling cost and waste analysis for Warp users.

Users would run:

```bash
npm install -g langcost @langcost/adapter-warp
langcost scan --source warp
langcost dashboard
```

---

## Why

Warp is an AI-powered terminal where users run Oz agents (powered by Claude) throughout their
development workflow. Each session can involve dozens of LLM exchanges. Users have no built-in
way to understand:

- Total tokens and cost per session or over time
- Which sessions burned the most money
- Whether their agents are looping or retrying excessively
- How model choices (Sonnet vs Haiku) affect spend

LangCost already provides this intelligence for Claude Code and OpenClaw. Warp users are a natural
third target: they are developers who are already thinking about agentic workflows and cost.

---

## Current State (Research Findings)

Warp stores its AI session data in a private SQLite database:

```
~/Library/Group Containers/2BBY89MBSN.dev.warp/Library/Application Support/dev.warp.Warp-Stable/warp.sqlite
```

WAL mode is confirmed active (`warp.sqlite-wal` and `warp.sqlite-shm` files exist), so
concurrent reads are safe while Warp is running.

Three tables are relevant:

### `agent_conversations`

One row per conversation (a top-level Oz agent session).

| Column | Type | Content |
|---|---|---|
| `conversation_id` | TEXT | UUID — primary identifier |
| `conversation_data` | TEXT | JSON blob (see below) |
| `last_modified_at` | TIMESTAMP | Last update time |

`conversation_data` JSON structure (observed):
```json
{
  "server_conversation_token": "uuid",
  "run_id": "uuid",
  "autoexecute_override": "RunToCompletion",
  "conversation_usage_metadata": {
    "was_summarized": false,
    "context_window_usage": 0.062613,
    "credits_spent": 0.0,
    "credits_spent_for_last_block": 0.0,
    "token_usage": [
      {
        "model_id": "Claude Haiku 4.5",
        "warp_tokens": 0,
        "byok_tokens": 25534,
        "warp_token_usage_by_category": {},
        "byok_token_usage_by_category": { "full_terminal_use": 25534 }
      },
      {
        "model_id": "Claude Sonnet 4.6",
        "warp_tokens": 0,
        "byok_tokens": 800034,
        "warp_token_usage_by_category": {},
        "byok_token_usage_by_category": { "primary_agent": 800034 }
      }
    ],
    "tool_usage_metadata": {
      "run_command_stats": { "count": 13, "commands_executed": 12 },
      "read_files_stats": { "count": 3 },
      "apply_file_diff_stats": { "count": 0, "lines_added": 0, "lines_removed": 0, "files_changed": 0 }
    }
  }
}
```

Notable:
- Token totals are **aggregated per model per conversation** — not per exchange.
- `credits_spent` is always `0.0` for BYOK users (Warp does not record actual API cost for
  bring-your-own-key setups).
- The `warp_tokens` vs `byok_tokens` split matters: `warp_tokens` are billed by Warp (credits);
  `byok_tokens` are billed by the user's own API key.

### `ai_queries`

One row per exchange (a single user prompt → assistant response cycle).

| Column | Type | Content |
|---|---|---|
| `exchange_id` | TEXT | UUID — primary identifier |
| `conversation_id` | TEXT | FK → `agent_conversations.conversation_id` |
| `start_ts` | DATETIME | Timestamp of the LLM request |
| `input` | TEXT | JSON array — the full prompt: user query + all context (see below) |
| `output_status` | TEXT | JSON-quoted string: `"\"Completed\""`, `"\"Cancelled\""`, or `"\"Failed\""` |
| `model_id` | TEXT | Model ID (e.g., `"claude-4-6-sonnet-high"`) |
| `planning_model_id` | TEXT | Usually empty |
| `coding_model_id` | TEXT | Usually empty |
| `working_directory` | TEXT | CWD at time of query |

`input` contains the **entire prompt** sent to the LLM — user message text plus all injected
context (project rules, directory state, git branch, terminal history). This makes it a reliable
basis for input token estimation.

```json
[
  {
    "Query": {
      "text": "User message text here",
      "context": [
        { "Directory": { "pwd": "/path/to/cwd", "home_dir": "/Users/..." } },
        { "Git": { "head": "main", "branch": "main" } },
        { "CurrentTime": { "current_time": "2026-05-04T..." } },
        { "ExecutionEnvironment": { "os": { "category": "MacOS" }, "shell_name": "zsh" } }
      ]
    }
  }
]
```

### `blocks`

One row per terminal command executed by the agent (`run_command` tool calls only).

| Column | Type | Content |
|---|---|---|
| `block_id` | TEXT | Stable identifier, e.g. `"precmd-177790-32"` |
| `start_ts` | DATETIME | When the command started |
| `completed_ts` | DATETIME | When the command finished |
| `exit_code` | INTEGER | `0` = success, non-zero = failure |
| `stylized_command` | BLOB | The command that was run (ANSI-encoded) |
| `stylized_output` | BLOB | The command's terminal output (ANSI-encoded) |
| `ai_metadata` | TEXT | JSON with `requested_command_action_id` and `conversation_id` |

`ai_metadata` structure (observed):
```json
{
  "requested_command_action_id": "toolu_01JvUGJUnWPPx8ttS3VfsbQD",
  "conversation_id": "4213546a-6805-42f4-bcdd-21989e851347",
  "subagent_task_id": null
}
```

Key findings:
- `requested_command_action_id` is Claude's `tool_use.id` — this is the exact tool call identifier.
- Each block can be attributed to its parent LLM exchange via timestamps: a block belongs to the
  exchange with the largest `start_ts` that is still less than `block.start_ts` within the same
  conversation. Verified empirically — blocks fall cleanly between consecutive exchanges.
- **Coverage**: `blocks` only captures `run_command` tool calls. Tools like `read_files`, `grep`,
  and `apply_file_diff` are not persisted. In a typical Warp session, `run_command` accounts for
  the majority of tool calls (e.g., 13 run_command vs 3 read_files observed). Coverage varies by
  workflow.
- **Subagent tasks**: `blocks.ai_metadata.subagent_task_id` links to `agent_tasks` for blocks
  executed within subagent context. These are still tool calls within the parent conversation —
  `agent_tasks.task_id` values are NOT `agent_conversations` IDs. No separate trace hierarchy is
  needed; subagent blocks are attributed to their parent conversation like any other block.
- **ANSI encoding**: `stylized_command` and `stylized_output` use character-by-character ANSI
  bold/reset sequences (e.g., `\x1b[1mA\x1b[0m\x1b[1mb\x1b[0m` for `Ab`). Standard CSI
  stripping (`\x1b\[[0-9;]*m`) fully recovers readable text.

---

## Mapping to LangCost Types

| LangCost Type | Warp Source | Notes |
|---|---|---|
| `Trace` | `agent_conversations` row | One per session |
| `Span` (type=`llm`) | `ai_queries` row | One per exchange |
| `Span` (type=`tool`) | `blocks` row with `ai_metadata` | `run_command` calls only |
| `Message` (role=`user`) | `ai_queries.input[0].Query.text` | Full prompt text |
| `Message` (role=`assistant`) | Not stored | Warp does not persist AI response text |
| `Message` (role=`tool`) | `blocks.stylized_output` (ANSI-stripped) | Command output |

### Trace fields

| Field | Source |
|---|---|
| `id` | `"warp:trace:{conversation_id}"` |
| `externalId` | `conversation_id` |
| `source` | `"warp"` |
| `startedAt` | `MIN(ai_queries.start_ts)` for the conversation |
| `endedAt` | `last_modified_at` |
| `totalInputTokens` | Sum of `token_usage[*].byok_tokens + warp_tokens` (not split by input/output) |
| `totalOutputTokens` | `0` — not separately available |
| `totalCostUsd` | Estimated via `calculateCost()` on aggregate BYOK tokens, or `credits_spent` metadata for Warp-credit users |
| `model` | Model with highest token count in `token_usage` |
| `status` | `"complete"` if all exchanges succeeded, `"error"` if any failed |

### Span (LLM exchange) fields

| Field | Source |
|---|---|
| `id` | `"warp:span:llm:{exchange_id}"` |
| `externalId` | `exchange_id` |
| `type` | `"llm"` |
| `startedAt` | `start_ts` |
| `endedAt` | next exchange `start_ts` or `last_modified_at` (approximation) |
| `model` | `model_id` (after normalization) |
| `inputTokens` | Estimated — see token estimation strategy below |
| `outputTokens` | Estimated — see token estimation strategy below |
| `costUsd` | Estimated — see token estimation strategy below |
| `status` | `"ok"` if `output_status = "\"Completed\""`, `"error"` if `"\"Failed\""`, `"partial"` if `"\"Cancelled\""` |

### Span (tool call) fields

| Field | Source |
|---|---|
| `id` | `"warp:span:tool:{block_id}"` |
| `externalId` | `requested_command_action_id` (Claude tool_use.id) |
| `type` | `"tool"` |
| `name` | `"run_command"` |
| `parentSpanId` | Parent LLM span (attributed by timestamp) |
| `startedAt` | `blocks.start_ts` |
| `endedAt` | `blocks.completed_ts` |
| `durationMs` | `completed_ts - start_ts` |
| `toolInput` | ANSI-stripped `stylized_command` |
| `toolOutput` | ANSI-stripped `stylized_output` |
| `toolSuccess` | `exit_code === 0` |
| `status` | `"ok"` or `"error"` based on `exit_code` |

---

## Token Estimation Strategy

The critical blocker (no per-exchange token counts) is solvable via a two-signal approach that
yields per-span estimates consistent with the conversation ground truth.

**Signal 1 — Content-based estimation:**  
`ai_queries.input` is the full prompt JSON (user text + all injected context). Applying
`estimateTokenCount(JSON.stringify(input))` — already available in `@langcost/core` — gives a
reasonable per-exchange input token estimate.

**Signal 2 — Agent-only conversation normalization:**  
`conversation_data.token_usage` provides token counts per model per conversation. However, **not
all token categories belong to the Oz agent**. Investigation shows two distinct categories:

| Category | Model | Source | In `ai_queries`? |
|---|---|---|---|
| `primary_agent` | Sonnet (or primary model) | Oz agent conversation | ✅ Yes |
| `full_terminal_use` | Haiku | Warp inline terminal AI | ❌ Never |

Haiku `full_terminal_use` tokens represent Warp's background terminal features (autocomplete,
inline suggestions). They are never recorded as exchanges in `ai_queries` and must be **excluded
from the normalization denominator**. Including them would inflate the per-span estimates.

Correct normalization:

```
estimated[i]       = estimateTokenCount(JSON.stringify(exchange[i].input))
total_estimated    = sum(estimated)
agent_total        = sum(token_usage[j].byok_tokens + warp_tokens
                        where token_usage[j] has 'primary_agent' in byok_token_usage_by_category
                             OR warp_token_usage_by_category)

scaled_tokens[i]   = estimated[i] × (agent_total / total_estimated)
```

The `full_terminal_use` tokens are still recorded on the `Trace` as part of `totalInputTokens`
(for accurate total cost reporting) but are excluded from per-span distribution.

Per-span cost: `calculateCost(model, scaled_tokens[i], 0)` (input-only; output split unavailable).

**Limitation:** Input and output tokens are not separable. All scaled tokens are treated as input
for cost purposes, which over-estimates input cost and under-estimates output cost. The aggregate
cost at trace level remains accurate.

---

## Blockers

### Blocker 1 — No per-exchange token counts

**Status: Mitigated** via the two-signal estimation strategy above.

Per-span token estimates are approximate but proportionally consistent and grounded in the
conversation actual total. This is sufficient for `high_output` detection (flags spans whose
scaled token count is 3× above the session average).

The remaining gap: input/output split is unknown, so `low_cache` cannot fire per-span.

---

### Blocker 2 — No tool spans / no assistant message content

**Status: Partially mitigated** via the `blocks` table.

**Tool spans**: The `blocks` table provides exact data for all `run_command` tool calls:
exact timing, exit code, command text, and command output. Parent exchange attribution via
timestamp is clean and reliable.

**Coverage gap**: Non-terminal tools (`read_files`, `grep`, `apply_file_diff`, etc.) are not
persisted as blocks. These cannot be reconstructed. A session that is predominantly
read-heavy will have incomplete tool span coverage.

**Assistant messages**: Response text is still not stored. `Message` records for
`role=assistant` remain unavailable.

---

### Blocker 3 — SQLite locking

**Status: Resolved.**  
Warp uses WAL mode (confirmed by presence of `warp.sqlite-wal` / `warp.sqlite-shm`). Opening
with `{ readonly: true }` in `bun:sqlite` works concurrently while Warp is running.

---

### Blocker 4 — Model ID mapping

**Status: Mitigated** via a static normalization map.

Two formats need mapping:
- `ai_queries.model_id` (snake_case): `"claude-4-6-sonnet-high"` → `"claude-sonnet-4-6"`
- `conversation_data.token_usage[].model_id` (display name): `"Claude Sonnet 4.6"` → `"claude-sonnet-4-6"`

Known mappings:
```
"claude-4-6-sonnet-high" → "claude-sonnet-4-6"
"claude-4-6-haiku"       → "claude-haiku-4-5"
"Claude Sonnet 4.6"      → "claude-sonnet-4-6"
"Claude Haiku 4.5"       → "claude-haiku-4-5"
```

This map must be maintained as Warp adds new models. Unknown IDs cost `$0` but token counts
and waste detection still work.

---

### Blocker 5 — Private, undocumented database schema

**Status: Mitigated** via defensive coding.

- Validate expected tables exist by querying `__diesel_schema_migrations` at startup.
- Use optional chaining throughout — never throw on unexpected JSON shapes.
- Emit a clear warning (not a crash) when the schema version is unrecognized.
- Document the stability risk in the adapter README.

---

### Blocker 6 — BYOK vs Warp tokens

**Status: Mitigated.**

- BYOK users: estimate cost via `calculateCost(model, byok_tokens, 0)`.
- Warp-credit users: `credits_spent` does not map to USD — store it in `metadata` and clearly
  label it as credits, not dollars, in the adapter output.

---

## How (Proposed Implementation)

### Package structure

Following the existing adapter convention:

```
packages/adapter-warp/
├── package.json          # @langcost/adapter-warp
├── src/
│   ├── index.ts          # exports warpAdapter as default
│   ├── adapter.ts        # implements IAdapter<Db>
│   ├── discovery.ts      # locates warp.sqlite, validates schema
│   ├── reader.ts         # opens SQLite (read-only), runs queries
│   ├── normalizer.ts     # maps rows → Trace, Span[], Message[]
│   ├── token-estimator.ts  # two-signal token estimation logic
│   ├── model-map.ts      # Warp model ID → langcost pricing ID
│   └── types.ts          # TypeScript types for Warp's JSON shapes
└── test/
    ├── normalizer.test.ts
    ├── token-estimator.test.ts
    └── discovery.test.ts
```

### Source path

Default:
```
~/Library/Group Containers/2BBY89MBSN.dev.warp/Library/Application Support/dev.warp.Warp-Stable/warp.sqlite
```

Can be overridden via `--path`.

### Read strategy

Warp uses WAL mode; open read-only:

```typescript
const db = new Database(warpDbPath, { readonly: true });
```

Three queries per ingest run:

```sql
-- 1. Conversations modified within --since window
SELECT conversation_id, conversation_data, last_modified_at
FROM agent_conversations
WHERE last_modified_at >= ?
ORDER BY last_modified_at ASC;

-- 2. All exchanges for those conversations
SELECT exchange_id, conversation_id, start_ts, input, output_status, model_id, working_directory
FROM ai_queries
WHERE conversation_id IN (...)
ORDER BY start_ts ASC;

-- 3. All run_command tool calls for those conversations
SELECT block_id, start_ts, completed_ts, exit_code,
       stylized_command, stylized_output, ai_metadata
FROM blocks
WHERE json_extract(ai_metadata, '$.conversation_id') IN (...)
  AND ai_metadata IS NOT NULL AND ai_metadata != ''
ORDER BY start_ts ASC;
```

### Normalizer

1. Each `agent_conversations` row → one `Trace`.
2. Each `ai_queries` row → one `Span` of type `llm`.
3. Run token estimation across all llm spans for the conversation (two-signal approach).
4. Each `blocks` row with `ai_metadata` → one `Span` of type `tool`, attributed to its parent
   llm span by finding the exchange with the highest `start_ts < block.start_ts`.
5. `ai_queries.input[0].Query.text` → `Message` of role `user` on the llm span.
6. ANSI-stripped `blocks.stylized_output` → `Message` of role `tool` on the tool span.

### ANSI stripping

`stylized_command` and `stylized_output` are ANSI-encoded terminal output. Strip escape sequences
before storing as `toolInput` / `toolOutput`. A simple regex over the known ANSI CSI sequences
is sufficient — the goal is readable text, not perfect fidelity.

### Incremental ingestion

Warp's source has no file hash or byte offset to compare. Use `last_modified_at` from
`agent_conversations` against the `updatedAt` in `ingestion_state` to skip unchanged conversations.

---

## Waste Rule Compatibility

| Rule | v1 Assessment | v2 Assessment | Notes |
|---|---|---|---|
| `model_overuse` | ✅ | ✅ | Per-exchange model ID available |
| `retry_patterns` | ✅ | ✅ | Failed `output_status` across consecutive exchanges |
| `tool_failures` | ⚠️ partial | ✅ | `blocks.exit_code` gives exact per-call failure |
| `agent_loops` | ❌ | ✅ | Repeated `run_command` blocks attributed to same exchange pattern |
| `high_output` | ❌ | ⚠️ approximate | Scaled token estimates enable detection; input/output split unknown |
| `low_cache` | ❌ | ❌ | Cache hit/miss not exposed per exchange |

---

## Acceptance Criteria

1. `langcost scan --source warp` reads `warp.sqlite` and ingests conversations as traces.
2. Each `ai_queries` row is ingested as an `llm` span.
3. Each `blocks` row with `ai_metadata` is ingested as a `tool` span, parented to the correct
   llm span via timestamp attribution.
4. Per-span token counts are estimated (two-signal: content estimation + conversation normalization)
   and documented as estimates in the adapter README.
5. `model_id` values are normalized to known pricing model IDs where possible.
6. `tool_failures` fires on individual failed blocks (non-zero `exit_code`).
7. `agent_loops` fires when the same command pattern repeats across exchanges.
8. `model_overuse` and `retry_patterns` fire as in other adapters.
9. `langcost validate --source warp` reports whether `warp.sqlite` exists and is readable,
   including a schema version check.
10. Failures (locked DB, missing tables, malformed JSON) produce human-readable errors, not crashes.
11. Incremental scans skip conversations with `last_modified_at ≤ ingestion_state.updatedAt`.
12. The adapter works on macOS. Linux/Windows are out of scope.

---

## Out of Scope

- Reconstructing assistant response text (not stored by Warp).
- Tool spans for `read_files`, `grep`, `apply_file_diff`, and other non-terminal tools.
- Accurate input/output token split (all tokens treated as input for cost estimation).
- Windows and Linux support (Warp is macOS-only currently).
- Warp Preview channel (different bundle ID; can be added later with a `--channel` flag).

---

## Open Questions

1. **Warp Stable vs Preview?** Warp Preview uses bundle ID `dev.warp.Warp-Preview`. Should the
   adapter auto-detect both databases or require a `--channel` flag?

2. **Are there other `byok_token_usage_by_category` values?** Only `primary_agent` and
   `full_terminal_use` have been observed. Additional categories (e.g., from future Warp features)
   could require updates to the normalization filter.

---

## References

- LangCost `IAdapter` interface: `packages/core/src/interfaces/adapter.ts`
- Claude Code adapter (reference implementation): `packages/adapter-claude-code/`
- OpenClaw adapter (alternative reference): `packages/adapter-openclaw/`
- Warp SQLite location: `~/Library/Group Containers/2BBY89MBSN.dev.warp/Library/Application Support/dev.warp.Warp-Stable/warp.sqlite`
- Observed Warp schema version: Diesel migrations (table: `__diesel_schema_migrations`)
