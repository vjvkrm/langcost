# langcost — Build Roadmap

Status: **Phase 1 — Foundation (in progress)**

See `SPEC.md` for full technical specification. See `PRODUCT.md` for product vision.

---

## Phase 1: Foundation

### 1.1 Monorepo Setup
- [x] Initialize git repo
- [x] Root `package.json` with workspaces config (`"workspaces": ["packages/*", "apps/*"]`)
- [x] `tsconfig.base.json` — shared compiler options (ESNext, strict, bundler resolution)
- [x] `biome.json` — formatting + linting config
- [x] `LICENSE` — AGPL-3.0
- [x] `.gitignore` — node_modules, dist, *.db, .env

### 1.2 @langcost/core
- [x] `packages/core/package.json` — name, version, zero deps
- [x] `packages/core/tsconfig.json` — extends base
- [x] `packages/core/src/types/trace.ts` — Trace, Span, Message interfaces
- [x] `packages/core/src/types/segment.ts` — SegmentType, TokenSegment
- [x] `packages/core/src/types/analysis.ts` — WasteReport, CostBreakdown, FaultReport, WasteCategory, Severity
- [x] `packages/core/src/types/index.ts` — barrel export
- [x] `packages/core/src/interfaces/adapter.ts` — IAdapter, AdapterMeta, IngestOptions, IngestResult
- [x] `packages/core/src/interfaces/analyzer.ts` — IAnalyzer, AnalyzerMeta, AnalyzeOptions, AnalyzeResult
- [x] `packages/core/src/interfaces/index.ts` — barrel export
- [x] `packages/core/src/pricing/providers.ts` — ModelPricing type + MODEL_PRICING array (Anthropic, OpenAI, Google)
- [x] `packages/core/src/pricing/calculator.ts` — findPricing(), calculateCost()
- [x] `packages/core/src/pricing/index.ts` — barrel export
- [x] `packages/core/src/utils/hash.ts` — SHA-256 content hashing via crypto.subtle
- [x] `packages/core/src/utils/tokens.ts` — fallback token estimator (chars/4)
- [x] `packages/core/src/index.ts` — barrel export
- [x] `packages/core/CLAUDE.md` — package-specific agent rules
- [x] Tests: pricing calculator, hash utility, token estimator

### 1.3 @langcost/db
- [x] `packages/db/package.json` — depends on @langcost/core (workspace:*)
- [x] `packages/db/tsconfig.json` — extends base
- [x] Install `drizzle-orm` + `drizzle-kit` via `bun add` in `packages/db`
- [x] `packages/db/src/schema/traces.ts` — Drizzle `sqliteTable` definition
- [x] `packages/db/src/schema/spans.ts`
- [x] `packages/db/src/schema/messages.ts`
- [x] `packages/db/src/schema/segments.ts`
- [x] `packages/db/src/schema/waste-reports.ts`
- [x] `packages/db/src/schema/fault-reports.ts`
- [x] `packages/db/src/schema/ingestion-state.ts`
- [x] `packages/db/src/schema/analysis-runs.ts`
- [x] `packages/db/src/schema/index.ts` — barrel export all tables
- [x] `packages/db/src/client.ts` — uses `drizzle({ client, schema })` from `drizzle-orm/bun-sqlite`
- [x] `packages/db/src/repositories/traces.ts` — Drizzle select/insert/update
- [x] `packages/db/src/repositories/spans.ts`
- [x] `packages/db/src/repositories/messages.ts`
- [x] `packages/db/src/repositories/segments.ts`
- [x] `packages/db/src/repositories/waste.ts`
- [x] `packages/db/src/repositories/faults.ts`
- [x] `packages/db/src/repositories/ingestion.ts`
- [x] `packages/db/src/repositories/analysis.ts`
- [x] `packages/db/src/repositories/index.ts`
- [x] `packages/db/drizzle.config.ts` — Drizzle Kit config
- [x] `packages/db/drizzle/` — initial generated SQL migration + snapshot metadata
- [x] Removed old raw `schema.ts` and `queries/` modules
- [x] `packages/db/src/index.ts` — barrel export (update after migration)
- [x] `packages/db/CLAUDE.md` — package-specific agent rules
- [x] Tests updated to use Drizzle repositories and migrator

### 1.4 Test Fixtures
- [x] `fixtures/openclaw/` directory for test data
- [x] Download real JSONL from pi-mono repo (the engine behind OpenClaw):
      - `https://github.com/badlogic/pi-mono/raw/refs/heads/main/packages/coding-agent/test/fixtures/large-session.jsonl` (1,019 lines)
      - `https://github.com/badlogic/pi-mono/raw/refs/heads/main/packages/coding-agent/test/fixtures/before-compaction.jsonl` (1,003 lines)
- [x] Create small synthetic fixtures for unit testing specific scenarios:
      - `fixtures/openclaw/simple-session.jsonl` — 5 turns, basic usage data
      - `fixtures/openclaw/expensive-session.jsonl` — high cost, Opus model
      - `fixtures/openclaw/tool-heavy.jsonl` — many tool calls, some failures
      - `fixtures/openclaw/model-switch.jsonl` — model_change mid-session
      - `fixtures/openclaw/missing-usage.jsonl` — usage field absent (bug #21819)
      - `fixtures/openclaw/agent-loop.jsonl` — repetitive tool call cycle
      - `fixtures/openclaw/with-compaction.jsonl` — includes compaction entries

### 1.5 Verify Phase 1
- [x] `bun install` succeeds at root
- [x] `bun test` passes — SQLite write/read round-trip works
- [x] Workspace package imports resolve where declared via `workspace:*` (verified from `packages/db` importing `@langcost/core`)

---

## Phase 2: Ingestion

### 2.1 @langcost/adapter-openclaw
- [x] `packages/adapter-openclaw/package.json` — depends on core + db (workspace:*)
- [x] `packages/adapter-openclaw/tsconfig.json` — extends base
- [x] `packages/adapter-openclaw/src/types.ts` — OpenClaw-specific raw JSONL types
- [x] `packages/adapter-openclaw/src/discovery.ts` — find ~/.openclaw/agents/*/sessions/*.jsonl, filter by date
- [x] `packages/adapter-openclaw/src/reader.ts` — stream JSONL line-by-line, track byte offset
- [x] `packages/adapter-openclaw/src/normalizer.ts` — map OpenClaw entries → Trace/Span/Message
- [x] `packages/adapter-openclaw/src/adapter.ts` — implement IAdapter (validate, ingest)
- [x] `packages/adapter-openclaw/src/index.ts` — default export adapter instance
- [x] `packages/adapter-openclaw/CLAUDE.md` — package-specific agent rules
- [x] Handle missing usage field gracefully (known bug #21819)
- [x] Handle model_change entries
- [x] Idempotent ingestion via ingestion_state table
- [x] Tests: adapter ingest/validate plus discovery with sample JSONL fixtures and mock directories

### 2.2 Verify Phase 2
- [x] Adapter validates real OpenClaw install (or test fixtures)
- [x] Ingest populates traces, spans, messages tables correctly
- [x] Re-running ingest doesn't create duplicates
- [x] --since filtering works (default 30d, max 60d)

---

## Phase 3: Analysis

### 3.1 @langcost/analyzers
- [ ] `packages/analyzers/package.json` — depends on core + db (workspace:*)
- [ ] `packages/analyzers/tsconfig.json` — extends base
- [ ] `packages/analyzers/src/cost-analyzer.ts` — aggregate cost per trace/span from usage data
- [ ] `packages/analyzers/src/waste-detector.ts` — orchestrates waste rules, writes reports
- [ ] `packages/analyzers/src/rules/low-cache.ts` — Tier 1: detect low cache utilization
- [ ] `packages/analyzers/src/rules/model-overuse.ts` — Tier 1: expensive model for simple tasks
- [ ] `packages/analyzers/src/rules/agent-loops.ts` — Tier 1: cyclic tool call patterns
- [ ] `packages/analyzers/src/rules/retry-patterns.ts` — Tier 1: similar sequential user messages
- [ ] `packages/analyzers/src/rules/tool-failures.ts` — Tier 1: failed tool calls + cost
- [ ] `packages/analyzers/src/rules/high-output.ts` — Tier 1: unusually verbose responses
- [ ] `packages/analyzers/src/rules/index.ts` — register all rules with tier designation
- [ ] `packages/analyzers/src/pipeline.ts` — run analyzers in priority order, record in analysis_runs
- [ ] `packages/analyzers/src/index.ts` — barrel export
- [ ] `packages/analyzers/CLAUDE.md` — package-specific agent rules
- [ ] Tests: each rule with fixture data, pipeline ordering

### 3.2 Verify Phase 3
- [ ] CostAnalyzer correctly aggregates costs from spans
- [ ] Each waste rule produces correct WasteReport from test data
- [ ] Pipeline runs in correct order, records analysis_runs
- [ ] Rules are source-agnostic — no reference to OpenClaw anywhere

---

## Phase 4: CLI

### 4.1 @langcost/cli
- [ ] `packages/cli/package.json` — bin field, depends on core + db + analyzers (workspace:*)
- [ ] `packages/cli/tsconfig.json` — extends base
- [ ] `packages/cli/src/index.ts` — entry point, arg parsing, command routing
- [ ] `packages/cli/src/adapter-loader.ts` — dynamic import(`@langcost/adapter-${name}`)
- [ ] `packages/cli/src/commands/scan.ts` — validate → ingest → analyze → print summary
- [ ] `packages/cli/src/commands/report.ts` — read DB → format → print (table/json/md)
- [ ] `packages/cli/src/commands/dashboard.ts` — start Hono + open browser
- [ ] `packages/cli/src/commands/status.ts` — DB stats, last scan, adapter info
- [ ] `packages/cli/src/output/table.ts` — terminal table rendering
- [ ] `packages/cli/src/output/summary.ts` — scan summary with tree formatting
- [ ] `packages/cli/src/output/colors.ts` — ANSI color helpers
- [ ] `packages/cli/src/config.ts` — resolve DB path, parse --since duration
- [ ] `packages/cli/CLAUDE.md` — package-specific agent rules
- [ ] Friendly error when adapter not installed
- [ ] --since 30d default, >60d shows upgrade message
- [ ] Tests: arg parsing, --since duration parsing, adapter-loader error handling

### 4.2 Verify Phase 4
- [ ] `bunx langcost scan --source openclaw` works end-to-end
- [ ] `bunx langcost report` shows formatted output
- [ ] `bunx langcost status` shows DB stats
- [ ] Missing adapter gives clean install instructions
- [ ] --since >60d gives upgrade message

---

## Phase 5: Dashboard

### 5.1 apps/api
- [ ] `apps/api/package.json` — depends on core + db, hono dependency
- [ ] `apps/api/tsconfig.json` — extends base
- [ ] `apps/api/src/index.ts` — Hono app, mount routes, serve static web build
- [ ] `apps/api/src/routes/overview.ts` — GET /api/v1/overview
- [ ] `apps/api/src/routes/traces.ts` — GET /api/v1/traces, GET /api/v1/traces/:id
- [ ] `apps/api/src/routes/waste.ts` — GET /api/v1/waste, GET /api/v1/waste/recommendations
- [ ] `apps/api/src/routes/segments.ts` — GET /api/v1/segments/breakdown
- [ ] `apps/api/src/routes/health.ts` — GET /api/v1/health
- [ ] `apps/api/CLAUDE.md` — package-specific agent rules

### 5.2 apps/web
- [ ] `apps/web/package.json` — react, react-dom, recharts, vite, tailwindcss
- [ ] `apps/web/vite.config.ts` — proxy /api to Hono in dev
- [ ] `apps/web/tailwind.config.ts`
- [ ] `apps/web/index.html`
- [ ] `apps/web/src/main.tsx` — React entry
- [ ] `apps/web/src/App.tsx` — router setup
- [ ] `apps/web/src/api/client.ts` — fetch wrappers for all API endpoints
- [ ] `apps/web/src/pages/Overview.tsx` — cost summary, waste %, charts
- [ ] `apps/web/src/pages/Sessions.tsx` — trace list with sort/filter
- [ ] `apps/web/src/pages/TraceDetail.tsx` — single trace breakdown
- [ ] `apps/web/src/pages/WasteReport.tsx` — waste findings + recommendations
- [ ] `apps/web/src/components/charts/CostBreakdown.tsx` — segment pie/bar chart
- [ ] `apps/web/src/components/charts/CostTimeline.tsx` — cost over time
- [ ] `apps/web/src/components/charts/WasteByCategory.tsx` — waste category chart
- [ ] `apps/web/src/components/tables/TraceTable.tsx` — sortable trace list
- [ ] `apps/web/src/components/tables/WasteTable.tsx` — waste report list
- [ ] `apps/web/src/components/layout/Header.tsx`
- [ ] `apps/web/src/components/layout/Sidebar.tsx`
- [ ] `apps/web/CLAUDE.md` — package-specific agent rules

### 5.3 Verify Phase 5
- [ ] `langcost dashboard` starts server and opens browser
- [ ] Overview page shows cost summary and charts
- [ ] Can drill into individual traces
- [ ] Waste report shows findings with recommendations
- [ ] API endpoints return correct JSON

---

## Future (post-launch)

### Phase 6: Langfuse Adapter
- [ ] `packages/adapter-langfuse/` — fetch traces via Langfuse API
- [ ] Normalize Langfuse generations → Trace/Span/Message
- [ ] Tier 2 waste rules become available (full messages array)

### Phase 7: Fault Attribution
- [ ] `packages/analyzers/src/fault-attributor.ts`
- [ ] Walk span graph backwards to find root cause
- [ ] fault_reports table population

### Phase 8: OpenClaw Plugin
- [ ] Build `langcost-openclaw-plugin` for OpenClaw's skill system
- [ ] Hook into LLM call pipeline, capture full messages array
- [ ] Enables Tier 2 rules for OpenClaw users

### Phase 9: SaaS
- [ ] Continuous sync engine
- [ ] Alerting (Slack/email)
- [ ] Team management + auth
- [ ] Aggregate benchmarking
- [ ] ee/ directory with proprietary features
