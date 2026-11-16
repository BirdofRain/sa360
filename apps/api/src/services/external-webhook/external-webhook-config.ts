/**
 * Admin configuration for one client's external webhook destination.
 * Writes are idempotent on requestId. Responses contain hostname, kind, and
 * revision. They do not contain the endpoint URL or the HMAC secret, and they
 * do not POST a lead.
 */

import { createHash, randomUUID } from "node:crypto";

import { Prisma, type PrismaClient } from "@prisma/client";

import {
  decryptExternalWebhookUrl,
  encryptExternalWebhookSigningSecret,
  isExternalWebhookCredentialEncryptionConfigured,
  sealExternalWebhookEndpoint,
} from "../../lib/external-webhook-credentials.js";
import {
  nodeExternalWebhookResolver,
  validateExternalWebhookUrl,
  type ExternalWebhookResolver,
  type ExternalWebhookUrlRejection,
} from "../../lib/external-webhook-url-policy.js";
import { assessPrimaryCrmDelivery } from "./external-webhook-contract.js";

const SAVE = "save";
const ACTIVATION = "activation";

export const EXTERNAL_WEBHOOK_CANARY = {
  implemented: false,
  requiresOperatorApproval: true,
  sandboxEndpointOnly: true,
  observableReceipt: true,
  consumerLeadData: false,
  postsLead: false,
} as const;

type Kind = "ghl_inbound" | "external_https";
type AuthMode = "none" | "hmac_sha256";

export type ExternalWebhookConfigFailure = {
  ok: false;
  statusCode: 400 | 404 | 409 | 503;
  error:
    | "client_not_found"
    | "revision_conflict"
    | "request_id_conflict"
    | "auth_mode_rejected"
    | "signing_secret_required"
    | "signing_secret_rejected"
    | "endpoint_rejected"
    | "credentials_unavailable"
    | "destination_missing"
    | "primary_crm_conflict"
    | "destination_invalid";
  code?: ExternalWebhookUrlRejection;
  replayed: boolean;
};

export type ExternalWebhookDestinationView = {
  present: boolean;
  kind: Kind | null;
  authMode: AuthMode | null;
  hostname: string | null;
  enabled: boolean;
  revision: number;
  configurationValid: boolean;
  primaryCrmConflict: boolean;
  latestAttempt: {
    state: string;
    outcome: string | null;
    httpStatus: number | null;
    httpAccepted: boolean;
    provesCrmCreation: false;
  } | null;
};

export type ExternalWebhookConfigRead = { ok: true } & ExternalWebhookDestinationView & {
  clientAccountId: string;
};

type SavedFields = {
  clientAccountId: string;
  kind: Kind;
  authMode: AuthMode;
  hostname: string;
  enabled: boolean;
  revision: number;
  configurationValid: boolean;
  primaryCrmConflict: boolean;
};

export type ExternalWebhookSaveResult =
  | ({ ok: true; replayed: boolean } & SavedFields)
  | ExternalWebhookConfigFailure;

export type ExternalWebhookPreflight = {
  ok: true;
  postsLead: false;
  hostname: string | null;
  endpointValid: boolean;
  endpointCode: ExternalWebhookUrlRejection | null;
  authValid: boolean;
  authCode: "auth_mode_rejected" | "signing_secret_required" | "signing_secret_rejected" | null;
  credentialsReady: boolean;
  primaryCrmConflict: boolean;
  currentRevision: number;
  revisionMatches: boolean;
  canary: typeof EXTERNAL_WEBHOOK_CANARY;
};

type StoredSave = { kind: "save" } & SavedFields;

export async function readExternalWebhookDestination(
  db: PrismaClient,
  clientAccountId: string
): Promise<ExternalWebhookConfigRead | ExternalWebhookConfigFailure> {
  const id = clientAccountId.trim();
  if (!id) return failure(404, "client_not_found");
  const client = await db.clientAccount.findUnique({
    where: { clientAccountId: id },
    select: {
      clientAccountId: true,
      ghlDestination: {
        select: {
          deliveryEnabled: true,
          deliveryMode: true,
          clientCutoverApproved: true,
          internalApprovalStatus: true,
          destinationSubaccountIdGhl: true,
        },
      },
      externalWebhookDestination: true,
      externalWebhookDeliveryAttempts: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { state: true, outcome: true, httpStatus: true },
      },
    },
  });
  if (!client) return failure(404, "client_not_found");
  const row = client.externalWebhookDestination;
  const conflict = assessPrimaryCrmDelivery({
    ghl: client.ghlDestination,
    externalWebhookEnabled: true,
  }).ok === false;
  const latest = client.externalWebhookDeliveryAttempts[0] ?? null;
  if (!row) {
    return {
      ok: true,
      clientAccountId: id,
      present: false,
      kind: null,
      authMode: null,
      hostname: null,
      enabled: false,
      revision: 0,
      configurationValid: false,
      primaryCrmConflict: conflict,
      latestAttempt: latest ? attemptView(latest) : null,
    };
  }
  return {
    ok: true,
    clientAccountId: id,
    present: true,
    kind: row.kind,
    authMode: row.authMode,
    hostname: row.endpointHost,
    enabled: row.enabled,
    revision: row.revision,
    configurationValid: configurationValid(row),
    primaryCrmConflict: conflict,
    latestAttempt: latest ? attemptView(latest) : null,
  };
}

export async function preflightExternalWebhookDestination(
  db: PrismaClient,
  input: {
    clientAccountId: string;
    expectedRevision: number;
    kind: Kind;
    authMode: AuthMode;
    endpointUrl: string;
    signingSecret?: string | null;
  },
  resolve: ExternalWebhookResolver = nodeExternalWebhookResolver
): Promise<ExternalWebhookPreflight | ExternalWebhookConfigFailure> {
  const clientAccountId = input.clientAccountId.trim();
  if (!clientAccountId) return failure(404, "client_not_found");
  const client = await db.clientAccount.findUnique({
    where: { clientAccountId },
    select: {
      externalWebhookDestination: { select: { revision: true } },
      ghlDestination: {
        select: {
          deliveryEnabled: true,
          deliveryMode: true,
          clientCutoverApproved: true,
          internalApprovalStatus: true,
          destinationSubaccountIdGhl: true,
        },
      },
    },
  });
  if (!client) return failure(404, "client_not_found");
  const auth = authProblem(input.kind, input.authMode, input.signingSecret);
  const credentialsReady = isExternalWebhookCredentialEncryptionConfigured();
  let hostname: string | null = null;
  let endpointValid = false;
  let endpointCode: ExternalWebhookUrlRejection | null = null;
  if (credentialsReady) {
    const checked = await validateExternalWebhookUrl(input.endpointUrl, resolve);
    if (checked.ok) {
      endpointValid = true;
      hostname = checked.hostname;
    } else {
      endpointCode = checked.code;
    }
  }
  const currentRevision = client.externalWebhookDestination?.revision ?? 0;
  return {
    ok: true,
    postsLead: false,
    hostname,
    endpointValid,
    endpointCode,
    authValid: auth == null,
    authCode: auth,
    credentialsReady,
    primaryCrmConflict: !assessPrimaryCrmDelivery({ ghl: client.ghlDestination, externalWebhookEnabled: true }).ok,
    currentRevision,
    revisionMatches: input.expectedRevision === currentRevision,
    canary: EXTERNAL_WEBHOOK_CANARY,
  };
}

export async function saveExternalWebhookDestination(
  db: PrismaClient,
  input: {
    clientAccountId: string;
    requestId: string;
    expectedRevision: number;
    kind: Kind;
    authMode: AuthMode;
    endpointUrl: string;
    signingSecret?: string | null;
  },
  resolve: ExternalWebhookResolver = nodeExternalWebhookResolver
): Promise<ExternalWebhookSaveResult> {
  const clientAccountId = input.clientAccountId.trim();
  if (!clientAccountId) return failure(404, "client_not_found");
  const auth = authProblem(input.kind, input.authMode, input.signingSecret);
  if (auth) return failure(400, auth);
  if (!isExternalWebhookCredentialEncryptionConfigured()) return failure(503, "credentials_unavailable");
  const payloadHash = hashPayload({
    action: SAVE,
    clientAccountId,
    expectedRevision: input.expectedRevision,
    kind: input.kind,
    authMode: input.authMode,
    endpointUrl: input.endpointUrl,
    signingSecret: input.signingSecret?.trim() ?? "",
  });

  try {
    return await db.$transaction(async (tx) => {
      await lockRequest(tx, input.requestId);
      const prior = await replay(tx, input.requestId, clientAccountId, SAVE, payloadHash);
      if (prior) return prior;
      const client = await lockClient(tx, clientAccountId);
      if (!client) return failure(404, "client_not_found");
      const existing = await lockDestination(tx, clientAccountId);
      const currentRevision = existing?.revision ?? 0;
      if (input.expectedRevision !== currentRevision) return failure(409, "revision_conflict");
      const sealed = await sealExternalWebhookEndpoint(input.endpointUrl, resolve);
      if (!sealed.ok) return failure(409, "endpoint_rejected", sealed.code);
      const secret =
        input.authMode === "hmac_sha256" ? encryptExternalWebhookSigningSecret(input.signingSecret ?? "") : null;
      if (!existing) {
        await tx.clientExternalWebhookDestination.create({
          data: {
            id: randomUUID(),
            clientAccountId,
            kind: input.kind,
            authMode: input.authMode,
            crmRole: "primary_crm",
            endpointUrlCiphertext: sealed.endpoint.ciphertext,
            endpointUrlFingerprint: sealed.endpoint.fingerprint,
            endpointHost: sealed.endpoint.hostname,
            signingSecretCiphertext: secret?.ciphertext ?? null,
            signingSecretFingerprint: secret?.fingerprint ?? null,
            enabled: false,
            revision: 1,
          },
        });
      } else {
        await tx.clientExternalWebhookDestination.update({
          where: { clientAccountId },
          data: {
            kind: input.kind,
            authMode: input.authMode,
            endpointUrlCiphertext: sealed.endpoint.ciphertext,
            endpointUrlFingerprint: sealed.endpoint.fingerprint,
            endpointHost: sealed.endpoint.hostname,
            signingSecretCiphertext: secret?.ciphertext ?? null,
            signingSecretFingerprint: secret?.fingerprint ?? null,
            enabled: false,
            revision: existing.revision + 1,
          },
        });
      }
      const saved = await savedView(tx, clientAccountId);
      await store(tx, input.requestId, clientAccountId, SAVE, payloadHash, saved);
      return { ok: true, replayed: false, ...saved };
    });
  } catch (error) {
    if (isPrimaryCrmConflict(error)) return failure(409, "primary_crm_conflict");
    throw error;
  }
}

export async function setExternalWebhookDestinationEnabled(
  db: PrismaClient,
  input: {
    clientAccountId: string;
    requestId: string;
    expectedRevision: number;
    enabled: boolean;
  },
  resolve: ExternalWebhookResolver = nodeExternalWebhookResolver
): Promise<ExternalWebhookSaveResult> {
  const clientAccountId = input.clientAccountId.trim();
  if (!clientAccountId) return failure(404, "client_not_found");
  const payloadHash = hashPayload({
    action: ACTIVATION,
    clientAccountId,
    expectedRevision: input.expectedRevision,
    enabled: input.enabled,
  });

  try {
    return await db.$transaction(async (tx) => {
      await lockRequest(tx, input.requestId);
      const prior = await replay(tx, input.requestId, clientAccountId, ACTIVATION, payloadHash);
      if (prior) return prior;
      const client = await lockClient(tx, clientAccountId);
      if (!client) return failure(404, "client_not_found");
      const existing = await lockDestination(tx, clientAccountId);
      if (!existing) return failure(409, "destination_missing");
      if (input.expectedRevision !== existing.revision) return failure(409, "revision_conflict");
      if (input.enabled) {
        const ready = await activationReady(existing, resolve);
        if (!ready.ok) return ready;
      }
      const ghl = await tx.clientGhlDestination.findUnique({ where: { clientAccountId } });
      if (input.enabled && !assessPrimaryCrmDelivery({ ghl, externalWebhookEnabled: true }).ok) {
        return failure(409, "primary_crm_conflict");
      }
      await tx.clientExternalWebhookDestination.update({
        where: { clientAccountId },
        data: { enabled: input.enabled, revision: existing.revision + 1 },
      });
      const saved = await savedView(tx, clientAccountId);
      await store(tx, input.requestId, clientAccountId, ACTIVATION, payloadHash, saved);
      return { ok: true, replayed: false, ...saved };
    });
  } catch (error) {
    if (isPrimaryCrmConflict(error)) return failure(409, "primary_crm_conflict");
    throw error;
  }
}

async function activationReady(
  row: {
    kind: Kind;
    authMode: AuthMode;
    endpointHost: string;
    endpointUrlCiphertext: string;
    signingSecretCiphertext: string | null;
    signingSecretFingerprint: string | null;
  },
  resolve: ExternalWebhookResolver
): Promise<{ ok: true } | ExternalWebhookConfigFailure> {
  if (!isExternalWebhookCredentialEncryptionConfigured()) return failure(503, "credentials_unavailable");
  if (!configurationValid(row)) return failure(409, "destination_invalid");
  let url: string;
  try {
    url = decryptExternalWebhookUrl(row.endpointUrlCiphertext);
  } catch {
    return failure(503, "credentials_unavailable");
  }
  const checked = await validateExternalWebhookUrl(url, resolve);
  if (!checked.ok) return failure(409, "endpoint_rejected", checked.code);
  if (checked.hostname !== row.endpointHost) return failure(409, "endpoint_rejected");
  return { ok: true };
}

function authProblem(
  kind: Kind,
  authMode: AuthMode,
  signingSecret: string | null | undefined
): "auth_mode_rejected" | "signing_secret_required" | "signing_secret_rejected" | null {
  const secret = signingSecret?.trim() ?? "";
  if (kind === "ghl_inbound" && authMode !== "none") return "auth_mode_rejected";
  if (authMode === "hmac_sha256" && !secret) return "signing_secret_required";
  if (authMode === "none" && secret) return "signing_secret_rejected";
  return null;
}

function configurationValid(row: {
  kind: Kind;
  authMode: AuthMode;
  endpointHost: string;
  signingSecretCiphertext: string | null;
  signingSecretFingerprint: string | null;
}): boolean {
  if (!row.endpointHost.trim()) return false;
  if (row.kind === "ghl_inbound" && row.authMode !== "none") return false;
  if (row.authMode === "none") return row.signingSecretCiphertext == null && row.signingSecretFingerprint == null;
  return Boolean(row.signingSecretCiphertext && row.signingSecretFingerprint);
}

function attemptView(row: { state: string; outcome: string | null; httpStatus: number | null }) {
  return {
    state: row.state,
    outcome: row.outcome,
    httpStatus: row.httpStatus,
    httpAccepted: row.outcome === "http_accepted",
    provesCrmCreation: false as const,
  };
}

async function savedView(tx: Prisma.TransactionClient, clientAccountId: string): Promise<SavedFields> {
  const row = await tx.clientExternalWebhookDestination.findUniqueOrThrow({ where: { clientAccountId } });
  const ghl = await tx.clientGhlDestination.findUnique({ where: { clientAccountId } });
  return {
    clientAccountId,
    kind: row.kind,
    authMode: row.authMode,
    hostname: row.endpointHost,
    enabled: row.enabled,
    revision: row.revision,
    configurationValid: configurationValid(row),
    primaryCrmConflict: !assessPrimaryCrmDelivery({ ghl, externalWebhookEnabled: true }).ok,
  };
}

async function replay(
  tx: Prisma.TransactionClient,
  requestId: string,
  clientAccountId: string,
  action: string,
  payloadHash: string
): Promise<ExternalWebhookSaveResult | null> {
  const prior = await tx.externalWebhookDestinationConfigRequest.findUnique({ where: { requestId } });
  if (!prior) return null;
  if (prior.clientAccountId !== clientAccountId || prior.action !== action || prior.payloadHash !== payloadHash) {
    return failure(409, "request_id_conflict");
  }
  const stored = prior.resultJson;
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return failure(409, "request_id_conflict");
  const record = stored as SavedFields;
  if (typeof record.hostname !== "string" || typeof record.revision !== "number") {
    return failure(409, "request_id_conflict");
  }
  return { ok: true, replayed: true, ...record, clientAccountId };
}

async function store(
  tx: Prisma.TransactionClient,
  requestId: string,
  clientAccountId: string,
  action: string,
  payloadHash: string,
  saved: SavedFields
): Promise<void> {
  await tx.externalWebhookDestinationConfigRequest.create({
    data: { requestId, clientAccountId, action, payloadHash, resultJson: saved as Prisma.InputJsonValue },
  });
}

async function lockRequest(tx: Prisma.TransactionClient, requestId: string): Promise<void> {
  await tx.$queryRaw`SELECT 1 AS "locked" FROM pg_advisory_xact_lock(hashtext(${requestId}))`;
}

async function lockClient(tx: Prisma.TransactionClient, clientAccountId: string): Promise<boolean> {
  const rows = await tx.$queryRaw<Array<{ clientAccountId: string }>>`
    SELECT "clientAccountId" FROM "ClientAccount" WHERE "clientAccountId" = ${clientAccountId} FOR UPDATE
  `;
  return rows.length === 1;
}

async function lockDestination(tx: Prisma.TransactionClient, clientAccountId: string) {
  await tx.$queryRaw`
    SELECT "id" FROM "ClientExternalWebhookDestination" WHERE "clientAccountId" = ${clientAccountId} FOR UPDATE
  `;
  return tx.clientExternalWebhookDestination.findUnique({ where: { clientAccountId } });
}

function hashPayload(value: Record<string, unknown>): string {
  const stable: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) stable[key] = value[key];
  return createHash("sha256").update(JSON.stringify(stable)).digest("hex");
}

function failure(
  statusCode: ExternalWebhookConfigFailure["statusCode"],
  error: ExternalWebhookConfigFailure["error"],
  code?: ExternalWebhookUrlRejection
): ExternalWebhookConfigFailure {
  return { ok: false, statusCode, error, ...(code ? { code } : {}), replayed: false };
}

function isPrimaryCrmConflict(error: unknown): boolean {
  return String(error).includes("duplicate_primary_crm");
}
