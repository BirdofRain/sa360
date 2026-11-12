/**
 * Durable request for a proposed client source and campaign association.
 *
 * The row is not a SourceFunnel and not a CampaignRoutingRule. Recording,
 * rejecting, or superseding it does not confirm origin, stamp inventory,
 * create or edit a routing rule, or arm GoHighLevel, Company Sheets, or a webhook.
 *
 * A repeat of the same request id returns the stored result. A stale request
 * revision or an unreadable setup is not stored.
 */

import { createHash } from "node:crypto";

import { Prisma, type PrismaClient } from "@prisma/client";

import { isClientOnboardingSetupEnabled } from "../../lib/client-onboarding-setup-env.js";
import { acceptedOnboardingActor } from "../../lib/onboarding-staff-actor.js";
import { isSourceCampaignRequestEnabled } from "../../lib/source-campaign-request-env.js";
import {
  SOURCE_CAMPAIGN_MATCH_LIMIT,
  parseSavedSetupSourceIdentity,
  type SavedSetupSourceIdentity,
} from "../team-workspace/source-campaign-review-read.js";
import {
  reviewSavedSourceCampaignRequest,
  type KnownCampaignRule,
  type KnownSourceFunnel,
  type SourceCampaignRequestReview,
} from "./source-association-request-review.js";

const TRANSACTION = { timeout: 10_000 } as const;

const BOUNDARY = {
  associationApplied: false as const,
  routingRuleApplied: false as const,
  deliveryArmed: false as const,
  confirmedOperationalAssociation: false as const,
};

export type SourceCampaignRequestError =
  | "client_not_found"
  | "feature_disabled"
  | "revision_conflict"
  | "request_id_conflict"
  | "setup_unavailable"
  | "setup_unreadable"
  | "setup_stale"
  | "setup_incomplete"
  | "setup_mismatch"
  | "ownership_unverified"
  | "no_open_request"
  | "unreadable_request"
  | "source_owned_by_other_client"
  | "ambiguous_source"
  | "campaign_owned_by_other_client"
  | "actor_rejected";

type OwnershipRejection =
  | "source_owned_by_other_client"
  | "ambiguous_source"
  | "campaign_owned_by_other_client";

export type SourceCampaignRequestFailure = typeof BOUNDARY & {
  ok: false;
  statusCode: 403 | 404 | 409;
  error: SourceCampaignRequestError;
  replayed: boolean;
  status?: "rejected";
  requestId?: string;
  associationRequestId?: string;
  revision?: number;
  setupRevision?: number;
  providerFunnelId?: string | null;
  parentUrlKey?: string | null;
  providerCampaignId?: string | null;
  requestedAssociation?: false;
  observedSourceStatus?: string | null;
  observedCampaignStatus?: string | null;
  dispositionReason?: string | null;
  supersededRequestId?: string | null;
};

export type SourceCampaignRequestSuccess = typeof BOUNDARY & {
  ok: true;
  replayed: boolean;
  status: "requested" | "rejected";
  requestId: string;
  associationRequestId: string;
  clientAccountId: string;
  revision: number;
  setupRevision: number;
  providerFunnelId: string | null;
  parentUrlKey: string | null;
  providerCampaignId: string;
  requestedAssociation: boolean;
  observedSourceStatus: string | null;
  observedCampaignStatus: string | null;
  dispositionReason: string | null;
  supersededRequestId: string | null;
};

export type SourceCampaignRequestResult = SourceCampaignRequestSuccess | SourceCampaignRequestFailure;

export type SourceCampaignRequestHead = typeof BOUNDARY & {
  ok: true;
  clientAccountId: string;
  revision: number;
  openRequest: {
    requestId: string;
    status: "requested";
    revision: number;
    setupRevision: number;
    providerFunnelId: string | null;
    parentUrlKey: string | null;
    providerCampaignId: string;
    requestedAssociation: true;
    createdAt: string;
  } | null;
};

type RecordCommand = {
  intent: "request";
  clientAccountId: string;
  requestId: string;
  expectedRevision: number;
  setupRevision: number;
  providerFunnelId: string | null;
  parentUrlKey: string | null;
  providerCampaignId: string | null;
};

type RejectCommand = {
  intent: "reject";
  clientAccountId: string;
  requestId: string;
  expectedRevision: number;
  setupRevision: number;
};

export type SourceCampaignRequestCommand = RecordCommand | RejectCommand;

type StoredSnapshot = {
  version: 1;
  ok: boolean;
  statusCode: 200 | 409;
  error: SourceCampaignRequestError | null;
  status: "requested" | "rejected";
  requestId: string;
  associationRequestId: string;
  clientAccountId: string;
  revision: number;
  setupRevision: number;
  providerFunnelId: string | null;
  parentUrlKey: string | null;
  providerCampaignId: string;
  requestedAssociation: boolean;
  observedSourceStatus: string | null;
  observedCampaignStatus: string | null;
  dispositionReason: string | null;
  supersededRequestId: string | null;
  associationApplied: false;
  routingRuleApplied: false;
  deliveryArmed: false;
  confirmedOperationalAssociation: false;
};

/**
 * Read the concurrency token and the one open proposal.
 * This does not load a source, a routing rule, or a delivery receipt.
 */
export async function readSourceCampaignAssociationHead(
  db: PrismaClient,
  clientAccountId: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<SourceCampaignRequestHead | SourceCampaignRequestFailure> {
  if (!isSourceCampaignRequestEnabled(env)) return failure(404, "feature_disabled");
  const id = clientAccountId.trim();
  if (!id) return failure(404, "client_not_found");
  const client = await db.clientAccount.findUnique({
    where: { clientAccountId: id },
    select: { clientAccountId: true },
  });
  if (!client) return failure(404, "client_not_found");
  const [open, max] = await Promise.all([
    db.sourceCampaignAssociationRequest.findFirst({
      where: { clientAccountId: id, status: "requested" },
    }),
    db.sourceCampaignAssociationRequest.aggregate({
      where: { clientAccountId: id },
      _max: { revision: true },
    }),
  ]);
  return {
    ...BOUNDARY,
    ok: true,
    clientAccountId: id,
    revision: max._max.revision ?? 0,
    openRequest: open
      ? {
          requestId: open.requestId,
          status: "requested",
          revision: open.revision,
          setupRevision: open.setupRevision,
          providerFunnelId: open.providerFunnelId,
          parentUrlKey: open.parentUrlKey,
          providerCampaignId: open.providerCampaignId,
          requestedAssociation: true,
          createdAt: open.createdAt.toISOString(),
        }
      : null,
  };
}

/**
 * Record, reject, or supersede a proposal. The same request id returns the
 * stored result and does not write again. Ownership and ambiguity rejections
 * are stored as rejected. Stale and unreadable setup data is not stored.
 */
export async function recordSourceCampaignAssociationRequest(
  db: PrismaClient,
  command: SourceCampaignRequestCommand,
  env: NodeJS.ProcessEnv = process.env,
  actor?: string
): Promise<SourceCampaignRequestResult> {
  if (!isSourceCampaignRequestEnabled(env)) return failure(404, "feature_disabled");
  const clientAccountId = command.clientAccountId.trim();
  if (!clientAccountId) return failure(404, "client_not_found");
  const recordedActor = acceptedOnboardingActor(actor);
  if (!recordedActor) return failure(403, "actor_rejected");
  try {
    return await db.$transaction(
      (tx) => applyCommand(tx, { ...command, clientAccountId }, env, recordedActor),
      TRANSACTION
    );
  } catch (error) {
    if (isUniqueConflict(error)) return failure(409, "revision_conflict");
    throw error;
  }
}

async function applyCommand(
  tx: Prisma.TransactionClient,
  command: SourceCampaignRequestCommand,
  env: NodeJS.ProcessEnv,
  actor: string
): Promise<SourceCampaignRequestResult> {
  await tx.$queryRaw`
    SELECT 1 AS "locked"
    FROM pg_advisory_xact_lock(hashtext(${command.requestId}))
  `;
  const lockedClient = await tx.$queryRaw<Array<{ clientAccountId: string }>>`
    SELECT "clientAccountId"
    FROM "ClientAccount"
    WHERE "clientAccountId" = ${command.clientAccountId}
    FOR UPDATE
  `;
  if (lockedClient.length === 0) return failure(404, "client_not_found");

  await tx.$queryRaw`
    SELECT "id"
    FROM "SourceCampaignAssociationRequest"
    WHERE "clientAccountId" = ${command.clientAccountId}
    FOR UPDATE
  `;

  const replay = await replayCommand(tx, command);
  if (replay) return replay;

  const currentRevision = await headRevision(tx, command.clientAccountId);
  if (command.expectedRevision !== currentRevision) return failure(409, "revision_conflict");

  const setup = await lockedSetup(tx, command.clientAccountId, env);
  if (!setup.ok) return setup.failure;
  if (setup.revision !== command.setupRevision) return failure(409, "setup_stale");

  if (command.intent === "reject") {
    return rejectOpen(tx, command, setup.revision, currentRevision);
  }
  return recordProposal(tx, command, setup.identity, setup.revision, currentRevision, actor);
}

async function recordProposal(
  tx: Prisma.TransactionClient,
  command: RecordCommand,
  identity: SavedSetupSourceIdentity,
  setupRevision: number,
  currentRevision: number,
  actor: string
): Promise<SourceCampaignRequestResult> {
  if (!identity.providerFunnelId && !identity.parentUrlKey) return failure(409, "setup_incomplete");
  if (!identity.providerCampaignId) return failure(409, "setup_incomplete");
  const echoed = {
    providerFunnelId: blank(command.providerFunnelId),
    parentUrlKey: blank(command.parentUrlKey),
    providerCampaignId: blank(command.providerCampaignId),
  };
  if (
    echoed.providerFunnelId !== identity.providerFunnelId ||
    echoed.parentUrlKey !== identity.parentUrlKey ||
    echoed.providerCampaignId !== identity.providerCampaignId
  ) {
    return failure(409, "setup_mismatch");
  }

  const loaded = await loadRegistries(tx, identity);
  if (!loaded.ok) return loaded.failure;
  const review = reviewSavedSourceCampaignRequest({
    clientAccountId: command.clientAccountId,
    requestId: command.requestId,
    requestStatus: "saved",
    loadedRevision: setupRevision,
    currentRevision: setupRevision,
    providerFunnelId: identity.providerFunnelId,
    parentUrlKey: identity.parentUrlKey,
    providerCampaignId: identity.providerCampaignId,
    funnels: loaded.funnels,
    rules: loaded.rules,
  });
  if (review.sourceStatus === "incomplete" || review.campaignStatus === "incomplete") {
    return failure(409, "setup_incomplete");
  }

  const reason = ownershipRejection(review, loaded.rules, command.clientAccountId);
  const open = await tx.sourceCampaignAssociationRequest.findFirst({
    where: { clientAccountId: command.clientAccountId, status: "requested" },
  });
  const revision = currentRevision + 1;
  const snapshot = snapshotFor({
    ok: reason === null,
    statusCode: reason === null ? 200 : 409,
    error: reason,
    status: reason === null ? "requested" : "rejected",
    requestId: command.requestId,
    associationRequestId: command.requestId,
    clientAccountId: command.clientAccountId,
    revision,
    setupRevision,
    providerFunnelId: identity.providerFunnelId,
    parentUrlKey: identity.parentUrlKey,
    providerCampaignId: identity.providerCampaignId,
    observedSourceStatus: review.sourceStatus,
    observedCampaignStatus: review.campaignStatus,
    dispositionReason: reason,
    supersededRequestId: reason === null && open ? open.requestId : null,
  });
  const payloadHash = commandHash(command);

  if (reason === null && open) {
    await tx.sourceCampaignAssociationRequest.update({
      where: { id: open.id },
      data: {
        status: "superseded",
        supersededAt: new Date(),
        supersededByRequestId: command.requestId,
        dispositionReason: "superseded_by_later_request",
      },
    });
  }

  await tx.sourceCampaignAssociationRequest.create({
    data: {
      requestId: command.requestId,
      clientAccountId: command.clientAccountId,
      historicalClientAccountId: command.clientAccountId,
      expectedRevision: command.expectedRevision,
      revision,
      setupRevision,
      providerFunnelId: identity.providerFunnelId,
      parentUrlKey: identity.parentUrlKey,
      providerCampaignId: identity.providerCampaignId,
      status: reason === null ? "requested" : "rejected",
      payloadHash,
      recordResultJson: snapshot,
      actor,
      dispositionReason: reason,
      rejectedAt: reason === null ? null : new Date(),
    },
  });
  return toResult(snapshot, false);
}

async function rejectOpen(
  tx: Prisma.TransactionClient,
  command: RejectCommand,
  setupRevision: number,
  currentRevision: number
): Promise<SourceCampaignRequestResult> {
  const open = await tx.sourceCampaignAssociationRequest.findFirst({
    where: { clientAccountId: command.clientAccountId, status: "requested" },
  });
  if (!open) return failure(409, "no_open_request");
  const prior = readSnapshot(open.recordResultJson);
  if (!prior || prior.clientAccountId !== command.clientAccountId) return failure(409, "unreadable_request");
  const revision = currentRevision + 1;
  const snapshot = snapshotFor({
    ok: true,
    statusCode: 200,
    error: null,
    status: "rejected",
    requestId: command.requestId,
    associationRequestId: open.requestId,
    clientAccountId: command.clientAccountId,
    revision,
    setupRevision,
    providerFunnelId: open.providerFunnelId,
    parentUrlKey: open.parentUrlKey,
    providerCampaignId: open.providerCampaignId,
    observedSourceStatus: prior.observedSourceStatus,
    observedCampaignStatus: prior.observedCampaignStatus,
    dispositionReason: "operator_rejected",
    supersededRequestId: null,
  });
  await tx.sourceCampaignAssociationRequest.update({
    where: { id: open.id },
    data: {
      status: "rejected",
      revision,
      dispositionReason: "operator_rejected",
      rejectionRequestId: command.requestId,
      rejectionPayloadHash: commandHash(command),
      rejectionResultJson: snapshot,
      rejectedAt: new Date(),
    },
  });
  return toResult(snapshot, false);
}

async function replayCommand(
  tx: Prisma.TransactionClient,
  command: SourceCampaignRequestCommand
): Promise<SourceCampaignRequestResult | null> {
  const recorded = await tx.sourceCampaignAssociationRequest.findUnique({ where: { requestId: command.requestId } });
  const rejected = await tx.sourceCampaignAssociationRequest.findUnique({
    where: { rejectionRequestId: command.requestId },
  });
  if (recorded && rejected) return failure(409, "request_id_conflict");
  if (command.intent === "request") {
    if (rejected) return failure(409, "request_id_conflict");
    if (!recorded) return null;
    return replayStored(recorded, command, recorded.payloadHash, recorded.recordResultJson);
  }
  if (recorded) return failure(409, "request_id_conflict");
  if (!rejected || !rejected.rejectionPayloadHash) return null;
  return replayStored(rejected, command, rejected.rejectionPayloadHash, rejected.rejectionResultJson);
}

function replayStored(
  row: { clientAccountId: string },
  command: SourceCampaignRequestCommand,
  storedHash: string,
  storedJson: Prisma.JsonValue | null
): SourceCampaignRequestResult {
  if (row.clientAccountId !== command.clientAccountId || storedHash !== commandHash(command)) {
    return failure(409, "request_id_conflict");
  }
  const snapshot = readSnapshot(storedJson);
  if (!snapshot || snapshot.requestId !== command.requestId || snapshot.clientAccountId !== command.clientAccountId) {
    return failure(409, "request_id_conflict");
  }
  return toResult(snapshot, true);
}

async function lockedSetup(
  tx: Prisma.TransactionClient,
  clientAccountId: string,
  env: NodeJS.ProcessEnv
): Promise<
  | { ok: true; revision: number; identity: SavedSetupSourceIdentity }
  | { ok: false; failure: SourceCampaignRequestFailure }
> {
  if (!isClientOnboardingSetupEnabled(env)) return { ok: false, failure: failure(409, "setup_unavailable") };
  await tx.$queryRaw`
    SELECT "clientAccountId"
    FROM "ClientOnboardingSetup"
    WHERE "clientAccountId" = ${clientAccountId}
    FOR UPDATE
  `;
  const setup = await tx.clientOnboardingSetup.findUnique({
    where: { clientAccountId },
    select: { revision: true, setupDataJson: true },
  });
  if (!setup || !Number.isInteger(setup.revision)) return { ok: false, failure: failure(409, "setup_unavailable") };
  const parsed = parseSavedSetupSourceIdentity(setup.setupDataJson);
  if (!parsed.readable) return { ok: false, failure: failure(409, "setup_unreadable") };
  return { ok: true, revision: setup.revision, identity: parsed.identity };
}

async function loadRegistries(
  tx: Prisma.TransactionClient,
  identity: SavedSetupSourceIdentity
): Promise<
  | { ok: true; funnels: KnownSourceFunnel[]; rules: KnownCampaignRule[] }
  | { ok: false; failure: SourceCampaignRequestFailure }
> {
  const filters = [
    identity.providerFunnelId ? { providerFunnelId: identity.providerFunnelId } : null,
    identity.parentUrlKey ? { parentUrlKey: identity.parentUrlKey } : null,
  ].filter((item): item is { providerFunnelId: string } | { parentUrlKey: string } => Boolean(item));
  const funnels = filters.length
    ? await tx.sourceFunnel.findMany({
        where: { OR: filters },
        select: {
          id: true,
          provider: true,
          providerFunnelId: true,
          parentUrlKey: true,
          pageSlug: true,
          associationStatus: true,
          originClientAccountId: true,
          suggestedClientAccountId: true,
        },
        take: SOURCE_CAMPAIGN_MATCH_LIMIT + 1,
      })
    : [];
  const rules = identity.providerCampaignId
    ? await tx.campaignRoutingRule.findMany({
        where: { campaignId: identity.providerCampaignId },
        select: {
          id: true,
          clientAccountId: true,
          campaignId: true,
          active: true,
          deliveryEnabled: true,
          effectiveStart: true,
          effectiveEnd: true,
        },
        take: SOURCE_CAMPAIGN_MATCH_LIMIT + 1,
      })
    : [];
  if (funnels.length > SOURCE_CAMPAIGN_MATCH_LIMIT || rules.length > SOURCE_CAMPAIGN_MATCH_LIMIT) {
    return { ok: false, failure: failure(409, "ownership_unverified") };
  }
  return { ok: true, funnels, rules };
}

function ownershipRejection(
  review: SourceCampaignRequestReview,
  rules: KnownCampaignRule[],
  clientAccountId: string
): OwnershipRejection | null {
  if (review.sourceStatus === "ambiguous") return "ambiguous_source";
  if (review.sourceStatus === "confirmed_for_other_client") return "source_owned_by_other_client";
  if (rules.some((rule) => rule.clientAccountId.trim() !== clientAccountId)) {
    return "campaign_owned_by_other_client";
  }
  return null;
}

async function headRevision(tx: Prisma.TransactionClient, clientAccountId: string): Promise<number> {
  const max = await tx.sourceCampaignAssociationRequest.aggregate({
    where: { clientAccountId },
    _max: { revision: true },
  });
  return max._max.revision ?? 0;
}

function snapshotFor(input: Omit<StoredSnapshot, "version" | keyof typeof BOUNDARY | "requestedAssociation">): StoredSnapshot {
  return {
    version: 1,
    ...input,
    requestedAssociation: input.status === "requested",
    ...BOUNDARY,
  };
}

function toResult(snapshot: StoredSnapshot, replayed: boolean): SourceCampaignRequestResult {
  if (!snapshot.ok) {
    return {
      ...BOUNDARY,
      ok: false,
      statusCode: 409,
      error: snapshot.error ?? "request_id_conflict",
      replayed,
      status: "rejected",
      requestId: snapshot.requestId,
      associationRequestId: snapshot.associationRequestId,
      revision: snapshot.revision,
      setupRevision: snapshot.setupRevision,
      providerFunnelId: snapshot.providerFunnelId,
      parentUrlKey: snapshot.parentUrlKey,
      providerCampaignId: snapshot.providerCampaignId,
      requestedAssociation: false,
      observedSourceStatus: snapshot.observedSourceStatus,
      observedCampaignStatus: snapshot.observedCampaignStatus,
      dispositionReason: snapshot.dispositionReason,
      supersededRequestId: snapshot.supersededRequestId,
    };
  }
  return {
    ...BOUNDARY,
    ok: true,
    replayed,
    status: snapshot.status,
    requestId: snapshot.requestId,
    associationRequestId: snapshot.associationRequestId,
    clientAccountId: snapshot.clientAccountId,
    revision: snapshot.revision,
    setupRevision: snapshot.setupRevision,
    providerFunnelId: snapshot.providerFunnelId,
    parentUrlKey: snapshot.parentUrlKey,
    providerCampaignId: snapshot.providerCampaignId,
    requestedAssociation: snapshot.status === "requested",
    observedSourceStatus: snapshot.observedSourceStatus,
    observedCampaignStatus: snapshot.observedCampaignStatus,
    dispositionReason: snapshot.dispositionReason,
    supersededRequestId: snapshot.supersededRequestId,
  };
}

function readSnapshot(value: Prisma.JsonValue | null): StoredSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (row.version !== 1) return null;
  if (row.associationApplied !== false || row.routingRuleApplied !== false) return null;
  if (row.deliveryArmed !== false || row.confirmedOperationalAssociation !== false) return null;
  if (row.status !== "requested" && row.status !== "rejected") return null;
  if (row.ok !== true && row.ok !== false) return null;
  if (row.statusCode !== 200 && row.statusCode !== 409) return null;
  if (typeof row.requestId !== "string" || typeof row.associationRequestId !== "string") return null;
  if (typeof row.clientAccountId !== "string") return null;
  if (typeof row.revision !== "number" || typeof row.setupRevision !== "number") return null;
  if (typeof row.providerCampaignId !== "string") return null;
  if (!nullableText(row.providerFunnelId) || !nullableText(row.parentUrlKey)) return null;
  if (!nullableText(row.observedSourceStatus) || !nullableText(row.observedCampaignStatus)) return null;
  if (!nullableText(row.dispositionReason) || !nullableText(row.supersededRequestId)) return null;
  if (typeof row.error !== "string" && row.error !== null) return null;
  return row as unknown as StoredSnapshot;
}

function nullableText(value: unknown): boolean {
  return value === null || typeof value === "string";
}

function commandHash(command: SourceCampaignRequestCommand): string {
  if (command.intent === "reject") {
    return hashPayload({
      action: "reject",
      clientAccountId: command.clientAccountId,
      expectedRevision: command.expectedRevision,
      setupRevision: command.setupRevision,
    });
  }
  return hashPayload({
    action: "request",
    clientAccountId: command.clientAccountId,
    expectedRevision: command.expectedRevision,
    setupRevision: command.setupRevision,
    providerFunnelId: blank(command.providerFunnelId),
    parentUrlKey: blank(command.parentUrlKey),
    providerCampaignId: blank(command.providerCampaignId),
  });
}

function hashPayload(value: Record<string, unknown>): string {
  const stable: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) stable[key] = value[key];
  return createHash("sha256").update(JSON.stringify(stable)).digest("hex");
}

function blank(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed : null;
}

function failure(statusCode: 403 | 404 | 409, error: SourceCampaignRequestError): SourceCampaignRequestFailure {
  return { ...BOUNDARY, ok: false, statusCode, error, replayed: false };
}

function isUniqueConflict(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "P2002";
}
