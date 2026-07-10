import type {
  LeadVerificationApprovalActionType,
  LeadVerificationApprovalStatus,
  Prisma,
  PrismaClient,
} from "@prisma/client";

import { prisma } from "../lib/db.js";

export type CreateLeadVerificationApprovalAuditInput = {
  sourceLeadEventId: string;
  sourceLeadUidMasked?: string | null;
  leadUid: string;
  clientAccountId: string;
  destinationSubaccountIdGhl: string;
  actionType: LeadVerificationApprovalActionType;
  previousVerificationStatus?: Prisma.LeadVerificationApprovalAuditEventCreateInput["previousVerificationStatus"];
  previousDuplicateStatus?: Prisma.LeadVerificationApprovalAuditEventCreateInput["previousDuplicateStatus"];
  newVerificationStatus?: Prisma.LeadVerificationApprovalAuditEventCreateInput["newVerificationStatus"];
  newDuplicateStatus?: Prisma.LeadVerificationApprovalAuditEventCreateInput["newDuplicateStatus"];
  phoneFingerprint?: string | null;
  emailFingerprint?: string | null;
  duplicateSearchClassification?: string | null;
  duplicateSearchReasonCode?: string | null;
  phoneSearchOutcome?: string | null;
  emailSearchOutcome?: string | null;
  matchedContactIdGhl?: string | null;
  approvalStatus: LeadVerificationApprovalStatus;
  reasonsJson?: Prisma.InputJsonValue | null;
  metadataJson?: Prisma.InputJsonValue | null;
  requestedBy?: string | null;
  requestId?: string | null;
};

export async function createLeadVerificationApprovalAuditEvent(
  input: CreateLeadVerificationApprovalAuditInput,
  db: PrismaClient | Prisma.TransactionClient = prisma
) {
  return db.leadVerificationApprovalAuditEvent.create({
    data: {
      sourceLeadEventId: input.sourceLeadEventId,
      sourceLeadUidMasked: input.sourceLeadUidMasked ?? null,
      leadUid: input.leadUid,
      clientAccountId: input.clientAccountId,
      destinationSubaccountIdGhl: input.destinationSubaccountIdGhl,
      actionType: input.actionType,
      previousVerificationStatus: input.previousVerificationStatus ?? null,
      previousDuplicateStatus: input.previousDuplicateStatus ?? null,
      newVerificationStatus: input.newVerificationStatus ?? null,
      newDuplicateStatus: input.newDuplicateStatus ?? null,
      phoneFingerprint: input.phoneFingerprint ?? null,
      emailFingerprint: input.emailFingerprint ?? null,
      duplicateSearchClassification: input.duplicateSearchClassification ?? null,
      duplicateSearchReasonCode: input.duplicateSearchReasonCode ?? null,
      phoneSearchOutcome: input.phoneSearchOutcome ?? null,
      emailSearchOutcome: input.emailSearchOutcome ?? null,
      matchedContactIdGhl: input.matchedContactIdGhl ?? null,
      approvalStatus: input.approvalStatus,
      reasonsJson: input.reasonsJson ?? undefined,
      metadataJson: input.metadataJson ?? undefined,
      requestedBy: input.requestedBy ?? null,
      requestId: input.requestId ?? null,
    },
  });
}

export async function findAppliedVerificationApprovalByRequestId(
  requestId: string,
  db: PrismaClient | Prisma.TransactionClient = prisma
) {
  const trimmed = requestId.trim();
  if (!trimmed) return null;
  return db.leadVerificationApprovalAuditEvent.findFirst({
    where: {
      requestId: trimmed,
      actionType: "APPROVE_UNIQUE",
      approvalStatus: { in: ["applied", "idempotent_replay"] },
    },
    orderBy: { createdAt: "desc" },
  });
}
