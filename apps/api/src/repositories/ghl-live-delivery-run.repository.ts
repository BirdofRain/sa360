import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../lib/db.js";

export async function findGhlLiveDeliveryRunById(id: string, db: PrismaClient = prisma) {
  return db.ghlLiveDeliveryRun.findUnique({
    where: { id },
    include: { stepRuns: { orderBy: { stepOrder: "asc" } } },
  });
}

export async function findGhlLiveDeliveryRunByIdempotencyKey(
  idempotencyKey: string,
  db: PrismaClient = prisma
) {
  return db.ghlLiveDeliveryRun.findUnique({
    where: { idempotencyKey },
    include: { stepRuns: { orderBy: { stepOrder: "asc" } } },
  });
}

export async function findLatestGhlLiveDeliveryRunForPlan(
  leadDeliveryPlanId: string,
  db: PrismaClient = prisma
) {
  return db.ghlLiveDeliveryRun.findFirst({
    where: { leadDeliveryPlanId },
    orderBy: { startedAt: "desc" },
    include: { stepRuns: { orderBy: { stepOrder: "asc" } } },
  });
}

export async function listGhlLiveDeliveryRuns(
  opts: {
    masterClientAccountId?: string;
    destinationClientAccountId?: string;
    destinationSubaccountIdGhl?: string;
    status?: string;
    leadDeliveryPlanId?: string;
    limit?: number;
  },
  db: PrismaClient = prisma
) {
  const where: Prisma.GhlLiveDeliveryRunWhereInput = {};
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
  if (opts.leadDeliveryPlanId?.trim()) {
    where.leadDeliveryPlanId = opts.leadDeliveryPlanId.trim();
  }

  return db.ghlLiveDeliveryRun.findMany({
    where,
    orderBy: { startedAt: "desc" },
    take: Math.min(Math.max(opts.limit ?? 50, 1), 200),
    include: { stepRuns: { orderBy: { stepOrder: "asc" } } },
  });
}

export async function createGhlLiveDeliveryRun(
  data: Prisma.GhlLiveDeliveryRunCreateInput,
  db: PrismaClient = prisma
) {
  return db.ghlLiveDeliveryRun.create({
    data,
    include: { stepRuns: { orderBy: { stepOrder: "asc" } } },
  });
}

export async function updateGhlLiveDeliveryRun(
  id: string,
  data: Prisma.GhlLiveDeliveryRunUpdateInput,
  db: PrismaClient = prisma
) {
  return db.ghlLiveDeliveryRun.update({
    where: { id },
    data,
    include: { stepRuns: { orderBy: { stepOrder: "asc" } } },
  });
}

export async function createGhlLiveDeliveryStepRun(
  data: Prisma.GhlLiveDeliveryStepRunCreateInput,
  db: PrismaClient = prisma
) {
  return db.ghlLiveDeliveryStepRun.create({ data });
}

export async function updateGhlLiveDeliveryStepRun(
  id: string,
  data: Prisma.GhlLiveDeliveryStepRunUpdateInput,
  db: PrismaClient = prisma
) {
  return db.ghlLiveDeliveryStepRun.update({ where: { id }, data });
}

export function isAdapterSimulationPassedForLiveCanary(run: {
  status: string;
  mode: string;
} | null): boolean {
  if (!run) return false;
  if (run.status === "failed_validation" || run.status === "disabled") return false;
  if (run.status === "readonly_probe_failed" || run.status === "blocked") return false;
  if (run.mode === "disabled" || run.mode === "live_blocked" || run.mode === "live_canary") {
    return false;
  }
  return run.status === "simulated" || run.status === "readonly_probe_passed";
}

export function describeAdapterSimulationGate(run: {
  id?: string;
  status: string;
  mode: string;
} | null): { passed: boolean; detail: string } {
  if (!run) {
    return {
      passed: false,
      detail:
        "No adapter run found for this deliveryPlanId. Shadow adapter simulation must succeed for the exact plan before live canary.",
    };
  }
  const passed = isAdapterSimulationPassedForLiveCanary(run);
  if (passed) {
    return {
      passed: true,
      detail: `Adapter run counts as recent successful simulation (status=${run.status}, mode=${run.mode}).`,
    };
  }
  let why = `status=${run.status}, mode=${run.mode}`;
  if (run.mode === "live_canary") {
    why +=
      " — live_canary adapter runs are live transport records, not shadow simulations; re-run adapter simulation for this deliveryPlanId";
  } else if (run.status === "failed_validation" || run.status === "disabled") {
    why += " — adapter simulation did not pass validation";
  }
  const runRef = run.id ? `Adapter run ${run.id}` : "Latest adapter run";
  return {
    passed: false,
    detail: `${runRef} does not count as recent successful simulation (${why}). Required for this exact deliveryPlanId: status simulated or readonly_probe_passed with mode simulate or readonly_probe.`,
  };
}
