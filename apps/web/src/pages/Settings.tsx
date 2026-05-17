import { useCallback, useEffect, useState } from "react";

import {
  type AdapterStatus,
  getAdapters,
  type InstalledAdapter,
  installAdapter,
  type MissingAdapter,
  triggerScan,
  uninstallAdapter,
} from "../api/client";
import { formatInt, formatRelativeTime } from "../lib/format";

interface SettingsProps {
  onShellRefresh: () => Promise<void> | void;
}

type RowAction = "idle" | "syncing" | "installing" | "uninstalling";

interface RowState {
  action: RowAction;
  message: string | null;
  error: string | null;
}

const INITIAL_ROW_STATE: RowState = { action: "idle", message: null, error: null };

const REPO_URL = "https://github.com/vjvkrm/langcost";
const ADAPTERS_DIR_URL = `${REPO_URL}/tree/main/packages`;

export function Settings({ onShellRefresh }: SettingsProps) {
  const [adapters, setAdapters] = useState<AdapterStatus[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [rowState, setRowState] = useState<Record<string, RowState>>({});

  const loadAdapters = useCallback(async () => {
    setListError(null);
    try {
      const response = await getAdapters();
      setAdapters(response.adapters);
    } catch (cause) {
      setListError(cause instanceof Error ? cause.message : "Failed to load adapters.");
    }
  }, []);

  useEffect(() => {
    void loadAdapters();
  }, [loadAdapters]);

  function setRow(name: string, next: Partial<RowState>) {
    setRowState((current) => ({
      ...current,
      [name]: { ...(current[name] ?? INITIAL_ROW_STATE), ...next },
    }));
  }

  async function runRowAction(
    name: string,
    action: Exclude<RowAction, "idle">,
    fn: () => Promise<string | null>,
    failureLabel: string,
  ) {
    setRow(name, { action, message: null, error: null });
    try {
      const message = await fn();
      setRow(name, { action: "idle", message, error: null });
      await loadAdapters();
      await onShellRefresh();
    } catch (cause) {
      setRow(name, {
        action: "idle",
        message: null,
        error: cause instanceof Error ? cause.message : failureLabel,
      });
    }
  }

  function handleSync(adapter: InstalledAdapter) {
    void runRowAction(
      adapter.name,
      "syncing",
      async () => {
        const result = await triggerScan(false, adapter.name);
        return `Ingested ${result.tracesIngested} traces in ${Math.round(result.durationMs)}ms.`;
      },
      "Scan failed.",
    );
  }

  function handleInstall(adapter: MissingAdapter) {
    void runRowAction(
      adapter.name,
      "installing",
      async () => {
        await installAdapter(adapter.name);
        return null;
      },
      "Install failed.",
    );
  }

  function handleUninstall(adapter: InstalledAdapter) {
    if (adapter.installType !== "npm") return;
    const confirmed = window.confirm(
      `Uninstall ${adapter.label}? Already-ingested traces will remain in the DB.`,
    );
    if (!confirmed) return;

    void runRowAction(
      adapter.name,
      "uninstalling",
      async () => {
        await uninstallAdapter(adapter.name);
        return null;
      },
      "Uninstall failed.",
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="panel p-6">
        <div className="flex items-baseline justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-slate-50">Adapters</h1>
            <p className="section-copy mt-2 text-sm">
              Install or uninstall adapters and sync their traces.{" "}
              <a
                href={ADAPTERS_DIR_URL}
                target="_blank"
                rel="noreferrer"
                className="underline decoration-dotted underline-offset-2 hover:text-slate-200"
              >
                Browse adapters on GitHub →
              </a>
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadAdapters()}
            className="button-ghost text-xs"
          >
            Refresh list
          </button>
        </div>

        <OssLimitsCallout />

        {listError ? <div className="banner banner--error mt-6 text-sm">{listError}</div> : null}

        <div className="mt-6 space-y-3">
          {adapters === null ? (
            <p className="text-sm text-slate-500">Loading adapters…</p>
          ) : (
            adapters.map((adapter) => (
              <AdapterRow
                key={adapter.name}
                adapter={adapter}
                state={rowState[adapter.name] ?? INITIAL_ROW_STATE}
                onSync={handleSync}
                onInstall={handleInstall}
                onUninstall={handleUninstall}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// 180 also lives in MAX_SINCE_DAYS in @langcost/core; kept literal here to avoid
// pulling core into the web workspace just for one number.
function OssLimitsCallout() {
  return (
    <div
      className="mt-4 rounded-2xl border px-4 py-3 text-sm leading-6"
      style={{
        borderColor: "color-mix(in srgb, var(--accent-yellow) 32%, var(--border))",
        backgroundColor: "color-mix(in srgb, var(--accent-yellow) 10%, transparent)",
        color: "var(--text-secondary)",
      }}
    >
      <span className="font-medium" style={{ color: "var(--accent-yellow)" }}>
        OSS limits:
      </span>{" "}
      scans only ever read the last <strong>180 days</strong> of history, and the dashboard keeps
      the <strong>500 most recent traces</strong> (older ones are pruned after each scan). For
      faster syncs on large histories, narrow the window from the CLI with{" "}
      <code
        className="rounded px-1.5 py-0.5 text-xs"
        style={{ backgroundColor: "var(--surface-soft)", color: "var(--text-primary)" }}
      >
        langcost scan --since 30d
      </code>
      .
    </div>
  );
}

interface AdapterRowProps {
  adapter: AdapterStatus;
  state: RowState;
  onSync: (adapter: InstalledAdapter) => void;
  onInstall: (adapter: MissingAdapter) => void;
  onUninstall: (adapter: InstalledAdapter) => void;
}

function AdapterRow({ adapter, state, onSync, onInstall, onUninstall }: AdapterRowProps) {
  const busy = state.action !== "idle";

  return (
    <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-alt)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-base font-medium text-slate-100">{adapter.label}</span>
            {adapter.installed ? (
              <span className="text-xs text-slate-500">v{adapter.version}</span>
            ) : (
              <span className="rounded-full border border-slate-500/30 bg-slate-500/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-300">
                not installed
              </span>
            )}
            {adapter.installed && adapter.installType === "workspace" ? (
              <span className="rounded-full border border-blue-400/30 bg-blue-500/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-blue-200">
                workspace
              </span>
            ) : null}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-slate-500">
            <span>@langcost/adapter-{adapter.name}</span>
            <span aria-hidden>·</span>
            <span>
              {formatInt(adapter.traceCount)} {adapter.traceCount === 1 ? "trace" : "traces"}
            </span>
            {adapter.lastScanAt ? (
              <>
                <span aria-hidden>·</span>
                <span>last scan {formatRelativeTime(adapter.lastScanAt)}</span>
              </>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {adapter.installed ? (
            <>
              <button
                type="button"
                onClick={() => onSync(adapter)}
                disabled={busy}
                className="button-primary px-3 py-2 text-sm"
              >
                {state.action === "syncing" ? "Syncing…" : "Sync"}
              </button>
              <button
                type="button"
                onClick={() => onUninstall(adapter)}
                disabled={busy || adapter.installType !== "npm"}
                title={
                  adapter.installType === "npm"
                    ? undefined
                    : "Workspace-linked adapters can't be uninstalled from the UI."
                }
                className="button-secondary px-3 py-2 text-sm"
              >
                {state.action === "uninstalling" ? "Uninstalling…" : "Uninstall"}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => onInstall(adapter)}
              disabled={busy}
              className="button-primary px-3 py-2 text-sm"
            >
              {state.action === "installing" ? "Installing…" : "Install"}
            </button>
          )}
        </div>
      </div>

      {!adapter.installed ? (
        <div className="mt-3 rounded-xl bg-[color:var(--surface-soft)] px-3 py-2 text-[11px] text-slate-400">
          Or run from your terminal:{" "}
          <code className="text-slate-200">{adapter.installCommand}</code>
        </div>
      ) : null}

      {state.message ? <p className="mt-3 text-xs text-blue-200">{state.message}</p> : null}
      {state.error ? <p className="mt-3 text-xs text-red-300">{state.error}</p> : null}
    </div>
  );
}
