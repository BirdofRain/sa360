/**
 * Customer portal delivery status from committed GoHighLevel receipts.
 *
 * Reads stored runs, step receipts, the destination, and the association
 * outbox. It calls `canonicalGhlDelivery` and does not call GoHighLevel,
 * retry a delivery, or write a timeline event.
 */

import type { Prisma, PrismaClient } from "@prisma/client";

import {
  canonicalGhlDelivery,
  type GhlCanonicalInput,
  type GhlCanonicalStep,
} from "../delivery-success/canonical-delivery.js";
import { parseSourceEnrichmentPolicyJson } from "../source-intake/source-enrichment.service.js";
import {
  normalizeDeliveryStatus,
  type NormalizedDeliveryStatus,
} from "./lead-delivery-status.js";

const LATER_CUSTOMER_EVENTS = new Set([
  "first_touch_sent",
  "contact_replied",
  "appointment_set",
  "appointment_showed",
  "sold",
]);

const OPTIONAL_STEP_TYPES = new Set([
  "assign_owner",
  "stamp_custom_fields",
  "stamp_source_attributes",
  "write_intake_summary_note",
]);

export type PortalGhlOptionalStepFailure = {
  stepType: string;
  status: string;
  errorCode: string | null;
};

/** Operator-visible receipt verdict for one lead. Absent when this lead has no matching association outbox. */
export type PortalGhlDeliveryFacts = {
  evaluated: true;
  canonical: boolean;
  /**
   * The two requirement values disagree and the run did not record one.
   * Customer surfaces say "Delivery unverified".
   */
  unverified: boolean;
  /** Null when this run did not record the requirement. */
  workflowStartRequired: boolean | null;
  at: string | null;
  reasons: string[];
  liveRunId: string | null;
  liveRunStatus: string | null;
  optionalStepFailures: PortalGhlOptionalStepFailure[];
};

export type PortalLeadDeliveryKey = {
  id: string;
  clientAccountId: string | null;
  destinationLocationId: string | null;
};

/** Read-only callers may pass a transaction client. This module only reads. */
export type PortalGhlDeliveryDb = PrismaClient | Prisma.TransactionClient;

type StoredStep = {
  stepOrder: number;
  stepType: string;
  status: string;
  externalId: string | null;
  errorCode: string | null;
  responseRedactedJson: unknown;
};

type StoredRun = {
  id: string;
  mode: string;
  status: string;
  completedAt: Date | null;
  destinationClientAccountId: string;
  destinationSubaccountIdGhl: string;
  idempotencyKey: string;
  workflowStartRequired: boolean | null;
  stepRuns: StoredStep[];
};

type StoredOutbox = {
  sourceLeadEventId: string;
  clientAccountId: string;
  destinationLocationIdGhl: string;
  liveRunId: string | null;
  status: string;
  externalCallExecuted: boolean;
  lastError: string | null;
  createdAt: Date;
};

type StoredDestination = {
  clientAccountId: string;
  destinationSubaccountIdGhl: string;
  workflowStartRequired: boolean;
  opportunityCreationEnabled: boolean;
  sourceEnrichmentPolicyJson: unknown;
};

export function applyCustomerPortalGhlDelivery(input: {
  deliveryStatus: NormalizedDeliveryStatus;
  lastEvent: { at: string | null; name: string | null };
  facts: PortalGhlDeliveryFacts | null | undefined;
  /** Same normalizer result with contact id ignored. A contact receipt is not delivery. */
  baselineWithoutContact: NormalizedDeliveryStatus;
}): { deliveryStatus: NormalizedDeliveryStatus; lastEvent: { at: string | null; name: string | null } } {
  const facts = input.facts;
  if (!facts?.evaluated) {
    return { deliveryStatus: input.deliveryStatus, lastEvent: input.lastEvent };
  }
  if (facts.unverified) {
    return {
      deliveryStatus: "unverified",
      lastEvent: { name: "delivery_unverified", at: input.lastEvent.at },
    };
  }
  if (facts.canonical) {
    const key = eventKey(input.lastEvent.name);
    if (key && LATER_CUSTOMER_EVENTS.has(key)) {
      return { deliveryStatus: "delivered", lastEvent: input.lastEvent };
    }
    return {
      deliveryStatus: "delivered",
      lastEvent: { name: "lead_delivered", at: facts.at ?? input.lastEvent.at },
    };
  }
  const deliveryStatus =
    input.baselineWithoutContact === "delivered"
      ? facts.liveRunStatus === "failed"
        ? "failed"
        : "not_started"
      : input.baselineWithoutContact;
  const key = eventKey(input.lastEvent.name);
  return {
    deliveryStatus,
    lastEvent: key === "lead_delivered" || key === "delivered" ? { name: null, at: input.lastEvent.at } : input.lastEvent,
  };
}

export function customerBaselineWithoutContact(input: {
  sourceStatus: Parameters<typeof normalizeDeliveryStatus>[0]["sourceStatus"];
  deliveryMode?: string | null;
  planStatus?: string | null;
  adapterRunStatus?: string | null;
  liveRunStatus?: string | null;
  deliveryResultStatus?: string | null;
}): NormalizedDeliveryStatus {
  return normalizeDeliveryStatus({ ...input, hasContactId: false });
}

export async function loadPortalGhlDeliveryFacts(
  leads: PortalLeadDeliveryKey[],
  db: PortalGhlDeliveryDb
): Promise<Map<string, PortalGhlDeliveryFacts>> {
  const ids = [...new Set(leads.map((lead) => lead.id).filter(Boolean))];
  const out = new Map<string, PortalGhlDeliveryFacts>();
  if (ids.length === 0) return out;

  const outboxes = await db.ghlAssociationDispatchOutbox.findMany({
    where: { sourceLeadEventId: { in: ids } },
    select: {
      sourceLeadEventId: true,
      clientAccountId: true,
      destinationLocationIdGhl: true,
      liveRunId: true,
      status: true,
      externalCallExecuted: true,
      lastError: true,
      createdAt: true,
    },
  });
  if (outboxes.length === 0) return out;

  const runIds = [...new Set(outboxes.map((row) => row.liveRunId).filter((id): id is string => Boolean(id)))];
  const clientIds = [...new Set(outboxes.map((row) => row.clientAccountId))];
  const [runs, destinations, profiles] = await Promise.all([
    runIds.length
      ? db.ghlLiveDeliveryRun.findMany({
          where: { id: { in: runIds } },
          select: {
            id: true,
            mode: true,
            status: true,
            completedAt: true,
            destinationClientAccountId: true,
            destinationSubaccountIdGhl: true,
            idempotencyKey: true,
            workflowStartRequired: true,
            stepRuns: {
              orderBy: { stepOrder: "asc" },
              select: {
                stepOrder: true,
                stepType: true,
                status: true,
                externalId: true,
                errorCode: true,
                responseRedactedJson: true,
              },
            },
          },
        })
      : Promise.resolve([]),
    db.clientGhlDestination.findMany({
      where: { clientAccountId: { in: clientIds } },
      select: {
        clientAccountId: true,
        destinationSubaccountIdGhl: true,
        workflowStartRequired: true,
        opportunityCreationEnabled: true,
        sourceEnrichmentPolicyJson: true,
      },
    }),
    db.clientOnboardingDestinationProfile.findMany({
      where: { clientAccountId: { in: clientIds } },
      select: { clientAccountId: true, notesEnabled: true },
    }),
  ]);

  const runById = new Map(runs.map((run) => [run.id, run]));
  const destinationByClient = new Map(destinations.map((row) => [row.clientAccountId, row]));
  const profileByClient = new Map(profiles.map((row) => [row.clientAccountId, row]));
  const onboardingKeys = await loadOnboardingKeys(db, runs);
  const attemptIds = await loadAttemptIds(db, runs);

  for (const lead of leads) {
    const outbox = matchingOutbox(outboxes, lead);
    if (!outbox) continue;
    const run = outbox.liveRunId ? runById.get(outbox.liveRunId) ?? null : null;
    if (!run) {
      out.set(lead.id, unevaluatedRun(outbox.liveRunId, ["run_missing"]));
      continue;
    }
    if (
      !same(run.destinationClientAccountId, lead.clientAccountId) ||
      !same(run.destinationSubaccountIdGhl, lead.destinationLocationId)
    ) {
      out.set(lead.id, unevaluatedRun(run.id, ["run_not_for_lead"]));
      continue;
    }
    const destination = destinationByClient.get(run.destinationClientAccountId) ?? null;
    const destinationMatches =
      destination != null &&
      same(destination.clientAccountId, lead.clientAccountId) &&
      same(destination.destinationSubaccountIdGhl, lead.destinationLocationId);
    const facts = factsForRun({
      run,
      outbox,
      destination: destinationMatches ? destination : null,
      notesEnabled: profileByClient.get(run.destinationClientAccountId)?.notesEnabled ?? false,
      onboardingKeys,
      onboardingTestAttemptId: attemptIds.get(run.idempotencyKey) ?? null,
    });
    out.set(lead.id, facts);
  }
  return out;
}

function factsForRun(input: {
  run: StoredRun;
  outbox: StoredOutbox;
  destination: StoredDestination | null;
  notesEnabled: boolean;
  onboardingKeys: string[];
  onboardingTestAttemptId: string | null;
}): PortalGhlDeliveryFacts {
  const policy = input.destination
    ? parseSourceEnrichmentPolicyJson(input.destination.sourceEnrichmentPolicyJson)
    : null;
  const steps: GhlCanonicalStep[] = input.run.stepRuns.map((step) => ({
    stepType: step.stepType,
    status: step.status,
    externalId: step.externalId,
    errorCode: step.errorCode,
    responseRedactedJson: step.responseRedactedJson,
  }));
  const base: Omit<GhlCanonicalInput, "destination"> = {
    run: {
      id: input.run.id,
      mode: input.run.mode,
      status: input.run.status,
      completedAt: input.run.completedAt,
      destinationClientAccountId: input.run.destinationClientAccountId,
      idempotencyKey: input.run.idempotencyKey,
    },
    steps,
    opportunityConfigured:
      input.destination != null &&
      policy?.lalAiBot1VetWebform !== true &&
      input.destination.opportunityCreationEnabled === true,
    intakeSummaryNotesEnabled: policy?.intakeSummaryNotesEnabled === true,
    onboardingProfileNotesEnabled: input.notesEnabled,
    profile: input.destination
      ? { clientAccountId: input.destination.clientAccountId, notesEnabled: input.notesEnabled }
      : null,
    outbox: {
      status: input.outbox.status,
      clientAccountId: input.outbox.clientAccountId,
      sourceLeadEventId: input.outbox.sourceLeadEventId,
      externalCallExecuted: input.outbox.externalCallExecuted,
      lastError: input.outbox.lastError,
      liveRunId: input.outbox.liveRunId,
    },
    onboardingTestAttemptId: input.onboardingTestAttemptId,
    onboardingTestAttemptKeys: input.onboardingKeys,
  };
  const saved = input.run.workflowStartRequired;
  const verdictFor = (required: boolean) =>
    canonicalGhlDelivery({
      ...base,
      destination: input.destination
        ? { clientAccountId: input.destination.clientAccountId, workflowStartRequired: required }
        : null,
    });
  if (saved === true || saved === false) {
    return packFacts(input.run, verdictFor(saved), false, saved);
  }
  const requiredVerdict = verdictFor(true);
  const optionalVerdict = verdictFor(false);
  if (requiredVerdict.canonical === optionalVerdict.canonical) {
    const reasons = requiredVerdict.canonical
      ? []
      : requiredVerdict.reasons.filter((reason) => optionalVerdict.reasons.includes(reason));
    return packFacts(input.run, { ...requiredVerdict, canonical: requiredVerdict.canonical, reasons }, false, null);
  }
  return packFacts(
    input.run,
    { ...requiredVerdict, canonical: false, at: null, reasons: ["workflow_requirement_unknown"] },
    true,
    null
  );
}

function packFacts(
  run: StoredRun,
  verdict: { canonical: boolean; at: string | null; reasons: string[] },
  unverified: boolean,
  workflowStartRequired: boolean | null
): PortalGhlDeliveryFacts {
  return {
    evaluated: true,
    canonical: verdict.canonical,
    unverified,
    workflowStartRequired,
    at: verdict.at,
    reasons: verdict.reasons,
    liveRunId: run.id,
    liveRunStatus: run.status,
    optionalStepFailures: optionalStepFailures(run.stepRuns, workflowStartRequired === true),
  };
}

function unevaluatedRun(liveRunId: string | null, reasons: string[]): PortalGhlDeliveryFacts {
  return {
    evaluated: true,
    canonical: false,
    unverified: false,
    workflowStartRequired: null,
    at: null,
    reasons,
    liveRunId,
    liveRunStatus: null,
    optionalStepFailures: [],
  };
}

function matchingOutbox(outboxes: StoredOutbox[], lead: PortalLeadDeliveryKey): StoredOutbox | null {
  const matches = outboxes.filter(
    (outbox) =>
      outbox.sourceLeadEventId === lead.id &&
      same(outbox.clientAccountId, lead.clientAccountId) &&
      same(outbox.destinationLocationIdGhl, lead.destinationLocationId)
  );
  matches.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return matches[0] ?? null;
}

export function optionalStepFailures(steps: StoredStep[], workflowRequired: boolean): PortalGhlOptionalStepFailure[] {
  const failures: PortalGhlOptionalStepFailure[] = [];
  for (const step of steps) {
    const optional =
      OPTIONAL_STEP_TYPES.has(step.stepType) || (step.stepType === "start_workflow" && !workflowRequired);
    if (!optional || step.status === "succeeded") continue;
    if (step.status === "skipped" && !step.errorCode) continue;
    failures.push({
      stepType: step.stepType,
      status: step.status,
      errorCode: step.errorCode,
    });
  }
  return failures;
}

export async function loadOnboardingKeys(db: PortalGhlDeliveryDb, runs: Array<{ idempotencyKey: string; stepRuns: Array<{ responseRedactedJson: unknown }> }>): Promise<string[]> {
  const candidates = new Set<string>();
  for (const run of runs) {
    if (run.idempotencyKey.trim()) candidates.add(run.idempotencyKey.trim());
    for (const step of run.stepRuns) collectIdempotencyKeys(step.responseRedactedJson, candidates);
  }
  const keys = [...candidates];
  if (keys.length === 0) return [];
  const rows = await db.clientOnboardingTestAttemptKey.findMany({
    where: { idempotencyKey: { in: keys } },
    select: { idempotencyKey: true },
  });
  return rows.map((row) => row.idempotencyKey);
}

export async function loadAttemptIds(db: PortalGhlDeliveryDb, runs: Array<{ idempotencyKey: string }>): Promise<Map<string, string>> {
  const keys = runs.map((run) => run.idempotencyKey.trim()).filter(Boolean);
  const ids = new Map<string, string>();
  if (keys.length === 0) return ids;
  const attempts = await db.clientOnboardingTestAttempt.findMany({
    where: { idempotencyKey: { in: keys } },
    select: { id: true, idempotencyKey: true },
  });
  for (const attempt of attempts) ids.set(attempt.idempotencyKey, attempt.id);
  return ids;
}

function collectIdempotencyKeys(value: unknown, into: Set<string>): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) collectIdempotencyKeys(item, into);
    return;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.idempotencyKey === "string" && record.idempotencyKey.trim()) {
    into.add(record.idempotencyKey.trim());
  }
  for (const nested of Object.values(record)) collectIdempotencyKeys(nested, into);
}

function same(left: string | null | undefined, right: string | null | undefined): boolean {
  const a = left?.trim() ?? "";
  const b = right?.trim() ?? "";
  return a.length > 0 && a === b;
}

function eventKey(name: string | null): string | null {
  const trimmed = name?.trim();
  if (!trimmed) return null;
  return trimmed.toLowerCase().replace(/[\s-]+/g, "_");
}
