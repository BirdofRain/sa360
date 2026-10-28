/**
 * Quarantine checks for one operator-owned test event.
 * A recordClass label is not sufficient. This module does not create events.
 */

import { Prisma, type PrismaClient } from "@prisma/client";

import { campaignLeadIdentityFromPayload } from "../company-sheets-dispatch/company-sheets-onboarding-read.js";

type Db = PrismaClient | Prisma.TransactionClient;

export type OperatorIntake = {
  sourceProvider?: string | null;
  sourceSystem?: string | null;
  sourceType?: string | null;
  sourceRouteKey?: string | null;
  webhookRequestLogId?: string | null;
};

/** Every SourceLeadProvider value the current schema can store. None is a quarantine. */
export const PRODUCTION_INTAKE_PROVIDERS = [
  "leadcapture_io",
  "facebook",
  "goat_leads",
  "manual_import",
  "google_sheets",
  "unknown",
] as const;

/** Every SourceLeadSystem value the current schema can store. */
export const PRODUCTION_INTAKE_SYSTEMS = [
  "leadcapture_io_legacy",
  "leadcapture_io_nextgen",
  "meta_lead_ads",
  "external_vendor",
  "csv_import",
  "google_sheet_import",
] as const;

/** Every SourceLeadType value the current schema can store. */
export const PRODUCTION_INTAKE_TYPES = ["webhook", "lead_form", "bulk_import", "api_import", "manual_entry"] as const;

const PRODUCTION_PROVIDERS = new Set<string>(PRODUCTION_INTAKE_PROVIDERS);
const PRODUCTION_SYSTEMS = new Set<string>(PRODUCTION_INTAKE_SYSTEMS);
const PRODUCTION_TYPES = new Set<string>(PRODUCTION_INTAKE_TYPES);

/**
 * Current production intake is never a quarantine.
 * `manual_import` / `external_vendor` / `manual_entry` is a shape the schema
 * can already store. recordClass, that triple, and an email domain do not
 * authorize a send. A later creator must register a durable authorization
 * record that this function does not infer from SourceLeadEvent columns.
 */
export function operatorOwnedIntake(event: OperatorIntake): boolean {
  if (event.webhookRequestLogId) return false;
  if (event.sourceRouteKey === "leadcapture_form") return false;
  if (!event.sourceProvider || PRODUCTION_PROVIDERS.has(event.sourceProvider)) return false;
  if (!event.sourceSystem || PRODUCTION_SYSTEMS.has(event.sourceSystem)) return false;
  if (!event.sourceType || PRODUCTION_TYPES.has(event.sourceType)) return false;
  // Unknown future strings are also refused. A later creator must consult a
  // durable authorization record. Do not return true from SourceLeadEvent columns.
  return false;
}

export async function assertGoogleOnlyReservation(
  db: Db,
  clientAccountId: string,
  sourceLeadEventId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const event = await db.sourceLeadEvent.findUnique({ where: { id: sourceLeadEventId } });
  if (!event || event.clientAccountIdResolved !== clientAccountId) {
    return { ok: false, error: "event_not_client_owned" };
  }
  if (!operatorOwnedIntake(event)) {
    return { ok: false, error: "quarantine_not_registered" };
  }
  const recordClass = recordClassOf(event.enrichmentMetadataJson);
  if (recordClass !== "onboarding_operator_owned_test" || event.deliveryResultJson != null) {
    return { ok: false, error: "event_not_operator_owned" };
  }
  const [inventoryCount, fulfillmentCount, allocationCount, dispatchIntentCount, billingAuditCount] = await Promise.all([
    db.leadInventoryItem.count({ where: { sourceLeadEventId } }),
    db.fulfillmentOutbox.count({ where: { sourceLeadEventId } }),
    db.leadAllocation.count({ where: { sourceLeadEventId } }),
    db.companySheetsDispatchIntent.count({ where: { sourceLeadEventId } }),
    db.leadVerificationApprovalAuditEvent.count({ where: { sourceLeadEventId } }),
  ]);
  if (inventoryCount || fulfillmentCount || allocationCount || dispatchIntentCount || billingAuditCount) {
    return { ok: false, error: "event_not_operator_owned" };
  }
  const contact = campaignLeadIdentityFromPayload(event.normalizedPayloadJson);
  const email = contact.email.trim().toLowerCase();
  const phone = contact.phone.trim();
  if (!email && !phone) return { ok: false, error: "verified_test_identity_mismatch" };
  if (email.endsWith(".invalid") || email.endsWith("@example.com")) {
    return { ok: false, error: "synthetic_contact_refused" };
  }
  const identities = await db.clientOnboardingVerifiedTestIdentity.findMany({ where: { clientAccountId } });
  const matched = identities.some((row) => {
    const rowEmail = row.email?.trim().toLowerCase() ?? "";
    const rowPhone = row.phoneE164?.trim() ?? "";
    return (rowEmail && email && rowEmail === email) || (rowPhone && phone && rowPhone === phone);
  });
  if (!matched) return { ok: false, error: "verified_test_identity_mismatch" };
  const sharedIdentity = await db.clientOnboardingVerifiedTestIdentity.findFirst({
    where: {
      clientAccountId: { not: clientAccountId },
      OR: [
        ...(email ? [{ email: { equals: email, mode: "insensitive" as const } }] : []),
        ...(phone ? [{ phoneE164: phone }] : []),
      ],
    },
    select: { id: true },
  });
  if (sharedIdentity) return { ok: false, error: "verified_test_identity_mismatch" };
  const sharedLead = await sourceLeadOwnedByOtherClient(db, clientAccountId, email, phone);
  if (sharedLead) return { ok: false, error: "verified_test_identity_mismatch" };
  return { ok: true };
}

const ONE_SHOT_CONFIRMATION = "DELIVER ONE GOOGLE SHEETS TEST ROW";

export type GoogleOnlyAppendAuthorization = {
  clientAccountId: string;
  sourceLeadEventId: string;
  testRunId: string;
  spreadsheetId: string;
  worksheetId: number;
  idempotencyKey: string;
};

/**
 * The append and enqueue ports cannot trust a caller-supplied confirmation.
 * The persisted test run must already describe the one-shot shape, and the
 * source event must have a durable quarantine registration. This release
 * does not create that registration, so current events fail closed.
 */
export async function authorizeGoogleOnlyAppend(
  db: Db,
  env: NodeJS.ProcessEnv,
  input: GoogleOnlyAppendAuthorization
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (
    env.SA360_CLIENT_ONBOARDING_V2_CAPTURED_TEST_ENABLED !== "true" ||
    env.SA360_CLIENT_ONBOARDING_GOOGLE_ONLY_PILOT_ENABLED !== "true"
  ) {
    return { ok: false, error: "google_only_pilot_required" };
  }
  if (input.idempotencyKey !== `onboarding-test:${input.testRunId}:sheets`) {
    return { ok: false, error: "production_idempotency_guard" };
  }
  const run = await db.clientOnboardingTestRun.findUnique({ where: { id: input.testRunId } });
  if (!run || run.sourceLeadEventId !== input.sourceLeadEventId) {
    return { ok: false, error: "test_run_not_reserved" };
  }
  if (run.clientAccountId !== input.clientAccountId) {
    return { ok: false, error: "tenant_mismatch" };
  }
  const snapshot = asRecord(run.requestSnapshot);
  const sheet = asRecord(snapshot?.sheet);
  const confirmation =
    typeof snapshot?.confirmation === "string"
      ? snapshot.confirmation
      : typeof snapshot?.fingerprint === "string"
        ? (snapshot.fingerprint.split("|").at(-1) ?? "")
        : "";
  const destinations = Array.isArray(run.destinations) ? run.destinations.filter((item): item is string => typeof item === "string") : [];
  const sheetsContract =
    typeof snapshot?.sheetsContract === "string"
      ? snapshot.sheetsContract
      : typeof sheet?.sheetsContract === "string"
        ? sheet.sheetsContract
        : "";
  if (
    run.kind !== "captured_event_delivery" ||
    confirmation !== ONE_SHOT_CONFIRMATION ||
    destinations.length !== 1 ||
    destinations[0] !== "google_sheets" ||
    run.isolationMode !== "isolated_destination" ||
    sheetsContract !== "exact_v3_test_worksheet"
  ) {
    return { ok: false, error: "google_only_pilot_required" };
  }
  if (typeof sheet?.spreadsheetId === "string" && sheet.spreadsheetId !== input.spreadsheetId) {
    return { ok: false, error: "test_worksheet_not_approved" };
  }
  if (typeof sheet?.worksheetId === "number" && sheet.worksheetId !== input.worksheetId) {
    return { ok: false, error: "test_worksheet_not_approved" };
  }
  const approved = await db.clientOnboardingTestWorksheet.findUnique({ where: { clientAccountId: input.clientAccountId } });
  if (!approved || approved.spreadsheetId !== input.spreadsheetId || approved.worksheetId !== input.worksheetId) {
    return { ok: false, error: "test_worksheet_not_approved" };
  }
  const destination = await db.companySheetsDestination.findUnique({ where: { clientAccountId: input.clientAccountId } });
  if (destination && destination.spreadsheetId === approved.spreadsheetId) {
    return { ok: false, error: "test_worksheet_not_approved" };
  }
  const priors = await db.clientOnboardingTestRun.findMany({
    where: {
      clientAccountId: input.clientAccountId,
      sourceLeadEventId: input.sourceLeadEventId,
      id: { not: run.id },
      status: { in: ["succeeded", "uncertain", "executing"] },
    },
    select: { status: true },
  });
  if (priors.some((prior) => prior.status === "uncertain" || prior.status === "executing")) {
    return { ok: false, error: "repeat_blocked_uncertain" };
  }
  if (priors.some((prior) => prior.status === "succeeded")) {
    return { ok: false, error: "one_test_already_used" };
  }
  const blockingJob = await db.companySheetsDeliveryJob.findFirst({
    where: {
      clientAccountId: input.clientAccountId,
      kind: "onboarding_captured_test",
      idempotencyKey: { not: input.idempotencyKey },
      OR: [{ status: "succeeded" }, { status: "uncertain" }, { status: "running" }, { appendStartedAt: { not: null } }],
    },
    select: { status: true },
  });
  if (blockingJob?.status === "succeeded") return { ok: false, error: "one_test_already_used" };
  if (blockingJob) return { ok: false, error: "repeat_blocked_uncertain" };
  return assertGoogleOnlyReservation(db, input.clientAccountId, input.sourceLeadEventId);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export async function countIdentityConflicts(
  db: Db,
  clientAccountId: string
): Promise<{ verifiedIdentityConflicts: number; storedLeadConflicts: number }> {
  const identities = await db.clientOnboardingVerifiedTestIdentity.findMany({
    where: { clientAccountId },
    select: { email: true, phoneE164: true },
  });
  let verifiedIdentityConflicts = 0;
  let storedLeadConflicts = 0;
  for (const identity of identities) {
    const email = identity.email?.trim().toLowerCase() ?? "";
    const phone = identity.phoneE164?.trim() ?? "";
    if (!email && !phone) continue;
    const otherIdentity = await db.clientOnboardingVerifiedTestIdentity.findFirst({
      where: {
        clientAccountId: { not: clientAccountId },
        OR: [
          ...(email ? [{ email: { equals: email, mode: "insensitive" as const } }] : []),
          ...(phone ? [{ phoneE164: phone }] : []),
        ],
      },
      select: { id: true },
    });
    if (otherIdentity) verifiedIdentityConflicts += 1;
    if (await sourceLeadOwnedByOtherClient(db, clientAccountId, email, phone)) storedLeadConflicts += 1;
  }
  return { verifiedIdentityConflicts, storedLeadConflicts };
}

export async function sourceLeadOwnedByOtherClient(db: Db, clientAccountId: string, email: string, phone: string): Promise<boolean> {
  if (!email && !phone) return false;
  const rows = await db.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT id FROM "SourceLeadEvent"
    WHERE "clientAccountIdResolved" IS DISTINCT FROM ${clientAccountId}
      AND (
        (${email} <> '' AND lower("normalizedPayloadJson" #>> '{contact,email}') = ${email})
        OR (${phone} <> '' AND "normalizedPayloadJson" #>> '{contact,phone_e164}' = ${phone})
      )
    LIMIT 1
  `);
  return rows.length > 0;
}

function recordClassOf(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const recordClass = (value as { recordClass?: unknown }).recordClass;
  return typeof recordClass === "string" ? recordClass : "";
}
