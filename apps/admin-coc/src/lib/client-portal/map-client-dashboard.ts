import type { ClientPortalDashboard } from "./types.ts";

/** Phase 1: identity mapper; Phase 2 may normalize API payloads here. */
export function mapClientPortalDashboard(raw: ClientPortalDashboard): ClientPortalDashboard {
  return {
    ...raw,
    funnel: {
      ...raw.funnel,
      conversion: { ...raw.funnel.conversion },
    },
    recentActivity: raw.recentActivity.map((item) => ({ ...item })),
    appointmentsNeedingAttention: raw.appointmentsNeedingAttention.map((item) => ({
      ...item,
    })),
    leadSources: raw.leadSources.map((row) => ({ ...row })),
  };
}

export function formatPercent(rate: number): string {
  if (!Number.isFinite(rate) || rate <= 0) return "0%";
  return `${Math.round(rate * 100)}%`;
}

export function formatRelativeTime(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const diffMs = now.getTime() - d.getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
