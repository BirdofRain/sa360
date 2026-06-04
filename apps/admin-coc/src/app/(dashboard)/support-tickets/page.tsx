import { SupportTicketsFilters } from "@/components/support/support-tickets-filters";
import { SupportTicketsTable } from "@/components/support/support-tickets-table";
import { StatTile } from "@/components/dashboard/stat-tile";
import { WarningBanner } from "@/components/dashboard/warning-banner";
import {
  fetchAdminSupportTickets,
  fetchAdminSupportTicketStats,
} from "@/lib/admin-api/support-tickets-server";
import { isAdminApiConfigured } from "@/lib/admin-api/server";
import {
  parseSupportTicketsSearchParams,
  supportTicketsQueryToApi,
} from "@/lib/support-tickets/query";

export default async function SupportTicketsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const query = parseSupportTicketsSearchParams(sp);
  const configured = isAdminApiConfigured();
  const apiQuery = supportTicketsQueryToApi(query);

  const [{ items, total, error }, { stats, error: statsError }] = configured
    ? await Promise.all([
        fetchAdminSupportTickets(apiQuery),
        fetchAdminSupportTicketStats(),
      ])
    : [{ items: [], total: 0, error: null }, { stats: null, error: null }];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Support Tickets</h1>
        <p className="mt-1 text-sm text-slate-500">
          Track issues, requests, and operational support items filed from Admin C.O.C.
        </p>
      </div>

      {!configured ? (
        <WarningBanner tone="warn" title="Admin API not configured">
          Set NEXT_PUBLIC_API_BASE_URL and SA360_ADMIN_API_KEY to load support tickets.
        </WarningBanner>
      ) : null}

      {configured && (error || statsError) ? (
        <WarningBanner tone="warn" title="Support tickets unavailable">
          {error ?? statsError}
        </WarningBanner>
      ) : null}

      {stats ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label="Open" value={stats.open} tone="warn" />
          <StatTile label="In progress" value={stats.inProgress} tone="neutral" />
          <StatTile label="Waiting on user" value={stats.waiting} tone="neutral" />
          <StatTile label="Resolved (7d)" value={stats.resolvedRecent} tone="good" />
        </div>
      ) : null}

      <SupportTicketsFilters initial={query} />

      <p className="text-xs text-slate-500">
        {total} ticket{total === 1 ? "" : "s"} · newest first
      </p>

      <SupportTicketsTable items={items} query={query} />
    </div>
  );
}
