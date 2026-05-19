import { LeadTimelineView } from "@/components/dashboard/lead-timeline-view";
import { WarningBanner } from "@/components/dashboard/warning-banner";
import { fetchAdminLeadTimeline, isAdminApiConfigured } from "@/lib/admin-api/server";
import type { LeadTimelineFetchParams } from "@/lib/lead-timeline-query";

function parseLeadTimelineSearchParams(
  sp: Record<string, string | string[] | undefined>
): LeadTimelineFetchParams {
  const one = (key: string) => {
    const v = sp[key];
    return typeof v === "string" ? v : undefined;
  };
  return {
    clientAccountId: one("clientAccountId"),
    subaccountIdGhl: one("subaccountIdGhl"),
    leadUid: one("leadUid"),
    contactIdGhl: one("contactIdGhl"),
    phoneE164: one("phoneE164"),
    email: one("email"),
    requestId: one("requestId"),
    sort: one("sort") === "desc" ? "desc" : "asc",
    limit: one("limit") ? Number(one("limit")) : 200,
  };
}

export default async function LeadTimelinePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const query = parseLeadTimelineSearchParams(sp);
  const configured = isAdminApiConfigured();

  const hasScope =
    Boolean(query.requestId?.trim()) ||
    Boolean(
      query.clientAccountId?.trim() &&
        (query.leadUid?.trim() || query.contactIdGhl?.trim() || query.phoneE164?.trim() || query.email?.trim())
    );

  const { timeline, error } = hasScope
    ? await fetchAdminLeadTimeline(query)
    : { timeline: null, error: null };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Lead timeline</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Chronological story for a lead across lifecycle webhooks, Synthflow, and agent actions.
        </p>
      </div>

      {!configured ? (
        <WarningBanner tone="warn" title="Admin API not configured">
          Set NEXT_PUBLIC_API_BASE_URL and SA360_ADMIN_API_KEY to load lead timelines.
        </WarningBanner>
      ) : null}

      {!hasScope ? (
        <WarningBanner tone="info" title="Missing scope">
          Open from Webhook Monitor request detail, or pass{" "}
          <span className="font-mono">?requestId=&lt;webhook-log-id&gt;</span> or{" "}
          <span className="font-mono">?clientAccountId=…&amp;leadUid=…</span>.
        </WarningBanner>
      ) : null}

      {configured && error ? (
        <WarningBanner tone="warn" title="Lead timeline unavailable">
          {error}
        </WarningBanner>
      ) : null}

      {timeline ? <LeadTimelineView data={timeline} anchor={query} /> : null}
    </div>
  );
}
