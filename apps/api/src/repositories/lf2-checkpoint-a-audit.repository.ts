import type { Lf2CheckpointAActionType, Lf2CheckpointAStatus, Prisma, PrismaClient } from "@prisma/client";

import { prisma } from "../lib/db.js";

export type CreateLf2CheckpointAAuditInput = {
  sourceLeadEventId: string;
  sourceLeadUidMasked?: string | null;
  clientAccountId: string;
  destinationSubaccountIdGhl: string;
  leadOrderId?: string | null;
  deliveryTargetId?: string | null;
  actionType: Lf2CheckpointAActionType;
  checkpointAStatus: Lf2CheckpointAStatus;
  reasonsJson?: Prisma.InputJsonValue | null;
  metadataJson?: Prisma.InputJsonValue | null;
  requestedBy?: string | null;
  requestId?: string | null;
};

export async function createLf2CheckpointAAuditEvent(
  input: CreateLf2CheckpointAAuditInput,
  db: PrismaClient | Prisma.TransactionClient = prisma
) {
  return db.lf2CheckpointAAuditEvent.create({
    data: {
      sourceLeadEventId: input.sourceLeadEventId,
      sourceLeadUidMasked: input.sourceLeadUidMasked ?? null,
      clientAccountId: input.clientAccountId,
      destinationSubaccountIdGhl: input.destinationSubaccountIdGhl,
      leadOrderId: input.leadOrderId ?? null,
      deliveryTargetId: input.deliveryTargetId ?? null,
      actionType: input.actionType,
      checkpointAStatus: input.checkpointAStatus,
      reasonsJson: input.reasonsJson ?? undefined,
      metadataJson: input.metadataJson ?? undefined,
      requestedBy: input.requestedBy ?? null,
      requestId: input.requestId ?? null,
    },
  });
}

export async function findAppliedCheckpointACreateByRequestId(
  requestId: string,
  db: PrismaClient | Prisma.TransactionClient = prisma
) {
  const trimmed = requestId.trim();
  if (!trimmed) return null;
  return db.lf2CheckpointAAuditEvent.findFirst({
    where: {
      requestId: trimmed,
      actionType: "CREATE_CONFIG",
      checkpointAStatus: { in: ["applied", "idempotent_replay"] },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function findAppliedCheckpointARevokeByRequestId(
  requestId: string,
  db: PrismaClient | Prisma.TransactionClient = prisma
) {
  const trimmed = requestId.trim();
  if (!trimmed) return null;
  return db.lf2CheckpointAAuditEvent.findFirst({
    where: {
      requestId: trimmed,
      actionType: "REVOKE_CONFIG",
      checkpointAStatus: { in: ["applied", "idempotent_replay"] },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function findLatestAppliedCheckpointACreateForSourceLead(
  sourceLeadEventId: string,
  db: PrismaClient | Prisma.TransactionClient = prisma
) {
  return db.lf2CheckpointAAuditEvent.findFirst({
    where: {
      sourceLeadEventId: sourceLeadEventId.trim(),
      actionType: "CREATE_CONFIG",
      checkpointAStatus: { in: ["applied", "idempotent_replay"] },
      leadOrderId: { not: null },
    },
    orderBy: { createdAt: "desc" },
  });
}
