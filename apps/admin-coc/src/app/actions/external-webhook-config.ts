"use server";

import { adminRequestJson } from "@/lib/admin-api/server";
import {
  readAdminCocAccess,
  requireAdminCocAdminSession,
  requireAdminCocSession,
  requireStaffWorkspacePermission,
  type AdminCocAccess,
} from "@/lib/admin-coc-session-guard";
import { isSafeTeamWorkspaceId } from "@/lib/team-workspace/contract";
import {
  externalWebhookBridgeAudit,
  externalWebhookBridgeFailure,
  isExternalWebhookConfigBridgeEnabled,
  projectExternalWebhookPreflight,
  projectExternalWebhookStatus,
  readExternalWebhookBridgeError,
  writeExternalWebhookBridgeAudit,
  type ExternalWebhookBridgeAudit,
  type ExternalWebhookBridgeOperation,
  type ExternalWebhookBridgeFailure,
  type ExternalWebhookBridgePreflight,
  type ExternalWebhookBridgeRead,
  type ExternalWebhookBridgeResult,
  type ExternalWebhookBridgeSave,
  type ExternalWebhookAuthMode,
  type ExternalWebhookDestinationKind,
} from "@/lib/team-workspace/external-webhook-bridge";

const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ExternalWebhookSaveInput = {
  clientAccountId: string;
  requestId: string;
  expectedRevision: number;
  kind: ExternalWebhookDestinationKind;
  authMode: ExternalWebhookAuthMode;
  endpointUrl: string;
  signingSecret?: string;
};

export type ExternalWebhookPreflightInput = {
  clientAccountId: string;
  expectedRevision: number;
  kind: ExternalWebhookDestinationKind;
  authMode: ExternalWebhookAuthMode;
  endpointUrl: string;
  signingSecret?: string;
};

export type ExternalWebhookActivationInput = {
  clientAccountId: string;
  requestId: string;
  expectedRevision: number;
};

export async function readExternalWebhookDestinationAction(
  clientAccountId: string
): Promise<ExternalWebhookBridgeResult> {
  const access = await readAdminCocAccess();
  try {
    await requireStaffWorkspacePermission("team_workspace");
  } catch (error) {
    audit(access, "read", safeClient(clientAccountId), null, null, "denied", "forbidden");
    throw error;
  }
  const id = safeClient(clientAccountId);
  if (!id) return reject(access, "read", null, "INVALID_CLIENT");
  if (!isExternalWebhookConfigBridgeEnabled()) return reject(access, "read", id, "FEATURE_DISABLED");
  const response = await adminRequestJson<unknown>("GET", destinationPath(id));
  if (!response.ok) return failResponse(access, "read", id, null, response.status, response.body);
  const status = projectExternalWebhookStatus(response.data, id);
  if (!status) return reject(access, "read", id, "client_mismatch");
  return succeedRead(access, id, status);
}

export async function preflightExternalWebhookDestinationAction(
  input: ExternalWebhookPreflightInput
): Promise<ExternalWebhookBridgeResult> {
  const access = await readAdminCocAccess();
  try {
    await requireStaffWorkspacePermission("team_manager");
  } catch (error) {
    audit(access, "preflight", safeClient(input.clientAccountId), null, null, "denied", "forbidden");
    throw error;
  }
  const id = safeClient(input.clientAccountId);
  if (!id) return reject(access, "preflight", null, "INVALID_CLIENT");
  const body = destinationBody(input);
  if (!body) return reject(access, "preflight", id, "invalid_body");
  if (!isExternalWebhookConfigBridgeEnabled()) return reject(access, "preflight", id, "FEATURE_DISABLED");
  const response = await adminRequestJson<unknown>("POST", `${destinationPath(id)}/preflight`, {
    expectedRevision: body.expectedRevision,
    kind: body.kind,
    authMode: body.authMode,
    endpointUrl: body.endpointUrl,
    ...(body.signingSecret ? { signingSecret: body.signingSecret } : {}),
  });
  if (!response.ok) return failResponse(access, "preflight", id, null, response.status, response.body);
  const preflight = projectExternalWebhookPreflight(response.data);
  if (!preflight) return reject(access, "preflight", id, "unavailable");
  const result: ExternalWebhookBridgePreflight = {
    ok: true,
    code: null,
    message: null,
    replayed: false,
    needsReload: false,
    status: null,
    preflight,
  };
  audit(access, "preflight", id, null, preflight.currentRevision, "ok", null);
  return result;
}

export async function saveExternalWebhookDestinationAction(
  input: ExternalWebhookSaveInput
): Promise<ExternalWebhookBridgeResult> {
  const access = await readAdminCocAccess();
  try {
    await requireStaffWorkspacePermission("team_manager");
  } catch (error) {
    audit(access, "save", safeClient(input.clientAccountId), null, null, "denied", "forbidden");
    throw error;
  }
  const id = safeClient(input.clientAccountId);
  if (!id) return reject(access, "save", null, "INVALID_CLIENT");
  const body = destinationBody(input);
  if (!body || !REQUEST_ID.test(input.requestId)) return reject(access, "save", id, "invalid_body");
  if (!isExternalWebhookConfigBridgeEnabled()) return reject(access, "save", id, "FEATURE_DISABLED", input.requestId);
  const response = await adminRequestJson<unknown>("PUT", destinationPath(id), {
    requestId: input.requestId,
    expectedRevision: body.expectedRevision,
    kind: body.kind,
    authMode: body.authMode,
    endpointUrl: body.endpointUrl,
    ...(body.signingSecret ? { signingSecret: body.signingSecret } : {}),
  });
  if (!response.ok) return failResponse(access, "save", id, input.requestId, response.status, response.body);
  return succeedWrite(access, "save", id, input.requestId, response.data, "The disabled destination was saved.");
}

export async function activateExternalWebhookDestinationAction(
  input: ExternalWebhookActivationInput
): Promise<ExternalWebhookBridgeResult> {
  await requireAdminCocSession();
  await requireAdminCocAdminSession();
  return changeActivation(input, true);
}

export async function deactivateExternalWebhookDestinationAction(
  input: ExternalWebhookActivationInput
): Promise<ExternalWebhookBridgeResult> {
  await requireAdminCocSession();
  await requireAdminCocAdminSession();
  return changeActivation(input, false);
}

async function changeActivation(
  input: ExternalWebhookActivationInput,
  enabled: boolean
): Promise<ExternalWebhookBridgeResult> {
  const access = await readAdminCocAccess();
  const operation: ExternalWebhookBridgeOperation = enabled ? "activate" : "deactivate";
  const id = safeClient(input.clientAccountId);
  if (!id) return reject(access, operation, null, "INVALID_CLIENT");
  if (!REQUEST_ID.test(input.requestId) || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) {
    return reject(access, operation, id, "invalid_body", input.requestId);
  }
  if (!isExternalWebhookConfigBridgeEnabled()) return reject(access, operation, id, "FEATURE_DISABLED", input.requestId);
  const response = await adminRequestJson<unknown>("PUT", `${destinationPath(id)}/activation`, {
    requestId: input.requestId,
    expectedRevision: input.expectedRevision,
    enabled,
  });
  if (!response.ok) return failResponse(access, operation, id, input.requestId, response.status, response.body);
  const message = enabled ? "The destination was enabled." : "The destination was disabled.";
  return succeedWrite(access, operation, id, input.requestId, response.data, message);
}

function succeedRead(access: AdminCocAccess, clientAccountId: string, status: ExternalWebhookBridgeSave["status"]): ExternalWebhookBridgeRead {
  audit(access, "read", clientAccountId, null, status.revision, "ok", null);
  return { ok: true, code: null, message: null, replayed: false, needsReload: false, status, preflight: null };
}

function succeedWrite(
  access: AdminCocAccess,
  operation: ExternalWebhookBridgeOperation,
  clientAccountId: string,
  requestId: string,
  data: unknown,
  message: string
): ExternalWebhookBridgeSave | ExternalWebhookBridgeFailure {
  const status = projectExternalWebhookStatus(data, clientAccountId);
  if (!status) return reject(access, operation, clientAccountId, "client_mismatch", requestId);
  const replayed = isRecord(data) && data.replayed === true;
  audit(access, operation, clientAccountId, requestId, status.revision, "ok", null);
  return { ok: true, code: null, message, replayed, needsReload: false, status, preflight: null };
}

function failResponse(
  access: AdminCocAccess,
  operation: ExternalWebhookBridgeOperation,
  clientAccountId: string,
  requestId: string | null,
  status: number,
  body: string
): ExternalWebhookBridgeFailure {
  const error = readExternalWebhookBridgeError(status, body);
  const result = error.code === "revision_conflict" || error.code === "request_id_conflict" ? "conflict" : error.code === "unavailable" ? "unavailable" : "rejected";
  return reject(access, operation, clientAccountId, error.code, requestId, error.needsReload, result);
}

function reject(
  access: AdminCocAccess,
  operation: ExternalWebhookBridgeOperation,
  clientAccountId: string | null,
  code: string,
  requestId: string | null = null,
  needsReload = false,
  result: ExternalWebhookBridgeAudit["result"] = code === "FEATURE_DISABLED" ? "unavailable" : "rejected"
): ExternalWebhookBridgeFailure {
  audit(access, operation, clientAccountId, requestId, null, result, code);
  const failure = externalWebhookBridgeFailure(code, needsReload);
  return failure;
}

function audit(
  access: AdminCocAccess,
  operation: ExternalWebhookBridgeOperation,
  clientAccountId: string | null,
  requestId: string | null,
  revision: number | null,
  result: ExternalWebhookBridgeAudit["result"],
  code: string | null
): void {
  const actor = actorOf(access);
  writeExternalWebhookBridgeAudit(
    externalWebhookBridgeAudit({
      actor: actor.actor,
      staffPrincipalId: actor.staffPrincipalId,
      clientAccountId,
      operation,
      requestId,
      revision,
      result,
      code,
    })
  );
}

function actorOf(access: AdminCocAccess): Pick<ExternalWebhookBridgeAudit, "actor" | "staffPrincipalId"> {
  if (access.kind === "admin" && access.source === "staff") {
    return { actor: "staff", staffPrincipalId: access.staffPrincipalId };
  }
  if (access.kind === "admin") return { actor: "shared_password", staffPrincipalId: null };
  if (access.kind === "staff_workspace") return { actor: "staff", staffPrincipalId: access.staffPrincipalId };
  if (access.kind === "observer") return { actor: "observer", staffPrincipalId: null };
  if (access.kind === "staff_limited") return { actor: "staff_limited", staffPrincipalId: null };
  return { actor: "anonymous", staffPrincipalId: null };
}

function destinationBody(input: {
  expectedRevision: number;
  kind: ExternalWebhookDestinationKind;
  authMode: ExternalWebhookAuthMode;
  endpointUrl: string;
  signingSecret?: string;
}): { expectedRevision: number; kind: ExternalWebhookDestinationKind; authMode: ExternalWebhookAuthMode; endpointUrl: string; signingSecret?: string } | null {
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) return null;
  if (input.kind !== "ghl_inbound" && input.kind !== "external_https") return null;
  if (input.authMode !== "none" && input.authMode !== "hmac_sha256") return null;
  if (typeof input.endpointUrl !== "string" || input.endpointUrl.length < 1 || input.endpointUrl.length > 2048) return null;
  if (input.signingSecret !== undefined && (typeof input.signingSecret !== "string" || input.signingSecret.length > 512)) return null;
  return {
    expectedRevision: input.expectedRevision,
    kind: input.kind,
    authMode: input.authMode,
    endpointUrl: input.endpointUrl,
    ...(input.signingSecret ? { signingSecret: input.signingSecret } : {}),
  };
}

function destinationPath(clientAccountId: string): string {
  return `/admin/v1/clients/${clientAccountId}/external-webhook`;
}

function safeClient(value: string): string | null {
  const id = value?.trim?.() ?? "";
  return isSafeTeamWorkspaceId(id) ? id : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
