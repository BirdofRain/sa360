import {
  portalLeadsContinuation,
  type PortalLeadListFilters,
  type PortalLeadListStatus,
} from "@/lib/client-portal/portal-lead-list-status";
import type { PortalLeadView } from "@/lib/client-portal/map-client-leads";

import { PortalLeadsContinuation } from "./portal-leads-continuation";
import { PortalLeadsList } from "./portal-leads-list";

/**
 * The leads page body after a tenant-scoped read. The cursor link keeps the
 * current status, search, and dates. An empty page with a cursor is not the
 * final empty state.
 */
export function PortalLeadsResults({
  statusFilter,
  filters,
  leads,
  nextCursor,
}: {
  statusFilter: PortalLeadListStatus;
  filters?: PortalLeadListFilters;
  leads: PortalLeadView[];
  nextCursor: string | null;
}) {
  const continuation = portalLeadsContinuation({
    status: statusFilter,
    filters,
    itemCount: leads.length,
    nextCursor,
  });
  const showFinalEmpty = leads.length === 0 && !continuation;

  return (
    <div className="space-y-3">
      {showFinalEmpty ? <PortalLeadsList leads={[]} statusFilter={statusFilter} /> : null}
      {leads.length > 0 ? <PortalLeadsList leads={leads} statusFilter={statusFilter} /> : null}
      {continuation ? (
        <PortalLeadsContinuation href={continuation.href} label={continuation.label} />
      ) : null}
    </div>
  );
}
