/**
 * Durable operator grant for one frozen campaign GHL operation.
 *
 * The shared admin key or a live admin_coc staff principal can issue or revoke
 * a grant. Registry status, a MATCHED shadow row, and a browser actor label
 * cannot. Issuing a grant does not update the shadow row and does not call
 * GoHighLevel. A grant for one event, campaign, workflow, or location does
 * not authorize another.
 */

import { createHash } from "node:crypto";

import { Prisma, type PrismaClient } from "@prisma/client";

import { CLIENT_CAMPAIGN_SHADOW_DECISION_VERSION } from "../client-campaign-shadow/resolve-client-campaign-shadow.js";
import {
  campaignGhlConfigurationHash,
  frozenScopeFromShadow,
  snapshotFromShadowRow,
  type FrozenCampaignScope,
} from "./campaign-ghl-frozen-shadow.js";
import type { CampaignGrantReadStatus } from "./plan-campaign-ghl-delivery.js";

const ACTOR = /^(?:ADMIN|c[a-z0-9]{24})$/;

export type CampaignGrantIssueInput = {
  requestId: string;
  clientAccountId: string;
  sourceLeadEventId: string;
  clientCampaignId: string;
  expectedDecisionVersion: number;
  expectedCampaignRevision: number;
  expectedWorkflowId: string;
  expectedLocationId: string;
  expiresAt: Date | null;
};

export type CampaignGrantIssueResult = {
  ok: boolean;
  error: string | null;
  grantId: string | null;
  replayed: boolean;
  executionStarted: false;
  externalCall: false;
  shadowExecutionAuthorized: false;
};

export type EffectiveCampaignGrant = {
  state: CampaignGrantReadStatus;
  grantId: string | null;
  scope: FrozenCampaignScope | null;
};

type GrantDb = PrismaClient | Prisma.TransactionClient;

export async function issueCampaignGhlExecutionGrant(
  db: PrismaClient,
  input: CampaignGrantIssueInput,
  actor: string,
  now = new Date()
): Promise<CampaignGrantIssueResult> {
  const refused = (error: string): CampaignGrantIssueResult => ({
    ok: false,
    error,
    grantId: null,
    replayed: false,
    executionStarted: false,
    externalCall: false,
    shadowExecutionAuthorized: false,
  });
  if (!ACTOR.test(actor) || actor !== actor.trim()) return refused("invalid_actor");
  if (!isUuid(input.requestId)) return refused("invalid_request");
  if (input.expiresAt && Number.isNaN(input.expiresAt.getTime())) return refused("invalid_request");
  if (input.expiresAt && input.expiresAt.getTime() <= now.getTime()) return refused("expires_in_past");

  const event = await db.sourceLeadEvent.findUnique({
    where: { id: input.sourceLeadEventId },
    select: { id: true, clientAccountIdResolved: true },
  });
  if (!event) return refused("event_not_found");
  if (event.clientAccountIdResolved !== input.clientAccountId) return refused("client_mismatch");

  const shadow = await db.clientCampaignShadowDecision.findUnique({
    where: {
      sourceLeadEventId_decisionVersion: {
        sourceLeadEventId: input.sourceLeadEventId,
        decisionVersion: CLIENT_CAMPAIGN_SHADOW_DECISION_VERSION,
      },
    },
  });
  if (!shadow) return refused("missing_shadow_row");
  const snapshot = snapshotFromShadowRow(shadow);
  if (snapshot.executionAuthorized !== false) return refused("shadow_not_a_grant");
  if (snapshot.clientAccountId !== input.clientAccountId) return refused("client_mismatch");
  if (snapshot.clientCampaignId !== input.clientCampaignId) return refused("campaign_mismatch");
  if (input.expectedDecisionVersion !== shadow.decisionVersion) return refused("decision_version_mismatch");
  if (snapshot.campaignRevision !== input.expectedCampaignRevision) return refused("frozen_revision_mismatch");
  const scope = frozenScopeFromShadow(shadow, input.sourceLeadEventId);
  if (!scope) return refused("frozen_destination_missing");
  if (scope.workflowIdGhl !== input.expectedWorkflowId.trim()) return refused("workflow_mismatch");
  if (scope.ghlLocationId !== input.expectedLocationId.trim()) return refused("location_mismatch");

  const campaign = await db.clientCampaign.findFirst({
    where: { id: input.clientCampaignId, clientAccountId: input.clientAccountId },
    select: { id: true },
  });
  if (!campaign) return refused("campaign_mismatch");

  const configurationHash = campaignGhlConfigurationHash(scope);
  const payloadHash = grantPayloadHash(input, configurationHash);
  try {
    return await db.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL lock_timeout = '3s'`;
      const byRequest = await tx.campaignGhlExecutionGrant.findUnique({ where: { requestId: input.requestId } });
      if (byRequest) {
        if (byRequest.payloadHash !== payloadHash) return refused("grant_conflict");
        return granted(byRequest.id, true);
      }
      const active = await tx.campaignGhlExecutionGrant.findFirst({
        where: {
          sourceLeadEventId: scope.sourceLeadEventId,
          clientCampaignId: scope.clientCampaignId,
          decisionVersion: scope.decisionVersion,
          campaignRevision: scope.campaignRevision,
          ghlLocationId: scope.ghlLocationId,
          workflowIdGhl: scope.workflowIdGhl,
          configurationHash,
          status: "active",
        },
      });
      if (active) {
        if (active.payloadHash !== payloadHash) return refused("grant_conflict");
        return granted(active.id, true);
      }
      const created = await tx.campaignGhlExecutionGrant.create({
        data: {
          requestId: input.requestId,
          payloadHash,
          sourceLeadEventId: scope.sourceLeadEventId,
          shadowDecisionId: scope.shadowDecisionId,
          clientAccountId: scope.clientAccountId,
          clientCampaignId: scope.clientCampaignId,
          decisionVersion: scope.decisionVersion,
          campaignRevision: scope.campaignRevision,
          ghlLocationId: scope.ghlLocationId,
          workflowIdGhl: scope.workflowIdGhl,
          configurationHash,
          status: "active",
          authorizedByActor: actor,
          expiresAt: input.expiresAt,
        },
        select: { id: true },
      });
      return granted(created.id, false);
    });
  } catch (err) {
    if (!isUnique(err)) return refused("unavailable");
    const existing = await db.campaignGhlExecutionGrant.findFirst({
      where: {
        OR: [
          { requestId: input.requestId },
          {
            sourceLeadEventId: scope.sourceLeadEventId,
            clientCampaignId: scope.clientCampaignId,
            decisionVersion: scope.decisionVersion,
            campaignRevision: scope.campaignRevision,
            ghlLocationId: scope.ghlLocationId,
            workflowIdGhl: scope.workflowIdGhl,
            configurationHash,
            status: "active",
          },
        ],
      },
    });
    if (!existing || existing.payloadHash !== payloadHash) return refused("grant_conflict");
    return granted(existing.id, true);
  }
}

export async function revokeCampaignGhlExecutionGrant(
  db: PrismaClient,
  input: { grantId: string; clientAccountId: string; reason: string },
  actor: string,
  now = new Date()
): Promise<CampaignGrantIssueResult> {
  const refused = (error: string): CampaignGrantIssueResult => ({
    ok: false,
    error,
    grantId: null,
    replayed: false,
    executionStarted: false,
    externalCall: false,
    shadowExecutionAuthorized: false,
  });
  if (!ACTOR.test(actor)) return refused("invalid_actor");
  const reason = input.reason.trim();
  if (!reason || reason.length > 200) return refused("invalid_request");
  const row = await db.campaignGhlExecutionGrant.findFirst({
    where: { id: input.grantId, clientAccountId: input.clientAccountId },
  });
  if (!row) return refused("grant_not_found");
  if (row.status === "revoked") return granted(row.id, true);
  if (row.status !== "active") return refused("grant_not_active");
  await db.campaignGhlExecutionGrant.update({
    where: { id: row.id },
    data: {
      status: "revoked",
      revokedAt: now,
      revokedByActor: actor,
      revocationReason: reason,
    },
  });
  return granted(row.id, false);
}

export async function loadEffectiveCampaignGhlGrant(
  db: GrantDb,
  input: { sourceLeadEventId: string; clientAccountId: string; clientCampaignId: string | null },
  now = new Date()
): Promise<EffectiveCampaignGrant> {
  if (!input.clientCampaignId) return { state: "absent", grantId: null, scope: null };
  const shadow = await db.clientCampaignShadowDecision.findUnique({
    where: {
      sourceLeadEventId_decisionVersion: {
        sourceLeadEventId: input.sourceLeadEventId,
        decisionVersion: CLIENT_CAMPAIGN_SHADOW_DECISION_VERSION,
      },
    },
  });
  const scope = shadow ? frozenScopeFromShadow(shadow, input.sourceLeadEventId) : null;
  const rows = await db.campaignGhlExecutionGrant.findMany({
    where: {
      sourceLeadEventId: input.sourceLeadEventId,
      clientAccountId: input.clientAccountId,
      clientCampaignId: input.clientCampaignId,
      decisionVersion: CLIENT_CAMPAIGN_SHADOW_DECISION_VERSION,
    },
    orderBy: { createdAt: "desc" },
  });
  if (rows.length === 0 || !scope || scope.clientAccountId !== input.clientAccountId) {
    return { state: "absent", grantId: null, scope };
  }
  const hash = campaignGhlConfigurationHash(scope);
  const active = rows.find(
    (row) =>
      row.status === "active" &&
      row.campaignRevision === scope.campaignRevision &&
      row.ghlLocationId === scope.ghlLocationId &&
      row.workflowIdGhl === scope.workflowIdGhl &&
      row.configurationHash === hash
  );
  if (active) {
    if (active.expiresAt && active.expiresAt.getTime() <= now.getTime()) {
      return { state: "expired", grantId: active.id, scope };
    }
    return { state: "active", grantId: active.id, scope };
  }
  const drifted = rows.find((row) => row.status === "active");
  if (drifted) return { state: "stale", grantId: drifted.id, scope };
  if (rows.some((row) => row.status === "expired" || (row.expiresAt && row.expiresAt.getTime() <= now.getTime()))) {
    return { state: "expired", grantId: rows[0]?.id ?? null, scope };
  }
  if (rows.some((row) => row.status === "revoked")) {
    return { state: "revoked", grantId: rows[0]?.id ?? null, scope };
  }
  return { state: "absent", grantId: null, scope };
}

function granted(grantId: string, replayed: boolean): CampaignGrantIssueResult {
  return {
    ok: true,
    error: null,
    grantId,
    replayed,
    executionStarted: false,
    externalCall: false,
    shadowExecutionAuthorized: false,
  };
}

function grantPayloadHash(input: CampaignGrantIssueInput, configurationHash: string): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        clientAccountId: input.clientAccountId,
        sourceLeadEventId: input.sourceLeadEventId,
        clientCampaignId: input.clientCampaignId,
        expectedDecisionVersion: input.expectedDecisionVersion,
        expectedCampaignRevision: input.expectedCampaignRevision,
        expectedWorkflowId: input.expectedWorkflowId.trim(),
        expectedLocationId: input.expectedLocationId.trim(),
        expiresAt: input.expiresAt ? input.expiresAt.toISOString() : null,
        configurationHash,
      })
    )
    .digest("hex");
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isUnique(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}
