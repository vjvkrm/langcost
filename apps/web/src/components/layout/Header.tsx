import type { SourceInfo } from "../../api/client";

interface HeaderProps {
  currentPath: string;
  onNavigate: (path: string) => void;
  onRefresh: () => void;
  refreshing: boolean;
  theme: "dark" | "light";
  onToggleTheme: () => void;
  sources: SourceInfo[];
  activeSource?: string | undefined;
  onSourceChange: (source: string | undefined) => void;
  billingMode: "subscription" | "api";
  onBillingModeChange: (mode: "subscription" | "api") => void;
}

const SOURCE_LABELS: Record<string, string> = {
  "claude-code": "Claude Code",
  openclaw: "OpenClaw",
  langfuse: "Langfuse",
};

const NAV_ITEMS = [
  { path: "/", label: "Traces" },
  { path: "/overview", label: "Overview" },
  { path: "/settings", label: "Adapters" },
];

export function Header({
  currentPath,
  onNavigate,
  onRefresh,
  refreshing,
  theme,
  onToggleTheme,
  sources,
  activeSource,
  onSourceChange,
  billingMode,
  onBillingModeChange,
}: HeaderProps) {
  const hasData = sources.length > 0;
  return (
    <header className="site-header fixed inset-x-0 top-0 z-20 border-b border-[color:var(--border)] backdrop-blur">
      <div className="mx-auto flex w-full max-w-[1480px] items-center justify-between gap-4 px-4 py-3 sm:px-6 xl:px-10">
        <div className="flex items-center gap-5">
          <button type="button" onClick={() => onNavigate("/")} className="header-brand">
            <img
              src="/logo.svg"
              alt=""
              className="h-7 w-7"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
            <span
              className="text-[15px] font-bold tracking-[-0.01em]"
              style={{ color: "var(--text-primary)" }}
            >
              Lang<span style={{ color: "var(--accent-orange, #ff6b00)" }}>Cost</span>
            </span>
          </button>

          <nav className="hidden items-center gap-1 md:flex">
            {NAV_ITEMS.map((item) => {
              const active = currentPath === item.path;
              return (
                <button
                  key={item.path}
                  type="button"
                  onClick={() => onNavigate(item.path)}
                  className={`nav-pill ${active ? "nav-pill-active" : ""}`}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center gap-2">
          {hasData && sources.length > 1 ? (
            <select
              value={activeSource ?? ""}
              onChange={(e) => onSourceChange(e.target.value || undefined)}
              className="source-selector rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-2)] px-3 py-1.5 text-sm font-medium"
              style={{ color: "var(--text-primary)" }}
            >
              {sources.map((s) => (
                <option key={s.name} value={s.name}>
                  {SOURCE_LABELS[s.name] ?? s.name} ({s.traceCount})
                </option>
              ))}
            </select>
          ) : hasData && sources.length === 1 && sources[0] ? (
            <span
              className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-2)] px-3 py-1.5 text-sm font-medium"
              style={{ color: "var(--text-secondary)" }}
            >
              {SOURCE_LABELS[sources[0].name] ?? sources[0].name}
            </span>
          ) : null}

          {hasData ? (
            <div className="theme-toggle">
              <button
                type="button"
                onClick={() => onBillingModeChange("subscription")}
                className={`theme-toggle__label ${billingMode === "subscription" ? "theme-toggle__label--active" : ""}`}
              >
                Sub
              </button>
              <button
                type="button"
                onClick={() => onBillingModeChange("api")}
                className={`theme-toggle__label ${billingMode === "api" ? "theme-toggle__label--active" : ""}`}
              >
                API
              </button>
            </div>
          ) : null}

          <button
            type="button"
            onClick={onToggleTheme}
            className="theme-toggle"
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
          >
            <span
              className={`theme-toggle__label ${
                theme === "dark" ? "theme-toggle__label--active" : ""
              }`}
            >
              Dark
            </span>
            <span
              className={`theme-toggle__label ${
                theme === "light" ? "theme-toggle__label--active" : ""
              }`}
            >
              Light
            </span>
          </button>

          <button
            type="button"
            onClick={onRefresh}
            disabled={!hasData || refreshing}
            className="button-secondary rounded-full px-4 py-2 text-sm"
          >
            {refreshing ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </div>
    </header>
  );
}
