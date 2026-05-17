# Changelog

All notable changes to this project will be documented in this file.

## [0.16.0] - 2026-05-17

### Added
- **Adapter**: New `@langcost/adapter-codex` for OpenAI Codex CLI. Ingests `~/.codex/sessions/**/*.jsonl` rollouts with full Tier-2 reach — system prompt, conversation history, tool calls, cached-input + reasoning-output token accounting, cost via `@langcost/core` pricing.
- **Adapter**: First npm publish of `@langcost/adapter-cline` (previously workspace-only).
- **Dashboard**: Adapters page replaces the old Settings + first-run Setup flow. Lists all known adapters with per-row Install / Sync / Uninstall buttons, trace counts, and last-scan timestamps. First-load auto-routes to `/settings` when no traces exist.
- **API**: New `POST /api/v1/adapters/:name` (install) and `DELETE /api/v1/adapters/:name` (uninstall) endpoints. Shell out to `npm install -g` / `npm uninstall -g` via `Bun.spawn` with strict name validation, stdin closed, 120s timeout, and `--no-audit --no-fund`. Returns summarized stderr on failure.
- **API**: `GET /api/v1/adapters` response now includes `traceCount`, `lastScanAt`, and `installType` (`npm | workspace`) per adapter.
- **Docs**: New `ADAPTERS.md` — user-facing reference of every published adapter with install commands and any adapter-specific flags.

### Changed
- **OSS limits**: Scans now read at most **180 days** of history (CLI and dashboard alike) via a shared `MAX_SINCE_DAYS` constant in `@langcost/core`. `--since all` and values over the cap are rejected with a clear error. Replaces the previous 30-day default and removes the unbounded option.
- **Packaging**: Every library and adapter package (`@langcost/core`, `@langcost/db`, `@langcost/analyzers`, plus all 5 adapters) now ships compiled `dist/` with `.d.ts` files. Previously only cline shipped compiled output; the others shipped raw TypeScript and only worked under Bun. Libraries and adapters are now consumable from any TypeScript or Node-compatible runtime. The `langcost` CLI itself remains source-shipped — it's invoked via its `#!/usr/bin/env bun` shebang, not imported as a library.
- **CLI**: `--since` default and maximum are both 180 days. Help text updated.
- **Dashboard**: Refresh/info banners auto-dismiss after 5 seconds; error banners persist until replaced.

### Fixed
- **Adapter (cline)**: `addTotals.costSource` no longer collapses divergent sources to a no-op; uses `aggregateCostSource` to track per-source cost provenance.
- **Adapter (cline)**: `assistantTextMessages` is computed once per turn instead of inside the events loop, eliminating O(n²) recomputation on long sessions.
- **Adapter (cline)**: `repaired` flag now reflects whether usage was actually repaired from `api_conversation_history` instead of being hardcoded `true` on the fallback path. Span metadata's `repairedFromApiConversationHistory` is now accurate.

## [0.1.6] - 2026-05-08

### Fixed
- **Dashboard**: Setup and settings now allow selecting OpenClaw, Claude Code, or Warp data sources instead of forcing OpenClaw.

## [0.1.4] - 2026-04-29

### Fixed
- **CLI**: Fixed scan command hanging after completion by properly releasing stream reader lock
- **TypeScript**: Fixed `exactOptionalPropertyTypes` errors across web app and adapters
- **Dashboard**: Cache column now sorts by actual cost instead of raw token count
- **Dashboard**: Sort arrows stay on same line with column headers

### Changed
- **Dashboard**: Status column now shows orange/green dot indicator (savings potential vs optimized) instead of text labels
- **Dashboard**: Stat strip is now centered with larger font size for better visibility
- **Dashboard**: Removed unused `subagentCount` prop from SessionRow component

### Added
- **Web**: Added `.npmignore` file to exclude dev files from package

## [0.1.3] - 2026-04-07

### Added
- Claude Code adapter for ingesting local conversation logs
- Dashboard UI for Claude Code traces with model breakdown visualization
- Cache cost tracking and display for Claude Code sessions
- Project filtering and grouping for Claude Code traces
- Subagent rollup for parent trace totals

## [0.1.2] - 2026-03-21

### Added
- Initial OpenClaw adapter
- Cost analyzer and waste detector
- CLI commands: scan, report, status, dashboard
- React dashboard with trace explorer
- SQLite storage with Drizzle ORM
