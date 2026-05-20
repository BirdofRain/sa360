import type { ClientPortalRangeKey } from "./types.ts";

const RANGE_KEYS: ClientPortalRangeKey[] = ["7d", "30d", "mtd"];

export function parseClientPortalRange(raw: string | undefined): ClientPortalRangeKey {
  const v = raw?.trim().toLowerCase();
  if (v && RANGE_KEYS.includes(v as ClientPortalRangeKey)) {
    return v as ClientPortalRangeKey;
  }
  return "7d";
}

export function rangeLabel(key: ClientPortalRangeKey): string {
  switch (key) {
    case "7d":
      return "Last 7 days";
    case "30d":
      return "Last 30 days";
    case "mtd":
      return "Month to date";
    default:
      return "Last 7 days";
  }
}

export function resolveRangeBounds(key: ClientPortalRangeKey, now = new Date()): { from: Date; to: Date } {
  const to = new Date(now);
  to.setHours(23, 59, 59, 999);

  const from = new Date(now);
  from.setHours(0, 0, 0, 0);

  if (key === "7d") {
    from.setDate(from.getDate() - 6);
    return { from, to };
  }

  if (key === "30d") {
    from.setDate(from.getDate() - 29);
    return { from, to };
  }

  from.setDate(1);
  return { from, to };
}
