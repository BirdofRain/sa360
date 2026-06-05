import type { SupportTicketListQuery, SupportTicketStatus } from "@/lib/support-tickets/types";

function firstString(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}

const STATUSES = new Set([
  "OPEN",
  "IN_PROGRESS",
  "WAITING_ON_USER",
  "RESOLVED",
  "CLOSED",
]);

export function parseSupportTicketsSearchParams(
  sp: Record<string, string | string[] | undefined>
): SupportTicketListQuery {
  const statusRaw = firstString(sp.status);
  const priorityRaw = firstString(sp.priority);
  const categoryRaw = firstString(sp.category);
  return {
    status:
      statusRaw && STATUSES.has(statusRaw)
        ? (statusRaw as SupportTicketStatus)
        : "all",
    priority:
      priorityRaw === "LOW" ||
      priorityRaw === "NORMAL" ||
      priorityRaw === "HIGH" ||
      priorityRaw === "URGENT"
        ? priorityRaw
        : "all",
    category:
      categoryRaw && categoryRaw !== "all" ? (categoryRaw as SupportTicketListQuery["category"]) : "all",
    search: firstString(sp.search)?.trim() || undefined,
    page: Number(firstString(sp.page)) || 1,
    limit: 25,
  };
}

export function supportTicketsQueryToApi(q: SupportTicketListQuery): SupportTicketListQuery {
  return {
    status: q.status === "all" ? undefined : q.status,
    priority: q.priority === "all" ? undefined : q.priority,
    category: q.category === "all" ? undefined : q.category,
    search: q.search,
    page: q.page,
    limit: q.limit,
  };
}
