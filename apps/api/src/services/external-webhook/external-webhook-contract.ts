import { createHmac } from "node:crypto";

import { isPersistedLiveDestination } from "../ghl-destination-authorization.js";
import { externalWebhookRedirectDisposition } from "../../lib/external-webhook-url-policy.js";

/**
 * Stable names for the fresh-lead external webhook.
 * Nothing in this module opens a socket, sends mail, or reads the database.
 */

export const EXTERNAL_WEBHOOK_DELIVERY_FLAG = "SA360_EXTERNAL_WEBHOOK_DELIVERY_ENABLED";

export const EXTERNAL_WEBHOOK_PAYLOAD_CONTRACT_VERSION = "sa360.external_webhook.lead.v1" as const;

export const EXTERNAL_WEBHOOK_IDEMPOTENCY_PREFIX = "external-webhook";

/** A 2xx proves only that the remote HTTP server accepted the POST. */
export const EXTERNAL_WEBHOOK_HTTP_PROOF = "http_2xx" as const;

export const EXTERNAL_WEBHOOK_DOES_NOT_PROVE = [
  "ghl_contact",
  "ghl_workflow",
  "ghl_note",
  "ghl_location_api_success",
  "sheets_row_appended",
  "sms_sent",
  "email_sent",
] as const;

export const EXTERNAL_WEBHOOK_HEADERS = {
  contentType: "application/json; charset=utf-8",
  contract: "X-SA360-Contract",
  idempotencyKey: "X-SA360-Idempotency-Key",
  mappingMode: "X-SA360-Mapping-Mode",
  mappingContentKey: "X-SA360-Mapping-Content-Key",
  destinationKind: "X-SA360-Destination-Kind",
  destinationRevision: "X-SA360-Destination-Revision",
  signature: "X-SA360-Signature",
} as const;

/**
 * Future admin retrieval. Not a route. A public lead-data GET is out of contract.
 * The response would be the frozen canonical JSON and the receipt. The endpoint
 * URL stays ciphertext. Hostname only.
 */
export const EXTERNAL_WEBHOOK_RETRIEVAL = {
  implemented: false,
  method: "GET",
  pathTemplate: "/api/admin/clients/:clientAccountId/external-webhook-attempts/:idempotencyKey",
  authHeader: "x-sa360-admin-key",
  publicRoute: false,
  returnsFrozenPayload: true,
  returnsEndpointUrl: false,
  sendsHttp: false,
  reprojects: false,
} as const;

export type ExternalWebhookDeliveryOutcomeName = "http_accepted" | "retryable" | "failed" | "uncertain";

export type GhlLocationPrimaryCrmRecord = {
  deliveryEnabled: boolean;
  deliveryMode: string;
  clientCutoverApproved: boolean;
  internalApprovalStatus: string;
  destinationSubaccountIdGhl: string;
};

/** Exact `true` only. TRUE, 1, and yes stay off. */
export function isExternalWebhookDeliveryEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[EXTERNAL_WEBHOOK_DELIVERY_FLAG]?.trim() === "true";
}

export function externalWebhookIdempotencyKey(clientAccountId: string, sourceLeadEventId: string): string {
  const client = requiredToken(clientAccountId, "clientAccountId");
  const event = requiredToken(sourceLeadEventId, "sourceLeadEventId");
  return `${EXTERNAL_WEBHOOK_IDEMPOTENCY_PREFIX}:${client}:${event}`;
}

/**
 * Primary CRM is the live GHL location API or one enabled external webhook.
 * Company Sheets and the legacy LF2 custom webhook are not primary CRM arms.
 * Both external kinds, ghl_inbound and external_https, are primary CRM.
 */
export function assessPrimaryCrmDelivery(input: {
  ghl: GhlLocationPrimaryCrmRecord | null;
  externalWebhookEnabled: boolean;
  companySheetsCampaignDispatchEnabled?: boolean;
  legacyCustomWebhookEnabled?: boolean;
}): { ok: true } | { ok: false; code: "duplicate_primary_crm" } {
  const ghlArmed = input.ghl
    ? isPersistedLiveDestination(input.ghl, input.ghl.destinationSubaccountIdGhl)
    : false;
  if (ghlArmed && input.externalWebhookEnabled) {
    return { ok: false, code: "duplicate_primary_crm" };
  }
  return { ok: true };
}

export type ExternalWebhookHttpObservation = {
  requestLeftSa360: boolean;
  httpStatus: number | null;
  timedOut: boolean;
};

export type ExternalWebhookReceipt = {
  outcome: ExternalWebhookDeliveryOutcomeName;
  httpStatus: number | null;
  requestLeftSa360: boolean;
  proves: ["http_2xx"] | [];
  doesNotProve: typeof EXTERNAL_WEBHOOK_DOES_NOT_PROVE;
};

/**
 * Retry only when the request never left SA360.
 * Timeout, 3xx, and a 5xx/408/429 after the bytes left are uncertain and are not retried.
 * 2xx is http_accepted and proves only http_2xx.
 */
export function classifyExternalWebhookResponse(
  observation: ExternalWebhookHttpObservation
): { ok: true; receipt: ExternalWebhookReceipt } | { ok: false; code: "receipt_inconsistent" } {
  const status = observation.httpStatus;
  if (status !== null && (!Number.isInteger(status) || status < 100 || status > 599)) {
    return { ok: false, code: "receipt_inconsistent" };
  }
  if (observation.timedOut) {
    if (status !== null && !observation.requestLeftSa360) return { ok: false, code: "receipt_inconsistent" };
    return observation.requestLeftSa360
      ? acceptedReceipt("uncertain", status, true)
      : acceptedReceipt("retryable", null, false);
  }
  if (status === null) {
    return observation.requestLeftSa360
      ? acceptedReceipt("uncertain", null, true)
      : acceptedReceipt("retryable", null, false);
  }
  if (!observation.requestLeftSa360) return { ok: false, code: "receipt_inconsistent" };
  if (externalWebhookRedirectDisposition(status) === "refused") {
    return acceptedReceipt("uncertain", status, true);
  }
  if (status >= 200 && status <= 299) return acceptedReceipt("http_accepted", status, true);
  if (status === 408 || status === 429 || status >= 500) return acceptedReceipt("uncertain", status, true);
  if (status >= 400 && status <= 499) return acceptedReceipt("failed", status, true);
  return { ok: false, code: "receipt_inconsistent" };
}

export function signExternalWebhookBody(secret: string, canonicalJson: string): string {
  if (typeof secret !== "string" || secret.trim().length === 0) {
    throw new Error("External webhook signing secret must be a non-empty string.");
  }
  if (typeof canonicalJson !== "string" || canonicalJson.length === 0) {
    throw new Error("External webhook signature covers the frozen canonical JSON.");
  }
  const hex = createHmac("sha256", secret).update(canonicalJson, "utf8").digest("hex");
  return `sha256=${hex}`;
}

export function externalWebhookRequestHeaders(input: {
  contractVersion: typeof EXTERNAL_WEBHOOK_PAYLOAD_CONTRACT_VERSION;
  idempotencyKey: string;
  mappingMode: "v3_canonical" | "published_column_map";
  mappingContentKey: string | null;
  destinationKind: "ghl_inbound" | "external_https";
  destinationRevision: number;
  signature: string | null;
}): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": EXTERNAL_WEBHOOK_HEADERS.contentType,
    [EXTERNAL_WEBHOOK_HEADERS.contract]: input.contractVersion,
    [EXTERNAL_WEBHOOK_HEADERS.idempotencyKey]: input.idempotencyKey,
    [EXTERNAL_WEBHOOK_HEADERS.mappingMode]: input.mappingMode,
    [EXTERNAL_WEBHOOK_HEADERS.mappingContentKey]: input.mappingContentKey ?? "",
    [EXTERNAL_WEBHOOK_HEADERS.destinationKind]: input.destinationKind,
    [EXTERNAL_WEBHOOK_HEADERS.destinationRevision]: String(input.destinationRevision),
  };
  if (input.signature) headers[EXTERNAL_WEBHOOK_HEADERS.signature] = input.signature;
  return headers;
}

function acceptedReceipt(
  outcome: ExternalWebhookDeliveryOutcomeName,
  httpStatus: number | null,
  requestLeftSa360: boolean
): { ok: true; receipt: ExternalWebhookReceipt } {
  return {
    ok: true,
    receipt: {
      outcome,
      httpStatus: outcome === "retryable" ? null : httpStatus,
      requestLeftSa360,
      proves: outcome === "http_accepted" ? [EXTERNAL_WEBHOOK_HTTP_PROOF] : [],
      doesNotProve: EXTERNAL_WEBHOOK_DOES_NOT_PROVE,
    },
  };
}

function requiredToken(value: string, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0 || value !== value.trim()) {
    throw new Error(`External webhook ${name} must be a non-empty trimmed string.`);
  }
  return value;
}
