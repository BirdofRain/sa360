import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../lib/db.js";
import type { GhlAdapterSimulationResult } from "../services/ghl-delivery-adapter/ghl-delivery-adapter.types.js";

export async function createGhlAdapterRunWithSteps(
  run: Prisma.GhlDeliveryAdapterRunCreateInput,
  db: PrismaClient = prisma
) {
  return db.ghlDeliveryAdapterRun.create({
    data: run,
    include: { stepRuns: { orderBy: { stepOrder: "asc" } } },
  });
}

export async function findGhlAdapterRunById(id: string, db: PrismaClient = prisma) {
  return db.ghlDeliveryAdapterRun.findUnique({
    where: { id },
    include: { stepRuns: { orderBy: { stepOrder: "asc" } } },
  });
}

export async function listGhlAdapterRuns(
  opts: {
    masterClientAccountId?: string;
    destinationClientAccountId?: string;
    destinationSubaccountIdGhl?: string;
    status?: string;
    limit?: number;
  },
  db: PrismaClient = prisma
) {
  const where: Prisma.GhlDeliveryAdapterRunWhereInput = {};
  if (opts.masterClientAccountId?.trim()) {
    where.masterClientAccountId = opts.masterClientAccountId.trim();
  }
  if (opts.destinationClientAccountId?.trim()) {
    where.destinationClientAccountId = opts.destinationClientAccountId.trim();
  }
  if (opts.destinationSubaccountIdGhl?.trim()) {
    where.destinationSubaccountIdGhl = opts.destinationSubaccountIdGhl.trim();
  }
  if (opts.status?.trim()) where.status = opts.status.trim();

  return db.ghlDeliveryAdapterRun.findMany({
    where,
    orderBy: { startedAt: "desc" },
    take: Math.min(Math.max(opts.limit ?? 50, 1), 200),
    include: { stepRuns: { orderBy: { stepOrder: "asc" } } },
  });
}

export async function findLatestGhlAdapterRunForPlan(
  leadDeliveryPlanId: string,
  db: PrismaClient = prisma
) {
  return db.ghlDeliveryAdapterRun.findFirst({
    where: { leadDeliveryPlanId },
    orderBy: { startedAt: "desc" },
    include: { stepRuns: { orderBy: { stepOrder: "asc" } } },
  });
}

export function simulationToRunCreateInput(
  plan: {
    id: string;
    routingDryRunDecisionId: string | null;
    masterClientAccountId: string;
    destinationClientAccountId: string;
    destinationSubaccountIdGhl: string;
  },
  simulation: GhlAdapterSimulationResult,
  startedAt: Date,
  completedAt: Date
): Prisma.GhlDeliveryAdapterRunCreateInput {
  const durationMs = completedAt.getTime() - startedAt.getTime();
  return {
    leadDeliveryPlan: { connect: { id: plan.id } },
    routingDryRunDecisionId: plan.routingDryRunDecisionId,
    masterClientAccountId: plan.masterClientAccountId,
    destinationClientAccountId: plan.destinationClientAccountId,
    destinationSubaccountIdGhl: plan.destinationSubaccountIdGhl,
    mode: simulation.mode,
    status: simulation.status,
    startedAt,
    completedAt,
    durationMs,
    summary: simulation.summary,
    warnings: simulation.warnings.length
      ? (simulation.warnings as Prisma.InputJsonValue)
      : undefined,
    errors: simulation.errors.length ? (simulation.errors as Prisma.InputJsonValue) : undefined,
    stepRuns: {
      create: simulation.stepDrafts.map((s) => ({
        deliveryPlanStepId: s.deliveryPlanStepId,
        stepOrder: s.stepOrder,
        stepType: s.stepType,
        targetSystem: s.targetSystem,
        targetId: s.targetId,
        mode: s.mode,
        status: s.status,
        title: s.title,
        requestPreviewJson: s.requestPreviewJson
          ? (s.requestPreviewJson as Prisma.InputJsonValue)
          : undefined,
        responsePreviewJson: s.responsePreviewJson
          ? (s.responsePreviewJson as Prisma.InputJsonValue)
          : undefined,
        validationErrors: s.validationErrors.length
          ? (s.validationErrors as Prisma.InputJsonValue)
          : undefined,
        warnings: s.warnings.length ? (s.warnings as Prisma.InputJsonValue) : undefined,
      })),
    },
  };
}
