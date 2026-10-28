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

const CUSTOMER_PROVIDERS = new Set(["leadcapture_io", "facebook", "goat_leads", "google_sheets", "unknown"]);

/**
 * The only intake shape a local fixture may use until a dedicated quarantine
 * row exists. LeadCapture, webhooks, and provider replays are customer intake.
 */
export function operatorOwnedIntake(event: OperatorIntake): boolean {
  if (event.webhookRequestLogId) return false;
  if (event.sourceRouteKey === "leadcapture_form") return false;
  if (!event.sourceProvider || CUSTOMER_PROVIDERS.has(event.sourceProvider)) return false;
  return (
    event.sourceProvider === "manual_import" &&
    event.sourceSystem === "external_vendor" &&
    event.sourceType === "manual_entry"
  );
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
  const recordClass = recordClassOf(event.enrichmentMetadataJson);
  if (recordClass !== "onboarding_operator_owned_test" || !operatorOwnedIntake(event) || event.deliveryResultJson != null) {
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
