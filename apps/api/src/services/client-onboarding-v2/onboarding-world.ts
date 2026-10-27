/**
 * Loads the captured-test world from local records.
 * It does not call Google, GoHighLevel, Meta, or LeadCapture.
 */

import type { PrismaClient } from "@prisma/client";

import { prisma } from "../../lib/db.js";
import type {
  ApprovedExactV3Worksheet,
  CapturedTestWorld,
  ProductionSnapshot,
  StoredSourceEvent,
  WorksheetControlSnapshot,
  WorksheetRisk,
} from "./captured-test-delivery.js";

const SELECTABLE = new Set(["company_created", "drive_owner_verified", "approved_shared_drive"]);

export async function loadCapturedTestWorld(
  clientAccountId: string,
  sourceLeadEventId?: string | null,
  db: PrismaClient = prisma
): Promise<CapturedTestWorld> {
  const client = await db.clientAccount.findUnique({
    where: { clientAccountId },
    include: {
      onboardingDestinationProfile: true,
      ghlDestination: true,
      companySheetsDestination: { include: { tabContracts: true } },
      onboardingVerifiedTestIdentities: true,
      onboardingTestWorksheet: true,
    },
  });
  if (!client) {
    return {
      clientFound: false,
      event: null,
      identities: [],
      sheets: null,
      ghl: null,
      production: emptyProduction(),
    };
  }
  const event = sourceLeadEventId
    ? await db.sourceLeadEvent.findUnique({ where: { id: sourceLeadEventId } })
    : null;
  const jobs = await db.companySheetsDeliveryJob.findMany({
    where: { clientAccountId },
    select: { status: true, appendStartedAt: true, worksheetId: true, kind: true, spreadsheetId: true },
  });
  const attempts = await db.clientOnboardingTestAttempt.findMany({
    where: { ownerClientAccountId: clientAccountId, destination: "google_sheets" },
    select: { status: true, appendStartedAt: true, worksheetId: true, spreadsheetId: true },
  });
  const [sourceLeadEventCount, inventoryCount, billingRowCount, dispatchIntentCount] = await Promise.all([
    db.sourceLeadEvent.count({ where: { clientAccountIdResolved: clientAccountId } }),
    db.leadInventoryItem.count({ where: { originClientAccountId: clientAccountId } }),
    db.fulfillmentOutbox.count({ where: { sourceLeadEvent: { clientAccountIdResolved: clientAccountId } } }),
    db.companySheetsDispatchIntent.count({ where: { clientAccountId } }),
  ]);
  const destination = client.companySheetsDestination;
  const campaign = boundTab(destination?.tabContracts.find((contract) => contract.role === "campaign"));
  const canary = boundTab(destination?.tabContracts.find((contract) => contract.role === "canary"));
  const approved = client.onboardingTestWorksheet;
  const production: ProductionSnapshot = {
    sourceLeadEventCount,
    inventoryCount,
    billingRowCount,
    dispatchIntentCount,
    eventStatus: event?.status ?? null,
    eventDeliveryResult: event?.deliveryResultJson ?? null,
    campaignDispatchEnabled: destination?.campaignDispatchEnabled ?? false,
    agedDispatchEnabled: destination?.agedDispatchEnabled ?? false,
  };
  return {
    clientFound: true,
    event: event ? toEvent(event) : null,
    identities: client.onboardingVerifiedTestIdentities.map((identity) => ({
      email: identity.email,
      phoneE164: identity.phoneE164,
    })),
    sheets: destination
      ? {
          spreadsheetId: destination.spreadsheetId,
          spreadsheetTitle: destination.spreadsheetTitle,
          canaryApproved: destination.canaryApproved,
          campaignDispatchEnabled: destination.campaignDispatchEnabled,
          agedDispatchEnabled: destination.agedDispatchEnabled,
          campaign,
          canary: canary
            ? { worksheetId: canary.worksheetId, worksheetTitle: canary.worksheetTitle, header: canary.header }
            : null,
          campaignRisk: jobRisk(jobs, campaign?.worksheetId ?? null),
          canaryRisk: jobRisk(jobs, canary?.worksheetId ?? null),
          campaignControl: controlFromDestination(destination.controlBasis, destination.accessCheckedAt ?? destination.updatedAt),
          destinationRevision: destination.destinationRevision,
          approvedTestWorksheet: approved ? toApproved(approved) : null,
          approvedTestWorksheetRisk: attemptRisk(attempts, approved?.spreadsheetId ?? null, approved?.worksheetId ?? null),
        }
      : null,
    ghl: {
      locationId: client.ghlDestination?.destinationSubaccountIdGhl ?? null,
      isolatedLocationId: null,
      workflowId: client.ghlDestination?.destinationWorkflowIdGhl ?? null,
      workflowName: null,
      workflowTriggerMode: client.ghlDestination?.workflowTriggerMode ?? null,
      notesEnabled: client.onboardingDestinationProfile?.notesEnabled ?? null,
    },
    production,
  };
}

function boundTab(
  contract:
    | { worksheetId: number | null; worksheetTitle: string | null; schemaVersion: string | null; headerContract: unknown }
    | null
    | undefined
): { worksheetId: number; worksheetTitle: string; schemaVersion: string; header: string[] } | null {
  if (!contract || contract.worksheetId == null || !contract.worksheetTitle || !contract.schemaVersion) return null;
  return {
    worksheetId: contract.worksheetId,
    worksheetTitle: contract.worksheetTitle,
    schemaVersion: contract.schemaVersion,
    header: stringList(contract.headerContract),
  };
}

function toEvent(event: {
  id: string;
  clientAccountIdResolved: string | null;
  status: string;
  sourceRouteKey: string | null;
  enrichmentMetadataJson: unknown;
  normalizedPayloadJson: unknown;
  receivedAt: Date;
  sourceLeadId: string | null;
  deliveryResultJson: unknown;
}): StoredSourceEvent {
  return {
    id: event.id,
    clientAccountIdResolved: event.clientAccountIdResolved,
    status: event.status,
    sourceRouteKey: event.sourceRouteKey,
    enrichmentMetadataJson: event.enrichmentMetadataJson,
    normalizedPayloadJson: event.normalizedPayloadJson,
    receivedAt: event.receivedAt.toISOString(),
    sourceLeadId: event.sourceLeadId,
    deliveryResultJson: event.deliveryResultJson,
  };
}

function toApproved(row: {
  spreadsheetId: string;
  worksheetId: number;
  worksheetTitle: string;
  schemaVersion: string;
  header: unknown;
  headerSha256: string;
  destinationRevision: number;
  clientAccountId: string;
  controlBasis: unknown;
}): ApprovedExactV3Worksheet {
  const control = asRecord(row.controlBasis);
  return {
    spreadsheetId: row.spreadsheetId,
    worksheetId: row.worksheetId,
    worksheetTitle: row.worksheetTitle,
    schemaVersion: row.schemaVersion,
    header: stringList(row.header),
    headerSha256: row.headerSha256,
    destinationRevision: row.destinationRevision,
    ownerClientAccountId: row.clientAccountId,
    control: {
      establishControl: typeof control?.establishControl === "string" ? control.establishControl : "",
      checkedAt: typeof control?.checkedAt === "string" ? control.checkedAt : "",
    },
  };
}

function controlFromDestination(controlBasis: string, checkedAt: Date): WorksheetControlSnapshot | null {
  if (!SELECTABLE.has(controlBasis)) return null;
  return { establishControl: controlBasis, checkedAt: checkedAt.toISOString() };
}

function jobRisk(
  jobs: Array<{ status: string; appendStartedAt: Date | null; worksheetId: number; kind: string }>,
  worksheetId: number | null
): WorksheetRisk {
  const rows = worksheetId == null ? [] : jobs.filter((job) => job.worksheetId === worksheetId);
  return {
    uncertain: rows.some((job) => job.status === "uncertain"),
    appendStartedAtHeld: rows.some(
      (job) => job.appendStartedAt != null && job.status !== "succeeded" && job.status !== "failed"
    ),
    campaignTestUnresolved: rows.some(
      (job) => job.kind === "campaign_test" && job.status !== "succeeded" && job.status !== "failed"
    ),
  };
}

function attemptRisk(
  attempts: Array<{ status: string; appendStartedAt: Date | null; worksheetId: number | null; spreadsheetId: string | null }>,
  spreadsheetId: string | null,
  worksheetId: number | null
): WorksheetRisk {
  const rows = attempts.filter(
    (attempt) => attempt.spreadsheetId === spreadsheetId && attempt.worksheetId === worksheetId
  );
  return {
    uncertain: rows.some((attempt) => attempt.status === "uncertain"),
    appendStartedAtHeld: rows.some(
      (attempt) => attempt.appendStartedAt != null && attempt.status !== "succeeded" && attempt.status !== "failed"
    ),
  };
}

function emptyProduction(): ProductionSnapshot {
  return {
    sourceLeadEventCount: 0,
    inventoryCount: 0,
    billingRowCount: 0,
    dispatchIntentCount: 0,
    eventStatus: null,
    eventDeliveryResult: null,
    campaignDispatchEnabled: false,
    agedDispatchEnabled: false,
  };
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}
