# Adapters

LangCost reads agent data through **adapters**. Each adapter knows how to ingest one source (a local SQLite DB, a JSONL directory, a remote API) and normalizes it for the analysis engine. Install only the adapters you actually use.

This file is the reference index — every published adapter is listed below with its install command, default source location, and any flags that only apply to that adapter.

---

## Managing adapters

You can do everything either from the CLI or from `langcost dashboard` → **Adapters** page (click **Install** / **Sync** / **Uninstall** on each row).

### Install

```bash
npm install -g @langcost/adapter-<name>
```

The CLI discovers any globally-installed `@langcost/adapter-*` package automatically — no extra config.

### Sync (scan)

`langcost scan` runs the adapter, ingests new sessions, then runs waste analysis. **Every scan — CLI or dashboard — is capped at 180 days of history.** That's the maximum window in OSS; pass `--since` for a shorter one. These flags work for **every** adapter:

```bash
langcost scan --source <name>          # required; e.g. claude-code, openclaw, warp, cline
  --path <path>                        # override the default source directory
  --file <path>                        # analyze a single session file (skips discovery)
  --since <duration|date>              # default 180d. Max 180d. Accepts: 7d, 30d, 90d, 2026-01-01
  --force                              # re-ingest and re-analyze everything
  --db <path>                          # override database path (default ~/.langcost/langcost.db)
```

Any flags beyond those are documented per-adapter below.

### Uninstall

```bash
npm uninstall -g @langcost/adapter-<name>
```

Traces already ingested from that adapter stay in the DB until they age out of the rolling 500-trace window.

---

## Catalog

Each adapter auto-discovers its source location. If yours isn't in the default spot, pass `--path <path>` (covered in the universal flags above).

| Adapter | Source flag | npm package | Adapter-specific flags |
| --- | --- | --- | --- |
| **Claude Code** | `--source claude-code` | `@langcost/adapter-claude-code` | — |
| **OpenClaw** | `--source openclaw` | `@langcost/adapter-openclaw` | — |
| **Warp** | `--source warp` | `@langcost/adapter-warp` | `--warp-plan <plan>` — credit-rate assumption for arbitrage reporting. One of `build`, `business`, `add-on-low`, `add-on-high`, `byok`. Default `build`. |
| **Cline** ⚠️ not on npm yet | `--source cline` | `@langcost/adapter-cline` | — |

> **Cline status:** the package isn't published to npm yet. The dashboard's **Install** button will return a 404 from npm until it is. In the monorepo it works fine as a workspace-linked adapter.
