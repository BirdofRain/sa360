"use server";

import { AdminCocForbiddenError, requireStaffWorkspacePermission } from "@/lib/admin-coc-session-guard";
import { fetchAdminClientSetup, postAdminSourceCampaignRequest, adminFetchJson } from "@/lib/admin-api/server";
import { isSafeTeamWorkspaceId } from "@/lib/team-workspace/contract";
import {
  disabledSourceCampaignRequest,
  echoSavedSourceCampaignIdentity,
  parseSourceCampaignRequestHead,
  parseStoredSourceCampaignRequest,
  readUnstoredRequestError,
  sourceCampaignRequestBlockedReason,
  sourceCampaignRequestPath,
  storedRequestMessage,
  unstoredRequestMessage,
  type SavedSourceEcho,
} from "@/lib/team-workspace/source-campaign-request";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type SourceCampaignRequestEcho = {
  expectedRevision: number;
  setupRevision: number;
  providerFunnelId: string | null;
  parentUrlKey: string | null;
  providerCampaignId: string | null;
  replaceOpenProposal: boolean;
};

export type SourceCampaignRequestActionResult = {
  ok: boolean;
  uncertain: boolean;
  stored: boolean;
  retainRequestId: boolean;
  code: string | null;
  message: string;
  status: "requested" | "rejected" | null;
  revision: number | null;
  requestId: string | null;
  replayed: boolean;
  supersededRequestId: string | null;
  sent: SourceCampaignRequestEcho | null;
};

type SubmitInput = {
  clientAccountId: string;
  requestId: string;
  expectedRevision: number;
  setupRevision: number;
  providerFunnelId: string | null;
  parentUrlKey: string | null;
  providerCampaignId: string | null;
  replaceOpenProposal: boolean;
};

type RejectInput = {
  clientAccountId: string;
  requestId: string;
  expectedRevision: number;
  setupRevision: number;
};

function closed(code: string, message: string, retainRequestId = false): SourceCampaignRequestActionResult {
  return {
    ok: false,
    uncertain: false,
    stored: false,
    retainRequestId,
    code,
    message,
    status: null,
    revision: null,
    requestId: null,
    replayed: false,
    supersededRequestId: null,
    sent: null,
  };
}

function uncertain(message: string, sent: SourceCampaignRequestEcho | null): SourceCampaignRequestActionResult {
  return {
    ok: false,
    uncertain: true,
    stored: false,
    retainRequestId: true,
    code: "UNCERTAIN",
    message,
    status: null,
    revision: null,
    requestId: sent ? null : null,
    replayed: false,
    supersededRequestId: null,
    sent,
  };
}

function isControlFlow(error: unknown): boolean {
  if (error instanceof AdminCocForbiddenError) return true;
  const digest = typeof error === "object" && error && "digest" in error ? String((error as { digest?: unknown }).digest) : "";
  return digest.startsWith("NEXT_REDIRECT") || digest.startsWith("NEXT_HTTP_ERROR_FALLBACK");
}

function integerRevision(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function blank(value: unknown, max: number): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > max) return undefined;
  return trimmed;
}

function parseJson(body: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return null;
  }
}

function transportFailed(status: number, body: string): boolean {
  return (
    status === 0 ||
    status >= 500 ||
    body.includes("non-JSON") ||
    body.includes("temporarily unavailable") ||
    body.includes("not configured") ||
    body.startsWith("Admin API request failed")
  );
}

function fromStored(value: unknown, sent: SourceCampaignRequestEcho | null): SourceCampaignRequestActionResult | null {
  const stored = parseStoredSourceCampaignRequest(value);
  if (!stored) return null;
  return {
    ok: stored.ok,
    uncertain: false,
    stored: true,
    retainRequestId: false,
    code: stored.error,
    message: storedRequestMessage(stored),
    status: stored.status,
    revision: stored.revision,
    requestId: stored.requestId,
    replayed: stored.replayed,
    supersededRequestId: stored.supersededRequestId,
    sent,
  };
}

function fromResponse(
  response: { ok: true; data: unknown } | { ok: false; status: number; body: string },
  sent: SourceCampaignRequestEcho
): SourceCampaignRequestActionResult {
  if (!response.ok) {
    const parsed = parseJson(response.body);
    const stored = fromStored(parsed, sent);
    if (stored) return stored;
    const code = readUnstoredRequestError(parsed);
    if (code) return { ...closed(code, unstoredRequestMessage(code)), sent };
    if (transportFailed(response.status, response.body)) {
      return uncertain("The request did not finish. Retry uses the same request id. Nothing on this page was marked stored.", sent);
    }
    return uncertain("The response could not be read. Retry uses the same request id.", sent);
  }
  const stored = fromStored(response.data, sent);
  if (stored?.ok) return stored;
  return closed(
    "UNREADABLE_RESULT",
    "The response could not be read as a request-only result. Reload the page before submitting again."
  );
}

function flagClosed(): SourceCampaignRequestActionResult | null {
  const reason = sourceCampaignRequestBlockedReason();
  if (!reason) return null;
  return closed("FEATURE_DISABLED", disabledSourceCampaignRequest(reason).message);
}

function clientEcho(input: SubmitInput): SavedSourceEcho | null {
  const providerFunnelId = blank(input.providerFunnelId, 200);
  const parentUrlKey = blank(input.parentUrlKey, 500);
  const providerCampaignId = blank(input.providerCampaignId, 200);
  if (providerFunnelId === undefined || parentUrlKey === undefined || providerCampaignId === undefined) return null;
  return {
    providerFunnelId,
    parentUrlKey,
    providerCampaignId,
    complete: Boolean((providerFunnelId || parentUrlKey) && providerCampaignId),
  };
}

export async function submitSourceCampaignRequestAction(input: SubmitInput): Promise<SourceCampaignRequestActionResult> {
  await requireStaffWorkspacePermission("team_manager");
  const flagged = flagClosed();
  if (flagged) return flagged;
  if (!isSafeTeamWorkspaceId(input.clientAccountId) || !UUID.test(input.requestId)) {
    return closed("VALIDATION", "This submission is missing a client id or request id. Reload and try again.");
  }
  if (!integerRevision(input.expectedRevision) || !integerRevision(input.setupRevision) || typeof input.replaceOpenProposal !== "boolean") {
    return closed("VALIDATION", "This submission is missing a revision. Reload and try again.");
  }
  const echoed = clientEcho(input);
  if (!echoed) return closed("VALIDATION", "The saved identifiers could not be read. Reload and try again.");

  let sent: SourceCampaignRequestEcho | null = null;
  try {
    const setup = await fetchAdminClientSetup(input.clientAccountId);
    if (!setup.data?.item || setup.error) {
      if (setup.error && !setup.error.startsWith("Admin API error (")) {
        return uncertain("The saved setup could not be reloaded. Retry uses the same request id. Nothing was submitted.", null);
      }
      return closed("setup_unavailable", unstoredRequestMessage("setup_unavailable"));
    }
    const item = setup.data.item;
    if (item.repairRequired || item.operationalEffects !== false || !integerRevision(item.revision)) {
      return closed("setup_unreadable", unstoredRequestMessage("setup_unreadable"));
    }
    const saved = echoSavedSourceCampaignIdentity(item.data);
    if (!saved) return closed("setup_unreadable", unstoredRequestMessage("setup_unreadable"));

    const headResponse = await adminFetchJson<unknown>(sourceCampaignRequestPath(input.clientAccountId));
    if (!headResponse.ok) {
      if (transportFailed(headResponse.status, headResponse.body)) {
        return uncertain("The request chain could not be reloaded. Retry uses the same request id. Nothing was submitted.", null);
      }
      const code = readUnstoredRequestError(parseJson(headResponse.body));
      if (code) return closed(code, unstoredRequestMessage(code));
      return uncertain("The request chain could not be reloaded. Retry uses the same request id. Nothing was submitted.", null);
    }
    const head = parseSourceCampaignRequestHead(headResponse.data);
    if (!head || head.availability !== "ready") {
      return closed("UNREADABLE_RESULT", "The request chain could not be read. Reload before submitting. Nothing was submitted.");
    }
    const chainMatches = head.revision === input.expectedRevision;
    const setupMatches = item.revision === input.setupRevision;
    if (chainMatches && head.openRequest && input.replaceOpenProposal !== true) {
      return closed("SUPERSEDE_CONFIRMATION", unstoredRequestMessage("SUPERSEDE_CONFIRMATION"), true);
    }

    const identity = chainMatches && setupMatches ? saved : echoed;
    if (chainMatches && setupMatches && !saved.complete) {
      return closed("setup_incomplete", unstoredRequestMessage("setup_incomplete"));
    }
    sent = {
      expectedRevision: input.expectedRevision,
      setupRevision: input.setupRevision,
      providerFunnelId: identity.providerFunnelId,
      parentUrlKey: identity.parentUrlKey,
      providerCampaignId: identity.providerCampaignId,
      replaceOpenProposal: input.replaceOpenProposal,
    };
    const response = await postAdminSourceCampaignRequest(input.clientAccountId, {
      requestId: input.requestId,
      expectedRevision: sent.expectedRevision,
      setupRevision: sent.setupRevision,
      intent: "request",
      providerFunnelId: sent.providerFunnelId,
      parentUrlKey: sent.parentUrlKey,
      providerCampaignId: sent.providerCampaignId,
    });
    return fromResponse(response, sent);
  } catch (error) {
    if (isControlFlow(error)) throw error;
    return uncertain("The request did not finish. Retry uses the same request id. Nothing on this page was marked stored.", sent);
  }
}

export async function rejectSourceCampaignRequestAction(input: RejectInput): Promise<SourceCampaignRequestActionResult> {
  await requireStaffWorkspacePermission("team_manager");
  const flagged = flagClosed();
  if (flagged) return flagged;
  if (!isSafeTeamWorkspaceId(input.clientAccountId) || !UUID.test(input.requestId)) {
    return closed("VALIDATION", "This rejection is missing a client id or request id. Reload and try again.");
  }
  if (!integerRevision(input.expectedRevision) || !integerRevision(input.setupRevision)) {
    return closed("VALIDATION", "This rejection is missing a revision. Reload and try again.");
  }
  const sent: SourceCampaignRequestEcho = {
    expectedRevision: input.expectedRevision,
    setupRevision: input.setupRevision,
    providerFunnelId: null,
    parentUrlKey: null,
    providerCampaignId: null,
    replaceOpenProposal: false,
  };
  try {
    const response = await postAdminSourceCampaignRequest(input.clientAccountId, {
      requestId: input.requestId,
      expectedRevision: input.expectedRevision,
      setupRevision: input.setupRevision,
      intent: "reject",
    });
    return fromResponse(response, sent);
  } catch (error) {
    if (isControlFlow(error)) throw error;
    return uncertain("The rejection did not finish. Retry uses the same request id.", sent);
  }
}
