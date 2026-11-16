/**
 * Server bridge contract for a later Team Workspace screen.
 * The admin API key stays in the Next.js server. This module does not call it.
 *
 * Order for that screen:
 * 1. readExternalWebhookDestinationAction
 * 2. preflightExternalWebhookDestinationAction
 * 3. saveExternalWebhookDestinationAction, which stores a disabled destination
 * 4. An administrator calls activateExternalWebhookDestinationAction
 * 5. deactivateExternalWebhookDestinationAction turns that destination off
 *
 * team_workspace may read. team_manager may preflight and save disabled.
 * team_operations has no configuration write. Activation is an Admin C.O.C.
 * administrator action. There is no team-manager cutover grant for this destination.
 */

export const EXTERNAL_WEBHOOK_BRIDGE_FLAG = "SA360_EXTERNAL_WEBHOOK_CONFIG_BRIDGE_ENABLED";

export type ExternalWebhookDestinationKind = "ghl_inbound" | "external_https";
export type ExternalWebhookAuthMode = "none" | "hmac_sha256";
export type ExternalWebhookBridgeOperation = "read" | "preflight" | "save" | "activate" | "deactivate";

export type ExternalWebhookBridgeAttempt = {
  state: string;
  outcome: string | null;
  httpStatus: number | null;
  httpAccepted: boolean;
  provesCrmCreation: false;
};

export type ExternalWebhookBridgeStatus = {
  present: boolean;
  kind: ExternalWebhookDestinationKind | null;
  authMode: ExternalWebhookAuthMode | null;
  hostname: string | null;
  enabled: boolean;
  revision: number;
  configurationValid: boolean;
  primaryCrmConflict: boolean;
  latestAttempt: ExternalWebhookBridgeAttempt | null;
};

export type ExternalWebhookBridgeFailure = {
  ok: false;
  code: string;
  message: string;
  replayed: false;
  needsReload: boolean;
  status: null;
  preflight: null;
};

export type ExternalWebhookBridgeRead = {
  ok: true;
  code: null;
  message: null;
  replayed: false;
  needsReload: false;
  status: ExternalWebhookBridgeStatus;
  preflight: null;
};

export type ExternalWebhookBridgeSave = {
  ok: true;
  code: null;
  message: string;
  replayed: boolean;
  needsReload: false;
  status: ExternalWebhookBridgeStatus;
  preflight: null;
};

export type ExternalWebhookBridgePreflightReport = {
  postsLead: false;
  hostname: string | null;
  endpointValid: boolean;
  endpointCode: string | null;
  authValid: boolean;
  authCode: string | null;
  credentialsReady: boolean;
  primaryCrmConflict: boolean;
  currentRevision: number;
  revisionMatches: boolean;
  canaryImplemented: false;
};

export type ExternalWebhookBridgePreflight = {
  ok: true;
  code: null;
  message: null;
  replayed: false;
  needsReload: false;
  status: null;
  preflight: ExternalWebhookBridgePreflightReport;
};

export type ExternalWebhookBridgeResult =
  | ExternalWebhookBridgeRead
  | ExternalWebhookBridgeSave
  | ExternalWebhookBridgePreflight
  | ExternalWebhookBridgeFailure;

export type ExternalWebhookBridgeAudit = {
  event: "external_webhook_config_bridge";
  at: string;
  actor: "shared_password" | "staff" | "observer" | "staff_limited" | "anonymous";
  staffPrincipalId: string | null;
  clientAccountId: string | null;
  operation: ExternalWebhookBridgeOperation;
  requestId: string | null;
  revision: number | null;
  result: "ok" | "denied" | "conflict" | "rejected" | "unavailable";
  code: string | null;
};

const URL_CODES = new Set([
  "invalid_url",
  "not_https",
  "userinfo",
  "fragment",
  "internal_hostname",
  "obfuscated_address",
  "private_address",
  "dns_empty",
  "dns_private",
  "dns_failed",
]);

const ERROR_CODES = new Set([
  "client_not_found",
  "revision_conflict",
  "request_id_conflict",
  "auth_mode_rejected",
  "signing_secret_required",
  "signing_secret_rejected",
  "endpoint_rejected",
  "credentials_unavailable",
  "destination_missing",
  "primary_crm_conflict",
  "destination_invalid",
  "invalid_body",
  "forbidden",
]);

const MESSAGES: Record<string, string> = {
  FEATURE_DISABLED: "External webhook configuration is turned off. Nothing was saved or enabled.",
  INVALID_CLIENT: "This client id cannot be used.",
  client_not_found: "This client was not found.",
  revision_conflict: "The destination changed. Reload it before trying again.",
  request_id_conflict: "This request id was already used for a different configuration.",
  auth_mode_rejected: "This destination kind does not accept that credential mode.",
  signing_secret_required: "This destination needs a signing secret.",
  signing_secret_rejected: "This destination does not take a signing secret.",
  endpoint_rejected: "The endpoint did not pass the HTTPS checks.",
  credentials_unavailable: "Webhook credentials are not available on the server.",
  destination_missing: "Save a disabled destination before changing activation.",
  primary_crm_conflict: "A live GoHighLevel destination already owns primary CRM delivery.",
  destination_invalid: "The saved destination is not valid to enable.",
  invalid_body: "The configuration could not be read.",
  forbidden: "This operator cannot change the external webhook.",
  client_mismatch: "The destination response did not match this client.",
  unavailable: "The configuration service did not finish. Nothing on this page was marked saved.",
};

export function isExternalWebhookConfigBridgeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[EXTERNAL_WEBHOOK_BRIDGE_FLAG]?.trim() === "true";
}

export function externalWebhookBridgeMessage(code: string): string {
  if (URL_CODES.has(code)) return MESSAGES.endpoint_rejected;
  return MESSAGES[code] ?? MESSAGES.unavailable;
}

export function externalWebhookBridgeFailure(code: string, needsReload = false): ExternalWebhookBridgeFailure {
  return {
    ok: false,
    code,
    message: externalWebhookBridgeMessage(code),
    replayed: false,
    needsReload,
    status: null,
    preflight: null,
  };
}

export function projectExternalWebhookStatus(value: unknown, clientAccountId: string): ExternalWebhookBridgeStatus | null {
  if (!isRecord(value)) return null;
  if (value.clientAccountId !== undefined && value.clientAccountId !== clientAccountId) return null;
  const kind = value.kind === null ? null : value.kind;
  const authMode = value.authMode === null ? null : value.authMode;
  if (kind !== null && kind !== "ghl_inbound" && kind !== "external_https") return null;
  if (authMode !== null && authMode !== "none" && authMode !== "hmac_sha256") return null;
  if (typeof value.enabled !== "boolean") return null;
  const present = value.present === undefined ? kind !== null : value.present;
  if (typeof present !== "boolean") return null;
  if (typeof value.revision !== "number" || !Number.isSafeInteger(value.revision) || value.revision < 0) return null;
  if (typeof value.configurationValid !== "boolean" || typeof value.primaryCrmConflict !== "boolean") return null;
  const hostname = value.hostname === null ? null : value.hostname;
  if (hostname !== null && (typeof hostname !== "string" || hostname.length === 0 || hostname.length > 253 || /[\s/]/.test(hostname))) {
    return null;
  }
  const latestAttempt = value.latestAttempt === undefined ? null : projectAttempt(value.latestAttempt);
  if (value.latestAttempt != null && value.latestAttempt !== undefined && !latestAttempt) return null;
  return {
    present,
    kind,
    authMode,
    hostname,
    enabled: value.enabled,
    revision: value.revision,
    configurationValid: value.configurationValid,
    primaryCrmConflict: value.primaryCrmConflict,
    latestAttempt,
  };
}

export function projectExternalWebhookPreflight(value: unknown): ExternalWebhookBridgePreflightReport | null {
  if (!isRecord(value) || value.postsLead !== false) return null;
  if (typeof value.endpointValid !== "boolean" || typeof value.authValid !== "boolean") return null;
  if (typeof value.credentialsReady !== "boolean" || typeof value.primaryCrmConflict !== "boolean") return null;
  if (typeof value.revisionMatches !== "boolean") return null;
  if (typeof value.currentRevision !== "number" || !Number.isSafeInteger(value.currentRevision) || value.currentRevision < 0) {
    return null;
  }
  const hostname = value.hostname === null ? null : value.hostname;
  if (hostname !== null && (typeof hostname !== "string" || /[\s/]/.test(hostname))) return null;
  const canary = isRecord(value.canary) ? value.canary : null;
  if (!canary || canary.implemented !== false || canary.consumerLeadData !== false) return null;
  const endpointCode = value.endpointCode === null ? null : value.endpointCode;
  const authCode = value.authCode === null ? null : value.authCode;
  if (endpointCode !== null && (typeof endpointCode !== "string" || !URL_CODES.has(endpointCode))) return null;
  if (authCode !== null && (typeof authCode !== "string" || !ERROR_CODES.has(authCode))) return null;
  return {
    postsLead: false,
    hostname,
    endpointValid: value.endpointValid,
    endpointCode,
    authValid: value.authValid,
    authCode,
    credentialsReady: value.credentialsReady,
    primaryCrmConflict: value.primaryCrmConflict,
    currentRevision: value.currentRevision,
    revisionMatches: value.revisionMatches,
    canaryImplemented: false,
  };
}

export function readExternalWebhookBridgeError(status: number, body: string): { code: string; needsReload: boolean } {
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(body) as unknown;
  } catch {
    parsed = null;
  }
  const code = isRecord(parsed) && typeof parsed.error === "string" ? parsed.error : "";
  if (status === 409 && code === "revision_conflict") return { code, needsReload: true };
  if (status === 409 && code === "endpoint_rejected") {
    const detail = isRecord(parsed) && typeof parsed.code === "string" && URL_CODES.has(parsed.code) ? parsed.code : code;
    return { code: detail, needsReload: false };
  }
  if ((status === 400 || status === 404 || status === 409 || status === 403 || status === 503) && ERROR_CODES.has(code)) {
    return { code, needsReload: false };
  }
  return { code: "unavailable", needsReload: false };
}

export function externalWebhookBridgeAudit(input: Omit<ExternalWebhookBridgeAudit, "event" | "at"> & { at?: string }): ExternalWebhookBridgeAudit {
  return {
    event: "external_webhook_config_bridge",
    at: input.at ?? new Date().toISOString(),
    actor: input.actor,
    staffPrincipalId: input.staffPrincipalId,
    clientAccountId: input.clientAccountId,
    operation: input.operation,
    requestId: input.requestId,
    revision: input.revision,
    result: input.result,
    code: input.code,
  };
}

type AuditSink = (record: ExternalWebhookBridgeAudit) => void;
let auditSink: AuditSink = (record) => {
  console.info("[external-webhook-bridge]", record);
};

export function writeExternalWebhookBridgeAudit(record: ExternalWebhookBridgeAudit): void {
  auditSink(record);
}

export function useExternalWebhookBridgeAuditSinkForTests(sink: AuditSink | undefined): void {
  auditSink = sink ?? ((record) => console.info("[external-webhook-bridge]", record));
}

function projectAttempt(value: unknown): ExternalWebhookBridgeAttempt | null {
  if (value == null) return null;
  if (!isRecord(value) || typeof value.state !== "string" || value.state.length === 0 || value.state.length > 40) return null;
  const outcome = value.outcome === null ? null : value.outcome;
  if (outcome !== null && (typeof outcome !== "string" || outcome.length > 40)) return null;
  const httpStatus = value.httpStatus === null ? null : value.httpStatus;
  if (httpStatus !== null && (typeof httpStatus !== "number" || !Number.isInteger(httpStatus) || httpStatus < 100 || httpStatus > 599)) {
    return null;
  }
  return {
    state: value.state,
    outcome,
    httpStatus,
    httpAccepted: outcome === "http_accepted" && value.httpAccepted === true,
    provesCrmCreation: false,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
