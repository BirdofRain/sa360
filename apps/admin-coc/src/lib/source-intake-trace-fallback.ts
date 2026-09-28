/**
 * Shared Lead Timeline → source-intake trace decision.
 * The full page and the compact widget both call these functions.
 * Fallback is allowed only for the client-scope resolution failure.
 */

export const LEAD_TIMELINE_SCOPE_UNRESOLVED_CODE = "lead_timeline_scope_unresolved";

export type SourceIntakeTraceAnchor =
  | { webhookRequestLogId: string }
  | { sourceLeadEventId: string }
  | { sourceLeadId: string }
  | { sourceLeadUid: string };

export type SourceIntakeAnchorSelection =
  | { kind: "none" }
  | { kind: "conflict" }
  | { kind: "one"; anchor: SourceIntakeTraceAnchor };

export type SourceIntakeTraceApplicability = {
  webhookRequestLog: { source: string } | null;
  sourceLeadEvent: { sourceProvider: string } | null;
};

const GHL_TIMELINE_SOURCES = new Set(["ghl_lifecycle", "synthflow_inbound_lookup"]);

function trim(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Timeline `requestId` is the webhook log id. At most one anchor is returned.
 * Distinct identifiers are a conflict and are not reduced to a single lookup.
 */
export function selectSingleSourceIntakeAnchor(input: {
  webhookRequestLogId?: string;
  requestId?: string;
  sourceLeadEventId?: string;
  sourceLeadId?: string;
  sourceLeadUid?: string;
}): SourceIntakeAnchorSelection {
  const webhookRequestLogId = trim(input.webhookRequestLogId);
  const requestId = trim(input.requestId);
  const sourceLeadEventId = trim(input.sourceLeadEventId);
  const sourceLeadId = trim(input.sourceLeadId);
  const sourceLeadUid = trim(input.sourceLeadUid);

  const anchors: SourceIntakeTraceAnchor[] = [];
  if (webhookRequestLogId) anchors.push({ webhookRequestLogId });
  if (requestId && requestId !== webhookRequestLogId) anchors.push({ webhookRequestLogId: requestId });
  if (sourceLeadEventId) anchors.push({ sourceLeadEventId });
  if (sourceLeadId) anchors.push({ sourceLeadId });
  if (sourceLeadUid) anchors.push({ sourceLeadUid });

  if (anchors.length === 0) return { kind: "none" };
  if (anchors.length > 1) return { kind: "conflict" };
  return { kind: "one", anchor: anchors[0]! };
}

export function shouldUseSourceIntakeTraceFallback(input: {
  timelineErrorCode: string | null | undefined;
  httpStatus: number | null | undefined;
}): boolean {
  if (input.httpStatus !== 400) return false;
  return input.timelineErrorCode === LEAD_TIMELINE_SCOPE_UNRESOLVED_CODE;
}

export function isApplicableSourceIntakeTrace(trace: SourceIntakeTraceApplicability): boolean {
  const source = trace.webhookRequestLog?.source ?? null;
  if (source && GHL_TIMELINE_SOURCES.has(source)) return false;
  if (trace.sourceLeadEvent?.sourceProvider === "leadcapture_io") return true;
  if (source === "leadcapture_io") return true;
  return Boolean(trace.sourceLeadEvent) && source !== "ghl_lifecycle";
}

export function resolveLeadTimelineSurface<TTimeline, TTrace extends SourceIntakeTraceApplicability>(input: {
  timeline: TTimeline | null;
  timelineError: string | null;
  timelineErrorCode: string | null;
  timelineHttpStatus: number | null;
  trace: TTrace | null;
}): { timelineError: string | null; trace: TTrace | null } {
  if (input.timeline) return { timelineError: null, trace: null };
  const allow = shouldUseSourceIntakeTraceFallback({
    timelineErrorCode: input.timelineErrorCode,
    httpStatus: input.timelineHttpStatus,
  });
  if (allow && input.trace && isApplicableSourceIntakeTrace(input.trace)) {
    return { timelineError: null, trace: input.trace };
  }
  return { timelineError: input.timelineError, trace: null };
}
