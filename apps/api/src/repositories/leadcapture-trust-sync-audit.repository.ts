import type {
  LeadCaptureTrustCorrelationClassification,
  LeadCaptureTrustSyncAction,
  LeadCaptureTrustSyncReviewStatus,
  LeadProofStatus,
  Prisma,
  PrismaClient,
} from "@prisma/client";

import { prisma } from "../lib/db.js";

export type CreateLeadCaptureTrustSyncAuditInput = {
  sourceLeadEventId: string;
  leadProofId?: string | null;
  providerLeadIdFingerprint: string;
  maskedProviderLeadId?: string | null;
  campaignId: string;
  formId?: string | null;
  clientAccountId: string;
  action: LeadCaptureTrustSyncAction;
  priorContentHash?: string | null;
  newContentHash?: string | null;
  correlationClassification: LeadCaptureTrustCorrelationClassification;
  previousProofStatus?: LeadProofStatus | null;
  newProofStatus?: LeadProofStatus | null;
  reviewStatus: LeadCaptureTrustSyncReviewStatus;
  completenessStatus?: string | null;
  missingFieldsJson?: Prisma.InputJsonValue | null;
  warningsJson?: Prisma.InputJsonValue | null;
  requestId: string;
  requestedBy?: string | null;
  operatorNote?: string | null;
};

export async function createLeadCaptureTrustSyncAuditEvent(
  input: CreateLeadCaptureTrustSyncAuditInput,
  db: PrismaClient | Prisma.TransactionClient = prisma
) {
  return db.leadCaptureTrustSyncAuditEvent.create({
    data: {
      sourceLeadEventId: input.sourceLeadEventId,
      leadProofId: input.leadProofId ?? null,
      providerLeadIdFingerprint: input.providerLeadIdFingerprint,
      maskedProviderLeadId: input.maskedProviderLeadId ?? null,
      campaignId: input.campaignId,
      formId: input.formId ?? null,
      clientAccountId: input.clientAccountId,
      action: input.action,
      priorContentHash: input.priorContentHash ?? null,
      newContentHash: input.newContentHash ?? null,
      correlationClassification: input.correlationClassification,
      previousProofStatus: input.previousProofStatus ?? null,
      newProofStatus: input.newProofStatus ?? null,
      reviewStatus: input.reviewStatus,
      completenessStatus: input.completenessStatus ?? null,
      missingFieldsJson: input.missingFieldsJson ?? undefined,
      warningsJson: input.warningsJson ?? undefined,
      requestId: input.requestId.trim(),
      requestedBy: input.requestedBy ?? null,
      operatorNote: input.operatorNote ?? null,
    },
  });
}

export async function findLeadCaptureTrustSyncAuditByRequestId(
  sourceLeadEventId: string,
  requestId: string,
  db: PrismaClient | Prisma.TransactionClient = prisma
) {
  const trimmed = requestId.trim();
  if (!trimmed) return null;
  return db.leadCaptureTrustSyncAuditEvent.findUnique({
    where: {
      sourceLeadEventId_requestId: {
        sourceLeadEventId: sourceLeadEventId.trim(),
        requestId: trimmed,
      },
    },
  });
}

export async function findLeadCaptureTrustSyncAuditByProviderHash(
  providerLeadIdFingerprint: string,
  contentHash: string,
  db: PrismaClient | Prisma.TransactionClient = prisma
) {
  return db.leadCaptureTrustSyncAuditEvent.findFirst({
    where: {
      providerLeadIdFingerprint,
      newContentHash: contentHash,
      action: "ATTACH",
      reviewStatus: { in: ["applied", "idempotent_replay"] },
    },
    orderBy: { createdAt: "desc" },
  });
}
