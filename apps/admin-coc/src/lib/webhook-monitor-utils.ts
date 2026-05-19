import type { AdminWebhookListItem } from "@/lib/admin-api/types";

/** Rows where the payload never passed validation or auth — matches API processingStatus values. */
export function isInvalidWebhookRow(processingStatus: string): boolean {
  const s = processingStatus.trim().toLowerCase();
  return s === "unauthorized" || s === "validation_failed";
}

/** Rows hidden when “Hide errors” is enabled. */
export function isWebhookErrorRow(processingStatus: string): boolean {
  const s = processingStatus.trim().toLowerCase();
  if (s === "unauthorized" || s === "validation_failed" || s === "failed" || s === "error") {
    return true;
  }
  return s.includes("fail") || s.includes("error");
}

/** Stored / valid chip — not an error row. */
export function isWebhookStoredValidRow(processingStatus: string): boolean {
  return !isWebhookErrorRow(processingStatus);
}

export type WebhookReceivedAtSort = "asc" | "desc";

export function sortWebhookRowsByReceivedAt(
  items: AdminWebhookListItem[],
  direction: WebhookReceivedAtSort = "desc"
): AdminWebhookListItem[] {
  const mult = direction === "desc" ? -1 : 1;
  return [...items].sort((a, b) => {
    const ta = new Date(a.receivedAt).getTime();
    const tb = new Date(b.receivedAt).getTime();
    if (ta !== tb) return (ta - tb) * mult;
    return a.id.localeCompare(b.id) * mult;
  });
}

export function filterWebhookRowsHideErrors(items: AdminWebhookListItem[]): AdminWebhookListItem[] {
  return items.filter((row) => !isWebhookErrorRow(row.processingStatus));
}

export type WebhookQuickChip =
  | "all"
  | "stored"
  | "errors"
  | "unauthorized"
  | "validation_failed"
  | "last15m"
  | "last1h";

export function filterWebhookRowsByChip(
  items: AdminWebhookListItem[],
  chip: WebhookQuickChip | undefined
): AdminWebhookListItem[] {
  if (!chip || chip === "all" || chip === "last15m" || chip === "last1h") {
    return items;
  }
  if (chip === "stored") {
    return items.filter((row) => isWebhookStoredValidRow(row.processingStatus));
  }
  if (chip === "errors") {
    return items.filter((row) => isWebhookErrorRow(row.processingStatus));
  }
  if (chip === "unauthorized") {
    return items.filter((row) => row.processingStatus.trim().toLowerCase() === "unauthorized");
  }
  if (chip === "validation_failed") {
    return items.filter((row) => row.processingStatus.trim().toLowerCase() === "validation_failed");
  }
  return items;
}

export function receivedAtFromMinutesAgo(minutes: number, now = new Date()): string {
  return new Date(now.getTime() - minutes * 60_000).toISOString();
}
