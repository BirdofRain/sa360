"use client";

import { useRouter } from "next/navigation";
import { useMemo } from "react";

import type { AdminWebhookListItem } from "@/lib/admin-api/types";
import { webhookMonitorHref, type WebhookMonitorUrlQuery } from "@/lib/webhook-monitor-query";
import {
  filterWebhookRowsByChip,
  filterWebhookRowsHideErrors,
  sortWebhookRowsByReceivedAt,
} from "@/lib/webhook-monitor-utils";

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
  query,
  emptyHint,
}: {
  items: AdminWebhookListItem[];
  query: WebhookMonitorUrlQuery;
  emptyHint?: string | null;
}) {
  const router = useRouter();
  const searchQuery = query.q ?? "";
  const sort = query.sort ?? "desc";

  function toggleSort() {
    const next = sort === "desc" ? "asc" : "desc";
    router.push(webhookMonitorHref(query, { sort: next }));
  }

  const displayItems = useMemo(() => {
    let rows = items;
    if (query.hideErrors) rows = filterWebhookRowsHideErrors(rows);
    rows = filterWebhookRowsByChip(rows, query.chip);
    rows = filterWebhookItemsBySearch(rows, searchQuery);
    return sortWebhookRowsByReceivedAt(rows, sort);
  }, [items, query.chip, query.hideErrors, sort, searchQuery]);

  const hint =
    displayItems.length === 0 && items.length > 0 && (searchQuery.trim() || query.hideErrors || query.chip !== "all")
      ? "No rows match your filters on this result set."
      : emptyHint;

  return (
    <div className="space-y-2">
      {searchQuery.trim() ? (
        <p className="text-xs text-muted-foreground">
          Search filters the loaded rows below (substring match on lead name, phone, email, event UUID, client id). Up to
          200 rows are loaded from the API per request.
        </p>
      ) : null}
      <p className="text-xs text-muted-foreground">
        Sorted by received time ({sort === "desc" ? "newest first" : "oldest first"}). Invalid rows stay highlighted but
        are not pinned above newer requests.
      </p>
      <WebhookMonitorTable
        items={displayItems}
        sortDirection={sort}
        onToggleSort={toggleSort}
        emptyHint={hint}
      />
    </div>
  );
}

