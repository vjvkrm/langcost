# langcost

**Stop guessing where your AI budget goes. Start knowing.**

langcost is a cost intelligence and fault attribution engine for AI agent systems. It connects to your existing observability platform (Langfuse, LangSmith, OpenTelemetry) and tells you exactly where tokens are wasted, why pipelines fail, and what to fix first.

---

## The Problem

AI agents in production are expensive and unreliable — and nobody can explain why.

### Teams are flying blind on costs

- **50-90% of enterprise LLM spending is eliminable** through optimization, but teams don't know where to cut. ([LeanLM](https://leanlm.ai/blog/llm-cost-optimization))
- **80% of companies miss their AI cost forecasts by more than 25%.** Enterprise LLM API spending doubled in 6 months — $3.5B to $8.4B — and is projected to hit $15B by 2026.
- A **30% token waste rate is typical**. On $10K/month spending, that's $3K/month burned on tokens that did nothing useful. ([Redis](https://redis.io/blog/llm-token-optimization-speed-up-apps/))

### The waste is hidden in plain sight

Observability tools like Langfuse and LangSmith tell you *how many* tokens each call used. They don't tell you *why*.

A typical LLM call might use 12,400 input tokens. But what's actually in those tokens?

```
system prompt:           2,100 tokens  (identical across last 6 calls)
tool definitions:        4,200 tokens  (28 of 30 tools never called)
conversation history:    3,400 tokens  (growing unbounded)
RAG context:             1,800 tokens  (same chunk retrieved 3rd time)
actual user query:         900 tokens
                         ─────
                        12,400 tokens → 7,200 are waste (58%)
```

Nobody sees this breakdown today. You get a single number per call and a monthly bill that keeps climbing.

### Agent loops quietly drain budgets

- A Reflexion loop running 10 cycles consumes **50x the tokens** of a single pass. An unconstrained agent can cost **$5-8 per task**. ([Adaline Labs](https://labs.adaline.ai/p/token-burnout-why-ai-costs-are-climbing))
- Modern agentic workflows consume roughly **100x more tokens** than standard queries.
- *"Agents are extremely good at burning through budgets, and get even better when unattended."* — [Hacker News](https://news.ycombinator.com/item?id=43998472)

### Failures cascade invisibly

Multi-agent pipelines don't fail cleanly. Step 4 throws the error, but the root cause was Agent 2 feeding it bad data three steps earlier.

- If an agent achieves **85% accuracy per action**, a **10-step workflow only succeeds ~20% of the time** (0.85^10).
- **89% of organizations** have some observability for agents, but only **62% have tracing** detailed enough to debug failures. ([LangChain State of Agent Engineering](https://www.langchain.com/state-of-agent-engineering))
- *"AI agents fail silently, loop endlessly, skip steps, and give wrong answers."* — [Vellum](https://www.vellum.ai/blog/understanding-your-agents-behavior-in-production)
- *"Reading raw logs for a 15-step agent with nested sub-agents is painful."* — [Evil Martians](https://evilmartians.com/chronicles/debug-ai-fast-agent-prism-open-source-library-visualize-agent-traces)

---

## What langcost Does

langcost sits on top of your existing observability stack and answers two questions:

> **"Where is the money going?"** and **"Where are failures coming from?"**

### Cost Intelligence

- **Token segmentation** — breaks down every LLM call into system prompt, tool schemas, conversation history, RAG context, and user query. Shows you what percentage of spend goes to each category.
- **Waste detection** — identifies unused tool definitions sent on every call, duplicate RAG chunks retrieved multiple times, conversation history growing unbounded, and system prompts repeated without caching.
- **Anomaly detection** — flags traces that cost significantly more than the session average and cost drift over time for the same workflow.
- **Optimization recommendations** — actionable suggestions: trim these 12 unused tools, summarize history after 10 turns, deduplicate these chunks, switch this workflow to a cheaper model.

### Fault Attribution

- **Root cause analysis** — when a multi-agent pipeline fails, traces the failure backwards to identify which agent actually caused it, not just which step errored.
- **Failure cascade mapping** — shows that when Agent 2 fails, Agents 4 and 5 always fail downstream. Tells you where to invest reliability effort.
- **Agent loop detection** — identifies cycles in agent graphs (A calls B calls A) and calculates the token cost of each loop.
- **Retry pattern detection** — spots the same prompt sent repeatedly with slight variations, a sign of an agent struggling and burning tokens.

### What langcost Is NOT

- **Not another observability platform.** Langfuse, LangSmith, and Arize do tracing. We don't replace them — we analyze the data they already collect.
- **Not a token counter.** Your LLM provider already counts tokens. We classify and segment them to show where the waste is.
- **Not a model router.** We tell you which workflows could use a cheaper model. The actual routing is your decision.

---

## How It Works

```
Your Agent System
      │
      ▼
  Langfuse / LangSmith / OTEL     ← traces + token counts (already collected)
      │
      ▼
   langcost                        ← analyzes traces, segments tokens, maps failures
      │
      ▼
  Dashboard + CLI Report           ← "here's what's wrong and how to fix it"
```

langcost connects to your existing observability platform via API, pulls trace data, and runs analyzers locally. No code changes to your agent system. No new SDK to install. No data leaves your machine (in self-hosted mode).

---

## Who This Is For

- **Engineering teams running AI agents in production** who got their first $10K+ LLM bill and thought *"where did that come from?"*
- **Platform teams** responsible for AI infrastructure costs across multiple teams and workflows.
- **Engineering managers** who need to answer *"what's our AI unit economics per customer?"*
- **Anyone debugging multi-agent pipelines** who's tired of reading raw logs to figure out which agent broke the chain.

---

## Real Pain Points We Solve

| Pain Point | Who said it | What langcost does |
|-----------|-------------|-------------------|
| *"Costs skyrocketed to $20/day serving only 300 users"* | [OpenAI Forum](https://community.openai.com/t/sos-alarming-situation-of-excessive-billing-threatening-the-survival-of-my-company-ai-project-gpt/734483) | Shows exactly which part of your prompt is eating tokens |
| *"Reasoning tokens count as output but the dashboard only shows input"* | [OpenAI Forum](https://community.openai.com/t/reasoning-tokens-hidden-price-question/1353099) | Full token breakdown by category, no hidden costs |
| *"60-80% of costs come from 20-30% of use cases"* | [LeanLM](https://leanlm.ai/blog/llm-cost-optimization) | Identifies which workflows are over-spending and why |
| *"90% of retrieval failures aren't due to the LLM but the data"* | [Hacker News](https://news.ycombinator.com/item?id=46384230) | Detects duplicate chunks, context overload, and retrieval waste |
| *"An extra call inside a loop can multiply your cost without anyone noticing"* | [Dev.to](https://dev.to/clickit_devops/whats-actually-making-your-llm-costs-skyrocket-3039) | Detects agent loops and calculates their token burn |
| *"AI agents fail in production because of infrastructure, not models"* | [RoboRhythms](https://www.roborhythms.com/why-ai-agents-fail-in-production/) | Fault attribution traces failures to the actual root cause agent |

---

## Project Status

langcost is in active development. Coming soon:

- [ ] Core analyzers (cost segmentation, waste detection)
- [ ] Langfuse adapter
- [ ] CLI with terminal reports
- [ ] Dashboard UI
- [ ] LangSmith adapter
- [ ] OTEL adapter
- [ ] Fault attribution engine

---

## License

AGPL-3.0

---

**Built by [vjvkrm](https://github.com/vjvkrm)**
