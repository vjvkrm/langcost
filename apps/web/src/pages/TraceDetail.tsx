import { useEffect, useMemo, useState } from "react";

import {
  getTraceDetail,
  readClaudeCodeTokens,
  readWarpArbitrage,
  type TraceDetailResponse,
  type TraceSummary,
} from "../api/client";
import {
  formatCategoryLabel,
  formatDateTime,
  formatInt,
  formatPercent,
  formatUsd,
  severityClasses,
  statusClasses,
  traceLabel,
} from "../lib/format";

interface TraceDetailProps {
  traceId: string;
  refreshToken: number;
  onBack: () => void;
}

const SPANS_PER_PAGE = 50;

export function TraceDetail({ traceId, refreshToken, onBack }: TraceDetailProps) {
  const [detail, setDetail] = useState<TraceDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [typeFilter, setTypeFilter] = useState("all");

  useEffect(() => {
    void refreshToken;
    let active = true;

    void (async () => {
      setLoading(true);
      setError(null);

      try {
        const response = await getTraceDetail(traceId);

        if (!active) {
          return;
        }

        setDetail(response);
      } catch (cause) {
        if (!active) {
          return;
        }

        setError(cause instanceof Error ? cause.message : "Failed to load trace detail.");
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [refreshToken, traceId]);

  const filteredSpans = useMemo(() => {
    if (!detail) {
      return [];
    }

    return detail.spans.filter((span) => typeFilter === "all" || span.type === typeFilter);
  }, [detail, typeFilter]);

  const visibleSpans = filteredSpans.slice((page - 1) * SPANS_PER_PAGE, page * SPANS_PER_PAGE);
  const totalPages = Math.max(1, Math.ceil(filteredSpans.length / SPANS_PER_PAGE));

  if (loading) {
    return <div className="panel p-8 text-sm text-slate-400">Loading trace detail...</div>;
  }

  if (error) {
    return <div className="panel p-8 text-sm text-red-300">{error}</div>;
  }

  if (!detail) {
    return <div className="panel p-8 text-sm text-slate-500">Trace not found.</div>;
  }

  const actionableReports = detail.wasteReports.filter(
    (report) => report.category !== "model_overuse",
  );
  const modelInsights = detail.wasteReports.filter((report) => report.category === "model_overuse");
  const spanTypes = ["all", ...new Set(detail.spans.map((span) => span.type))];

  return (
    <div className="mx-auto flex w-full max-w-[1480px] flex-col gap-6">
      <button type="button" onClick={onBack} className="button-ghost w-fit">
        ← Back to Traces
      </button>

      <div className="panel p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="section-kicker">Trace</div>
            <h1 className="mt-2 text-3xl font-semibold text-slate-50">
              {traceLabel(detail.trace.externalId, detail.trace.id)}
            </h1>
            <div className="mt-3 flex flex-wrap gap-3 text-sm text-slate-400">
              <span>Model: {detail.trace.model ?? "unknown"}</span>
              <span>Started: {formatDateTime(detail.trace.startedAt)}</span>
              <span>
                Tokens: {formatInt(detail.trace.totalInputTokens + detail.trace.totalOutputTokens)}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <div className="pill-card">
              <div className="text-xs text-slate-500">Cost</div>
              <div className="mt-1 text-xl font-semibold text-slate-50">
                {formatUsd(detail.trace.totalCostUsd)}
              </div>
            </div>
            <div className="pill-card">
              <div className="text-xs text-slate-500">Actionable Waste</div>
              <div className="mt-1 text-xl font-semibold text-red-300">
                {formatUsd(detail.costBreakdown.wastedCostUsd)}
              </div>
            </div>
            <div className="pill-card">
              <div className="text-xs text-slate-500">Status</div>
              <div className="mt-2">
                <span
                  className={`rounded-full px-2.5 py-1 text-xs ${statusClasses(detail.trace.status)}`}
                >
                  {detail.trace.status}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <WarpArbitrageSection trace={detail.trace} />
      <ClaudeCodeTokensSection trace={detail.trace} />

      <section className="grid gap-4 lg:grid-cols-3">
        {detail.costBreakdown.segments.map((segment) => (
          <div key={segment.type} className="soft-card">
            <div className="text-sm text-slate-500">{segment.type}</div>
            <div className="mt-2 text-xl font-semibold text-slate-50">
              {formatUsd(segment.costUsd)}
            </div>
            <div className="mt-2 text-sm text-slate-400">
              {formatInt(segment.tokenCount)} tokens · {formatPercent(segment.percentOfTotal)}
            </div>
          </div>
        ))}
      </section>

      <section className="panel p-5">
        <h2 className="text-lg font-semibold text-slate-100">Trace Annotations</h2>
        <div className="mt-4 space-y-3">
          {actionableReports.length === 0 && modelInsights.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/10 p-4 text-sm text-slate-500">
              No waste reports for this trace.
            </div>
          ) : (
            [...actionableReports, ...modelInsights].map((report) => (
              <div
                key={report.id}
                className={`${
                  report.category === "model_overuse"
                    ? "annotation-card annotation-card--info"
                    : "soft-card"
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-sm font-medium text-slate-100">
                    {report.category === "model_overuse" ? (
                      <span className="text-blue-200">ℹ</span>
                    ) : (
                      <span
                        className={`inline-flex h-2.5 w-2.5 rounded-full ${severityClasses(report.severity)}`}
                      />
                    )}
                    {formatCategoryLabel(report.category)}
                  </div>
                  {report.category !== "model_overuse" ? (
                    <div className="text-sm text-red-300">{formatUsd(report.wastedCostUsd)}</div>
                  ) : null}
                </div>
                <p className="mt-3 text-sm text-slate-300">{report.description}</p>
                <p className="mt-2 text-sm text-slate-500">{report.recommendation}</p>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="panel overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-[color:var(--border)] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-100">
              Spans ({formatInt(filteredSpans.length)})
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Filter by span type and page through the trace.
            </p>
          </div>

          <label className="text-sm text-slate-400">
            <span className="mr-2">Filter</span>
            <select
              value={typeFilter}
              onChange={(event) => {
                setTypeFilter(event.target.value);
                setPage(1);
              }}
              className="field-shell rounded-xl px-3 py-2"
            >
              {spanTypes.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="grid grid-cols-[90px_minmax(0,1.8fr)_minmax(0,1fr)_90px_90px] gap-3 border-b border-[color:var(--border)] px-5 py-3 text-xs tracking-[0.18em] text-slate-500 uppercase">
          <span>Type</span>
          <span>Name</span>
          <span>Model</span>
          <span className="text-right">Cost</span>
          <span className="text-right">Status</span>
        </div>

        <div>
          {visibleSpans.map((span) => (
            <div
              key={span.id}
              className="grid grid-cols-[90px_minmax(0,1.8fr)_minmax(0,1fr)_90px_90px] gap-3 border-b border-[color:var(--border)] px-5 py-4 text-sm last:border-b-0"
            >
              <span className="text-slate-500">{span.type}</span>
              <div className="min-w-0">
                <div className="truncate text-slate-100">{span.name ?? span.externalId}</div>
                <div className="mt-1 truncate text-xs text-slate-500">
                  {span.toolName ?? span.provider ?? ""}
                </div>
              </div>
              <span className="truncate text-slate-300">{span.model ?? "-"}</span>
              <span className="text-right text-slate-100">{formatUsd(span.costUsd ?? 0)}</span>
              <div className="flex justify-end">
                <span className={`rounded-full px-2 py-1 text-xs ${statusClasses(span.status)}`}>
                  {span.status}
                </span>
              </div>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between gap-3 px-5 py-4 text-sm text-slate-500">
          <div>
            Page {page} of {totalPages}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={page === 1}
              className="button-secondary rounded-xl px-3 py-2 text-sm"
            >
              Previous
            </button>
            <button
              type="button"
              onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
              disabled={page >= totalPages}
              className="button-secondary rounded-xl px-3 py-2 text-sm"
            >
              Next
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

function WarpArbitrageSection({ trace }: { trace: TraceSummary }) {
  const arbitrage = readWarpArbitrage(trace);
  if (!arbitrage) return null;

  const { creditCostUsd, apiCostUsd, costMarkupPct, warpPlan, billingMode } = arbitrage;
  const delta = creditCostUsd - apiCostUsd;
  const comparable = apiCostUsd > 0;
  const cheaper = comparable && delta < 0;
  const deltaTone = !comparable
    ? "text-slate-400"
    : cheaper
      ? "text-emerald-300"
      : "text-amber-300";
  const headline = !comparable
    ? "Warp arbitrage (partial data)"
    : cheaper
      ? "Warp cheaper than API"
      : "Warp markup vs API";

  const isByok = billingMode === "byok";
  const isMixed = billingMode === "mixed";

  return (
    <section className="panel p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="section-kicker">Warp arbitrage</div>
          <h2 className="mt-2 text-lg font-semibold text-slate-100">{headline}</h2>
          <p className="mt-1 text-sm text-slate-500">
            What you paid Warp in credits vs. the same tokens at direct API rates.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="rounded-full border border-white/10 px-2.5 py-1 text-slate-300">
            plan: {warpPlan}
          </span>
          {isByok ? (
            <span className="rounded-full border border-emerald-300/30 bg-emerald-300/10 px-2.5 py-1 text-emerald-200">
              BYOK
            </span>
          ) : null}
          {isMixed ? (
            <span className="rounded-full border border-blue-300/30 bg-blue-300/10 px-2.5 py-1 text-blue-200">
              partial BYOK
            </span>
          ) : null}
        </div>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-3">
        <div className="soft-card">
          <div className="text-xs text-slate-500">Paid (Warp credits)</div>
          <div className="mt-1 text-xl font-semibold text-slate-50">
            {formatUsd(creditCostUsd)}
          </div>
        </div>
        <div className="soft-card">
          <div className="text-xs text-slate-500">API-equivalent</div>
          <div className="mt-1 text-xl font-semibold text-slate-50">
            {comparable ? formatUsd(apiCostUsd) : "—"}
          </div>
          {!comparable ? (
            <div className="mt-1 text-xs text-slate-500">model not yet priced</div>
          ) : null}
        </div>
        <div className="soft-card">
          <div className="text-xs text-slate-500">Δ</div>
          <div className={`mt-1 text-xl font-semibold ${deltaTone}`}>
            {comparable ? (
              <>
                {cheaper ? "−" : "+"}
                {formatUsd(Math.abs(delta))}
                {costMarkupPct !== null ? (
                  <span className="ml-2 text-sm font-normal text-slate-400">
                    ({formatPercent(Math.abs(costMarkupPct))} {cheaper ? "lower" : "higher"})
                  </span>
                ) : null}
              </>
            ) : (
              "—"
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function ClaudeCodeTokensSection({ trace }: { trace: TraceSummary }) {
  const breakdown = readClaudeCodeTokens(trace);
  if (!breakdown) return null;

  const {
    freshInputTokens,
    cacheWriteTokens,
    cacheReadTokens,
    outputTokens,
    inputCostUsd,
    cacheWriteCostUsd,
    cacheReadCostUsd,
    outputCostUsd,
    totalCostUsd,
    cacheHitRate,
    cacheRoi,
  } = breakdown;

  const totalContextTokens = freshInputTokens + cacheWriteTokens + cacheReadTokens;

  // Cache ROI = cache_read_savings / cache_write_premium.
  // Read at 0.1× input vs full input = 0.9× saved per read token.
  // Write at 2× input vs full input = 1× extra per write token (1h cache).
  // ROI > 1 means cache investment paid back; < 1 means writes weren't amortized.
  const roiTone =
    cacheRoi === null
      ? "text-slate-400"
      : cacheRoi >= 1
        ? "text-emerald-300"
        : cacheRoi >= 0.5
          ? "text-amber-300"
          : "text-red-300";
  const roiLabel =
    cacheRoi === null
      ? "—"
      : cacheRoi >= 1
        ? `${cacheRoi.toFixed(1)}× (paid back)`
        : `${cacheRoi.toFixed(2)}× (under-amortized)`;

  const rows: Array<{ label: string; tokens: number; costUsd: number; rateNote: string }> = [
    { label: "Fresh input", tokens: freshInputTokens, costUsd: inputCostUsd, rateNote: "1× rate" },
    {
      label: "Cache writes",
      tokens: cacheWriteTokens,
      costUsd: cacheWriteCostUsd,
      rateNote: "2× rate (1h)",
    },
    {
      label: "Cache reads",
      tokens: cacheReadTokens,
      costUsd: cacheReadCostUsd,
      rateNote: "0.1× rate",
    },
    { label: "Output", tokens: outputTokens, costUsd: outputCostUsd, rateNote: "" },
  ];

  return (
    <section className="panel p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="section-kicker">Tokens</div>
          <h2 className="mt-2 text-lg font-semibold text-slate-100">
            API-equivalent breakdown
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Where this session's tokens went, priced at Anthropic API rates.
          </p>
        </div>
        <div className="flex flex-wrap gap-3 text-right">
          <div className="pill-card">
            <div className="text-xs text-slate-500">Total context</div>
            <div className="mt-1 text-lg font-semibold text-slate-50">
              {formatInt(totalContextTokens)}
            </div>
          </div>
          <div className="pill-card">
            <div className="text-xs text-slate-500">API-equivalent cost</div>
            <div className="mt-1 text-lg font-semibold text-slate-50">
              {formatUsd(totalCostUsd)}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-5 overflow-hidden rounded-2xl border border-[color:var(--border)]">
        <table className="w-full text-sm">
          <thead className="bg-white/[0.02] text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2 text-left font-medium">Bucket</th>
              <th className="px-4 py-2 text-right font-medium">Tokens</th>
              <th className="px-4 py-2 text-right font-medium">Cost</th>
              <th className="px-4 py-2 text-right font-medium">Rate</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[color:var(--border)]">
            {rows.map((row) => (
              <tr key={row.label}>
                <td className="px-4 py-2.5 text-slate-200">{row.label}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-slate-300">
                  {formatInt(row.tokens)}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums text-slate-100">
                  {formatUsd(row.costUsd)}
                </td>
                <td className="px-4 py-2.5 text-right text-xs text-slate-500">{row.rateNote}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex flex-wrap gap-6 text-sm">
        <div>
          <div className="text-xs text-slate-500">Cache hit rate</div>
          <div className="mt-1 font-semibold text-slate-100">
            {formatPercent(cacheHitRate * 100)}
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500">Cache ROI</div>
          <div className={`mt-1 font-semibold ${roiTone}`}>{roiLabel}</div>
        </div>
      </div>
    </section>
  );
}
