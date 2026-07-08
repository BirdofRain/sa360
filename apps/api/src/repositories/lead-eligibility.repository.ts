import type { LeadEligibilityStatus, Prisma, PrismaClient } from "@prisma/client";

import { prisma } from "../lib/db.js";

export type UpsertLeadEligibilityAssessmentInput = {
  sourceLeadEventId: string;
  policyKey: string;
  policyVersion: string;
  status: LeadEligibilityStatus;
  reasonCodesJson: Prisma.InputJsonValue;
  proofResultJson?: Prisma.InputJsonValue;
  duplicateResultJson?: Prisma.InputJsonValue;
  requiredFieldResultJson?: Prisma.InputJsonValue;
  geographyResultJson?: Prisma.InputJsonValue;
  consentResultJson?: Prisma.InputJsonValue;
};

export async function findLeadEligibilityAssessment(
  input: { sourceLeadEventId: string; policyKey: string; policyVersion: string },
  db: PrismaClient = prisma
) {
  return db.leadEligibilityAssessment.findUnique({
    where: {
      sourceLeadEventId_policyKey_policyVersion: {
        sourceLeadEventId: input.sourceLeadEventId.trim(),
        policyKey: input.policyKey.trim(),
        policyVersion: input.policyVersion.trim(),
      },
    },
  });
}

export async function upsertLeadEligibilityAssessment(
  input: UpsertLeadEligibilityAssessmentInput,
  db: PrismaClient = prisma
) {
  return db.leadEligibilityAssessment.upsert({
    where: {
      sourceLeadEventId_policyKey_policyVersion: {
        sourceLeadEventId: input.sourceLeadEventId.trim(),
        policyKey: input.policyKey.trim(),
        policyVersion: input.policyVersion.trim(),
      },
    },
    create: {
      sourceLeadEventId: input.sourceLeadEventId.trim(),
      policyKey: input.policyKey.trim(),
      policyVersion: input.policyVersion.trim(),
      status: input.status,
      reasonCodesJson: input.reasonCodesJson,
      proofResultJson: input.proofResultJson,
      duplicateResultJson: input.duplicateResultJson,
      requiredFieldResultJson: input.requiredFieldResultJson,
      geographyResultJson: input.geographyResultJson,
      consentResultJson: input.consentResultJson,
      evaluatedAt: new Date(),
    },
    update: {
      status: input.status,
      reasonCodesJson: input.reasonCodesJson,
      proofResultJson: input.proofResultJson,
      duplicateResultJson: input.duplicateResultJson,
      requiredFieldResultJson: input.requiredFieldResultJson,
      geographyResultJson: input.geographyResultJson,
      consentResultJson: input.consentResultJson,
      evaluatedAt: new Date(),
    },
  });
}

export async function listLeadEligibilityByStatus(
  statuses: LeadEligibilityStatus[],
  limit = 50,
  db: PrismaClient = prisma
) {
  return db.leadEligibilityAssessment.findMany({
    where: { status: { in: statuses } },
    orderBy: { evaluatedAt: "desc" },
    take: Math.min(Math.max(limit, 1), 200),
    include: {
      sourceLeadEvent: {
        select: {
          id: true,
          sourceLeadUid: true,
          clientAccountIdResolved: true,
          status: true,
        },
      },
    },
  });
}
