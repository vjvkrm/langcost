# Contributing to langcost

## Quick Start

```bash
git clone https://github.com/vjvkrm/langcost.git
cd langcost
bun install
bun test
```

## Project Structure

See [SPEC.md](../SPEC.md) for full technical specification and [CLAUDE.md](../CLAUDE.md) for development guide.

## How to Contribute

### Adding a Waste Detection Rule

The easiest way to contribute. Each rule is a standalone function.

1. Create `packages/analyzers/src/rules/your-rule.ts`
2. Implement the rule function: `(db, traceIds?) => WasteReport[]`
3. Register in `packages/analyzers/src/rules/index.ts`
4. Designate as Tier 1 (works with any adapter) or Tier 2 (needs full messages)
5. Add tests in `packages/analyzers/src/rules/your-rule.test.ts`

### Adding an Adapter

Adapters are separate npm packages. Anyone can build one.

1. Create a new package `@langcost/adapter-<name>` (or `@yourorg/langcost-adapter-<name>`)
2. Implement the `IAdapter` interface from `@langcost/core`
3. Export as default from `src/index.ts`
4. The CLI discovers it automatically — no changes needed in the CLI

### Updating Pricing

Model pricing lives in `packages/core/src/pricing/providers.ts`. PRs to update prices are always welcome — just update the `updatedAt` field.

## Architecture Rules

- **Adapters only ingest.** They normalize source data into Traces/Spans/Messages. They never analyze.
- **Analyzers are source-agnostic.** They never reference any specific adapter or source format.
- **Minimal dependencies.** Use Bun built-ins first. Don't add npm packages without discussion.
- **Drizzle ORM** for all database access. Schema in `packages/db/src/schema/`. Migrations via `drizzle-kit`.
- **Never hand-write dependency versions.** Always `bun add <package>` to get latest. Never manually edit version strings in package.json.

## Running Tests

```bash
bun test                          # all tests
bun test packages/core            # specific package
bun test --watch                  # watch mode
```

## Code Style

- Biome for formatting and linting: `bun run lint` / `bun run format`
- TypeScript strict mode
- Functions over classes
- No `any` types
