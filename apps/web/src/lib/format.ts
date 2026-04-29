import type { Severity, TraceStatus } from "../api/client";

export function formatUsd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatInt(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

export function formatCompactInt(value: number): string {
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }

  if (absolute >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  }

  return formatInt(value);
}

export function formatPercent(value: number): string {
  return `${value.toFixed(value >= 10 ? 0 : 1)}%`;
}

export function formatDateTime(value?: string | null): string {
  if (!value) {
    return "Never";
  }

  const date = new Date(value);
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function formatRelativeTime(value?: string | null): string {
  if (!value) {
    return "Never";
  }

  const diffMs = new Date(value).getTime() - Date.now();
  const diffMinutes = Math.round(diffMs / 60000);
  const formatter = new Intl.RelativeTimeFormat("en-US", { numeric: "auto" });

  if (Math.abs(diffMinutes) < 60) {
    return formatter.format(diffMinutes, "minute");
  }

  const diffHours = Math.round(diffMinutes / 60);
  if (Math.abs(diffHours) < 48) {
    return formatter.format(diffHours, "hour");
  }

  const diffDays = Math.round(diffHours / 24);
  return formatter.format(diffDays, "day");
}

export function formatBytes(value: number): string {
  if (value < 1024) {
    return `${value} B`;
  }

  const units = ["KB", "MB", "GB"];
  let amount = value / 1024;
  let index = 0;

  while (amount >= 1024 && index < units.length - 1) {
    amount /= 1024;
    index += 1;
  }

  return `${amount.toFixed(1)} ${units[index]}`;
}

export function formatDurationMs(value?: number | null): string {
  if (value === undefined || value === null || Number.isNaN(value)) {
    return "Unknown";
  }

  if (value < 60_000) {
    return `${Math.max(1, Math.round(value / 1000))}s`;
  }

  const totalMinutes = Math.round(value / 60_000);
  if (totalMinutes < 60) {
    return `${totalMinutes}m`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
}

export function traceLabel(externalId?: string, fallbackId?: string): string {
  if (externalId && externalId.length > 0) {
    return externalId;
  }

  if (!fallbackId) {
    return "unknown-trace";
  }

  return fallbackId.length > 16 ? fallbackId.slice(-16) : fallbackId;
}

export function formatCategoryLabel(category: string): string {
  switch (category) {
    case "tool_failure_waste":
      return "tool failures";
    case "retry_waste":
      return "retry patterns";
    case "low_cache_utilization":
      return "low cache";
    case "high_output":
      return "high output";
    case "agent_loop":
      return "agent loops";
    case "model_overuse":
      return "model insight";
    case "cache_expiry":
      return "cache expiry";
    default:
      return category.replaceAll("_", " ");
  }
}

export function statusClasses(status: TraceStatus | "ok"): string {
  switch (status) {
    case "error":
      return "border border-red-500/40 bg-red-500/10 text-red-200";
    case "partial":
      return "border border-yellow-500/40 bg-yellow-500/10 text-yellow-100";
    default:
      return "border border-emerald-500/40 bg-emerald-500/10 text-emerald-200";
  }
}

export function severityClasses(severity: Severity): string {
  switch (severity) {
    case "critical":
      return "bg-red-500";
    case "high":
      return "bg-yellow-400";
    case "medium":
      return "bg-blue-400";
    default:
      return "bg-slate-400";
  }
}
