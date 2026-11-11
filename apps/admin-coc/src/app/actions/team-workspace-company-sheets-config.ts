"use server";

import { requireStaffWorkspacePermission } from "@/lib/admin-coc-session-guard";
import {
  fetchCompanySheetsDestinationConfiguration,
  postCompanySheetsDestinationConfiguration,
} from "@/lib/admin-api/company-google-sheets";
import { isNativeClientSetupEnabled } from "@/lib/clients/native-client-setup-env";
import { isCompanySheetsConfigRequestEnabled } from "@/lib/team-workspace/company-sheets-config-request-env";
import {
  companySheetsConfigRequestErrorMessage,
  companySheetsSubmitPayload,
  parseCompanySheetsConfigHead,
  parseCompanySheetsConfigSaveResult,
  parseCompanySpreadsheetRef,
  readCompanySheetsConfigError,
  type CompanySheetsConfigHead,
  type CompanySheetsConfigSubmitBody,
  type CompanySheetsOperationalDestination,
  type CompanySheetsStoredRequest,
} from "@/lib/team-workspace/company-sheets-config-request";
import { isTeamWorkspaceEnabled, isTeamWorkspaceServerEnabled } from "@/lib/team-workspace/config";
import { isSafeTeamWorkspaceId } from "@/lib/team-workspace/contract";

export type CompanySheetsConfigLoadResult = {
  ok: boolean;
  uncertain: boolean;
  code: string | null;
  message: string | null;
  head: CompanySheetsConfigHead | null;
};

export type CompanySheetsConfigSaveResult = {
  ok: boolean;
  uncertain: boolean;
  stored: boolean;
  retainRequestId: boolean;
  needsReload: boolean;
  code: string | null;
  message: string;
  revision: number | null;
  requestId: string | null;
  replayed: boolean;
  sent: CompanySheetsConfigSubmitBody | null;
  storedRequest: CompanySheetsStoredRequest | null;
  operationalDestination: CompanySheetsOperationalDestination | null;
};

const RELOAD_CODES = new Set(["revision_conflict", "destination_stale", "request_id_reused"]);

function configDisabledMessage(): string | null {
  if (!isTeamWorkspaceEnabled() || !isTeamWorkspaceServerEnabled()) {
    return "Team Workspace is turned off. A Company Sheets configuration request was not stored, and delivery was not changed.";
  }
  if (!isNativeClientSetupEnabled()) {
    return "Client setup is turned off. A Company Sheets configuration request was not stored, and delivery was not changed.";
  }
  if (!isCompanySheetsConfigRequestEnabled()) return companySheetsConfigRequestErrorMessage("FEATURE_DISABLED");
  return null;
}

async function authorizeConfig(): Promise<CompanySheetsConfigLoadResult | null> {
  const message = configDisabledMessage();
  if (!message) return null;
  return { ok: false, uncertain: false, code: "FEATURE_DISABLED", message, head: null };
}

function parseBody(body: string): unknown {
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

function normalizeSubmit(input: CompanySheetsConfigSubmitBody): CompanySheetsConfigSubmitBody | null {
  if (!input || typeof input.requestId !== "string") return null;
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) return null;
  if (input.expectedDestinationRevision !== null) {
    if (!Number.isSafeInteger(input.expectedDestinationRevision) || input.expectedDestinationRevision < 1) return null;
  }
  if (typeof input.spreadsheetId !== "string" || typeof input.worksheetId !== "number") return null;
  const parsed = parseCompanySpreadsheetRef(input.spreadsheetId);
  if (!parsed.ok) return null;
  if (!Number.isSafeInteger(input.worksheetId) || input.worksheetId < 0) return null;
  return companySheetsSubmitPayload({
    requestId: input.requestId,
    expectedRevision: input.expectedRevision,
    expectedDestinationRevision: input.expectedDestinationRevision,
    spreadsheetId: parsed.spreadsheetId,
    worksheetId: input.worksheetId,
  });
}

function closedSave(code: string, message: string, sent: CompanySheetsConfigSubmitBody | null = null): CompanySheetsConfigSaveResult {
  return {
    ok: false,
    uncertain: false,
    stored: false,
    retainRequestId: false,
    needsReload: false,
    code,
    message,
    revision: null,
    requestId: sent?.requestId ?? null,
    replayed: false,
    sent,
    storedRequest: null,
    operationalDestination: null,
  };
}

function uncertainSave(message: string, sent: CompanySheetsConfigSubmitBody): CompanySheetsConfigSaveResult {
  return {
    ok: false,
    uncertain: true,
    stored: false,
    retainRequestId: true,
    needsReload: false,
    code: "UNCERTAIN",
    message,
    revision: null,
    requestId: sent.requestId,
    replayed: false,
    sent,
    storedRequest: null,
    operationalDestination: null,
  };
}

export async function loadTeamWorkspaceCompanySheetsConfigurationAction(
  clientAccountId: string
): Promise<CompanySheetsConfigLoadResult> {
  await requireStaffWorkspacePermission("team_workspace");
  const denied = await authorizeConfig();
  if (denied) return denied;
  const id = clientAccountId.trim();
  if (!isSafeTeamWorkspaceId(id)) {
    return { ok: false, uncertain: false, code: "INVALID_CLIENT", message: "This client id cannot be read.", head: null };
  }
  const response = await fetchCompanySheetsDestinationConfiguration(id);
  if (!response.ok) {
    const code = readCompanySheetsConfigError(parseBody(response.body));
    if (code && !transportFailed(response.status, response.body)) {
      return { ok: false, uncertain: false, code, message: companySheetsConfigRequestErrorMessage(code), head: null };
    }
    return {
      ok: false,
      uncertain: true,
      code: "UNCERTAIN",
      message: "The configuration request could not be read. Retry the read. Nothing was stored.",
      head: null,
    };
  }
  const head = parseCompanySheetsConfigHead(response.data);
  if (!head || head.clientAccountId !== id) {
    return {
      ok: false,
      uncertain: true,
      code: "UNCERTAIN",
      message: "The configuration response could not be read. Retry the read before saving. Nothing was stored.",
      head: null,
    };
  }
  return { ok: true, uncertain: false, code: null, message: null, head };
}

export async function saveTeamWorkspaceCompanySheetsConfigurationRequestAction(
  input: CompanySheetsConfigSubmitBody & { clientAccountId: string }
): Promise<CompanySheetsConfigSaveResult> {
  await requireStaffWorkspacePermission("team_manager");
  const denied = await authorizeConfig();
  if (denied) return closedSave("FEATURE_DISABLED", denied.message ?? companySheetsConfigRequestErrorMessage("FEATURE_DISABLED"));
  const clientAccountId = input.clientAccountId.trim();
  if (!isSafeTeamWorkspaceId(clientAccountId)) return closedSave("INVALID_CLIENT", "This client id cannot be saved.");
  const sent = normalizeSubmit(input);
  if (!sent) return closedSave("invalid_body", companySheetsConfigRequestErrorMessage("invalid_body"));
  const response = await postCompanySheetsDestinationConfiguration(clientAccountId, { ...sent });
  if (!response.ok) {
    const code = readCompanySheetsConfigError(parseBody(response.body));
    if (!code || transportFailed(response.status, response.body)) {
      return uncertainSave(
        "The configuration request did not finish. Retry uses the same request id and the same payload. Nothing on this page was marked stored.",
        sent
      );
    }
    return {
      ok: false,
      uncertain: false,
      stored: false,
      retainRequestId: code === "destination_busy",
      needsReload: RELOAD_CODES.has(code),
      code,
      message: companySheetsConfigRequestErrorMessage(code),
      revision: null,
      requestId: sent.requestId,
      replayed: false,
      sent,
      storedRequest: null,
      operationalDestination: null,
    };
  }
  const saved = parseCompanySheetsConfigSaveResult(response.data);
  if (!saved) {
    return uncertainSave(
      "The response could not be read. Retry uses the same request id and the same payload. This page does not treat it as stored.",
      sent
    );
  }
  const { replayed, operationalDestination, ...storedRequest } = saved;
  return {
    ok: true,
    uncertain: false,
    stored: true,
    retainRequestId: false,
    needsReload: false,
    code: null,
    message: replayed
      ? "This configuration request was already stored. The operational destination was not changed."
      : "The configuration request was stored. The operational destination was not changed.",
    revision: saved.revision,
    requestId: saved.requestId,
    replayed,
    sent,
    storedRequest,
    operationalDestination,
  };
}
