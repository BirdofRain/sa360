import type {
  LeadProofReviewActionType,
  LeadProofReviewStatus,
  Prisma,
  PrismaClient,
} from "@prisma/client";

import { prisma } from "../lib/db.js";

export type CreateLeadProofReviewAuditInput = {
  sourceLeadEventId: string;
  leadProofId?: string | null;
  sourceLeadUidMasked?: string | null;
  leadUidFingerprint: string;
  clientAccountId: string;
  canonicalSourceLane: string;
  proofPolicyKey: string;
  actionType: LeadProofReviewActionType;
  previousProofStatus?: Prisma.LeadProofReviewAuditEventCreateInput["previousProofStatus"];
  extractedProofStatus?: Prisma.LeadProofReviewAuditEventCreateInput["extractedProofStatus"];
  newProofStatus?: Prisma.LeadProofReviewAuditEventCreateInput["newProofStatus"];
  previousVerificationStatus?: Prisma.LeadProofReviewAuditEventCreateInput["previousVerificationStatus"];
  previousDuplicateStatus?: Prisma.LeadProofReviewAuditEventCreateInput["previousDuplicateStatus"];
  reviewStatus: LeadProofReviewStatus;
  evidenceSummaryJson?: Prisma.InputJsonValue | null;
  reasonsJson?: Prisma.InputJsonValue | null;
  metadataJson?: Prisma.InputJsonValue | null;
  requestedBy?: string | null;
  operatorNote?: string | null;
  requestId: string;
};

export async function createLeadProofReviewAuditEvent(
  input: CreateLeadProofReviewAuditInput,
  db: PrismaClient | Prisma.TransactionClient = prisma
) {
  return db.leadProofReviewAuditEvent.create({
    data: {
      sourceLeadEventId: input.sourceLeadEventId,
      leadProofId: input.leadProofId ?? null,
      sourceLeadUidMasked: input.sourceLeadUidMasked ?? null,
      leadUidFingerprint: input.leadUidFingerprint,
      clientAccountId: input.clientAccountId,
      canonicalSourceLane: input.canonicalSourceLane,
      proofPolicyKey: input.proofPolicyKey,
      actionType: input.actionType,
      previousProofStatus: input.previousProofStatus ?? null,
      extractedProofStatus: input.extractedProofStatus ?? null,
      newProofStatus: input.newProofStatus ?? null,
      previousVerificationStatus: input.previousVerificationStatus ?? null,
      previousDuplicateStatus: input.previousDuplicateStatus ?? null,
      reviewStatus: input.reviewStatus,
      evidenceSummaryJson: input.evidenceSummaryJson ?? undefined,
      reasonsJson: input.reasonsJson ?? undefined,
      metadataJson: input.metadataJson ?? undefined,
      requestedBy: input.requestedBy ?? null,
      operatorNote: input.operatorNote ?? null,
      requestId: input.requestId.trim(),
    },
  });
}

export async function findProofReviewAuditByRequestId(
  sourceLeadEventId: string,
  requestId: string,
  db: PrismaClient | Prisma.TransactionClient = prisma
) {
  const trimmed = requestId.trim();
  if (!trimmed) return null;
  return db.leadProofReviewAuditEvent.findUnique({
    where: {
      sourceLeadEventId_requestId: {
        sourceLeadEventId: sourceLeadEventId.trim(),
        requestId: trimmed,
      },
    },
  });
}

export async function findLatestAppliedProofApprovalForSourceLead(
  sourceLeadEventId: string,
  db: PrismaClient | Prisma.TransactionClient = prisma
) {
  return db.leadProofReviewAuditEvent.findFirst({
    where: {
      sourceLeadEventId: sourceLeadEventId.trim(),
      actionType: "APPROVE_PROOF",
      reviewStatus: { in: ["applied", "idempotent_replay"] },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function listRecentProofReviewAuditsForSourceLead(
  sourceLeadEventId: string,
  limit = 10,
  db: PrismaClient | Prisma.TransactionClient = prisma
) {
  return db.leadProofReviewAuditEvent.findMany({
    where: { sourceLeadEventId: sourceLeadEventId.trim() },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      actionType: true,
      reviewStatus: true,
      previousProofStatus: true,
      newProofStatus: true,
      requestId: true,
      createdAt: true,
    },
  });
}
