# langcost — Product Vision

## One-Liner

Cost intelligence and fault attribution for AI agent systems.

## The Problem

Teams running AI agents in production have no idea where their money goes or why things break.

### Cost Blindness

Observability tools (Langfuse, LangSmith) tell you **how many tokens** each call used. They don't tell you **why**.

A call that costs $0.18 might be 58% waste — unused tool definitions, duplicate RAG chunks, unbounded conversation history. But the observability dashboard just shows "$0.18" and moves on. Multiply that across thousands of calls and you're burning $3K-5K/month on tokens that did nothing.

**The numbers:**
- 50-90% of enterprise LLM spending is eliminable (LeanLM)
- 30% average token waste rate — on $10K/month, that's $3K recoverable (Redis)
- 80% of companies miss AI cost forecasts by >25% (LeanLM)
- 40-70% of tokens wasted on poor data serialization in RAG/agent architectures (CodeAnt)
- Agentic workflows consume ~100x more tokens than standard queries (Adaline Labs)

### Invisible Failures

Multi-agent pipelines don't fail cleanly. Step 4 errors, but the root cause was Agent 2 three steps earlier. Nobody can trace this automatically today.

- 85% per-step accuracy → 10-step pipeline succeeds only 20% of the time
- Only 62% of teams have tracing detailed enough to debug agent failures (LangChain)
- Redundant model calls and mis-sequenced API hits burn $500-$2K per failure incident (Greptime)

### Real Developer Pain

| Quote | Source |
|-------|--------|
| *"Costs skyrocketed to $20/day serving only 300 users"* | OpenAI Forum |
| *"Agents are extremely good at burning through budgets, and get even better when unattended"* | Hacker News |
| *"AI agents fail silently, loop endlessly, skip steps, and give wrong answers"* | Vellum |
| *"Reading raw logs for a 15-step agent with nested sub-agents is painful"* | Evil Martians |
| *"90% of retrieval failures aren't due to the LLM but the data"* | Hacker News |
| *"An extra call inside a loop can multiply your cost without anyone noticing"* | Dev.to |

---

## The Solution

langcost connects to your existing observability stack (or directly to agent logs) and answers two questions:

**"Where is the money going?"** — Cost Intelligence
**"Where are failures coming from?"** — Fault Intelligence

### Cost Intelligence

| Feature | What it does |
|---------|-------------|
| Token segmentation | Breaks each LLM call into: system prompt, tool schemas, conversation history, RAG context, user query |
| Waste detection | Identifies unused tools, duplicate RAG chunks, unbounded history, uncached system prompts |
| Anomaly detection | Flags traces that cost 5x+ the session average, cost drift over time |
| Optimization recs | Actionable: "trim these 12 tools, summarize after 10 turns, switch this to Haiku" |

### Fault Intelligence

| Feature | What it does |
|---------|-------------|
| Root cause attribution | Walks agent graph backwards — was the input bad (upstream fault) or did this agent fail on good input? |
| Failure cascade mapping | "When Agent 2 fails, Agents 4 and 5 always fail downstream" |
| Agent loop detection | Cycle detection in agent graphs, with token cost per loop |
| Retry pattern detection | Same prompt sent repeatedly with variations — agent struggling and burning tokens |

---

## What langcost Is NOT

- **Not an observability platform.** Langfuse/LangSmith do tracing. We analyze the data they collect.
- **Not a token counter.** Providers already count tokens. We segment and classify them.
- **Not a model router.** We tell you what could use a cheaper model. Routing is your decision.
- **Not a proxy.** We read existing data. No interception, no latency added.

---

## Architecture

```
Data Sources (adapters)          Analyzers              Output
─────────────────────           ──────────             ──────
OpenClaw logs      ──┐
Langfuse API       ──┼──→  SQLite  ──→  Cost Analyzer     ──→  CLI Report
LangSmith API      ──┤                  Waste Detector     ──→  Dashboard
OTEL traces        ──┘                  Fault Attributor   ──→  JSON/Markdown
```

### Tech Stack
- **Runtime:** Bun
- **API:** Hono
- **Database:** SQLite (bun:sqlite, zero deps)
- **Frontend:** React + Vite + Tailwind
- **Language:** TypeScript throughout

---

## Data Sources (Adapter Pattern)

### Phase 1: OpenClaw (launch adapter)
- Reads OpenClaw's local logs/SQLite directly
- No API key needed, fully local
- Targets 328K-star community, rides current hype wave
- Differentiates from ClawMetry/Tokscale by showing *why* tokens were spent, not just *how many*

### Phase 2: Langfuse
- Connects via Langfuse API
- Pulls traces, sessions, generations
- Expands to enterprise audience

### Phase 3: LangSmith, OTEL
- Broader compatibility
- Platform-agnostic positioning

---

## Analysis Levels

### Level 1 — Basic Aggregation (SQL)
- Token counts per segment type
- Cost per trace/session/day
- Unused tool detection

### Level 2 — Pattern Detection (SQL + TS)
- Conversation history growth (unbounded context)
- RAG duplicate detection (same chunk retrieved multiple times)
- System prompt repetition (hash comparison)
- Cost anomalies (5x+ session average)

### Level 3 — Cross-Session Intelligence (TS)
- Tool schema waste (30 tools defined, 3 ever called across 500 traces)
- Agent loop detection (cycle detection in agent graph)
- Failure cascade mapping (graph traversal)
- Retry pattern detection (similarity matching)
- Cost drift over time (same workflow costs 40% more this week)

### Level 4 — Classification (TS + heuristics)
- Message segmentation (classify parts of messages array)
- Root cause attribution (upstream fault vs. this agent's fault)
- Optimization recommendations (actionable suggestions with estimated savings)

---

## Target Users

| Persona | Pain Point | What they get |
|---------|-----------|---------------|
| Solo dev running OpenClaw | "I spent $400 last month, on what?" | Token breakdown + waste detection + quick wins |
| AI engineering team | "Our agent costs are growing 20%/month" | Segmented cost analysis + optimization recs |
| Platform team | "Which of our 15 workflows is too expensive?" | Cross-workflow cost comparison + anomaly detection |
| Engineering manager | "What's our AI unit economics?" | Cost per customer/workflow/team reports |

---

## Competitive Position

```
                    Counts tokens    Segments tokens    Recommends fixes
                    ─────────────    ───────────────    ────────────────
Langfuse                 ✓                 ✗                  ✗
LangSmith                ✓                 ✗                  ✗
ClawMetry                ✓                 ✗                  ✗
Tokscale                 ✓                 ✗                  ✗
Helicone                 ✓                 ✗                  ✗
LiteLLM                  ✓                 ✗                  ✗

langcost                 ✓                 ✓                  ✓
```

---

## Business Model

### Open Source (AGPL-3.0 → MIT + ee/ later)
- Full product: CLI + dashboard + all analyzers + all adapters
- Single user, local SQLite, self-hosted
- Complete and genuinely useful — not a crippled demo

### SaaS (later)
- Managed hosting (no self-hosting burden)
- Continuous sync (automatic, not manual CLI runs)
- Team access + roles
- Slack/PagerDuty alerts on cost spikes or reliability drops
- Scheduled reports (weekly cost digest)
- Trend history (90-365 days vs. 30 days free)
- **Aggregate benchmarking** — "companies like you waste X%" (impossible to self-host, true network effect)

### Revenue Potential (conservative)
- 500 customers x $300/month = $1.8M ARR
- 1,500 customers x $350/month = $6.3M ARR

### Acquisition Signal
- Potential acquirers: Langfuse, Datadog, Grafana Labs, New Relic, Arize
- Full OSS with strong adoption = strongest acquisition signal
- Comparable exits: Vantage ($25M), Cast.ai ($73M), Komodor ($42M)

---

## Launch Plan

### Month 1 — OpenClaw Adapter + Core Analyzers
- `npx langcost --source openclaw`
- CLI output with cost segmentation + waste detection
- Blog post: "We analyzed X OpenClaw sessions, here's what we found"
- Post on HN, Reddit r/LocalLLaMA, OpenClaw community

### Month 2 — Dashboard + Iterate
- Local React dashboard at localhost
- Iterate based on community feedback
- Start building Langfuse adapter

### Month 3 — Langfuse Adapter + Fault Attribution
- Expand to enterprise audience
- Add fault attribution analyzer
- Begin SaaS infrastructure privately

### Month 4+ — Growth
- LangSmith/OTEL adapters
- Community contributions to analyzers
- SaaS launch with free tier

---

## Academic Foundation

- **SETA: Statistical Fault Attribution for Compound AI Systems** (arXiv:2601.19337, Jan 2026) — validates the fault attribution approach for multi-agent pipelines
- The paper proposes modular testing to trace how errors propagate through compound AI systems — directly maps to our Fault Intelligence features

---

*Built by [vjvkrm](https://github.com/vjvkrm)*
