"use client";

import { useMemo } from "react";

import type { AdminWebhookListItem } from "@/lib/admin-api/types";

import { WebhookMonitorTable } from "./webhook-monitor-table";

function filterWebhookItemsBySearch(items: AdminWebhookListItem[], q: string): AdminWebhookListItem[] {
  const t = q.trim().toLowerCase();
  if (!t) return items;
  return items.filter((row) => {
    const parts = [
      row.leadName,
      row.leadFirstName,
      row.leadLastName,
      row.leadPhone,
      row.leadEmail,
      row.eventUuid,
      row.clientAccountId,
    ].filter((x): x is string => typeof x === "string" && x.length > 0);
    return parts.some((p) => p.toLowerCase().includes(t));
  });
}

export function WebhookMonitorView({
  items,
  searchQuery,
  emptyHint,
}: {
  items: AdminWebhookListItem[];
  searchQuery: string;
  emptyHint?: string | null;
}) {
  const filtered = useMemo(
    () => filterWebhookItemsBySearch(items, searchQuery),
    [items, searchQuery]
  );

  const hint =
    filtered.length === 0 && items.length > 0 && searchQuery.trim()
      ? "No rows match your search on this result set."
      : emptyHint;

  return (
    <div className="space-y-2">
      {searchQuery.trim() ? (
        <p className="text-xs text-muted-foreground">
          Search filters the loaded rows below (substring match on lead name, phone, email, event UUID, client id). Up to
          200 rows are loaded from the API per request.
        </p>
      ) : null}
      <WebhookMonitorTable items={filtered} emptyHint={hint} />
    </div>
  );
}
