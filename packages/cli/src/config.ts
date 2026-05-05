import type {
  CliCommand,
  DashboardCommandOptions,
  ReportCommandOptions,
  ScanCommandOptions,
  StatusCommandOptions,
} from "./types";

const HELP_TEXT = `langcost scan --source <adapter> [options]
  --source <adapter>      Required. "openclaw" (more later)
  --path <path>           Override default data source root directory
  --file <path>           Analyze a single session file (skips discovery)
  --warp-plan <plan>      Warp-only: build | business | add-on-low | add-on-high | byok
  --since <duration|date> Default: 30d. Accepts: 7d, 30d, 90d, 2026-01-01, all
  --force                 Re-ingest and re-analyze everything
  --db <path>             Override database path

langcost report [options]
  --format <fmt>          table (default) | json | markdown
  --sort <field>          cost | waste | date
  --limit <n>             Number of traces to show (default: 20)
  --trace <id>            Detailed report for a single trace
  --category <cat>        Filter waste by category
  --db <path>             Override database path

langcost dashboard [options]
  --port <port>           API server port (default: 3737)
  --no-open               Do not auto-open browser
  --db <path>             Override database path

langcost status [options]
  --db <path>             Override database path`;

const BOOLEAN_FLAGS = new Set(["force", "help", "no-open"]);
const WARP_PLAN_OPTIONS = new Set(["build", "business", "add-on-low", "add-on-high", "byok"]);
const WASTE_CATEGORIES = new Set([
  "low_cache_utilization",
  "model_overuse",
  "unused_tools",
  "duplicate_rag",
  "unbounded_history",
  "uncached_prompt",
  "agent_loop",
  "retry_waste",
  "tool_failure_waste",
  "high_output",
  "oversized_context",
]);

function invalid(message: string): never {
  throw new Error(message);
}

function parseNumber(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    invalid(`${label} must be a positive integer.`);
  }

  return parsed;
}

function parseFlags(argv: string[]): { command?: string; flags: Map<string, string | boolean> } {
  const flags = new Map<string, string | boolean>();

  let command: string | undefined;
  let index = 0;
  if (argv[0] && !argv[0].startsWith("--")) {
    command = argv[0];
    index = 1;
  }

  while (index < argv.length) {
    const token = argv[index];
    if (!token) {
      break;
    }

    if (token === "-h") {
      flags.set("help", true);
      index += 1;
      continue;
    }

    if (!token.startsWith("--")) {
      invalid(`Unexpected argument: ${token}`);
    }

    const key = token.slice(2);
    if (BOOLEAN_FLAGS.has(key)) {
      flags.set(key, true);
      index += 1;
      continue;
    }

    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      invalid(`Missing value for --${key}.`);
    }

    flags.set(key, value);
    index += 2;
  }

  return command ? { command, flags } : { flags };
}

function getStringFlag(flags: Map<string, string | boolean>, key: string): string | undefined {
  const value = flags.get(key);
  return typeof value === "string" ? value : undefined;
}

/** OSS limit: keep at most 500 traces in the database. */
export const MAX_TRACES_OSS = 500;

export function parseSinceArgument(value: string | undefined, now = new Date()): Date | undefined {
  if (value === undefined) {
    return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  }

  if (value.toLowerCase() === "all") {
    return undefined;
  }

  const durationMatch = value.match(/^(\d+)d$/i);
  if (durationMatch) {
    const days = Number(durationMatch[1]);
    if (!Number.isFinite(days) || days <= 0) {
      invalid(`Invalid --since value: ${value}`);
    }

    return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    invalid(`Invalid --since value: ${value}`);
  }

  return parsed;
}

function parseScan(flags: Map<string, string | boolean>, now: Date): ScanCommandOptions {
  const source = getStringFlag(flags, "source");
  if (!source) {
    invalid("scan requires --source <adapter>.");
  }

  const sourcePath = getStringFlag(flags, "path");
  const file = getStringFlag(flags, "file");
  const warpPlan = getStringFlag(flags, "warp-plan");
  const since = parseSinceArgument(getStringFlag(flags, "since"), now);
  const dbPath = getStringFlag(flags, "db");
  const apiKey = getStringFlag(flags, "api-key");
  const apiUrl = getStringFlag(flags, "api-url");

  if (warpPlan && !WARP_PLAN_OPTIONS.has(warpPlan)) {
    invalid(`Invalid --warp-plan value: ${warpPlan}`);
  }
  const selectedWarpPlan = warpPlan as ScanCommandOptions["warpPlan"] | undefined;

  return {
    command: "scan",
    source,
    ...(sourcePath ? { sourcePath } : {}),
    ...(file ? { file } : {}),
    ...(selectedWarpPlan ? { warpPlan: selectedWarpPlan } : {}),
    ...(since ? { since } : {}),
    force: flags.get("force") === true,
    ...(dbPath ? { dbPath } : {}),
    ...(apiKey ? { apiKey } : {}),
    ...(apiUrl ? { apiUrl } : {}),
  };
}

function parseReport(flags: Map<string, string | boolean>): ReportCommandOptions {
  const formatValue = getStringFlag(flags, "format") ?? "table";
  const format = formatValue === "md" ? "markdown" : formatValue;

  if (!["table", "json", "markdown"].includes(format)) {
    invalid(`Invalid --format value: ${formatValue}`);
  }

  const sort = getStringFlag(flags, "sort") ?? "date";
  if (!["cost", "waste", "date"].includes(sort)) {
    invalid(`Invalid --sort value: ${sort}`);
  }

  const category = getStringFlag(flags, "category");
  const traceId = getStringFlag(flags, "trace");
  const dbPath = getStringFlag(flags, "db");
  if (category && !WASTE_CATEGORIES.has(category)) {
    invalid(`Invalid --category value: ${category}`);
  }

  return {
    command: "report",
    format: format as ReportCommandOptions["format"],
    sort: sort as ReportCommandOptions["sort"],
    limit: parseNumber(getStringFlag(flags, "limit") ?? "20", "--limit"),
    ...(traceId ? { traceId } : {}),
    ...(category ? { category } : {}),
    ...(dbPath ? { dbPath } : {}),
  };
}

function parseStatus(flags: Map<string, string | boolean>): StatusCommandOptions {
  const dbPath = getStringFlag(flags, "db");
  return {
    command: "status",
    ...(dbPath ? { dbPath } : {}),
  };
}

function parseDashboard(flags: Map<string, string | boolean>): DashboardCommandOptions {
  const dbPath = getStringFlag(flags, "db");
  return {
    command: "dashboard",
    port: parseNumber(getStringFlag(flags, "port") ?? "3737", "--port"),
    noOpen: flags.get("no-open") === true,
    ...(dbPath ? { dbPath } : {}),
  };
}

export function getHelpText(): string {
  return HELP_TEXT;
}

export function parseArgv(argv: string[], now = new Date()): CliCommand | { command: "help" } {
  const { command: explicitCommand, flags } = parseFlags(argv);
  const help = flags.get("help") === true;

  const command = explicitCommand ?? (getStringFlag(flags, "source") ? "scan" : undefined);

  if (help || !command) {
    return { command: "help" };
  }

  switch (command) {
    case "scan":
      return parseScan(flags, now);
    case "report":
      return parseReport(flags);
    case "status":
      return parseStatus(flags);
    case "dashboard":
      return parseDashboard(flags);
    default:
      invalid(`Unknown command: ${command}`);
  }
}
