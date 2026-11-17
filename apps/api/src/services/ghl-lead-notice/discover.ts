/**
 * Pages completed ongoing-association runs and records ghl_lead_received
 * notices. The first pass stamps a cutoff and does not notify for contact
 * writes that already finished. This module does not call Twilio.
 */

import type { PrismaClient } from "@prisma/client";

import { readSmsCanaryIsolation } from "@sa360/shared";

import { ghlContactReceived, type GhlCanonicalStep } from "../delivery-success/canonical-delivery.js";
import { planGhlLeadSms } from "./contract.js";
import { recordGhlLeadNotice } from "./receipt.js";
import {
  GHL_LEAD_NOTICE_CUTOFF_CURSOR_ID,
  GHL_LEAD_NOTICE_DISCOVERY_CURSOR_ID,
} from "./recovery.js";

export const GHL_LEAD_NOTICE_ENABLED_ENV = "SA360_GHL_LEAD_NOTICE_ENABLED";
const PAGE = 20;

export function isGhlLeadNoticeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[GHL_LEAD_NOTICE_ENABLED_ENV]?.trim() === "true";
}

export async function discoverGhlLeadNotices(
  db: PrismaClient,
  deps: {
    env?: NodeJS.ProcessEnv;
    enqueue?: (receiptId: string) => Promise<unknown>;
    now?: Date;
  } = {}
): Promise<{ scanned: number; inserted: number; enqueued: number; establishedCutoff: boolean }> {
  const env = deps.env ?? process.env;
  if (readSmsCanaryIsolation(env).mode !== "off") {
    return { scanned: 0, inserted: 0, enqueued: 0, establishedCutoff: false };
  }
  const now = deps.now ?? new Date();
  try {
    await db.ghlLeadNoticeDiscoveryCursor.create({
      data: { id: GHL_LEAD_NOTICE_DISCOVERY_CURSOR_ID, lastCompletedAt: now, lastRunId: "" },
    });
    await ensureDiscoveryCutoff(db, now);
    return { scanned: 0, inserted: 0, enqueued: 0, establishedCutoff: true };
  } catch (error) {
    if (!isUniqueConflict(error)) throw error;
  }
  const cursor = await db.ghlLeadNoticeDiscoveryCursor.findUnique({
    where: { id: GHL_LEAD_NOTICE_DISCOVERY_CURSOR_ID },
  });
  if (!cursor?.lastCompletedAt) {
    return { scanned: 0, inserted: 0, enqueued: 0, establishedCutoff: false };
  }
  if (cursor.lastRunId === "") await ensureDiscoveryCutoff(db, cursor.lastCompletedAt);
  const runs = await db.ghlLiveDeliveryRun.findMany({
    where: {
      mode: "ongoing_association",
      completedAt: { not: null },
      OR: [
        { completedAt: { gt: cursor.lastCompletedAt } },
        { completedAt: cursor.lastCompletedAt, id: { gt: cursor.lastRunId } },
      ],
    },
    orderBy: [{ completedAt: "asc" }, { id: "asc" }],
    take: PAGE,
    include: { stepRuns: true },
  });
  if (runs.length === 0) return { scanned: 0, inserted: 0, enqueued: 0, establishedCutoff: false };

  const runIds = runs.map((run) => run.id);
  const clientIds = [...new Set(runs.map((run) => run.destinationClientAccountId))];
  const outboxes = await db.ghlAssociationDispatchOutbox.findMany({
    where: { liveRunId: { in: runIds } },
  });
  const eventIds = [...new Set(outboxes.map((row) => row.sourceLeadEventId))];
  const [destinations, leads, preferences, onboardingKeys, attempts] = await Promise.all([
    db.clientGhlDestination.findMany({
      where: { clientAccountId: { in: clientIds } },
      select: { clientAccountId: true, destinationSubaccountIdGhl: true },
    }),
    eventIds.length
      ? db.sourceLeadEvent.findMany({
          where: { id: { in: eventIds } },
          select: { id: true, bulkImportId: true, bulkImportRowId: true, sourceType: true },
        })
      : Promise.resolve([]),
    db.clientDeliveryNotificationPreference.findMany({ where: { clientAccountId: { in: clientIds } } }),
    loadOnboardingKeys(db, runs),
    loadOnboardingAttempts(db, runs.map((run) => run.idempotencyKey)),
  ]);
  const destinationByClient = new Map(destinations.map((row) => [row.clientAccountId, row]));
  const leadById = new Map(leads.map((row) => [row.id, row]));
  const preferenceByClient = new Map(preferences.map((row) => [row.clientAccountId, row]));
  const outboxByRun = new Map(outboxes.map((row) => [row.liveRunId, row]));

  let inserted = 0;
  let enqueued = 0;
  for (const run of runs) {
    const outbox = run.id ? outboxByRun.get(run.id) ?? null : null;
    const destination = destinationByClient.get(run.destinationClientAccountId) ?? null;
    const lead = outbox ? leadById.get(outbox.sourceLeadEventId) ?? null : null;
    const steps: GhlCanonicalStep[] = [...run.stepRuns]
      .sort((a, b) => a.stepOrder - b.stepOrder)
      .map((step) => ({
        stepType: step.stepType,
        status: step.status,
        externalId: step.externalId,
        errorCode: step.errorCode,
        responseRedactedJson: step.responseRedactedJson,
      }));
    const contact = ghlContactReceived({
      run: {
        id: run.id,
        mode: run.mode,
        status: run.status,
        completedAt: run.completedAt,
        destinationClientAccountId: run.destinationClientAccountId,
        destinationSubaccountIdGhl: run.destinationSubaccountIdGhl,
        idempotencyKey: run.idempotencyKey,
      },
      steps,
      destination: destination
        ? { clientAccountId: destination.clientAccountId, locationIdGhl: destination.destinationSubaccountIdGhl }
        : null,
      outbox: outbox
        ? {
            status: outbox.status,
            clientAccountId: outbox.clientAccountId,
            sourceLeadEventId: outbox.sourceLeadEventId,
            destinationLocationIdGhl: outbox.destinationLocationIdGhl,
            liveRunId: outbox.liveRunId,
          }
        : null,
      sourceLead: lead,
      onboardingTestAttemptId: attempts.get(run.idempotencyKey) ?? null,
      onboardingTestAttemptKeys: onboardingKeys,
    });
    const preference = preferenceByClient.get(run.destinationClientAccountId) ?? null;
    const plan = planGhlLeadSms({
      evidence: "ghl_contact",
      clientAccountId: run.destinationClientAccountId,
      contact,
      liveRunId: run.id,
      preference,
    });
    if (plan.action !== "record") continue;
    const recorded = await recordGhlLeadNotice(db, plan);
    if (!recorded.inserted || recorded.receipt.status !== "pending") continue;
    inserted += 1;
    if (!deps.enqueue) continue;
    try {
      await deps.enqueue(recorded.receipt.id);
      enqueued += 1;
    } catch {
      // The insert is already committed. Recovery requeues this pending row.
    }
  }
  const last = runs[runs.length - 1];
  if (last?.completedAt) {
    await db.ghlLeadNoticeDiscoveryCursor.update({
      where: { id: GHL_LEAD_NOTICE_DISCOVERY_CURSOR_ID },
      data: { lastCompletedAt: last.completedAt, lastRunId: last.id },
    });
  }
  return { scanned: runs.length, inserted, enqueued, establishedCutoff: false };
}

async function loadOnboardingKeys(
  db: PrismaClient,
  runs: Array<{ idempotencyKey: string; stepRuns: Array<{ responseRedactedJson: unknown }> }>
): Promise<string[]> {
  const candidates = new Set<string>();
  for (const run of runs) {
    if (run.idempotencyKey.trim()) candidates.add(run.idempotencyKey);
    for (const step of run.stepRuns) collectKeys(step.responseRedactedJson, candidates);
  }
  const keys = [...candidates];
  if (keys.length === 0) return [];
  const rows = await db.clientOnboardingTestAttemptKey.findMany({
    where: { idempotencyKey: { in: keys } },
    select: { idempotencyKey: true },
  });
  return rows.map((row) => row.idempotencyKey);
}

async function loadOnboardingAttempts(db: PrismaClient, keys: string[]): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  const usable = keys.map((key) => key.trim()).filter((key) => key.length > 0);
  if (usable.length === 0) return ids;
  const attempts = await db.clientOnboardingTestAttempt.findMany({
    where: { idempotencyKey: { in: usable } },
    select: { id: true, idempotencyKey: true },
  });
  for (const attempt of attempts) ids.set(attempt.idempotencyKey, attempt.id);
  return ids;
}

async function ensureDiscoveryCutoff(db: PrismaClient, at: Date): Promise<void> {
  try {
    await db.ghlLeadNoticeDiscoveryCursor.create({
      data: { id: GHL_LEAD_NOTICE_CUTOFF_CURSOR_ID, lastCompletedAt: at, lastRunId: "" },
    });
  } catch (error) {
    if (!isUniqueConflict(error)) throw error;
  }
}

function isUniqueConflict(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "P2002"
  );
}

function collectKeys(value: unknown, into: Set<string>): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, into);
    return;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.idempotencyKey === "string" && record.idempotencyKey.trim()) into.add(record.idempotencyKey.trim());
  for (const nested of Object.values(record)) collectKeys(nested, into);
}
