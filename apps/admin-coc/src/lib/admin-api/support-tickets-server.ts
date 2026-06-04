import "server-only";

import {
  adminFetchJson,
  adminRequestJson,
} from "@/lib/admin-api/server";
import type {
  SupportTicketCreateInput,
  SupportTicketDetail,
  SupportTicketListQuery,
  SupportTicketStats,
  SupportTicketSummary,
  SupportTicketUpdateInput,
} from "@/lib/support-tickets/types";

function formatError(err: { status: number; body: string }): string {
  if (err.status === 0) return err.body;
  const snippet = err.body.length > 280 ? `${err.body.slice(0, 280)}…` : err.body;
  return err.status ? `Admin API ${err.status}: ${snippet}` : snippet;
}

function supportTicketListQueryString(q: SupportTicketListQuery): string {
  const params = new URLSearchParams();
  if (q.status && q.status !== "all") params.set("status", q.status);
  if (q.priority && q.priority !== "all") params.set("priority", q.priority);
  if (q.category && q.category !== "all") params.set("category", q.category);
  if (q.search?.trim()) params.set("search", q.search.trim());
  if (q.page) params.set("page", String(q.page));
  if (q.limit) params.set("limit", String(q.limit));
  const s = params.toString();
  return s ? `?${s}` : "";
}

export async function fetchAdminSupportTicketStats(): Promise<{
  stats: SupportTicketStats | null;
  error: string | null;
}> {
  const res = await adminFetchJson<{ ok: boolean; stats: SupportTicketStats }>(
    "/admin/v1/support-tickets/stats"
  );
  if (!res.ok) return { stats: null, error: formatError(res) };
  return { stats: res.data.stats, error: null };
}

export async function fetchAdminSupportTickets(
  query: SupportTicketListQuery = {}
): Promise<{ items: SupportTicketSummary[]; total: number; error: string | null }> {
  const res = await adminFetchJson<{
    ok: boolean;
    items: SupportTicketSummary[];
    total: number;
  }>(`/admin/v1/support-tickets${supportTicketListQueryString(query)}`);
  if (!res.ok) return { items: [], total: 0, error: formatError(res) };
  return { items: res.data.items ?? [], total: res.data.total ?? 0, error: null };
}

export async function fetchAdminSupportTicketById(
  id: string
): Promise<{ ticket: SupportTicketDetail | null; error: string | null }> {
  const trimmed = id.trim();
  if (!trimmed) return { ticket: null, error: "Missing ticket id" };
  const res = await adminFetchJson<{ ok: boolean; ticket: SupportTicketDetail }>(
    `/admin/v1/support-tickets/${encodeURIComponent(trimmed)}`
  );
  if (!res.ok) return { ticket: null, error: formatError(res) };
  return { ticket: res.data.ticket, error: null };
}

export async function createAdminSupportTicket(
  body: SupportTicketCreateInput
): Promise<{
  ok: boolean;
  ticket: { id: string; ticketNumber: number } | null;
  error: string | null;
}> {
  const res = await adminRequestJson<{
    ok: boolean;
    ticket: { id: string; ticketNumber: number };
  }>("POST", "/admin/v1/support-tickets", body);
  if (!res.ok) return { ok: false, ticket: null, error: formatError(res) };
  return { ok: true, ticket: res.data.ticket, error: null };
}

export async function updateAdminSupportTicket(
  id: string,
  body: SupportTicketUpdateInput
): Promise<{ ok: boolean; ticket: SupportTicketDetail | null; error: string | null }> {
  const trimmed = id.trim();
  if (!trimmed) return { ok: false, ticket: null, error: "Missing ticket id" };
  const res = await adminRequestJson<{ ok: boolean; ticket: SupportTicketDetail }>(
    "PATCH",
    `/admin/v1/support-tickets/${encodeURIComponent(trimmed)}`,
    body
  );
  if (!res.ok) return { ok: false, ticket: null, error: formatError(res) };
  return { ok: true, ticket: res.data.ticket, error: null };
}
