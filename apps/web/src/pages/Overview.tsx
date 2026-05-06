import { useEffect, useState } from "react";

import {
  getOverview,
  getRecommendations,
  type OverviewResponse,
  type Recommendation,
  type WarpArbitrageAggregate,
} from "../api/client";
import { CostTimeline } from "../components/charts/CostTimeline";
import { formatCompactInt, formatPercent, formatRelativeTime, formatUsd } from "../lib/format";

interface OverviewProps {
  refreshToken: number;
  onNavigate: (path: string) => void;
  source?: string | undefined;
  billingMode: "subscription" | "api";
}

export function Overview({ refreshToken, onNavigate, source, billingMode }: OverviewProps) {
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void refreshToken;
    let active = true;

    void (async () => {
      setLoading(true);
      setError(null);

      try {
        const [overviewResponse, recommendationResponse] = await Promise.all([
          getOverview(source),
          getRecommendations(source),
        ]);

        if (!active) {
          return;
        }

        setOverview(overviewResponse);
        setRecommendations(recommendationResponse.recommendations);
      } catch (cause) {
        if (!active) {
          return;
        }

        setError(cause instanceof Error ? cause.message : "Failed to load overview.");
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [refreshToken, source]);

  if (loading) {
    return <div className="panel p-8 text-sm text-slate-400">Loading overview...</div>;
  }

  if (error) {
    return <div className="panel p-8 text-sm text-red-300">{error}</div>;
  }

  if (!overview) {
    return <div className="panel p-8 text-sm text-slate-500">No overview data available.</div>;
  }

  const isApi = billingMode === "api";
  const totalTokens = overview.costByModel.reduce(
    (sum, m) => sum + (m.inputTokens ?? 0) + (m.outputTokens ?? 0),
    0,
  );
  const sr = overview.successRate ?? { complete: 0, error: 0, partial: 0, completePercent: 0 };
  const turns = overview.turns ?? { avg: 0, min: 0, max: 0, total: 0 };

  return (
    <div className="mx-auto flex w-full max-w-[1480px] flex-col gap-6">
      <section className="stat-strip">
        {isApi ? (
          <>
            <span className="stat-strip__item">
              <span className="stat-strip__label">Total:</span> {formatUsd(overview.totalCostUsd)}
            </span>
            <span className="stat-strip__separator">|</span>
            <span className="stat-strip__item">
              <span className="stat-strip__label">Waste:</span> {formatUsd(overview.totalWastedUsd)}{" "}
              ({formatPercent(overview.wastePercentage)})
            </span>
            <span className="stat-strip__separator">|</span>
          </>
        ) : null}
        <span className="stat-strip__item">
          <span className="stat-strip__label">Sessions:</span> {overview.totalTraces}
        </span>
        <span className="stat-strip__separator">|</span>
        <span className="stat-strip__item">
          <span className="stat-strip__label">Tokens:</span> {formatCompactInt(totalTokens)}
        </span>
        <span className="stat-strip__separator">|</span>
        <span className="stat-strip__item">
          <span className="stat-strip__label">Success:</span>{" "}
          <span
            style={{
              color: sr.completePercent >= 50 ? "var(--accent-green)" : "var(--accent-red)",
            }}
          >
            {formatPercent(sr.completePercent)}
          </span>
        </span>
        <span className="stat-strip__separator">|</span>
        <span className="stat-strip__item">
          <span className="stat-strip__label">Avg turns:</span> {turns.avg}
        </span>
        <span className="stat-strip__separator">|</span>
        <span className="stat-strip__item">
          <span className="stat-strip__label">Last scan:</span>{" "}
          {formatRelativeTime(overview.lastScanAt)}
        </span>
      </section>

      {isApi ? (
        <section className="panel p-5">
          <div className="mb-4">
            <div className="section-kicker">Daily Trend</div>
            <h2 className="text-lg font-semibold text-slate-100">Cost by Day</h2>
            <p className="section-copy mt-1 text-sm">Daily cost with actionable waste overlay</p>
          </div>
          <CostTimeline data={overview.costByDay} />
        </section>
      ) : null}

      <WarpArbitrageCard arbitrage={overview.warpArbitrage} />


      {overview.byProject?.length > 0 ? (
        <section className="panel p-5">
          <div className="mb-4">
            <div className="section-kicker">Projects</div>
            <h2 className="text-lg font-semibold text-slate-100">Project Comparison</h2>
            <p className="section-copy mt-1 text-sm">
              Token usage, efficiency, and success rate per project
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[color:var(--border)] text-xs tracking-[0.18em] text-slate-500 uppercase">
                  <th className="px-3 py-2 text-left font-medium">Project</th>
                  <th className="px-3 py-2 text-right font-medium">Sessions</th>
                  <th className="px-3 py-2 text-right font-medium">Tokens</th>
                  <th className="px-3 py-2 text-right font-medium">Avg turns</th>
                  <th className="px-3 py-2 text-right font-medium">Success</th>
                  {isApi ? <th className="px-3 py-2 text-right font-medium">Cost</th> : null}
                </tr>
              </thead>
              <tbody>
                {overview.byProject.map((p) => (
                  <tr
                    key={p.project}
                    className="border-b border-[color:var(--border)] last:border-b-0"
                  >
                    <td
                      className="px-3 py-2.5 font-medium"
                      style={{ color: "var(--accent-orange, #ff6b00)" }}
                    >
                      {p.project}
                    </td>
                    <td className="px-3 py-2.5 text-right text-slate-300">{p.sessions}</td>
                    <td className="px-3 py-2.5 text-right text-slate-300">
                      <span
                        title={`in: ${formatCompactInt(p.totalInputTokens)} | out: ${formatCompactInt(p.totalOutputTokens)}`}
                      >
                        {formatCompactInt(p.totalTokens)}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right text-slate-300">{p.avgTurns}</td>
                    <td className="px-3 py-2.5 text-right">
                      <span
                        style={{
                          color:
                            p.successRate >= 50
                              ? "var(--accent-green, #10b981)"
                              : "var(--accent-red, #ef4444)",
                        }}
                      >
                        {formatPercent(p.successRate)}
                      </span>
                    </td>
                    {isApi ? (
                      <td className="px-3 py-2.5 text-right text-slate-300">
                        {formatUsd(p.totalCostUsd)}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
        <div className="panel p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="section-kicker">Actions</div>
              <h2 className="text-lg font-semibold text-slate-100">Top Recommendations</h2>
              <p className="section-copy mt-1 text-sm">Actionable insights from your sessions</p>
            </div>
            <button type="button" onClick={() => onNavigate("/")} className="button-ghost">
              Open traces
            </button>
          </div>

          <div className="mt-4 space-y-3">
            {recommendations.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/10 p-4 text-sm text-slate-500">
                No recommendations yet.
              </div>
            ) : (
              recommendations.slice(0, 5).map((item, index) => (
                <div key={`${item.category}-${item.description}`} className="soft-card">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="text-sm font-medium text-slate-100">
                        {index + 1}. {item.description}
                      </div>
                      <div className="mt-2 text-sm text-slate-400">
                        {item.category} across {item.affectedTraces} traces
                      </div>
                    </div>
                    {isApi ? (
                      <div className="text-right">
                        <div className="text-sm text-slate-500">Savings</div>
                        <div className="mt-1 text-lg font-semibold text-emerald-300">
                          {formatUsd(item.estimatedSavingsUsd)}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="panel p-5">
          <div className="section-kicker">Distribution</div>
          <h2 className="text-lg font-semibold text-slate-100">Model Usage</h2>
          <p className="section-copy mt-1 text-sm">
            Token distribution — can you delegate more to smaller models?
          </p>

          <div className="mt-4 space-y-3">
            {overview.costByModel
              .filter((m) => m.inputTokens + m.outputTokens > 0)
              .map((entry) => {
                const entryTokens = entry.inputTokens + entry.outputTokens;
                const pct = totalTokens > 0 ? (entryTokens / totalTokens) * 100 : 0;
                const shortModel = entry.model.replace("claude-", "").replace(/-20\d+/g, "");
                const lower = entry.model.toLowerCase();
                const barColor = lower.includes("opus")
                  ? "#ff6b00"
                  : lower.includes("sonnet")
                    ? "#3b82f6"
                    : lower.includes("haiku")
                      ? "#10b981"
                      : "#6b7280";
                return (
                  <div key={entry.model} className="soft-card">
                    <div className="flex items-center justify-between gap-3 mb-2">
                      <span className="text-sm font-medium text-slate-100">{shortModel}</span>
                      <span className="text-sm text-slate-400">
                        {entry.traceCount} sessions
                        {isApi ? ` · ${formatUsd(entry.costUsd)}` : ""}
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <div
                        className="flex-1 h-2.5 rounded-full overflow-hidden"
                        style={{ background: "var(--surface-alt)" }}
                      >
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${Math.max(2, pct)}%`,
                            backgroundColor: barColor,
                          }}
                        />
                      </div>
                      <span className="text-sm font-medium text-slate-300 w-16 text-right">
                        {formatPercent(pct)}
                      </span>
                    </div>
                    <div className="flex gap-4 mt-1 text-xs text-slate-500">
                      <span>in: {formatCompactInt(entry.inputTokens)}</span>
                      <span>out: {formatCompactInt(entry.outputTokens)}</span>
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      </section>
    </div>
  );
}

function WarpArbitrageCard({ arbitrage }: { arbitrage: WarpArbitrageAggregate | null }) {
  if (!arbitrage || arbitrage.comparedTraces === 0) return null;

  const { totalPaidUsd, totalApiEquivalentUsd, markupPct, comparedTraces, totalWarpTraces } =
    arbitrage;
  const cheaper = markupPct < 0;
  const deltaTone = cheaper ? "text-emerald-300" : "text-amber-300";
  const headline = cheaper ? "Warp cheaper than direct API" : "Warp markup vs direct API";
  const skipped = totalWarpTraces - comparedTraces;

  return (
    <section className="panel p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="section-kicker">Warp arbitrage</div>
          <h2 className="mt-2 text-lg font-semibold text-slate-100">{headline}</h2>
          <p className="mt-1 text-sm text-slate-500">
            Aggregate of what you paid Warp vs. the same tokens at direct provider rates across{" "}
            {comparedTraces} session{comparedTraces === 1 ? "" : "s"}.
            {skipped > 0
              ? ` ${skipped} additional Warp session${skipped === 1 ? "" : "s"} excluded (model not yet priced).`
              : null}
          </p>
        </div>
      </div>
      <div className="mt-5 grid gap-4 sm:grid-cols-3">
        <div className="soft-card">
          <div className="text-xs text-slate-500">Paid (Warp)</div>
          <div className="mt-1 text-xl font-semibold text-slate-50">{formatUsd(totalPaidUsd)}</div>
        </div>
        <div className="soft-card">
          <div className="text-xs text-slate-500">API-equivalent</div>
          <div className="mt-1 text-xl font-semibold text-slate-50">
            {formatUsd(totalApiEquivalentUsd)}
          </div>
        </div>
        <div className="soft-card">
          <div className="text-xs text-slate-500">Markup</div>
          <div className={`mt-1 text-xl font-semibold ${deltaTone}`}>
            {cheaper ? "−" : "+"}
            {formatPercent(Math.abs(markupPct))}
          </div>
        </div>
      </div>
    </section>
  );
}
