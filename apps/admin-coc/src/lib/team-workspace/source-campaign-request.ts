/**
 * Read and present a source/campaign association request.
 * The request row is not a source confirmation and not a routing rule.
 */

import { normalizeLeadCaptureParentUrl } from "@/lib/clients/leadcapture-page-url";
import type { ClientSetupData } from "@/lib/clients/types";

import { isNativeClientSetupEnabled } from "../clients/native-client-setup-env";
import { isTeamWorkspaceEnabled, isTeamWorkspaceServerEnabled } from "./config";
import { isSourceCampaignRequestEnabled } from "./source-campaign-request-env";
import type { SourceCampaignReviewView } from "./source-campaign-review";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type SourceCampaignRequestFlagReason =
  | "team_workspace"
  | "team_workspace_server"
  | "native_setup"
  | "request_flag"
  | "workspace_api";

export type SourceCampaignOpenRequest = {
  requestId: string;
  status: "requested";
  revision: number;
  setupRevision: number;
  providerFunnelId: string | null;
  parentUrlKey: string | null;
  providerCampaignId: string;
  requestedAssociation: true;
  createdAt: string;
};

export type SourceCampaignRequestView =
  | { availability: "disabled"; reason: SourceCampaignRequestFlagReason; message: string }
  | { availability: "error"; message: string }
  | { availability: "ready"; revision: number; openRequest: SourceCampaignOpenRequest | null };

export type SavedSourceEcho = {
  providerFunnelId: string | null;
  parentUrlKey: string | null;
  providerCampaignId: string | null;
  complete: boolean;
};

export type RequestProgressStep = {
  id: "draft_saved" | "source_reviewed" | "request_submitted" | "awaiting_review";
  label: string;
  state: "complete" | "current" | "waiting";
  detail: string;
};

const FLAG_MESSAGES: Record<SourceCampaignRequestFlagReason, string> = {
  team_workspace: "Team Workspace is turned off. A source and campaign request cannot be loaded.",
  team_workspace_server: "The Team Workspace server flag is off. A source and campaign request cannot be loaded.",
  native_setup: "Native client setup is turned off. A source and campaign request cannot be loaded.",
  request_flag: "Formal source and campaign requests are turned off. The check above is still a read.",
  workspace_api: "Team Workspace is turned off on the API. A source and campaign request was not loaded.",
};

export function sourceCampaignRequestBlockedReason(): SourceCampaignRequestFlagReason | null {
  if (!isTeamWorkspaceEnabled()) return "team_workspace";
  if (!isTeamWorkspaceServerEnabled()) return "team_workspace_server";
  if (!isNativeClientSetupEnabled()) return "native_setup";
  if (!isSourceCampaignRequestEnabled()) return "request_flag";
  return null;
}

export function disabledSourceCampaignRequest(
  reason: SourceCampaignRequestFlagReason
): Extract<SourceCampaignRequestView, { availability: "disabled" }> {
  return { availability: "disabled", reason, message: FLAG_MESSAGES[reason] };
}

export function sourceCampaignRequestPath(clientAccountId: string): string {
  return `/admin/v1/clients/${encodeURIComponent(clientAccountId)}/source-campaign-requests`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function revisionOf(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return null;
  return value;
}

function nullableId(value: unknown, max: number): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > max) return undefined;
  return trimmed;
}

function boundaryClosed(value: Record<string, unknown>): boolean {
  return (
    value.associationApplied === false &&
    value.routingRuleApplied === false &&
    value.deliveryArmed === false &&
    value.confirmedOperationalAssociation === false
  );
}

function timestamp(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

export function parseSourceCampaignRequestHead(value: unknown): SourceCampaignRequestView | null {
  if (!isRecord(value) || value.ok !== true || !boundaryClosed(value)) return null;
  const revision = revisionOf(value.revision);
  if (revision === null || typeof value.clientAccountId !== "string") return null;
  if (value.openRequest === null) return { availability: "ready", revision, openRequest: null };
  if (!isRecord(value.openRequest)) return null;
  const open = value.openRequest;
  const requestId = typeof open.requestId === "string" && UUID.test(open.requestId) ? open.requestId : null;
  const openRevision = revisionOf(open.revision);
  const setupRevision = revisionOf(open.setupRevision);
  const providerFunnelId = nullableId(open.providerFunnelId, 200);
  const parentUrlKey = nullableId(open.parentUrlKey, 500);
  const providerCampaignId = nullableId(open.providerCampaignId, 200);
  const createdAt = timestamp(open.createdAt);
  if (
    !requestId ||
    open.status !== "requested" ||
    open.requestedAssociation !== true ||
    openRevision === null ||
    setupRevision === null ||
    openRevision !== revision ||
    providerFunnelId === undefined ||
    parentUrlKey === undefined ||
    !providerCampaignId ||
    !createdAt
  ) {
    return null;
  }
  return {
    availability: "ready",
    revision,
    openRequest: {
      requestId,
      status: "requested",
      revision: openRevision,
      setupRevision,
      providerFunnelId,
      parentUrlKey,
      providerCampaignId,
      requestedAssociation: true,
      createdAt,
    },
  };
}

export type StoredSourceCampaignRequest = {
  ok: boolean;
  replayed: boolean;
  status: "requested" | "rejected";
  error: string | null;
  requestId: string;
  associationRequestId: string;
  revision: number;
  setupRevision: number | null;
  providerFunnelId: string | null;
  parentUrlKey: string | null;
  providerCampaignId: string | null;
  requestedAssociation: boolean;
  dispositionReason: string | null;
  supersededRequestId: string | null;
};

function optionalNullableId(value: unknown, max: number): string | null | undefined {
  if (value === undefined) return null;
  return nullableId(value, max);
}

/**
 * A stored 200 includes the identifier snapshot.
 * A stored 409 rejection includes status, revision, and the error code.
 * The route omits the identifier snapshot on that 409.
 */
export function parseStoredSourceCampaignRequest(value: unknown): StoredSourceCampaignRequest | null {
  if (!isRecord(value) || (value.ok !== true && value.ok !== false) || !boundaryClosed(value)) return null;
  if (value.status !== "requested" && value.status !== "rejected") return null;
  if (typeof value.requestId !== "string" || !UUID.test(value.requestId)) return null;
  if (typeof value.associationRequestId !== "string" || !UUID.test(value.associationRequestId)) return null;
  if (value.replayed !== true && value.replayed !== false) return null;
  const revision = revisionOf(value.revision);
  if (revision === null) return null;
  const requestedAssociation = value.status === "requested";
  if (value.requestedAssociation !== undefined && value.requestedAssociation !== requestedAssociation) return null;

  if (value.ok === false) {
    if (value.status !== "rejected" || typeof value.error !== "string" || !/^[a-z0-9_]{1,64}$/.test(value.error)) return null;
    return {
      ok: false,
      replayed: value.replayed,
      status: "rejected",
      error: value.error,
      requestId: value.requestId,
      associationRequestId: value.associationRequestId,
      revision,
      setupRevision: revisionOf(value.setupRevision),
      providerFunnelId: optionalNullableId(value.providerFunnelId, 200) ?? null,
      parentUrlKey: optionalNullableId(value.parentUrlKey, 500) ?? null,
      providerCampaignId: optionalNullableId(value.providerCampaignId, 200) ?? null,
      requestedAssociation: false,
      dispositionReason: optionalNullableId(value.dispositionReason, 80) ?? null,
      supersededRequestId: null,
    };
  }

  const setupRevision = revisionOf(value.setupRevision);
  const providerFunnelId = nullableId(value.providerFunnelId, 200);
  const parentUrlKey = nullableId(value.parentUrlKey, 500);
  const providerCampaignId = nullableId(value.providerCampaignId, 200);
  const dispositionReason = optionalNullableId(value.dispositionReason, 80);
  const supersededRaw = value.supersededRequestId === undefined ? null : nullableId(value.supersededRequestId, 80);
  if (
    setupRevision === null ||
    providerFunnelId === undefined ||
    parentUrlKey === undefined ||
    !providerCampaignId ||
    dispositionReason === undefined ||
    supersededRaw === undefined
  ) {
    return null;
  }
  if (value.error !== undefined && value.error !== null) return null;
  const supersededRequestId = typeof supersededRaw === "string" && UUID.test(supersededRaw) ? supersededRaw : null;
  if (typeof supersededRaw === "string" && !UUID.test(supersededRaw)) return null;
  return {
    ok: true,
    replayed: value.replayed,
    status: value.status,
    error: null,
    requestId: value.requestId,
    associationRequestId: value.associationRequestId,
    revision,
    setupRevision,
    providerFunnelId,
    parentUrlKey,
    providerCampaignId,
    requestedAssociation,
    dispositionReason,
    supersededRequestId,
  };
}

export function readUnstoredRequestError(value: unknown): string | null {
  if (!isRecord(value) || value.ok !== false || typeof value.error !== "string") return null;
  if (!/^[a-z0-9_]{1,64}$/.test(value.error)) return null;
  if (value.status === "rejected" && revisionOf(value.revision) !== null) return null;
  return value.error;
}

export function echoSavedSourceCampaignIdentity(data: ClientSetupData | null | undefined): SavedSourceEcho | null {
  if (!data) return null;
  const funnelId = typeof data.providerFunnelId === "string" ? data.providerFunnelId.trim() : "";
  const campaignId = typeof data.providerCampaignId === "string" ? data.providerCampaignId.trim() : "";
  if (funnelId.length > 200 || campaignId.length > 200) return null;
  const fromUrl = normalizeLeadCaptureParentUrl(data.nextgenFunnelUrl);
  const fromFunnelUrl =
    funnelId.startsWith("http://") || funnelId.startsWith("https://") ? normalizeLeadCaptureParentUrl(funnelId) : null;
  const parentUrlKey = fromUrl?.parentUrlKey ?? fromFunnelUrl?.parentUrlKey ?? "";
  if (parentUrlKey.length > 500) return null;
  const providerFunnelId = (fromFunnelUrl && !fromUrl ? "" : funnelId) || null;
  const parent = parentUrlKey || null;
  const providerCampaignId = campaignId || null;
  return {
    providerFunnelId,
    parentUrlKey: parent,
    providerCampaignId,
    complete: Boolean((providerFunnelId || parent) && providerCampaignId),
  };
}

export function draftMatchesSavedSetup(
  draft: { providerFunnelId: string; providerCampaignId: string },
  data: ClientSetupData | null | undefined
): boolean {
  const savedFunnel = typeof data?.providerFunnelId === "string" ? data.providerFunnelId.trim() : "";
  const savedCampaign = typeof data?.providerCampaignId === "string" ? data.providerCampaignId.trim() : "";
  return draft.providerFunnelId.trim() === savedFunnel && draft.providerCampaignId.trim() === savedCampaign;
}

function reviewTrustworthy(review: SourceCampaignReviewView | null | undefined, setupRevision: number | null): boolean {
  if (!review || setupRevision === null) return false;
  const ready = review.availability === "ready" && (review.disposition === "saved_request" || review.disposition === "incomplete");
  return ready && review.revision === setupRevision;
}

function sameIdentity(echo: SavedSourceEcho, open: SourceCampaignOpenRequest): boolean {
  return (
    echo.providerFunnelId === open.providerFunnelId &&
    echo.parentUrlKey === open.parentUrlKey &&
    echo.providerCampaignId === open.providerCampaignId
  );
}

export function presentSourceCampaignRequestProgress(input: {
  setupReadable: boolean;
  setupRevision: number | null;
  draftMatchesSaved: boolean;
  echo: SavedSourceEcho | null;
  review: SourceCampaignReviewView | null | undefined;
  request: SourceCampaignRequestView;
}): RequestProgressStep[] {
  const echo = input.echo;
  const savedMatches = input.setupReadable && input.draftMatchesSaved && input.setupRevision !== null;
  const identifiersSaved = savedMatches && Boolean(echo?.complete);
  const reviewReady = savedMatches && reviewTrustworthy(input.review, input.setupRevision);
  const reviewed = identifiersSaved && reviewReady;
  const open = input.request.availability === "ready" ? input.request.openRequest : null;
  const submitted =
    identifiersSaved &&
    Boolean(open) &&
    open?.setupRevision === input.setupRevision &&
    echo !== null &&
    open !== null &&
    sameIdentity(echo, open);

  const draftDetail = !input.setupReadable
    ? "No readable setup draft is saved yet."
    : !input.draftMatchesSaved
      ? "Save the onboarding draft before submitting. The form has edits that are not saved."
      : echo?.complete
        ? `Setup revision ${input.setupRevision} is saved.`
        : "The saved draft is missing a funnel id or page URL, or a campaign id.";

  const reviewDetail = reviewed
    ? "The saved draft was checked against source and campaign records."
    : reviewReady
      ? "The source check ran. A proposal still needs a saved funnel id or page URL, and a campaign id."
      : input.request.availability === "disabled"
        ? input.request.message
        : "The source check has not been read for this saved draft.";

  let submittedDetail = "No open proposal is stored for this saved draft.";
  if (input.request.availability === "disabled" || input.request.availability === "error") {
    submittedDetail = input.request.message;
  } else if (open && !submitted) {
    submittedDetail = "An open proposal is stored for a different saved draft. Reload after saving if you need to replace it.";
  } else if (submitted && open) {
    submittedDetail = `Proposal ${open.status} at request revision ${open.revision}.`;
  }

  const waitingDetail = submitted
    ? "Awaiting operational review."
    : "Operational review starts after a proposal is stored.";

  return [
    { id: "draft_saved", label: "Draft saved", state: identifiersSaved ? "complete" : "current", detail: draftDetail },
    {
      id: "source_reviewed",
      label: "Source reviewed",
      state: reviewed ? "complete" : identifiersSaved ? "current" : "waiting",
      detail: reviewDetail,
    },
    {
      id: "request_submitted",
      label: "Request submitted",
      state: submitted ? "complete" : reviewed ? "current" : "waiting",
      detail: submittedDetail,
    },
    {
      id: "awaiting_review",
      label: "Awaiting operational review",
      state: submitted ? "current" : "waiting",
      detail: waitingDetail,
    },
  ];
}

export function formatRequestTimestamp(iso: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

export function unstoredRequestMessage(code: string): string {
  switch (code) {
    case "source_campaign_request_disabled":
    case "feature_disabled":
      return "Formal source and campaign requests are turned off. Nothing was stored.";
    case "setup_incomplete":
      return "The saved setup is missing a source identity or a campaign id. Nothing was stored.";
    case "setup_unavailable":
      return "The saved setup is unavailable. Nothing was stored.";
    case "setup_unreadable":
      return "The saved setup could not be read. Nothing was stored.";
    case "setup_stale":
      return "The saved setup revision changed. Reload before trying again. Nothing new was stored from this attempt.";
    case "setup_mismatch":
      return "The submission did not match the saved setup. Reload and submit the saved identifiers. Nothing was stored.";
    case "revision_conflict":
      return "The request chain changed. Reload before trying again. Nothing new was stored from this attempt.";
    case "request_id_conflict":
      return "This request id was already used for a different submission. Reload and start again.";
    case "no_open_request":
      return "There is no open proposal to reject.";
    case "unreadable_request":
      return "The open proposal could not be read. Nothing was changed.";
    case "ownership_unverified":
      return "Too many matching records were found to judge ownership. Nothing was stored.";
    case "client_not_found":
      return "That client was not found. Nothing was stored.";
    case "invalid_body":
      return "The request could not be sent. Reload and try again. Nothing was stored.";
    case "SUPERSEDE_CONFIRMATION":
      return "An open proposal is already stored. Confirm replacement before submitting another.";
    case "UNCERTAIN":
      return "The request did not finish. Retry uses the same request id.";
    default:
      return "The request could not be completed. Reload before trying again.";
  }
}

export function storedRequestMessage(record: StoredSourceCampaignRequest): string {
  const revision = `request revision ${record.revision}`;
  if (record.ok && record.status === "requested") {
    const replay = record.replayed ? "The API returned the proposal it already stored" : "The API stored this proposal";
    const replaced = record.supersededRequestId ? " The previous open proposal was replaced." : "";
    return `${replay} at ${revision}.${replaced} Status: requested. Next step: operational review.`;
  }
  if (record.ok && record.status === "rejected" && record.dispositionReason === "operator_rejected") {
    const replay = record.replayed ? "The API returned the operator rejection it already stored" : "The open proposal was rejected by this operator";
    return `${replay} at ${revision}. Status: rejected.`;
  }
  if (record.error === "source_owned_by_other_client") {
    return `The API recorded a rejection at ${revision} because a matching source belongs to another client. This was not an operator rejection. Status: rejected.`;
  }
  if (record.error === "ambiguous_source") {
    return `The API recorded a rejection at ${revision} because more than one source matches. This was not an operator rejection. Status: rejected.`;
  }
  if (record.error === "campaign_owned_by_other_client") {
    return `The API recorded a rejection at ${revision} because a campaign rule belongs to another client. This was not an operator rejection. Status: rejected.`;
  }
  if (record.status === "rejected") {
    return `The API recorded a rejection at ${revision}. Status: rejected.`;
  }
  return `The API stored a request result at ${revision}. Status: ${record.status}.`;
}
