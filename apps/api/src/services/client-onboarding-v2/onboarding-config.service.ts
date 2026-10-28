/**
 * Onboarding v2 configuration persistence.
 * Writes the destination profile, verified test identity, exact-v3 test
 * worksheet, and non-operational activation intent. It does not enable
 * delivery, move a cutoff, or call Google or GoHighLevel.
 */

import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { COMPANY_SHEETS_V3_HEADER } from "@sa360/shared";
import { isCustomSheetsWriterEnabled } from "../company-sheets-delivery/company-sheets-custom-row.js";
import { findPublishedColumnMap } from "./column-maps.js";

import { prisma } from "../../lib/db.js";
import {
  COMPANY_SHEETS_CANARY_HEADER,
  COMPANY_SHEETS_CANARY_SCHEMA_VERSION,
  COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V3,
} from "../../lib/company-google-sheets-env.js";
import { assessBoundCampaignHeader, readClientOnboardingSummary, sheetsFirstActivationReady } from "./readiness.js";

const CONFIRMATION = "ACTIVATE CLIENT ONBOARDING DESTINATION";
const SELECTABLE_CONTROL = new Set(["company_created", "drive_owner_verified", "approved_shared_drive"]);
const V3_HEADER = [...COMPANY_SHEETS_V3_HEADER];

export type OnboardingConfigFailure = { ok: false; statusCode: number; error: string; detail?: string };

export type WorksheetHeaderRead = {
  spreadsheetId: string;
  worksheetId: number;
  worksheetTitle: string;
  header: string[];
  control: { establishControl: string; checkedAt: string };
  destinationRevision: number;
  /** empty is the only value that can be approved. A failed body read must not use this field. */
  historicalDataRows: "empty" | "has_rows" | "truncated" | "unproven";
};

export async function saveOnboardingDestinationProfile(
  input: {
    clientAccountId: string;
    requestId: string;
    expectedRevision: number;
    sheetsSelected: boolean;
    ghlMode: "unset" | "location_api" | "inbound_webhook" | "external_zapier";
    notesEnabled: boolean;
    actorLabel?: string | null;
  },
  db: PrismaClient = prisma
): Promise<
  | {
      ok: true;
      revision: number;
      notesEnabled: boolean;
      notesContractVersion: string | null;
      ghlMode: string;
      sheetsSelected: boolean;
      deliveryEnabled: boolean;
      campaignDispatchEnabled: boolean;
    }
  | OnboardingConfigFailure
> {
  const client = await db.clientAccount.findUnique({
    where: { clientAccountId: input.clientAccountId },
    include: { ghlDestination: true, companySheetsDestination: true },
  });
  if (!client) return { ok: false, statusCode: 404, error: "client_not_found" };
  const before = switchSnapshot(client.ghlDestination, client.companySheetsDestination);
  const notesEnabled = input.ghlMode === "location_api" && input.notesEnabled === true;
  const notesContractVersion = notesEnabled ? "sa360_lead_note_v2" : null;
  const existing = await db.clientOnboardingDestinationProfile.findUnique({
    where: { clientAccountId: input.clientAccountId },
  });
  if (existing) {
    if (existing.revision !== input.expectedRevision) {
      return { ok: false, statusCode: 409, error: "revision_conflict" };
    }
    const updated = await db.clientOnboardingDestinationProfile.updateMany({
      where: { clientAccountId: input.clientAccountId, revision: input.expectedRevision },
      data: {
        ghlMode: input.ghlMode,
        notesEnabled,
        notesContractVersion,
        sheetsSelected: input.sheetsSelected,
        revision: { increment: 1 },
      },
    });
    if (updated.count !== 1) return { ok: false, statusCode: 409, error: "revision_conflict" };
  } else if (input.expectedRevision !== 0) {
    return { ok: false, statusCode: 409, error: "revision_conflict" };
  } else {
    await db.clientOnboardingDestinationProfile.create({
      data: {
        clientAccountId: input.clientAccountId,
        ghlMode: input.ghlMode,
        notesEnabled,
        notesContractVersion,
        sheetsSelected: input.sheetsSelected,
        revision: 1,
      },
    });
  }
  const saved = await db.clientOnboardingDestinationProfile.findUniqueOrThrow({
    where: { clientAccountId: input.clientAccountId },
  });
  const afterClient = await db.clientAccount.findUniqueOrThrow({
    where: { clientAccountId: input.clientAccountId },
    include: { ghlDestination: true, companySheetsDestination: true },
  });
  const after = switchSnapshot(afterClient.ghlDestination, afterClient.companySheetsDestination);
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    return { ok: false, statusCode: 409, error: "worksheet_blocked", detail: "destination save changed a delivery switch" };
  }
  await db.clientOnboardingV2AuditEvent.create({
    data: {
      clientAccountId: input.clientAccountId,
      historicalClientAccountId: input.clientAccountId,
      requestId: input.requestId,
      action: "destination_profile_save",
      actorLabel: input.actorLabel ?? null,
      auth: "admin_api_key",
      destinations: [],
      metadataJson: {
        ghlMode: saved.ghlMode,
        notesEnabled: saved.notesEnabled,
        sheetsSelected: saved.sheetsSelected,
        revision: saved.revision,
      },
    },
  });
  return {
    ok: true,
    revision: saved.revision,
    notesEnabled: saved.notesEnabled,
    notesContractVersion: saved.notesContractVersion,
    ghlMode: saved.ghlMode,
    sheetsSelected: saved.sheetsSelected,
    deliveryEnabled: after.deliveryEnabled,
    campaignDispatchEnabled: after.campaignDispatchEnabled,
  };
}

export async function saveVerifiedTestIdentity(
  input: {
    clientAccountId: string;
    requestId: string;
    email: string | null;
    phoneE164: string | null;
    actorLabel?: string | null;
  },
  db: PrismaClient = prisma
): Promise<{ ok: true; persisted: true } | OnboardingConfigFailure> {
  const client = await db.clientAccount.findUnique({
    where: { clientAccountId: input.clientAccountId },
    select: { clientAccountId: true },
  });
  if (!client) return { ok: false, statusCode: 404, error: "client_not_found" };
  const email = input.email?.trim() || null;
  const phoneE164 = input.phoneE164?.trim() || null;
  if (!email && !phoneE164) return { ok: false, statusCode: 400, error: "invalid_confirmation" };
  if (phoneE164 && !/^\+[1-9][0-9]{7,14}$/.test(phoneE164)) {
    return { ok: false, statusCode: 400, error: "invalid_confirmation", detail: "phone must be E.164" };
  }
  try {
    await db.clientOnboardingVerifiedTestIdentity.create({
      data: {
        clientAccountId: input.clientAccountId,
        email,
        phoneE164,
        requestId: input.requestId,
        actorLabel: input.actorLabel ?? null,
        evidenceJson: { method: "operator_confirmed" },
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/Unique constraint/i.test(message)) {
      return { ok: false, statusCode: 409, error: "revision_conflict" };
    }
    throw error;
  }
  return { ok: true, persisted: true };
}

export async function approveExactV3TestWorksheet(
  input: {
    clientAccountId: string;
    requestId: string;
    actorLabel?: string | null;
    spreadsheetId?: string | null;
    worksheetId?: number | null;
  },
  readHeader: (
    clientAccountId: string,
    target?: { spreadsheetId: string; worksheetId: number } | null
  ) => Promise<WorksheetHeaderRead | null>,
  db: PrismaClient = prisma
): Promise<{ ok: true; worksheetId: number; schemaVersion: string } | OnboardingConfigFailure> {
  const client = await db.clientAccount.findUnique({
    where: { clientAccountId: input.clientAccountId },
    include: { companySheetsDestination: true },
  });
  if (!client) return { ok: false, statusCode: 404, error: "client_not_found" };
  const before = {
    canaryApproved: client.companySheetsDestination?.canaryApproved ?? null,
    campaignDispatchEnabled: client.companySheetsDestination?.campaignDispatchEnabled ?? null,
    spreadsheetId: client.companySheetsDestination?.spreadsheetId ?? null,
  };
  const target =
    input.spreadsheetId && input.worksheetId != null
      ? { spreadsheetId: input.spreadsheetId, worksheetId: input.worksheetId }
      : null;
  let header: WorksheetHeaderRead | null;
  try {
    header = await readHeader(input.clientAccountId, target);
  } catch {
    return { ok: false, statusCode: 409, error: "test_worksheet_not_approved", detail: "header read failed closed" };
  }
  if (!header) return { ok: false, statusCode: 409, error: "test_worksheet_not_approved" };
  if (isStatsTitle(header.worksheetTitle)) {
    return { ok: false, statusCode: 409, error: "test_worksheet_not_approved" };
  }
  if (isCanaryHeader(header.header)) {
    return { ok: false, statusCode: 409, error: "canary_schema_mismatch" };
  }
  if (!exactV3(header.header) || !SELECTABLE_CONTROL.has(header.control.establishControl)) {
    return { ok: false, statusCode: 409, error: "test_worksheet_not_approved" };
  }
  if (header.historicalDataRows !== "empty") {
    const incomplete = header.historicalDataRows === "truncated" || header.historicalDataRows === "unproven";
    return {
      ok: false,
      statusCode: 409,
      error: "test_worksheet_not_approved",
      detail: incomplete
        ? "the worksheet body was not proven empty. An incomplete or failed read is not empty"
        : "the test worksheet body must be empty. A truncated or failed read is not empty",
    };
  }
  if (client.companySheetsDestination && header.spreadsheetId === client.companySheetsDestination.spreadsheetId) {
    return {
      ok: false,
      statusCode: 409,
      error: "test_worksheet_not_approved",
      detail: "the test worksheet must be a separate spreadsheet from the saved production file",
    };
  }
  const data = {
    spreadsheetId: header.spreadsheetId,
    worksheetId: header.worksheetId,
    worksheetTitle: header.worksheetTitle,
    schemaVersion: COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V3,
    header: header.header as Prisma.InputJsonValue,
    headerSha256: sha256(JSON.stringify(header.header)),
    destinationRevision: header.destinationRevision,
    controlBasis: header.control as Prisma.InputJsonValue,
    approvedAt: new Date(),
  };
  await db.clientOnboardingTestWorksheet.upsert({
    where: { clientAccountId: input.clientAccountId },
    create: { clientAccountId: input.clientAccountId, ...data },
    update: data,
  });
  const after = await db.companySheetsDestination.findUnique({ where: { clientAccountId: input.clientAccountId } });
  if (
    (after?.canaryApproved ?? null) !== before.canaryApproved ||
    (after?.campaignDispatchEnabled ?? null) !== before.campaignDispatchEnabled ||
    (after?.spreadsheetId ?? null) !== before.spreadsheetId
  ) {
    return { ok: false, statusCode: 409, error: "worksheet_blocked", detail: "test worksheet approval changed a production binding" };
  }
  await db.clientOnboardingV2AuditEvent.create({
    data: {
      clientAccountId: input.clientAccountId,
      historicalClientAccountId: input.clientAccountId,
      requestId: input.requestId,
      action: "test_worksheet_approve",
      actorLabel: input.actorLabel ?? null,
      destinations: ["google_sheets"],
      metadataJson: {
        spreadsheetId: header.spreadsheetId,
        worksheetId: header.worksheetId,
        schemaVersion: COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V3,
      },
    },
  });
  return { ok: true, worksheetId: header.worksheetId, schemaVersion: COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V3 };
}

export async function recordActivationIntent(
  input: {
    clientAccountId: string;
    requestId: string;
    destination: "google_sheets_campaign" | "ghl_location_api";
    confirmation: string;
    expectedReceiptIds: string[];
    actorLabel?: string | null;
  },
  db: PrismaClient = prisma
): Promise<
  | { ok: true; status: "ready_for_operator" | "blocked"; activatesDelivery: false; id: string }
  | OnboardingConfigFailure
> {
  if (input.confirmation !== CONFIRMATION) return { ok: false, statusCode: 400, error: "invalid_confirmation" };
  const client = await db.clientAccount.findUnique({
    where: { clientAccountId: input.clientAccountId },
    include: { ghlDestination: true, companySheetsDestination: true, onboardingDestinationProfile: true },
  });
  if (!client) return { ok: false, statusCode: 404, error: "client_not_found" };
  const before = switchSnapshot(client.ghlDestination, client.companySheetsDestination);
  const summary = await readClientOnboardingSummary(input.clientAccountId, db);
  if (!summary.ok) return { ok: false, statusCode: summary.statusCode, error: summary.code };
  const ready =
    input.destination === "google_sheets_campaign"
      ? await sheetsIntentReady(input.clientAccountId, db)
      : await ghlIntentReady(input.clientAccountId, client, db);
  const status = ready ? "ready_for_operator" : "blocked";
  const intent = await db.clientOnboardingActivationIntent.create({
    data: {
      clientAccountId: input.clientAccountId,
      destination: input.destination,
      status,
      requestId: input.requestId,
      expectedReceiptIds: input.expectedReceiptIds,
      readinessEvidenceJson: {
        ready,
        liveActivationPerformedByOnboarding: false,
        blockers: summary.blockers,
      },
      confirmationPhrase: CONFIRMATION,
      actorLabel: input.actorLabel ?? null,
      activatesDelivery: false,
      deliverySwitchChanged: false,
      cutoffChanged: false,
    },
  });
  const afterClient = await db.clientAccount.findUniqueOrThrow({
    where: { clientAccountId: input.clientAccountId },
    include: { ghlDestination: true, companySheetsDestination: true },
  });
  const after = switchSnapshot(afterClient.ghlDestination, afterClient.companySheetsDestination);
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    return { ok: false, statusCode: 409, error: "worksheet_blocked", detail: "activation intent changed a delivery switch" };
  }
  return { ok: true, status, activatesDelivery: false, id: intent.id };
}

async function sheetsIntentReady(clientAccountId: string, db: PrismaClient): Promise<boolean> {
  const destination = await db.companySheetsDestination.findUnique({
    where: { clientAccountId },
    include: { tabContracts: true },
  });
  if (!destination) return false;
  const campaign = destination.tabContracts.find((contract) => contract.role === "campaign");
  const rawHeader = campaign?.headerContract;
  const header = Array.isArray(rawHeader) && rawHeader.every((cell) => typeof cell === "string") ? rawHeader : null;
  const published =
    campaign?.worksheetId == null
      ? null
      : await findPublishedColumnMap(db, {
          clientAccountId,
          spreadsheetId: destination.spreadsheetId,
          worksheetId: campaign.worksheetId,
          sourceFunnelId: null,
        });
  const snapshot = published?.headerSnapshot;
  const publishedHeader =
    Array.isArray(snapshot) && snapshot.every((cell) => typeof cell === "string") ? snapshot : null;
  const assessment = assessBoundCampaignHeader({
    schemaVersion: campaign?.schemaVersion ?? null,
    setupState: campaign?.setupState ?? null,
    header,
    spreadsheetId: destination.spreadsheetId,
    worksheetId: campaign?.worksheetId ?? null,
    publishedMap:
      published && publishedHeader
        ? {
            spreadsheetId: published.spreadsheetId,
            worksheetId: published.worksheetId,
            headerSnapshot: publishedHeader,
          }
        : null,
  });
  const synthetic = await db.companySheetsDeliveryJob.findFirst({
    where: {
      clientAccountId,
      kind: { in: ["campaign_test"] },
      status: "succeeded",
      worksheetId: campaign?.worksheetId ?? -1,
    },
    select: { id: true },
  });
  const captured = await db.clientOnboardingTestAttempt.findFirst({
    where: {
      destination: "google_sheets",
      status: "succeeded",
      ownerClientAccountId: clientAccountId,
      productionCampaignBind: false,
    },
    select: { id: true },
  });
  const uncertain = await db.companySheetsDeliveryJob.count({
    where: { clientAccountId, status: "uncertain" },
  });
  return sheetsFirstActivationReady({
    preset: assessment.preset,
    headerReady: assessment.headerReady,
    customWriterEnabled: isCustomSheetsWriterEnabled(process.env),
    writeReadiness: destination.writeReadiness,
    controlledTestSucceeded: Boolean(synthetic || captured),
    uncertainJobs: uncertain,
    controlSelectable: SELECTABLE_CONTROL.has(destination.controlBasis),
  });
}

async function ghlIntentReady(
  clientAccountId: string,
  client: {
    onboardingDestinationProfile: { ghlMode: string; notesEnabled: boolean; notesContractVersion: string | null } | null;
    ghlDestination: { destinationSubaccountIdGhl: string; destinationWorkflowIdGhl: string | null; workflowTriggerMode: string } | null;
  },
  db: PrismaClient
): Promise<boolean> {
  const profile = client.onboardingDestinationProfile;
  const destination = client.ghlDestination;
  if (!profile || profile.ghlMode !== "location_api") return false;
  if (!destination?.destinationSubaccountIdGhl?.trim()) return false;
  if (destination.workflowTriggerMode !== "direct_api" || !destination.destinationWorkflowIdGhl?.trim()) return false;
  if (!profile.notesEnabled || profile.notesContractVersion !== "sa360_lead_note_v2") return false;
  const preview = await db.clientOnboardingTestRun.findFirst({
    where: {
      clientAccountId,
      kind: { in: ["preview", "captured_event_replay"] },
      status: "previewed",
      noteBodySha256: { not: null },
    },
    select: { id: true },
  });
  return Boolean(preview);
}

function switchSnapshot(
  ghl: { deliveryEnabled: boolean; clientCutoverApproved: boolean; workflowTriggerMode: string } | null,
  sheets: { campaignDispatchEnabled: boolean; agedDispatchEnabled: boolean; campaignDispatchNotBefore: Date | null } | null
) {
  return {
    deliveryEnabled: ghl?.deliveryEnabled ?? false,
    clientCutoverApproved: ghl?.clientCutoverApproved ?? false,
    workflowTriggerMode: ghl?.workflowTriggerMode ?? null,
    campaignDispatchEnabled: sheets?.campaignDispatchEnabled ?? false,
    agedDispatchEnabled: sheets?.agedDispatchEnabled ?? false,
    campaignDispatchNotBefore: sheets?.campaignDispatchNotBefore?.toISOString() ?? null,
  };
}

function exactV3(header: readonly string[]): boolean {
  return header.length === V3_HEADER.length && V3_HEADER.every((cell, index) => header[index] === cell);
}

function isCanaryHeader(header: readonly string[]): boolean {
  return (
    header.length === COMPANY_SHEETS_CANARY_HEADER.length &&
    COMPANY_SHEETS_CANARY_HEADER.every((cell, index) => header[index] === cell)
  );
}

function isStatsTitle(title: string): boolean {
  const trimmed = title.trim().toLowerCase();
  return trimmed === "daily stats" || trimmed === "weekly stats";
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
