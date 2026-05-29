import type { LeadDuplicateRiskAssessment, Prisma } from "@prisma/client";
import { prisma } from "../lib/db.js";

export async function upsertDuplicateRiskForRoutingDecision(
  routingDryRunDecisionId: string,
  data: Omit<
    Prisma.LeadDuplicateRiskAssessmentCreateInput,
    "routingDryRunDecision"
  >
): Promise<LeadDuplicateRiskAssessment> {
  const existing = await prisma.leadDuplicateRiskAssessment.findUnique({
    where: { routingDryRunDecisionId },
  });
  if (existing) {
    return prisma.leadDuplicateRiskAssessment.update({
      where: { id: existing.id },
      data: {
        ...data,
        routingDryRunDecisionId,
      },
    });
  }
  return prisma.leadDuplicateRiskAssessment.create({
    data: {
      ...data,
      routingDryRunDecision: { connect: { id: routingDryRunDecisionId } },
    },
  });
}

export async function findDuplicateRiskByRoutingDecisionId(
  routingDryRunDecisionId: string
): Promise<LeadDuplicateRiskAssessment | null> {
  return prisma.leadDuplicateRiskAssessment.findUnique({
    where: { routingDryRunDecisionId },
  });
}

export async function findDuplicateRiskByDecisionIds(
  routingDryRunDecisionIds: string[]
): Promise<LeadDuplicateRiskAssessment[]> {
  if (routingDryRunDecisionIds.length === 0) return [];
  return prisma.leadDuplicateRiskAssessment.findMany({
    where: { routingDryRunDecisionId: { in: routingDryRunDecisionIds } },
  });
}

export async function findAssessmentsByFacebookLeadId(
  facebookLeadId: string
): Promise<LeadDuplicateRiskAssessment[]> {
  return prisma.leadDuplicateRiskAssessment.findMany({
    where: { facebookLeadId },
    orderBy: { evaluatedAt: "desc" },
    take: 5,
  });
}

export async function findAssessmentsByFacebookSubmissionId(
  facebookSubmissionId: string
): Promise<LeadDuplicateRiskAssessment[]> {
  return prisma.leadDuplicateRiskAssessment.findMany({
    where: { facebookSubmissionId },
    orderBy: { evaluatedAt: "desc" },
    take: 5,
  });
}

export async function updateDuplicateRiskOperatorStatus(
  id: string,
  data: {
    operatorOverrideStatus: string;
    operatorNotes?: string | null;
    operatorUpdatedBy?: string | null;
    identityStatus?: string;
  }
): Promise<LeadDuplicateRiskAssessment | null> {
  try {
    return await prisma.leadDuplicateRiskAssessment.update({
      where: { id },
      data: {
        operatorOverrideStatus: data.operatorOverrideStatus,
        operatorNotes: data.operatorNotes ?? null,
        operatorUpdatedBy: data.operatorUpdatedBy ?? null,
        operatorUpdatedAt: new Date(),
        ...(data.identityStatus ? { identityStatus: data.identityStatus } : {}),
      },
    });
  } catch {
    return null;
  }
}

export async function createOrphanAppointmentAssessment(
  data: Omit<Prisma.LeadDuplicateRiskAssessmentCreateInput, "routingDryRunDecision">
): Promise<LeadDuplicateRiskAssessment> {
  return prisma.leadDuplicateRiskAssessment.create({ data });
}

export async function hasPriorLeadCreatedForIdentity(opts: {
  clientAccountId: string;
  subaccountIdGhl?: string;
  leadUid?: string | null;
  phoneE164?: string | null;
  email?: string | null;
}): Promise<boolean> {
  const or: Prisma.LifecycleEventWhereInput[] = [];
  if (opts.leadUid?.trim()) {
    or.push({ leadUid: opts.leadUid.trim(), eventNameInternal: "lead_created" });
  }
  if (opts.phoneE164?.trim()) {
    or.push({
      eventNameInternal: "lead_created",
      payloadJson: { path: ["contact", "phone_e164"], equals: opts.phoneE164.trim() },
    });
  }
  if (opts.email?.trim()) {
    or.push({
      eventNameInternal: "lead_created",
      payloadJson: { path: ["contact", "email"], equals: opts.email.trim() },
    });
  }
  if (or.length === 0) return false;

  const where: Prisma.LifecycleEventWhereInput = {
    clientAccountId: opts.clientAccountId,
    OR: or,
  };
  if (opts.subaccountIdGhl !== undefined) {
    where.subaccountIdGhl = opts.subaccountIdGhl;
  }

  const row = await prisma.lifecycleEvent.findFirst({
    where,
    select: { id: true },
  });
  return row != null;
}
