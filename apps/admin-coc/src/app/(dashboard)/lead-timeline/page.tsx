import { LeadTimelineView } from "@/components/dashboard/lead-timeline-view";
import { SourceIntakeTraceView } from "@/components/dashboard/source-intake-trace-view";
import { WarningBanner } from "@/components/dashboard/warning-banner";
import {
  fetchAdminLeadTimeline,
  fetchAdminSourceIntakeTrace,
  isAdminApiConfigured,
} from "@/lib/admin-api/server";
import type { LeadTimelineFetchParams } from "@/lib/lead-timeline-query";
import {
  isApplicableSourceIntakeTrace,
  resolveLeadTimelineSurface,
  selectSingleSourceIntakeAnchor,
  shouldUseSourceIntakeTraceFallback,
} from "@/lib/source-intake-trace-fallback";

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

function parseOptionalParam(
  sp: Record<string, string | string[] | undefined>,
  key: string
): string | undefined {
  const v = sp[key];
  return typeof v === "string" ? v : undefined;
}

export default async function LeadTimelinePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const query = parseLeadTimelineSearchParams(sp);
  const configured = isAdminApiConfigured();
  const anchorSelection = selectSingleSourceIntakeAnchor({
    webhookRequestLogId: parseOptionalParam(sp, "webhookRequestLogId"),
    requestId: query.requestId,
    sourceLeadEventId: parseOptionalParam(sp, "sourceLeadEventId"),
    sourceLeadId: parseOptionalParam(sp, "sourceLeadId"),
    sourceLeadUid: parseOptionalParam(sp, "sourceLeadUid"),
  });

  const hasScope =
    Boolean(query.requestId?.trim()) ||
    Boolean(
      query.clientAccountId?.trim() &&
        (query.leadUid?.trim() || query.contactIdGhl?.trim() || query.phoneE164?.trim() || query.email?.trim())
    );

  const timelineResult = hasScope
    ? await fetchAdminLeadTimeline(query)
    : { timeline: null, error: null, errorCode: null, httpStatus: null };

  const directLookup = !hasScope && anchorSelection.kind === "one";
  const wantsFallback =
    hasScope &&
    !timelineResult.timeline &&
    shouldUseSourceIntakeTraceFallback({
      timelineErrorCode: timelineResult.errorCode,
      httpStatus: timelineResult.httpStatus,
    });
  const fetchedTrace =
    configured && anchorSelection.kind === "one" && (directLookup || wantsFallback)
      ? await fetchAdminSourceIntakeTrace(anchorSelection.anchor)
      : { trace: null, error: null };
  const applicableTrace =
    wantsFallback && fetchedTrace.trace && isApplicableSourceIntakeTrace(fetchedTrace.trace)
      ? fetchedTrace.trace
      : null;
  const surface = resolveLeadTimelineSurface({
    timeline: timelineResult.timeline,
    timelineError: timelineResult.error,
    timelineErrorCode: timelineResult.errorCode,
    timelineHttpStatus: timelineResult.httpStatus,
    trace: applicableTrace,
  });
  const visibleTrace = hasScope ? surface.trace : fetchedTrace.trace;
  const visibleError = hasScope ? surface.timelineError : fetchedTrace.error;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Lead timeline</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Chronological story for a client-scoped lead. Normalized NextGen leads without a
          destination client use the read-only source intake trace.
        </p>
      </div>

      {!configured ? (
        <WarningBanner tone="warn" title="Admin API not configured">
          Set NEXT_PUBLIC_API_BASE_URL and SA360_ADMIN_API_KEY to load lead timelines.
        </WarningBanner>
      ) : null}

      {!hasScope && !visibleTrace ? (
        <WarningBanner tone="info" title="Missing scope">
          Open from Webhook Monitor request detail, or pass{" "}
          <span className="font-mono">?requestId=&lt;webhook-log-id&gt;</span> or{" "}
          <span className="font-mono">?clientAccountId=…&amp;leadUid=…</span>.
        </WarningBanner>
      ) : null}

      {configured && anchorSelection.kind === "conflict" ? (
        <WarningBanner tone="warn" title="Conflicting lookup identifiers">
          Provide one source intake identifier. Mixed identifiers are not combined.
        </WarningBanner>
      ) : null}

      {configured && visibleError ? (
        <WarningBanner tone="warn" title="Lead timeline unavailable">
          {visibleError}
        </WarningBanner>
      ) : null}

      {visibleTrace ? <SourceIntakeTraceView trace={visibleTrace} /> : null}

      {timelineResult.timeline ? <LeadTimelineView data={timelineResult.timeline} anchor={query} /> : null}
    </div>
  );
}
