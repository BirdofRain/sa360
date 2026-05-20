import type { ClientPortalActivityKind, ClientPortalDashboard } from "./types.ts";
import { getClientPortalDisplayName, getClientPortalLocationLabel } from "./config.ts";
import type { ClientPortalRangeKey } from "./types.ts";

/** Phase 2: normalize API payload + apply display env overrides. */
export function mapClientPortalDashboard(
  raw: ClientPortalDashboard,
  opts?: { displayName?: string; locationLabel?: string | null }
): ClientPortalDashboard {
  const rangeKey = (raw.range.key as ClientPortalRangeKey) || "7d";

  return {
    ...raw,
    range: {
      ...raw.range,
      key: rangeKey,
    },
    client: {
      displayName: opts?.displayName?.trim() || raw.client.displayName || getClientPortalDisplayName(),
      locationLabel:
        opts?.locationLabel !== undefined
          ? opts.locationLabel
          : getClientPortalLocationLabel() ?? raw.client.locationLabel ?? null,
    },
    funnel: {
      ...raw.funnel,
      conversion: { ...raw.funnel.conversion },
    },
    recentActivity: raw.recentActivity.map((item) => ({
      ...item,
      kind: item.kind as ClientPortalActivityKind,
    })),
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
