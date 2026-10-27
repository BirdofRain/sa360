import { createHash, randomUUID } from "node:crypto";

import type { CompanySheetsDeliveryJob, CompanySheetsDestination, Prisma, PrismaClient } from "@prisma/client";
import { COMPANY_SHEETS_EXECUTION_LEASE_MS } from "@sa360/shared";

import { prisma } from "../../lib/db.js";
import {
  COMPANY_SHEETS_CANARY_HEADER,
  COMPANY_SHEETS_CANARY_SCHEMA_VERSION,
  COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V3,
  COMPANY_SHEETS_DELIVERY_BATCH_SIZE,
  COMPANY_SHEETS_RECONCILE_ROW_CAP,
  COMPANY_SHEETS_ACCEPT_RECONCILED_ROW_PHRASE,
  COMPANY_SHEETS_RELEASE_HOLD_PHRASE,
  companySheetsCampaignHeader,
  companySheetsDeliveryState,
  companySheetsTabUrl,
  isCompanyGoogleSheetsEnabled,
  isCompanyGoogleSheetsExecutionEnabled,
} from "../../lib/company-google-sheets-env.js";
import { findCompanyGoogleConnection } from "../../repositories/company-google-connection.repository.js";
import { companySheetsCampaignRowValues, type CampaignSheetLeadInput } from "./company-sheets-campaign-row.js";
import {
  applyOperatorAssignments,
  columnMapContentKey,
  COMPANY_SHEETS_CAMPAIGN_CUSTOM_SCHEMA,
  customAppendSegments,
  customRowValues,
  exactHeader,
  formulaColumnIndexes,
  isCustomSheetsWriterEnabled,
  publishBlocker,
  sourceFunnelIdFromLead,
  syntheticCustomCampaignLead,
  appendedRowNumber,
  columnLabel,
} from "./company-sheets-custom-row.js";
import { findPublishedColumnMap } from "../client-onboarding-v2/column-maps.js";
import { loadAuthorizedAgedDeliverySet } from "./company-sheets-aged-authority.js";
import { getSpreadsheetMetadata } from "../google-sheets/google-sheets-http-client.js";
import { getCompanyDriveFile } from "../company-google/company-google-drive-http.js";
import { getValidCompanyGoogleAccessToken } from "../company-google/company-google-access-token.service.js";
import {
  establishControl,
  type CompanySheetsDeps,
} from "../company-google/company-sheets-destination.service.js";
import {
  appendSheetValues,
  getSheetValues,
  quoteSheetTitle,
  updateSheetValues,
} from "./company-sheets-values-http.js";

function uncertainAppendReason(reason: string): boolean {
  return (
    reason === "append_outcome_unknown" ||
    reason === "network_error" ||
    reason === "server_error" ||
    reason === "malformed_response"
  );
}

/**
 * Captured onboarding proof. Not a lead, aged release, Canary, or campaign_test job.
 * The target is the approved ClientOnboardingTestWorksheet, snapshotted onto the job.
 */
export const ONBOARDING_CAPTURED_TEST_KIND = "onboarding_captured_test";
const SELECTABLE_CONTROL = new Set(["company_created", "drive_owner_verified", "approved_shared_drive"]);
const ONBOARDING_SHEETS_KEY = /^onboarding-test:[^\s:]+\:sheets$/;

type BoundContract = {
  worksheetId: number;
  worksheetTitle: string;
  schemaVersion: string;
  destinationRevision: number;
  header: string[];
};

export type CompanySheetsDeliveryDeps = CompanySheetsDeps & {
  batchSize?: number;
  maxBatches?: number;
  getValues?: typeof getSheetValues;
  appendValues?: typeof appendSheetValues;
  updateValues?: typeof updateSheetValues;
  /** Creates the durable job without the execution flag. Never calls Google. */
  scheduleWithoutExecution?: boolean;
  /**
   * Executes one synthetic campaign_test job while the global execution flag
   * stays off. Lead and aged jobs still require the execution flag.
   */
  controlledCampaignTest?: boolean;
  /**
   * Executes one onboarding_captured_test job while the global execution flag
   * stays off. It does not execute lead, aged, canary, or campaign_test jobs.
   */
  controlledOnboardingCapturedTest?: boolean;
};

export type DeliveryFailure = {
  ok: false;
  code: string;
  statusCode: number;
};

function fail(code: string, statusCode = 409): DeliveryFailure {
  return { ok: false, code, statusCode };
}

function executionOff(env: NodeJS.ProcessEnv): DeliveryFailure | null {
  if (!isCompanyGoogleSheetsExecutionEnabled(env)) return fail("execution_disabled", 404);
  return null;
}

export { campaignLeadIdentityFromPayload } from "./company-sheets-campaign-row.js";

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => (item == null ? "" : String(item)));
}

function headerOf(job: CompanySheetsDeliveryJob): string[] {
  return stringList(job.headerContract);
}

function rowValues(value: Prisma.JsonValue): string[] {
  return stringList(value);
}

function rawRow(values: string[]): string[] {
  return values.map((cell) => String(cell));
}

function sameContractHeader(actual: string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && expected.every((cell, index) => actual[index] === cell);
}

function sameHeader(actual: string[], expected: string[]): boolean {
  if (actual.length < expected.length) return false;
  return expected.every((cell, index) => (actual[index] ?? "") === cell);
}

function blankRow(row: string[] | undefined): boolean {
  return !row || row.every((cell) => cell.trim() === "");
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function isOnboardingStatsTitle(title: string): boolean {
  const trimmed = title.trim().toLowerCase();
  return trimmed === "daily stats" || trimmed === "weekly stats";
}

function columnLetters(index: number): string {
  let n = index + 1;
  let letters = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

/** Column that holds delivery_row_id on an exact v3 header. v1 jobs stay on column A. */
export function onboardingCapturedTestStableColumn(header: readonly string[]): string | null {
  const index = header.indexOf("delivery_row_id");
  if (index < 0) return null;
  return columnLetters(index);
}

function reservedProductionKey(key: string): boolean {
  return /^(?:lead|campaign|ghl-webhook|ghl-note):/.test(key);
}

function exactV3Header(header: readonly string[]): boolean {
  const expected = companySheetsCampaignHeader(COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V3);
  return Boolean(expected && sameContractHeader([...header], [...expected]));
}

function headerIndex(name: string): number {
  const expected = companySheetsCampaignHeader(COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V3) ?? [];
  return [...expected].indexOf(name);
}

export async function setCompanySheetsCanaryApproval(
  clientAccountId: string,
  approved: boolean,
  deps: CompanySheetsDeliveryDeps = {}
): Promise<{ ok: true; canaryApproved: boolean } | DeliveryFailure> {
  const env = deps.env ?? process.env;
  if (!isCompanyGoogleSheetsEnabled(env)) return fail("destination_disabled", 404);
  const db = deps.db ?? prisma;
  const destination = await db.companySheetsDestination.findUnique({
    where: { clientAccountId: clientAccountId.trim() },
  });
  if (!destination) return fail("destination_not_configured", 404);
  const updated = await db.companySheetsDestination.update({
    where: { id: destination.id },
    data: { canaryApproved: approved },
  });
  return { ok: true, canaryApproved: updated.canaryApproved };
}

async function snapshotDestination(
  clientAccountId: string,
  db: PrismaClient
): Promise<CompanySheetsDestination | DeliveryFailure> {
  const destination = await db.companySheetsDestination.findUnique({ where: { clientAccountId } });
  if (!destination) return fail("destination_not_configured", 404);
  return destination;
}

async function loadBoundContract(
  db: PrismaClient,
  destination: CompanySheetsDestination,
  role: "campaign" | "aged" | "canary"
): Promise<BoundContract | DeliveryFailure> {
  const row = await db.companySheetsTabContract.findUnique({
    where: { destinationId_role: { destinationId: destination.id, role } },
  });
  if (!row || row.setupState !== "bound" || row.worksheetId == null || !row.schemaVersion) {
    return fail(row?.setupState === "incompatible" ? "tab_incompatible" : "tab_missing", 409);
  }
  const header = stringList(row.headerContract);
  if (header.length === 0 || !row.worksheetTitle) return fail("tab_incompatible", 409);
  return {
    worksheetId: row.worksheetId,
    worksheetTitle: row.worksheetTitle,
    schemaVersion: row.schemaVersion,
    destinationRevision: destination.destinationRevision,
    header,
  };
}

async function createJob(
  db: PrismaClient,
  input: {
    kind: "lead" | "aged_release" | "canary" | "campaign_test";
    idempotencyKey: string;
    destination: CompanySheetsDestination;
    contract: BoundContract;
    rows: Array<{ stableRowId: string; values: string[] }>;
    sourceLeadEventId?: string | null;
    leadOrderId?: string | null;
    exportPackageId?: string | null;
    contentSha256?: string | null;
    schemaVersion?: string;
    header?: string[];
  }
): Promise<CompanySheetsDeliveryJob> {
  const existing = await db.companySheetsDeliveryJob.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
  });
  if (existing) return existing;
  try {
    return await db.$transaction(async (tx) => {
      const job = await tx.companySheetsDeliveryJob.create({
        data: {
          kind: input.kind,
          status: "queued",
          clientAccountId: input.destination.clientAccountId,
          companyConnectionId: input.destination.companyConnectionId,
          destinationId: input.destination.id,
          spreadsheetId: input.destination.spreadsheetId,
          spreadsheetUrl: input.destination.spreadsheetUrl,
          worksheetId: input.contract.worksheetId,
          worksheetTitle: input.contract.worksheetTitle,
          controlBasis: input.destination.controlBasis,
          destinationUpdatedAt: input.destination.updatedAt,
          headerContract: input.header ?? input.contract.header,
          schemaVersion: input.schemaVersion ?? input.contract.schemaVersion,
          destinationRevision: input.contract.destinationRevision,
          sourceLeadEventId: input.sourceLeadEventId ?? null,
          leadOrderId: input.leadOrderId ?? null,
          exportPackageId: input.exportPackageId ?? null,
          contentSha256: input.contentSha256 ?? null,
          idempotencyKey: input.idempotencyKey,
          rowsTotal: input.rows.length,
          rowsWritten: 0,
        },
      });
      await tx.companySheetsDeliveryRow.createMany({
        data: input.rows.map((row, ordinal) => ({
          jobId: job.id,
          spreadsheetId: input.destination.spreadsheetId,
          worksheetId: input.contract.worksheetId,
          stableRowId: row.stableRowId,
          ordinal,
          valuesJson: row.values,
          status: "pending",
        })),
      });
      if (input.kind === "aged_release" && input.leadOrderId && input.exportPackageId) {
        await tx.companySheetsOrderDeliveryEvidence.create({
          data: {
            leadOrderId: input.leadOrderId,
            exportPackageId: input.exportPackageId,
            clientAccountId: input.destination.clientAccountId,
            jobId: job.id,
            spreadsheetId: input.destination.spreadsheetId,
            spreadsheetUrl: input.destination.spreadsheetUrl,
            worksheetId: input.contract.worksheetId,
            worksheetTitle: input.contract.worksheetTitle,
            status: "queued",
          },
        });
      }
      return job;
    });
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "P2002") {
      const raced = await db.companySheetsDeliveryJob.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
      });
      if (raced) return raced;
    }
    throw err;
  }
}

async function resolveCampaignWrite(
  db: PrismaClient,
  env: NodeJS.ProcessEnv,
  destination: CompanySheetsDestination,
  contract: BoundContract,
  lead: CampaignSheetLeadInput & { sourceFunnelId: string | null },
  options: { controlledTest?: boolean } = {}
): Promise<
  | { ok: true; schemaVersion: string; header: string[]; values: string[]; contentSha256: string | null }
  | DeliveryFailure
> {
  if (contract.schemaVersion === COMPANY_SHEETS_CAMPAIGN_CUSTOM_SCHEMA) {
    if (!options.controlledTest && !isCustomSheetsWriterEnabled(env)) return fail("custom_writer_disabled", 409);
    const map = await findPublishedColumnMap(db, {
      clientAccountId: destination.clientAccountId,
      spreadsheetId: destination.spreadsheetId,
      worksheetId: contract.worksheetId,
      sourceFunnelId: lead.sourceFunnelId,
    });
    if (!map) return fail("mapping_required", 409);
    const snapshot = stringList(map.headerSnapshot);
    if (!exactHeader(snapshot, contract.header)) return fail("header_changed", 409);
    const sample = Array.isArray(map.assignments)
      ? map.assignments.map((item) => {
          const record = item && typeof item === "object" && !Array.isArray(item) ? (item as { formula?: unknown }) : null;
          return record?.formula === true ? "=" : "";
        })
      : [];
    const applied = applyOperatorAssignments(snapshot, sample, map.assignments);
    if (!applied.ok) return fail(applied.error, applied.statusCode);
    const blocked = publishBlocker(applied.assignments);
    if (!blocked.ok) return fail(blocked.error, blocked.statusCode);
    const values = customRowValues(applied.assignments, lead);
    if (!values || values.length !== snapshot.length) return fail("mapping_required", 409);
    return {
      ok: true,
      schemaVersion: COMPANY_SHEETS_CAMPAIGN_CUSTOM_SCHEMA,
      header: snapshot,
      values,
      contentSha256: columnMapContentKey(map.id, map.mapVersion),
    };
  }
  const expectedHeader = companySheetsCampaignHeader(contract.schemaVersion);
  if (!expectedHeader || !sameContractHeader(contract.header, expectedHeader)) return fail("schema_mismatch", 409);
  const values = companySheetsCampaignRowValues({ ...lead, schemaVersion: contract.schemaVersion });
  if (!values) return fail("schema_mismatch", 409);
  return { ok: true, schemaVersion: contract.schemaVersion, header: [...contract.header], values, contentSha256: null };
}

export async function enqueueConfirmedLeadSheetsDelivery(
  sourceLeadEventId: string,
  deps: CompanySheetsDeliveryDeps = {}
): Promise<{ ok: true; job: CompanySheetsDeliveryJob; created: boolean } | DeliveryFailure> {
  const env = deps.env ?? process.env;
  const disabled = deps.scheduleWithoutExecution ? null : executionOff(env);
  if (disabled) return disabled;
  const db = deps.db ?? prisma;
  const id = sourceLeadEventId.trim();
  const lead = await db.sourceLeadEvent.findUnique({ where: { id } });
  if (!lead) return fail("lead_not_found", 404);
  const clientAccountId = lead.clientAccountIdResolved?.trim() ?? "";
  if (!clientAccountId) return fail("client_not_confirmed", 409);
  const destination = await snapshotDestination(clientAccountId, db);
  if (!("spreadsheetId" in destination)) return destination;
  const contract = await loadBoundContract(db, destination, "campaign");
  if (!("worksheetId" in contract)) return contract;
  const stableRowId = `lead:${clientAccountId}:${lead.id}`;
  const resolved = await resolveCampaignWrite(db, env, destination, contract, {
    stableRowId,
    clientAccountId,
    sourceLeadEventId: lead.id,
    receivedAt: lead.receivedAt.toISOString(),
    sourceLeadId: lead.sourceLeadId,
    normalizedPayload: lead.normalizedPayloadJson,
    sourceFunnelId: sourceFunnelIdFromLead(lead),
  });
  if (!resolved.ok) return resolved;
  const idempotencyKey = `lead:${clientAccountId}:${lead.id}`;
  const before = await db.companySheetsDeliveryJob.findUnique({ where: { idempotencyKey } });
  const job = await createJob(db, {
    kind: "lead",
    idempotencyKey,
    destination,
    contract,
    rows: [{ stableRowId, values: resolved.values }],
    sourceLeadEventId: lead.id,
    contentSha256: resolved.contentSha256,
    schemaVersion: resolved.schemaVersion,
    header: resolved.header,
  });
  const unchanged = await db.sourceLeadEvent.findUnique({ where: { id: lead.id } });
  if (
    unchanged?.status !== lead.status ||
    JSON.stringify(unchanged?.deliveryResultJson ?? null) !== JSON.stringify(lead.deliveryResultJson ?? null)
  ) {
    return fail("lead_mutated", 500);
  }
  return { ok: true, job, created: !before };
}

export async function enqueueAuthorizedAgedReleaseSheetsDelivery(
  exportPackageId: string,
  deps: CompanySheetsDeliveryDeps = {}
): Promise<{ ok: true; job: CompanySheetsDeliveryJob; created: boolean } | DeliveryFailure> {
  const env = deps.env ?? process.env;
  const disabled = deps.scheduleWithoutExecution ? null : executionOff(env);
  if (disabled) return disabled;
  const db = deps.db ?? prisma;
  const loaded = await loadAuthorizedAgedDeliverySet(db, exportPackageId);
  if (!loaded.ok) return fail(loaded.code, loaded.code === "export_not_found" ? 404 : 409);
  const contentSha256 = loaded.packageRow.contentSha256;
  const rowCount = loaded.packageRow.rowCount;
  const destination = await snapshotDestination(loaded.packageRow.clientAccountId, db);
  if (!("spreadsheetId" in destination)) return destination;
  const contract = await loadBoundContract(db, destination, "aged");
  if (!("worksheetId" in contract)) return contract;
  if (contract.schemaVersion !== loaded.schemaVersion || !sameContractHeader(contract.header, loaded.header)) {
    return fail("schema_mismatch", 409);
  }
  const idempotencyKey = `release:${loaded.packageRow.clientAccountId}:${loaded.order.id}:${loaded.packageRow.id}`;
  const before = await db.companySheetsDeliveryJob.findUnique({ where: { idempotencyKey } });
  const job = await createJob(db, {
    kind: "aged_release",
    idempotencyKey,
    destination,
    contract,
    rows: loaded.rows,
    leadOrderId: loaded.order.id,
    exportPackageId: loaded.packageRow.id,
    contentSha256: loaded.packageRow.contentSha256,
  });
  const after = await db.leadDeliveryExportPackage.findUnique({ where: { id: loaded.packageRow.id } });
  if (after?.contentSha256 !== contentSha256 || after?.rowCount !== rowCount) {
    return fail("release_mutated", 500);
  }
  return { ok: true, job, created: !before };
}

export async function enqueueCompanySheetsCanary(
  input: { clientAccountId: string; idempotencyKey: string; rowCount?: number },
  deps: CompanySheetsDeliveryDeps = {}
): Promise<{ ok: true; job: CompanySheetsDeliveryJob; created: boolean } | DeliveryFailure> {
  const env = deps.env ?? process.env;
  const disabled = deps.scheduleWithoutExecution ? null : executionOff(env);
  if (disabled) return disabled;
  const db = deps.db ?? prisma;
  const clientAccountId = input.clientAccountId.trim();
  const idem = input.idempotencyKey.trim();
  if (!idem || idem.length > 80) return fail("invalid_idempotency_key", 400);
  const destination = await snapshotDestination(clientAccountId, db);
  if (!("spreadsheetId" in destination)) return destination;
  if (!destination.canaryApproved) return fail("canary_not_approved", 409);
  const contract = await loadBoundContract(db, destination, "canary");
  if (!("worksheetId" in contract)) return contract;
  if (
    contract.schemaVersion !== COMPANY_SHEETS_CANARY_SCHEMA_VERSION ||
    !sameContractHeader(contract.header, COMPANY_SHEETS_CANARY_HEADER)
  ) {
    return fail("schema_mismatch", 409);
  }
  const count = input.rowCount == null ? 2 : input.rowCount;
  if (!Number.isInteger(count) || count < 1 || count > 5) return fail("invalid_canary_size", 400);
  const rows = Array.from({ length: count }, (_, index) => {
    const stableRowId = `canary:${clientAccountId}:${idem}:${index + 1}`;
    return {
      stableRowId,
      values: [stableRowId, "=1+1", "+SUM(A1)", "synthetic canary"],
    };
  });
  const idempotencyKey = `canary:${clientAccountId}:${idem}`;
  const before = await db.companySheetsDeliveryJob.findUnique({ where: { idempotencyKey } });
  const job = await createJob(db, {
    kind: "canary",
    idempotencyKey,
    destination,
    contract,
    rows,
  });
  return { ok: true, job, created: !before };
}

const SYNTHETIC_TEST_SUBMITTED_AT = "2026-10-26T14:00:00.000Z";
const SYNTHETIC_TEST_RECEIVED_AT = "2026-10-26T15:00:00.000Z";

/**
 * One explicit synthetic row through the bound campaign writer.
 * Does not create a source lead, dispatch intent, inventory row, or billing row.
 * Does not change delivery switches. An uncertain append is not retried.
 */
export async function sendCompanySheetsCampaignTestRow(
  clientAccountId: string,
  deps: CompanySheetsDeliveryDeps = {}
): Promise<
  | {
      ok: true;
      testRow: true;
      inventoryAffected: false;
      billingAffected: false;
      deliveryEnabled: false;
      automaticRetry: false;
      spreadsheetId: string;
      spreadsheetTitle: string | null;
      worksheetId: number;
      worksheetTitle: string;
      schemaVersion: string;
      jobId: string;
      status: string;
      appended: boolean;
      rowWritten: boolean;
    }
  | DeliveryFailure
> {
  const env = deps.env ?? process.env;
  if (!isCompanyGoogleSheetsEnabled(env)) return fail("destination_disabled", 404);
  const db = deps.db ?? prisma;
  const id = clientAccountId.trim();
  const destination = await snapshotDestination(id, db);
  if (!("spreadsheetId" in destination)) return destination;
  const beforeSwitches = {
    campaignDispatchEnabled: destination.campaignDispatchEnabled,
    agedDispatchEnabled: destination.agedDispatchEnabled,
    enabled: destination.enabled,
  };
  const contract = await loadBoundContract(db, destination, "campaign");
  if (!("worksheetId" in contract)) return contract;
  if (contract.schemaVersion === COMPANY_SHEETS_CAMPAIGN_CUSTOM_SCHEMA && destination.campaignDispatchEnabled) {
    return fail("delivery_not_paused", 409);
  }
  const unresolved = await db.companySheetsDeliveryJob.findFirst({
    where: {
      clientAccountId: id,
      spreadsheetId: destination.spreadsheetId,
      worksheetId: contract.worksheetId,
      kind: "campaign_test",
      OR: [{ status: { in: ["uncertain", "running", "queued", "retryable"] } }, { appendStartedAt: { not: null }, status: { not: "succeeded" } }],
    },
    orderBy: { createdAt: "desc" },
  });
  const resumable = unresolved?.status === "queued" || unresolved?.status === "retryable";
  if (unresolved && (!resumable || unresolved.appendStartedAt)) {
    return fail("campaign_test_unresolved", 409);
  }
  const idempotencyKey = resumable && unresolved
    ? unresolved.idempotencyKey
    : `campaign-test:${id}:${randomUUID()}`;
  const stableRowId = `campaign-test:${id}:${idempotencyKey}`;
  const syntheticLead: CampaignSheetLeadInput =
    contract.schemaVersion === COMPANY_SHEETS_CAMPAIGN_CUSTOM_SCHEMA
      ? syntheticCustomCampaignLead({
          stableRowId,
          clientAccountId: id,
          spreadsheetId: destination.spreadsheetId,
          worksheetTitle: contract.worksheetTitle,
        })
      : {
          stableRowId,
          clientAccountId: id,
          sourceLeadEventId: "synthetic-campaign-test",
          receivedAt: SYNTHETIC_TEST_RECEIVED_AT,
          sourceLeadId: null,
          normalizedPayload: {
            contact: {
              first_name: "SYNTHETIC",
              last_name: `TEST ${destination.spreadsheetId} ${contract.worksheetTitle}`,
              email: "synthetic@example.invalid",
              state: "NA",
            },
            phone: "SYNTHETIC",
            state: { lead_type: "SYNTHETIC" },
            routing: {
              source_intake: {
                lead_id: "synthetic-sheets-test",
                source_lead_id_generated: true,
                submitted_at: SYNTHETIC_TEST_SUBMITTED_AT,
                unmappedSourceFieldsJson: [
                  {
                    key: "notes",
                    value: `Controlled writer test for spreadsheet ${destination.spreadsheetId} tab ${contract.worksheetTitle}. Not an inventory lead.`,
                  },
                ],
              },
            },
          },
        };
  const resolved =
    resumable && unresolved
      ? null
      : await resolveCampaignWrite(db, env, destination, contract, { ...syntheticLead, sourceFunnelId: null }, { controlledTest: true });
  if (resolved && !resolved.ok) return resolved;
  const job = resumable && unresolved
    ? unresolved
    : await createJob(db, {
        kind: "campaign_test",
        idempotencyKey,
        destination,
        contract,
        rows: [{ stableRowId, values: resolved && resolved.ok ? resolved.values : [] }],
        schemaVersion: resolved && resolved.ok ? resolved.schemaVersion : contract.schemaVersion,
        header: resolved && resolved.ok ? resolved.header : contract.header,
        contentSha256: resolved && resolved.ok ? resolved.contentSha256 : null,
      });
  const executed = await executeCompanySheetsDeliveryJob(job.id, { ...deps, env, db, controlledCampaignTest: true });
  const after = await db.companySheetsDestination.findUnique({ where: { id: destination.id } });
  if (
    !after ||
    after.campaignDispatchEnabled !== beforeSwitches.campaignDispatchEnabled ||
    after.agedDispatchEnabled !== beforeSwitches.agedDispatchEnabled ||
    after.enabled !== beforeSwitches.enabled
  ) {
    return fail("delivery_switch_changed", 500);
  }
  if (!executed.ok) return executed;
  if (executed.status !== "succeeded" || executed.rowsWritten < 1) {
    return fail("test_row_not_written", 409);
  }
  return {
    ok: true,
    testRow: true,
    inventoryAffected: false,
    billingAffected: false,
    deliveryEnabled: false,
    automaticRetry: false,
    spreadsheetId: destination.spreadsheetId,
    spreadsheetTitle: destination.spreadsheetTitle,
    worksheetId: contract.worksheetId,
    worksheetTitle: contract.worksheetTitle,
    schemaVersion: contract.schemaVersion,
    jobId: job.id,
    status: executed.status,
    appended: executed.appended,
    rowWritten: true,
  };
}

type SheetsWriteDb = PrismaClient | Prisma.TransactionClient;

type LockJob = Pick<CompanySheetsDeliveryJob, "id" | "spreadsheetId" | "worksheetId">;

async function syncEvidence(db: SheetsWriteDb, jobId: string, status: string) {
  await db.companySheetsOrderDeliveryEvidence.updateMany({ where: { jobId }, data: { status } });
}

async function finishJob(
  db: PrismaClient,
  job: CompanySheetsDeliveryJob,
  claimToken: string,
  status: CompanySheetsDeliveryJob["status"],
  extra: { lastError?: string | null; uncertainReason?: string | null; rowsWritten?: number } = {}
): Promise<boolean> {
  const written =
    extra.rowsWritten ??
    (await db.companySheetsDeliveryRow.count({ where: { jobId: job.id, status: "written" } }));
  const updated = await db.companySheetsDeliveryJob.updateMany({
    where: { id: job.id, claimToken },
    data: {
      status,
      rowsWritten: written,
      lastError: extra.lastError === undefined ? undefined : extra.lastError,
      uncertainReason: extra.uncertainReason === undefined ? undefined : extra.uncertainReason,
      finishedAt: status === "running" ? null : new Date(),
      appendStartedAt: status === "uncertain" ? undefined : null,
    },
  });
  if (updated.count !== 1) return false;
  await syncEvidence(db, job.id, status);
  return true;
}

async function finishOwned(
  db: PrismaClient,
  job: CompanySheetsDeliveryJob,
  claimToken: string,
  status: CompanySheetsDeliveryJob["status"],
  extra: { lastError?: string | null; uncertainReason?: string | null; rowsWritten?: number } = {}
): Promise<DeliveryFailure | null> {
  const owned = await finishJob(db, job, claimToken, status, extra);
  return owned ? null : fail("claim_lost", 409);
}

async function holdWorksheetLock(db: SheetsWriteDb, job: LockJob, now: Date) {
  await db.companySheetsWorksheetLock.upsert({
    where: {
      spreadsheetId_worksheetId: { spreadsheetId: job.spreadsheetId, worksheetId: job.worksheetId },
    },
    create: {
      spreadsheetId: job.spreadsheetId,
      worksheetId: job.worksheetId,
      ownerJobId: job.id,
      lockedAt: now,
    },
    update: {},
  });
  await db.companySheetsWorksheetLock.updateMany({
    where: {
      spreadsheetId: job.spreadsheetId,
      worksheetId: job.worksheetId,
      OR: [{ ownerJobId: null }, { ownerJobId: job.id }],
    },
    data: { ownerJobId: job.id, lockedAt: now },
  });
}

async function releaseWorksheetLock(db: SheetsWriteDb, job: LockJob) {
  await db.companySheetsWorksheetLock.updateMany({
    where: { spreadsheetId: job.spreadsheetId, worksheetId: job.worksheetId, ownerJobId: job.id },
    data: { ownerJobId: null, lockedAt: null },
  });
}

const staleStart = (leaseCutoff: Date): Prisma.CompanySheetsDeliveryJobWhereInput => ({
  OR: [{ startedAt: null }, { startedAt: { lt: leaseCutoff } }],
});

/**
 * A stale running job with no append marker is returned to retryable and only
 * its own worksheet lock is released. A job that already started an append
 * stays uncertain, keeps the marker, and keeps the lock without taking a lock
 * owned by someone else. The two updates are mutually exclusive.
 */
export async function settleStaleCompanySheetsRun(
  db: SheetsWriteDb,
  job: LockJob,
  now: Date,
  leaseCutoff: Date
): Promise<"reclaimed" | "held" | "unchanged"> {
  const reclaimed = await db.companySheetsDeliveryJob.updateMany({
    where: {
      id: job.id,
      status: "running",
      appendStartedAt: null,
      ...staleStart(leaseCutoff),
    },
    data: {
      status: "retryable",
      claimToken: randomUUID(),
      lastError: null,
      uncertainReason: null,
      finishedAt: null,
      startedAt: null,
      appendStartedAt: null,
    },
  });
  if (reclaimed.count === 1) {
    await releaseWorksheetLock(db, job);
    await syncEvidence(db, job.id, "retryable");
    await db.companySheetsDispatchIntent.updateMany({
      where: { jobId: job.id, status: "processing" },
      data: { status: "retryable", availableAt: now, lastError: null, reason: null },
    });
    return "reclaimed";
  }
  const held = await db.companySheetsDeliveryJob.updateMany({
    where: {
      id: job.id,
      status: "running",
      appendStartedAt: { not: null },
      ...staleStart(leaseCutoff),
    },
    data: {
      status: "uncertain",
      uncertainReason: "worker_lost",
      lastError: "worker_lost",
      finishedAt: now,
      claimToken: randomUUID(),
    },
  });
  if (held.count === 1) {
    await holdWorksheetLock(db, job, now);
    await syncEvidence(db, job.id, "uncertain");
    return "held";
  }
  return "unchanged";
}

/** Release the lock only while this claim still owns a finished job. */
async function releaseFinishedClaimLock(db: PrismaClient, job: LockJob, claimToken: string) {
  await db.$transaction(async (tx) => {
    const owned = await tx.companySheetsDeliveryJob.updateMany({
      where: { id: job.id, claimToken, status: { notIn: ["running", "uncertain"] } },
      data: { claimToken },
    });
    if (owned.count !== 1) return;
    await releaseWorksheetLock(tx, job);
  });
}

/**
 * Proves this claim is still the running pre-append owner. A miss means the
 * caller must not mutate Google.
 */
async function claimStillBeforeAppend(db: PrismaClient, jobId: string, claimToken: string): Promise<boolean> {
  const marked = await db.companySheetsDeliveryJob.updateMany({
    where: { id: jobId, claimToken, status: "running", appendStartedAt: null },
    data: { claimToken },
  });
  return marked.count === 1;
}

async function lostPreAppend(
  db: PrismaClient,
  job: CompanySheetsDeliveryJob,
  claimToken: string
): Promise<DeliveryFailure> {
  const latest = await db.companySheetsDeliveryJob.findUnique({ where: { id: job.id } });
  if (latest?.claimToken === claimToken && latest.status === "running" && latest.appendStartedAt != null) {
    const lost = await finishOwned(db, job, claimToken, "uncertain", {
      lastError: "append_outcome_unknown",
      uncertainReason: "append_outcome_unknown",
    });
    if (lost) return lost;
    return fail("uncertain", 409);
  }
  return fail("claim_lost", 409);
}

export async function executeCompanySheetsDeliveryJob(
  jobId: string,
  deps: CompanySheetsDeliveryDeps = {}
): Promise<
  | { ok: true; status: string; rowsWritten: number; appended: boolean }
  | DeliveryFailure
> {
  const env = deps.env ?? process.env;
  const disabled = executionOff(env);
  const campaignBypass = deps.controlledCampaignTest === true;
  const onboardingBypass = deps.controlledOnboardingCapturedTest === true;
  if (disabled && !campaignBypass && !onboardingBypass) return disabled;
  const db = deps.db ?? prisma;
  const now = deps.now?.() ?? new Date();
  const stale = new Date(now.getTime() - COMPANY_SHEETS_EXECUTION_LEASE_MS);
  const current = await db.companySheetsDeliveryJob.findUnique({ where: { id: jobId } });
  if (!current) return fail("job_not_found", 404);
  if (current.status === "uncertain") return fail("uncertain", 409);
  if (current.status === "succeeded") return fail("already_succeeded", 409);
  if (current.status === "running") {
    const withinLease = current.startedAt != null && current.startedAt >= stale;
    if (withinLease) return fail("already_running", 409);
    // The lease ending does not prove an append finished. A null marker never
    // started Google, so that claim can be invalidated and resumed later.
    const settled = await db.$transaction((tx) => settleStaleCompanySheetsRun(tx, current, now, stale));
    if (settled === "reclaimed") return fail("claim_lost", 409);
    if (settled === "held") return fail("uncertain", 409);
    const again = await db.companySheetsDeliveryJob.findUnique({ where: { id: jobId } });
    if (!again) return fail("job_not_found", 404);
    if (again.status === "succeeded") return fail("already_succeeded", 409);
    if (again.status === "uncertain") return fail("uncertain", 409);
    if (again.status === "running") return fail("already_running", 409);
    return fail("claim_lost", 409);
  }
  const claimToken = randomUUID();
  const claimed = await db.companySheetsDeliveryJob.updateMany({
    where: {
      id: jobId,
      appendStartedAt: null,
      status: { in: ["queued", "retryable"] },
    },
    data: {
      status: "running",
      attemptCount: { increment: 1 },
      claimToken,
      startedAt: now,
      finishedAt: null,
      uncertainReason: null,
      appendStartedAt: null,
    },
  });
  if (claimed.count !== 1) {
    const again = await db.companySheetsDeliveryJob.findUnique({ where: { id: jobId } });
    if (!again) return fail("job_not_found", 404);
    return fail(again.status === "uncertain" ? "uncertain" : again.status === "succeeded" ? "already_succeeded" : "already_running", 409);
  }
  const job = await db.companySheetsDeliveryJob.findUnique({ where: { id: jobId } });
  if (!job || job.claimToken !== claimToken) return fail("already_running", 409);
  if (campaignBypass && onboardingBypass) {
    const restored = await finishOwned(db, job, claimToken, "queued", { lastError: "controlled_test_only" });
    if (restored) return restored;
    return fail("controlled_test_only", 409);
  }
  if (campaignBypass && job.kind !== "campaign_test") {
    const restored = await finishOwned(db, job, claimToken, "queued", { lastError: "controlled_test_only" });
    if (restored) return restored;
    return fail("controlled_test_only", 409);
  }
  if (onboardingBypass && job.kind !== ONBOARDING_CAPTURED_TEST_KIND) {
    const restored = await finishOwned(db, job, claimToken, "queued", { lastError: "controlled_test_only" });
    if (restored) return restored;
    return fail("controlled_test_only", 409);
  }
  if (job.kind === ONBOARDING_CAPTURED_TEST_KIND) {
    const drift = await onboardingCapturedTestDrift(db, job);
    if (drift) {
      const status = drift === "worksheet_blocked" ? "queued" : "uncertain";
      const lost = await finishOwned(db, job, claimToken, status, {
        lastError: drift,
        uncertainReason: status === "uncertain" ? drift : null,
      });
      if (lost) return lost;
      return fail(drift, drift === "tenant_mismatch" ? 403 : 409);
    }
  }
  if (job.kind === "campaign_test") {
    const currentDestination = job.destinationId
      ? await db.companySheetsDestination.findUnique({ where: { id: job.destinationId } })
      : null;
    const campaignTab = currentDestination
      ? await db.companySheetsTabContract.findUnique({
          where: { destinationId_role: { destinationId: currentDestination.id, role: "campaign" } },
        })
      : null;
    if (
      !currentDestination ||
      currentDestination.spreadsheetId !== job.spreadsheetId ||
      campaignTab?.setupState !== "bound" ||
      campaignTab.worksheetId !== job.worksheetId ||
      campaignTab.schemaVersion !== job.schemaVersion
    ) {
      const lost = await finishOwned(db, job, claimToken, "uncertain", {
        lastError: "campaign_test_destination_changed",
        uncertainReason: "campaign_test_destination_changed",
      });
      if (lost) return lost;
      return fail("campaign_test_destination_changed", 409);
    }
  }
  if (job.kind === "canary") {
    const destination = job.destinationId
      ? await db.companySheetsDestination.findUnique({ where: { id: job.destinationId } })
      : null;
    const canaryTab = destination
      ? await db.companySheetsTabContract.findUnique({
          where: { destinationId_role: { destinationId: destination.id, role: "canary" } },
        })
      : null;
    if (
      !destination?.canaryApproved ||
      destination.spreadsheetId !== job.spreadsheetId ||
      canaryTab?.setupState !== "bound" ||
      canaryTab.worksheetId !== job.worksheetId
    ) {
      const lost = await finishOwned(db, job, claimToken, "uncertain", {
        lastError: "canary_destination_changed",
        uncertainReason: "canary_destination_changed",
      });
      if (lost) return lost;
      return fail("canary_destination_changed", 409);
    }
  }

  if (
    job.schemaVersion === COMPANY_SHEETS_CAMPAIGN_CUSTOM_SCHEMA &&
    !isCustomSheetsWriterEnabled(env) &&
    deps.controlledCampaignTest !== true
  ) {
    const held = await finishOwned(db, job, claimToken, "retryable", { lastError: "custom_writer_disabled" });
    if (held) return held;
    return fail("custom_writer_disabled", 409);
  }
  const locked = await acquireWorksheetLock(db, job, now);
  if (!locked) {
    const lost = await finishOwned(db, job, claimToken, "queued", { lastError: "worksheet_busy" });
    if (lost) return lost;
    return fail("worksheet_busy", 409);
  }
  try {
    return await runJob(job, claimToken, deps, db, env);
  } catch {
    const lost = await finishOwned(db, job, claimToken, "uncertain", {
      lastError: "append_outcome_unknown",
      uncertainReason: "append_outcome_unknown",
    });
    if (lost) return lost;
    return fail("uncertain", 409);
  } finally {
    await releaseFinishedClaimLock(db, job, claimToken);
  }
}

async function worksheetAppendBlocked(db: PrismaClient, job: CompanySheetsDeliveryJob) {
  const blocker = await db.companySheetsDeliveryJob.findFirst({
    where: {
      spreadsheetId: job.spreadsheetId,
      worksheetId: job.worksheetId,
      id: { not: job.id },
      OR: [{ status: "uncertain" }, { status: "running", appendStartedAt: { not: null } }],
    },
    select: { id: true },
  });
  return Boolean(blocker);
}

async function acquireWorksheetLock(db: PrismaClient, job: CompanySheetsDeliveryJob, now: Date) {
  const stale = new Date(now.getTime() - COMPANY_SHEETS_EXECUTION_LEASE_MS);
  await db.$transaction(async (tx) => {
    const siblings = await tx.companySheetsDeliveryJob.findMany({
      where: {
        spreadsheetId: job.spreadsheetId,
        worksheetId: job.worksheetId,
        id: { not: job.id },
        status: "running",
        OR: [{ startedAt: null }, { startedAt: { lt: stale } }],
      },
      select: { id: true, spreadsheetId: true, worksheetId: true },
    });
    for (const sibling of siblings) {
      await settleStaleCompanySheetsRun(tx, sibling, now, stale);
    }
  });
  if (await worksheetAppendBlocked(db, job)) return false;
  await db.companySheetsWorksheetLock.upsert({
    where: {
      spreadsheetId_worksheetId: { spreadsheetId: job.spreadsheetId, worksheetId: job.worksheetId },
    },
    create: {
      spreadsheetId: job.spreadsheetId,
      worksheetId: job.worksheetId,
      ownerJobId: null,
      lockedAt: null,
    },
    update: {},
  });
  const lock = await db.companySheetsWorksheetLock.findUnique({
    where: {
      spreadsheetId_worksheetId: { spreadsheetId: job.spreadsheetId, worksheetId: job.worksheetId },
    },
  });
  let stealOwnerId: string | null = null;
  if (lock?.ownerJobId && lock.ownerJobId !== job.id) {
    const owner = await db.companySheetsDeliveryJob.findUnique({ where: { id: lock.ownerJobId } });
    if (owner?.status === "running") return false;
    const ownerUnresolved = owner?.status === "uncertain" || owner?.appendStartedAt != null;
    const lockFresh = lock.lockedAt != null && lock.lockedAt >= stale;
    if (ownerUnresolved || (lockFresh && owner?.status !== "succeeded")) return false;
    stealOwnerId = lock.ownerJobId;
  }
  const taken = await db.companySheetsWorksheetLock.updateMany({
    where: {
      spreadsheetId: job.spreadsheetId,
      worksheetId: job.worksheetId,
      OR: [
        { ownerJobId: null },
        { ownerJobId: job.id },
        ...(stealOwnerId ? [{ ownerJobId: stealOwnerId, lockedAt: { lt: stale } }] : []),
      ],
    },
    data: { ownerJobId: job.id, lockedAt: now },
  });
  return taken.count === 1;
}

async function runJob(
  job: CompanySheetsDeliveryJob,
  claimToken: string,
  deps: CompanySheetsDeliveryDeps,
  db: PrismaClient,
  env: NodeJS.ProcessEnv
): Promise<{ ok: true; status: string; rowsWritten: number; appended: boolean } | DeliveryFailure> {
  const token = await (deps.getAccessToken ?? getValidCompanyGoogleAccessToken)({
    env,
    db,
    fetchImpl: deps.fetchImpl,
    now: deps.now,
  });
  if (!token.ok) {
    const lost = await finishOwned(db, job, claimToken, "retryable", { lastError: token.code });
    if (lost) return lost;
    return fail(token.code, token.code === "google_not_connected" ? 409 : 503);
  }
  if (token.connectionId !== job.companyConnectionId) {
    const lost = await finishOwned(db, job, claimToken, "uncertain", {
      lastError: "company_connection_changed",
      uncertainReason: "company_connection_changed",
    });
    if (lost) return lost;
    return fail("company_connection_changed", 409);
  }
  const metadataResult = await (deps.getMetadata ?? getSpreadsheetMetadata)(
    { spreadsheetId: job.spreadsheetId, accessToken: token.accessToken },
    deps.fetchImpl
  );
  if (!metadataResult.ok) {
    const lost = await finishOwned(db, job, claimToken, "retryable", {
      lastError: metadataResult.reason,
      uncertainReason: null,
    });
    if (lost) return lost;
    return fail(metadataResult.reason, 502);
  }
  const connection = await db.companyGoogleConnection.findUnique({ where: { id: job.companyConnectionId } });
  if (!connection || connection.status !== "connected") {
    const lost = await finishOwned(db, job, claimToken, "retryable", { lastError: "google_not_connected" });
    if (lost) return lost;
    return fail("google_not_connected", 409);
  }
  const control = await establishControl(
    {
      connection,
      accessToken: token.accessToken,
      spreadsheetId: job.spreadsheetId,
      metadata: metadataResult.metadata,
    },
    { ...deps, env, db, getDriveFile: deps.getDriveFile ?? getCompanyDriveFile }
  );
  if (!control.ok) {
    const lost = await finishOwned(db, job, claimToken, "retryable", { lastError: control.code });
    if (lost) return lost;
    return fail(control.code, control.statusCode);
  }
  const worksheet = metadataResult.metadata.worksheets.find((sheet) => sheet.sheetId === job.worksheetId);
  if (!worksheet || worksheet.sheetType !== "GRID") {
    const lost = await finishOwned(db, job, claimToken, "retryable", { lastError: "worksheet_unavailable" });
    if (lost) return lost;
    return fail("worksheet_unavailable", 409);
  }
  if (job.kind === ONBOARDING_CAPTURED_TEST_KIND) {
    if (isOnboardingStatsTitle(worksheet.title)) {
      const lost = await finishOwned(db, job, claimToken, "uncertain", {
        lastError: "test_worksheet_not_approved",
        uncertainReason: "test_worksheet_not_approved",
      });
      if (lost) return lost;
      return fail("test_worksheet_not_approved", 409);
    }
    if (!SELECTABLE_CONTROL.has(control.controlBasis) || control.controlBasis !== job.controlBasis) {
      const lost = await finishOwned(db, job, claimToken, "uncertain", {
        lastError: "onboarding_test_destination_changed",
        uncertainReason: "onboarding_test_destination_changed",
      });
      if (lost) return lost;
      return fail("onboarding_test_destination_changed", 409);
    }
    const drift = await onboardingCapturedTestDrift(db, job);
    if (drift) {
      const status = drift === "worksheet_blocked" ? "queued" : "uncertain";
      const lost = await finishOwned(db, job, claimToken, status, {
        lastError: drift,
        uncertainReason: status === "uncertain" ? drift : null,
      });
      if (lost) return lost;
      return fail(drift, drift === "tenant_mismatch" ? 403 : 409);
    }
  }
  const title = quoteSheetTitle(worksheet.title);
  const header = headerOf(job);
  const headerReady = await ensureHeader(job, title, header, token.accessToken, deps, db, claimToken);
  if (!headerReady.ok) return headerReady;
  let prependHeader = headerReady.prependHeader;
  const customSheet = job.schemaVersion === COMPANY_SHEETS_CAMPAIGN_CUSTOM_SCHEMA;
  const reconciled = await reconcilePending(job, title, token.accessToken, deps, db, claimToken);
  if (!reconciled.ok) {
    if (reconciled.reason === "claim_lost") return fail("claim_lost", 409);
    const lost = await finishOwned(db, job, claimToken, "uncertain", {
      lastError: reconciled.reason,
      uncertainReason: reconciled.reason,
    });
    if (lost) return lost;
    return fail("uncertain", 409);
  }
  let appended = false;
  const batchSize = deps.batchSize ?? COMPANY_SHEETS_DELIVERY_BATCH_SIZE;
  const maxBatches = deps.maxBatches ?? 4;
  for (let batch = 0; batch < maxBatches; batch += 1) {
    const pending = await db.companySheetsDeliveryRow.findMany({
      where: { jobId: job.id, status: "pending" },
      orderBy: { ordinal: "asc" },
      take: batchSize,
    });
    if (pending.length === 0) {
      const rowsWritten = await db.companySheetsDeliveryRow.count({ where: { jobId: job.id, status: "written" } });
      const lost = await finishOwned(db, job, claimToken, "succeeded", { lastError: null, rowsWritten });
      if (lost) return lost;
      return { ok: true, status: "succeeded", rowsWritten, appended };
    }
    let values = pending.map((row) => rawRow(rowValues(row.valuesJson)));
    if (prependHeader) {
      const again = await inspectSheetHeader(job, title, header, token.accessToken, deps);
      if (!again.ok) return finishHeaderInspection(db, job, claimToken, again.reason);
      if (again.action === "prepend") values = [rawRow(header), ...values];
      prependHeader = false;
    }
    const marked = await db.companySheetsDeliveryJob.updateMany({
      where: { id: job.id, claimToken, status: "running", appendStartedAt: null },
      data: { appendStartedAt: new Date() },
    });
    if (marked.count !== 1) return lostPreAppend(db, job, claimToken);
    const wrote = customSheet
      ? await appendMappedRows(job, title, header, headerReady.sampleRow, values, token.accessToken, deps)
      : await (deps.appendValues ?? appendSheetValues)(
          { spreadsheetId: job.spreadsheetId, range: `${title}!A1`, values, accessToken: token.accessToken },
          deps.fetchImpl
        );
    if (!wrote.ok) {
      if (wrote.reason === "partial_row_confirmed" && wrote.rowNumber != null) {
        const lost = await finishOwned(db, job, claimToken, "uncertain", {
          lastError: `partial_row_confirmed:${wrote.rowNumber}`,
          uncertainReason: "partial_row_confirmed",
        });
        if (lost) return lost;
        return fail("partial_row_confirmed", 409);
      }
      if (customSheet && wrote.reason === "append_outcome_unknown") {
        const confirmed = wrote.confirmedRows.length > 0 ? ` confirmed:${wrote.confirmedRows.join(",")}` : "";
        const lost = await finishOwned(db, job, claimToken, "uncertain", {
          lastError: `append_outcome_unknown${confirmed}`,
          uncertainReason: "append_outcome_unknown",
        });
        if (lost) return lost;
        return fail("uncertain", 409);
      }
      if (uncertainAppendReason(wrote.reason)) {
        const again = await reconcilePending(job, title, token.accessToken, deps, db, claimToken);
        if (!again.ok) {
          if (again.reason === "claim_lost") return fail("claim_lost", 409);
          const lost = await finishOwned(db, job, claimToken, "uncertain", {
            lastError: wrote.reason,
            uncertainReason: "reconcile_incomplete",
          });
          if (lost) return lost;
          return fail("uncertain", 409);
        }
        const stillPending = await db.companySheetsDeliveryRow.count({
          where: { id: { in: pending.map((row) => row.id) }, status: "pending" },
        });
        if (stillPending > 0) {
          const lost = await finishOwned(db, job, claimToken, "uncertain", {
            lastError: wrote.reason,
            uncertainReason: "append_outcome_unknown",
          });
          if (lost) return lost;
          return fail("uncertain", 409);
        }
        const cleared = await db.companySheetsDeliveryJob.updateMany({
          where: { id: job.id, claimToken, status: "running" },
          data: { appendStartedAt: null },
        });
        if (cleared.count !== 1) return fail("claim_lost", 409);
        continue;
      }
      const rowsWritten = await db.companySheetsDeliveryRow.count({ where: { jobId: job.id, status: "written" } });
      const remaining = await db.companySheetsDeliveryRow.count({ where: { jobId: job.id, status: "pending" } });
      const status = remaining === 0 ? "succeeded" : "retryable";
      const lost = await finishOwned(db, job, claimToken, status, {
        lastError: status === "succeeded" ? null : wrote.reason,
        rowsWritten,
      });
      if (lost) return lost;
      return { ok: true, status, rowsWritten, appended };
    }
    const wroteRows = await markRowsWrittenIfClaimed(db, job.id, claimToken, pending.map((row) => row.id));
    if (!wroteRows) {
      const lost = await finishOwned(db, job, claimToken, "uncertain", {
        lastError: "append_outcome_unknown",
        uncertainReason: "append_outcome_unknown",
      });
      if (lost) return lost;
      return fail("uncertain", 409);
    }
    const progressed = await db.companySheetsDeliveryRow.count({
      where: { jobId: job.id, status: "written" },
    });
    const advanced = await db.companySheetsDeliveryJob.updateMany({
      where: { id: job.id, claimToken, status: "running" },
      data: { rowsWritten: progressed, appendStartedAt: null },
    });
    if (advanced.count !== 1) return fail("claim_lost", 409);
    appended = true;
  }
  const rowsWritten = await db.companySheetsDeliveryRow.count({ where: { jobId: job.id, status: "written" } });
  const remaining = await db.companySheetsDeliveryRow.count({ where: { jobId: job.id, status: "pending" } });
  const status = remaining === 0 ? "succeeded" : "retryable";
  const lost = await finishOwned(db, job, claimToken, status, {
    lastError: remaining === 0 ? null : "batch_limit",
    rowsWritten,
  });
  if (lost) return lost;
  return { ok: true, status, rowsWritten, appended };
}

type HeaderInspection = { ok: true; action: "prepend" | "present"; sampleRow: string[] } | { ok: false; reason: string };

/**
 * Reads the snapshotted tab and does not write. A blank grid asks the append
 * to insert the header. Anything else is left untouched.
 */
async function inspectSheetHeader(
  job: CompanySheetsDeliveryJob,
  title: string,
  header: string[],
  accessToken: string,
  deps: CompanySheetsDeliveryDeps
): Promise<HeaderInspection> {
  const read = await (deps.getValues ?? getSheetValues)(
    { spreadsheetId: job.spreadsheetId, range: `${title}!A1:ZZ2`, accessToken },
    deps.fetchImpl
  );
  if (!read.ok) return { ok: false, reason: read.reason };
  const first = read.values[0];
  const second = read.values[1];
  if (job.schemaVersion === COMPANY_SHEETS_CAMPAIGN_CUSTOM_SCHEMA) {
    if (!exactHeader(first ?? [], header)) return { ok: false, reason: "header_changed" };
    return { ok: true, action: "present", sampleRow: second ?? [] };
  }
  if (job.kind === ONBOARDING_CAPTURED_TEST_KIND) {
    if (!sameContractHeader(first ?? [], header) || header.length !== 35) {
      return { ok: false, reason: "header_mismatch" };
    }
    return { ok: true, action: "present", sampleRow: second ?? [] };
  }
  if (blankRow(first) && blankRow(second)) {
    const cap = COMPANY_SHEETS_RECONCILE_ROW_CAP + 1;
    const probe = await (deps.getValues ?? getSheetValues)(
      { spreadsheetId: job.spreadsheetId, range: `${title}!A1:A${cap}`, accessToken },
      deps.fetchImpl
    );
    if (!probe.ok) return { ok: false, reason: probe.reason };
    const occupied = probe.values.some((row) => (row[0] ?? "").trim() !== "");
    if (occupied) return { ok: false, reason: "header_conflict" };
    if (probe.values.length >= cap) return { ok: false, reason: "reconcile_incomplete" };
    return { ok: true, action: "prepend", sampleRow: [] };
  }
  if (blankRow(first) && !blankRow(second)) return { ok: false, reason: "header_conflict" };
  if (!sameHeader(first ?? [], header)) return { ok: false, reason: "header_mismatch" };
  return { ok: true, action: "present", sampleRow: second ?? [] };
}

function headerInspectionStatus(reason: string): "uncertain" | "retryable" {
  if (reason === "header_conflict" || reason === "header_mismatch" || reason === "reconcile_incomplete") {
    return "uncertain";
  }
  return "retryable";
}

async function finishHeaderInspection(
  db: PrismaClient,
  job: CompanySheetsDeliveryJob,
  claimToken: string,
  reason: string
): Promise<DeliveryFailure> {
  const status = headerInspectionStatus(reason);
  const lost = await finishOwned(db, job, claimToken, status, {
    lastError: reason,
    uncertainReason: status === "uncertain" ? reason : null,
  });
  if (lost) return lost;
  return fail(status === "uncertain" ? "uncertain" : reason, 409);
}

async function ensureHeader(
  job: CompanySheetsDeliveryJob,
  title: string,
  header: string[],
  accessToken: string,
  deps: CompanySheetsDeliveryDeps,
  db: PrismaClient,
  claimToken: string
): Promise<{ ok: true; prependHeader: boolean; sampleRow: string[] } | DeliveryFailure> {
  const inspected = await inspectSheetHeader(job, title, header, accessToken, deps);
  if (!inspected.ok) return finishHeaderInspection(db, job, claimToken, inspected.reason);
  if (!(await claimStillBeforeAppend(db, job.id, claimToken))) return lostPreAppend(db, job, claimToken);
  return { ok: true, prependHeader: inspected.action === "prepend", sampleRow: inspected.sampleRow };
}

type MappedAppendResult =
  | { ok: true }
  | { ok: false; reason: "partial_row_confirmed"; rowNumber: number; confirmedRows: number[] }
  | { ok: false; reason: "append_outcome_unknown"; confirmedRows: number[] }
  | { ok: false; reason: string; confirmedRows: number[]; rowNumber?: undefined };

async function appendMappedRows(
  job: CompanySheetsDeliveryJob,
  title: string,
  header: string[],
  sampleRow: string[],
  rows: string[][],
  accessToken: string,
  deps: CompanySheetsDeliveryDeps
): Promise<MappedAppendResult> {
  const formulas = formulaColumnIndexes(header, sampleRow);
  const confirmedRows: number[] = [];
  for (const row of rows) {
    const segments = customAppendSegments(row, formulas);
    if (segments.length === 0) {
      return confirmedRows.length > 0
        ? { ok: false, reason: "append_outcome_unknown", confirmedRows }
        : { ok: false, reason: "mapping_required", confirmedRows };
    }
    let appendedRow: number | null = null;
    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index];
      if (!segment) continue;
      const label = columnLabel(segment.startIndex);
      if (index === 0) {
        const wrote = await (deps.appendValues ?? appendSheetValues)(
          {
            spreadsheetId: job.spreadsheetId,
            range: `${title}!${label}1`,
            values: [segment.values],
            accessToken,
          },
          deps.fetchImpl
        );
        if (!wrote.ok) {
          // A 400 or timeout on a later row must not be retried: an earlier
          // row in this batch is already on the sheet.
          return confirmedRows.length > 0
            ? { ok: false, reason: "append_outcome_unknown", confirmedRows }
            : { ok: false, reason: wrote.reason, confirmedRows };
        }
        appendedRow = appendedRowNumber(wrote.updatedRange);
        if (segments.length > 1 && (appendedRow == null || appendedRow < 2)) {
          return { ok: false, reason: "append_outcome_unknown", confirmedRows };
        }
        continue;
      }
      if (appendedRow == null || appendedRow < 2) return { ok: false, reason: "append_outcome_unknown", confirmedRows };
      const wrote = await (deps.updateValues ?? updateSheetValues)(
        {
          spreadsheetId: job.spreadsheetId,
          range: `${title}!${label}${appendedRow}`,
          values: [segment.values],
          accessToken,
        },
        deps.fetchImpl
      );
      // The append returned this row number. A later update timeout or 400
      // leaves that row in place. It is not an unknown insert.
      if (!wrote.ok) return { ok: false, reason: "partial_row_confirmed", rowNumber: appendedRow, confirmedRows };
    }
    if (appendedRow != null && appendedRow >= 2) confirmedRows.push(appendedRow);
  }
  return { ok: true };
}

function stableIdCounts(values: string[][]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of values) {
    const id = (row[0] ?? "").trim();
    if (!id) continue;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

async function markRowsWrittenIfClaimed(
  db: PrismaClient,
  jobId: string,
  claimToken: string,
  rowIds: string[]
): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const owner = await tx.companySheetsDeliveryJob.findFirst({
      where: { id: jobId, claimToken, status: "running" },
      select: { id: true },
    });
    if (!owner) return false;
    const updated = await tx.companySheetsDeliveryRow.updateMany({
      where: { id: { in: rowIds }, status: "pending" },
      data: { status: "written" },
    });
    return updated.count === rowIds.length;
  });
}

async function reconcilePending(
  job: CompanySheetsDeliveryJob,
  title: string,
  accessToken: string,
  deps: CompanySheetsDeliveryDeps,
  db: PrismaClient,
  claimToken: string
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const cap = COMPANY_SHEETS_RECONCILE_ROW_CAP + 1;
  const column =
    job.kind === ONBOARDING_CAPTURED_TEST_KIND ? onboardingCapturedTestStableColumn(headerOf(job)) : "A";
  if (!column) return { ok: false, reason: "header_mismatch" };
  const read = await (deps.getValues ?? getSheetValues)(
    { spreadsheetId: job.spreadsheetId, range: `${title}!${column}1:${column}${cap}`, accessToken },
    deps.fetchImpl
  );
  if (!read.ok) return { ok: false, reason: read.reason };
  const counts = stableIdCounts(read.values);
  const pending = await db.companySheetsDeliveryRow.findMany({
    where: { jobId: job.id, status: "pending" },
    select: { id: true, stableRowId: true },
  });
  const hasDuplicate = pending.some((row) => (counts.get(row.stableRowId) ?? 0) > 1);
  const found = hasDuplicate ? [] : pending.filter((row) => counts.get(row.stableRowId) === 1);
  const adopted = await db.$transaction(async (tx) => {
    const owner = await tx.companySheetsDeliveryJob.findFirst({
      where: { id: job.id, claimToken, status: "running" },
      select: { id: true },
    });
    if (!owner) return false;
    if (found.length > 0) {
      await tx.companySheetsDeliveryRow.updateMany({
        where: { id: { in: found.map((row) => row.id) }, status: "pending" },
        data: { status: "written" },
      });
    }
    return true;
  });
  if (!adopted) return { ok: false, reason: "claim_lost" };
  if (hasDuplicate) return { ok: false, reason: "duplicate_row_id" };
  const missing = pending.length - found.length;
  if (read.values.length >= cap && missing > 0) return { ok: false, reason: "reconcile_incomplete" };
  return { ok: true };
}

async function readWorksheetIdCounts(
  job: CompanySheetsDeliveryJob,
  deps: CompanySheetsDeliveryDeps,
  db: PrismaClient,
  env: NodeJS.ProcessEnv
): Promise<{ ok: true; counts: Map<string, number>; truncated: boolean } | { ok: false; reason: string }> {
  const token = await (deps.getAccessToken ?? getValidCompanyGoogleAccessToken)({
    env,
    db,
    fetchImpl: deps.fetchImpl,
    now: deps.now,
  });
  if (!token.ok) return { ok: false, reason: token.code };
  const metadataResult = await (deps.getMetadata ?? getSpreadsheetMetadata)(
    { spreadsheetId: job.spreadsheetId, accessToken: token.accessToken },
    deps.fetchImpl
  );
  if (!metadataResult.ok) return { ok: false, reason: metadataResult.reason };
  const worksheet = metadataResult.metadata.worksheets.find((sheet) => sheet.sheetId === job.worksheetId);
  if (!worksheet || worksheet.sheetType !== "GRID") return { ok: false, reason: "worksheet_unavailable" };
  const cap = COMPANY_SHEETS_RECONCILE_ROW_CAP + 1;
  const read = await (deps.getValues ?? getSheetValues)(
    {
      spreadsheetId: job.spreadsheetId,
      range: `${quoteSheetTitle(worksheet.title)}!A1:A${cap}`,
      accessToken: token.accessToken,
    },
    deps.fetchImpl
  );
  if (!read.ok) return { ok: false, reason: read.reason };
  return { ok: true, counts: stableIdCounts(read.values), truncated: read.values.length >= cap };
}

/**
 * The confirmation phrase records operator intent. It does not prove an earlier
 * append stopped. Another append is permitted only on a later execute, and only
 * when this call observed a complete column and appendStartedAt is null.
 * A missing row while appendStartedAt is set stays uncertain.
 */
function storedPartialRow(lastError: string | null): number | null {
  const match = /^partial_row_confirmed:(\d+)$/.exec(lastError ?? "");
  if (!match?.[1]) return null;
  const row = Number(match[1]);
  return row >= 2 ? row : null;
}

function customCellsMatch(
  actual: string[],
  expected: string[],
  formulas: readonly number[],
  mode: "partial" | "complete"
): boolean {
  const segments = customAppendSegments(expected, formulas);
  if (segments.length === 0) return false;
  const required = mode === "partial" ? segments.slice(0, 1) : segments;
  for (const segment of required) {
    for (let offset = 0; offset < segment.values.length; offset += 1) {
      if ((actual[segment.startIndex + offset] ?? "") !== (segment.values[offset] ?? "")) return false;
    }
  }
  if (mode === "partial") {
    for (const segment of segments.slice(1)) {
      for (let offset = 0; offset < segment.values.length; offset += 1) {
        const cell = actual[segment.startIndex + offset] ?? "";
        const wanted = segment.values[offset] ?? "";
        if (cell !== "" && cell !== wanted) return false;
      }
    }
  }
  return true;
}

/**
 * Confirms one already-inserted custom row and closes the hold. The phrase
 * does not append, and a mismatch leaves the lock in place.
 */
async function acceptReconciledCustomRow(
  job: CompanySheetsDeliveryJob,
  observedRowNumber: number | null,
  deps: CompanySheetsDeliveryDeps,
  db: PrismaClient,
  env: NodeJS.ProcessEnv
): Promise<{ ok: true; status: "succeeded"; appended: false } | DeliveryFailure> {
  const pending = await db.companySheetsDeliveryRow.findMany({
    where: { jobId: job.id, status: "pending" },
    orderBy: { ordinal: "asc" },
  });
  if (pending.length !== 1) return fail("partial_row_hold", 409);
  const expected = rowValues(pending[0]?.valuesJson ?? []);
  const storedRow = storedPartialRow(job.lastError);
  const rowNumber = job.uncertainReason === "partial_row_confirmed" ? storedRow : observedRowNumber;
  if (rowNumber == null || rowNumber < 2) return fail("partial_row_hold", 409);
  if (job.uncertainReason === "partial_row_confirmed" && observedRowNumber != null && observedRowNumber !== storedRow) {
    return fail("reconciled_row_mismatch", 409);
  }
  if (job.uncertainReason === "append_outcome_unknown" && observedRowNumber == null) return fail("partial_row_hold", 409);
  const token = await (deps.getAccessToken ?? getValidCompanyGoogleAccessToken)({
    env,
    db,
    fetchImpl: deps.fetchImpl,
    now: deps.now,
  });
  if (!token.ok) return fail("append_outcome_unresolved", 409);
  const metadataResult = await (deps.getMetadata ?? getSpreadsheetMetadata)(
    { spreadsheetId: job.spreadsheetId, accessToken: token.accessToken },
    deps.fetchImpl
  );
  if (!metadataResult.ok) return fail("append_outcome_unresolved", 409);
  const worksheet = metadataResult.metadata.worksheets.find((sheet) => sheet.sheetId === job.worksheetId);
  if (!worksheet || worksheet.sheetType !== "GRID") return fail("worksheet_unavailable", 409);
  const title = quoteSheetTitle(worksheet.title);
  const sample = await (deps.getValues ?? getSheetValues)(
    { spreadsheetId: job.spreadsheetId, range: `${title}!A1:ZZ2`, accessToken: token.accessToken },
    deps.fetchImpl
  );
  const read = await (deps.getValues ?? getSheetValues)(
    { spreadsheetId: job.spreadsheetId, range: `${title}!A${rowNumber}:ZZ${rowNumber}`, accessToken: token.accessToken },
    deps.fetchImpl
  );
  if (!sample.ok || !read.ok) return fail("append_outcome_unresolved", 409);
  const header = headerOf(job);
  if (!exactHeader(sample.values[0] ?? [], header)) return fail("header_changed", 409);
  const formulas = formulaColumnIndexes(header, sample.values[1] ?? []);
  const mode = job.uncertainReason === "partial_row_confirmed" ? "partial" : "complete";
  if (!customCellsMatch(read.values[0] ?? [], expected, formulas, mode)) return fail("reconciled_row_mismatch", 409);
  const pendingRow = pending[0];
  if (!pendingRow) return fail("partial_row_hold", 409);
  const closed = await db.$transaction(async (tx) => {
    const owned = await tx.companySheetsDeliveryJob.updateMany({
      where: { id: job.id, status: "uncertain" },
      data: {
        status: "succeeded",
        uncertainReason: null,
        lastError: null,
        appendStartedAt: null,
        rowsWritten: 1,
        finishedAt: new Date(),
      },
    });
    if (owned.count !== 1) return false;
    await tx.companySheetsDeliveryRow.updateMany({
      where: { id: pendingRow.id, status: "pending" },
      data: { status: "written" },
    });
    return true;
  });
  if (!closed) return fail("not_uncertain", 409);
  await releaseWorksheetLock(db, job);
  await syncEvidence(db, job.id, "succeeded");
  return { ok: true, status: "succeeded", appended: false };
}

export async function releaseCompanySheetsDeliveryHold(
  jobId: string,
  confirmation: string,
  deps: CompanySheetsDeliveryDeps = {},
  observedRowNumber: number | null = null
): Promise<{ ok: true; status: "retryable" | "succeeded"; appended: false } | DeliveryFailure> {
  const env = deps.env ?? process.env;
  const disabled = executionOff(env);
  if (disabled) return disabled;
  const db = deps.db ?? prisma;
  const job = await db.companySheetsDeliveryJob.findUnique({ where: { id: jobId } });
  if (!job) return fail("job_not_found", 404);
  if (job.status !== "uncertain") return fail("not_uncertain", 409);
  if (job.schemaVersion === COMPANY_SHEETS_CAMPAIGN_CUSTOM_SCHEMA && (job.uncertainReason === "partial_row_confirmed" || job.uncertainReason === "append_outcome_unknown")) {
    const phrase = confirmation.trim();
    if (phrase === COMPANY_SHEETS_RELEASE_HOLD_PHRASE) return fail("partial_row_hold", 409);
    if (phrase !== COMPANY_SHEETS_ACCEPT_RECONCILED_ROW_PHRASE) return fail("confirmation_required", 400);
    return acceptReconciledCustomRow(job, observedRowNumber, deps, db, env);
  }
  if (job.kind === ONBOARDING_CAPTURED_TEST_KIND) return fail("append_outcome_unresolved", 409);
  if (confirmation.trim() !== COMPANY_SHEETS_RELEASE_HOLD_PHRASE) return fail("confirmation_required", 400);
  const observed = await readWorksheetIdCounts(job, deps, db, env);
  if (!observed.ok) return fail("append_outcome_unresolved", 409);
  const rows = await db.companySheetsDeliveryRow.findMany({
    where: { jobId: job.id },
    select: { id: true, stableRowId: true, status: true },
  });
  if (rows.some((row) => (observed.counts.get(row.stableRowId) ?? 0) > 1)) {
    await db.companySheetsDeliveryJob.updateMany({
      where: { id: job.id, status: "uncertain" },
      data: { uncertainReason: "duplicate_row_id", lastError: "duplicate_row_id" },
    });
    return fail("duplicate_row_id", 409);
  }
  const pending = rows.filter((row) => row.status === "pending");
  const found = pending.filter((row) => observed.counts.get(row.stableRowId) === 1);
  if (found.length > 0) {
    await db.companySheetsDeliveryRow.updateMany({
      where: { id: { in: found.map((row) => row.id) }, status: "pending" },
      data: { status: "written" },
    });
  }
  const missing = pending.length - found.length;
  const unresolvedAppend = job.appendStartedAt != null && (missing > 0 || observed.truncated);
  if (unresolvedAppend || (observed.truncated && missing > 0)) {
    return fail("append_outcome_unresolved", 409);
  }
  const rowsWritten = await db.companySheetsDeliveryRow.count({
    where: { jobId: job.id, status: "written" },
  });
  const status = missing === 0 ? "succeeded" : "retryable";
  const updated = await db.companySheetsDeliveryJob.updateMany({
    where: { id: job.id, status: "uncertain" },
    data: {
      status,
      uncertainReason: null,
      lastError: status === "succeeded" ? null : "operator_released_hold",
      appendStartedAt: null,
      rowsWritten,
      finishedAt: new Date(),
    },
  });
  if (updated.count !== 1) return fail("not_uncertain", 409);
  await releaseWorksheetLock(db, job);
  await syncEvidence(db, jobId, status);
  return { ok: true, status, appended: false };
}

export async function getCompanySheetsOrderEvidenceForClient(
  input: { clientAccountId: string; leadOrderId: string },
  deps: CompanySheetsDeliveryDeps = {}
) {
  const db = deps.db ?? prisma;
  const rows = await db.companySheetsOrderDeliveryEvidence.findMany({
    where: { clientAccountId: input.clientAccountId, leadOrderId: input.leadOrderId },
    orderBy: { createdAt: "asc" },
    include: { job: { select: { status: true, rowsWritten: true, rowsTotal: true } } },
  });
  return rows.map((row) => ({
    exportPackageId: row.exportPackageId,
    spreadsheetId: row.spreadsheetId,
    spreadsheetUrl: row.spreadsheetUrl,
    tabUrl: companySheetsTabUrl(row.spreadsheetUrl, row.spreadsheetId, row.worksheetId),
    worksheetId: row.worksheetId,
    worksheetTitle: row.worksheetTitle,
    status: row.status,
    deliveryState: companySheetsDeliveryState([
      {
        status: row.job?.status ?? row.status,
        rowsWritten: row.job?.rowsWritten ?? 0,
        rowsTotal: row.job?.rowsTotal ?? 0,
      },
    ]),
    portalLinkGrantsGoogleAccess: false as const,
    usesCurrentDestination: false as const,
  }));
}

export type OnboardingCapturedTestAppendRequest = {
  clientAccountId: string;
  spreadsheetId: string;
  worksheetId: number;
  worksheetTitle: string;
  worksheetRole: "campaign" | "canary";
  schemaVersion: string;
  values: string[];
  idempotencyKey: string;
  deliveryRowId: string;
  sourceLeadEventId: string;
  testRunId: string;
};

export type OnboardingCapturedTestAppendResult =
  | {
      ok: true;
      status: "succeeded";
      rowsWritten: number;
      appended: boolean;
      jobId: string;
      externalCallExecuted: boolean;
    }
  | {
      ok: false;
      code: string;
      statusCode: number;
      externalCallExecuted: boolean;
      uncertainReason?: "timeout" | "unknown" | "in_flight";
      appendStartedAt?: string | null;
      jobId?: string;
    };

type OnboardingCapturedTestFailure = Extract<OnboardingCapturedTestAppendResult, { ok: false }>;

function refused(code: string, statusCode = 409, jobId?: string): OnboardingCapturedTestFailure {
  return { ok: false, code, statusCode, externalCallExecuted: false, jobId };
}

function uncertainResult(
  job: CompanySheetsDeliveryJob,
  reason: "timeout" | "unknown" | "in_flight"
): OnboardingCapturedTestFailure {
  return {
    ok: false,
    code: "uncertain",
    statusCode: 409,
    externalCallExecuted: true,
    uncertainReason: reason,
    appendStartedAt: job.appendStartedAt?.toISOString() ?? new Date().toISOString(),
    jobId: job.id,
  };
}

function appendUncertainty(job: CompanySheetsDeliveryJob): "timeout" | "unknown" {
  if (job.lastError === "network_error" && job.uncertainReason === "append_outcome_unknown") return "timeout";
  return "unknown";
}

async function onboardingCapturedTestDrift(
  db: PrismaClient,
  job: CompanySheetsDeliveryJob
): Promise<string | null> {
  if (job.kind !== ONBOARDING_CAPTURED_TEST_KIND) return null;
  if (reservedProductionKey(job.idempotencyKey) || !ONBOARDING_SHEETS_KEY.test(job.idempotencyKey)) {
    return "production_idempotency_guard";
  }
  if (
    !job.sourceLeadEventId ||
    job.sourceLeadEventId === job.idempotencyKey ||
    job.sourceLeadEventId === "synthetic-campaign-test"
  ) {
    return "production_idempotency_guard";
  }
  if (job.schemaVersion !== COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V3 || !exactV3Header(headerOf(job))) {
    return "header_mismatch";
  }
  if (isOnboardingStatsTitle(job.worksheetTitle)) return "test_worksheet_not_approved";
  const otherOwner = await db.companySheetsDestination.findFirst({
    where: { spreadsheetId: job.spreadsheetId, clientAccountId: { not: job.clientAccountId } },
    select: { id: true },
  });
  if (otherOwner) return "tenant_mismatch";
  const approved = await db.clientOnboardingTestWorksheet.findUnique({
    where: { clientAccountId: job.clientAccountId },
  });
  if (!approved || approved.clientAccountId !== job.clientAccountId) return "test_worksheet_not_approved";
  if (
    approved.spreadsheetId !== job.spreadsheetId ||
    approved.worksheetId !== job.worksheetId ||
    approved.destinationRevision !== job.destinationRevision ||
    approved.schemaVersion !== job.schemaVersion ||
    approved.worksheetTitle !== job.worksheetTitle ||
    !exactV3Header(stringList(approved.header))
  ) {
    return "onboarding_test_destination_changed";
  }
  const own = await db.companySheetsDestination.findUnique({
    where: { clientAccountId: job.clientAccountId },
  });
  if (own && own.spreadsheetId === job.spreadsheetId && own.destinationRevision !== job.destinationRevision) {
    return "onboarding_test_destination_changed";
  }
  if (own && own.companyConnectionId !== job.companyConnectionId) return "company_connection_changed";
  const connection = await findCompanyGoogleConnection(db);
  if (!connection || connection.status !== "connected" || connection.id !== job.companyConnectionId) {
    return "company_connection_changed";
  }
  const event = await db.sourceLeadEvent.findUnique({ where: { id: job.sourceLeadEventId } });
  if (!event || event.clientAccountIdResolved !== job.clientAccountId) return "tenant_mismatch";
  const rows = await db.companySheetsDeliveryRow.findMany({ where: { jobId: job.id } });
  if (rows.length !== 1) return "onboarding_test_row_refused";
  const values = rowValues(rows[0]!.valuesJson);
  const delivery = headerIndex("delivery_row_id");
  const client = headerIndex("client_account_id");
  const source = headerIndex("source_lead_event_id");
  if (
    values.length !== 35 ||
    rows[0]!.stableRowId !== job.idempotencyKey ||
    values[delivery] !== job.idempotencyKey ||
    values[client] !== job.clientAccountId ||
    values[source] !== job.sourceLeadEventId
  ) {
    return values.length === 35 ? "production_idempotency_guard" : "canary_schema_mismatch";
  }
  const blocker = await db.companySheetsDeliveryJob.findFirst({
    where: {
      spreadsheetId: job.spreadsheetId,
      worksheetId: job.worksheetId,
      id: { not: job.id },
      OR: [{ status: "uncertain" }, { status: "running", appendStartedAt: { not: null } }],
    },
    select: { id: true },
  });
  if (blocker) return "worksheet_blocked";
  return null;
}

/**
 * Creates the onboarding_captured_test job for an explicitly approved worksheet.
 * Does not call Google and does not execute the append.
 */
export async function enqueueOnboardingCapturedTestJob(
  request: OnboardingCapturedTestAppendRequest,
  deps: CompanySheetsDeliveryDeps = {}
): Promise<
  | { ok: true; job: CompanySheetsDeliveryJob; execute: boolean }
  | (OnboardingCapturedTestAppendResult & { ok: false })
> {
  const env = deps.env ?? process.env;
  if (!isCompanyGoogleSheetsEnabled(env)) return refused("destination_disabled", 404);
  const db = deps.db ?? prisma;
  const clientAccountId = request.clientAccountId.trim();
  const key = request.idempotencyKey.trim();
  if (
    request.worksheetRole === "canary" ||
    request.schemaVersion === COMPANY_SHEETS_CANARY_SCHEMA_VERSION ||
    sameContractHeader(request.values, [...COMPANY_SHEETS_CANARY_HEADER])
  ) {
    return refused(request.values.length === 35 ? "canary_schema_mismatch" : "canary_projection_not_a_v3_proof");
  }
  if (reservedProductionKey(key) || key !== `onboarding-test:${request.testRunId}:sheets` || !ONBOARDING_SHEETS_KEY.test(key)) {
    return refused("production_idempotency_guard");
  }
  if (request.deliveryRowId !== key) return refused("production_idempotency_guard");
  if (
    !request.sourceLeadEventId ||
    request.sourceLeadEventId === key ||
    request.sourceLeadEventId === "synthetic-campaign-test"
  ) {
    return refused("production_idempotency_guard");
  }
  if (request.schemaVersion !== COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V3 || request.values.length !== 35) {
    return refused("test_worksheet_not_approved");
  }
  if (isOnboardingStatsTitle(request.worksheetTitle)) return refused("test_worksheet_not_approved");
  const delivery = headerIndex("delivery_row_id");
  const clientIndex = headerIndex("client_account_id");
  const sourceIndex = headerIndex("source_lead_event_id");
  if (
    request.values[delivery] !== key ||
    request.values[clientIndex] !== clientAccountId ||
    request.values[sourceIndex] !== request.sourceLeadEventId
  ) {
    return refused("production_idempotency_guard");
  }
  const client = await db.clientAccount.findUnique({
    where: { clientAccountId },
    select: { clientAccountId: true },
  });
  if (!client) return refused("client_not_found", 404);
  const event = await db.sourceLeadEvent.findUnique({ where: { id: request.sourceLeadEventId } });
  if (!event || event.clientAccountIdResolved !== clientAccountId) return refused("tenant_mismatch", 403);
  const approved = await db.clientOnboardingTestWorksheet.findUnique({ where: { clientAccountId } });
  if (!approved || !exactV3Header(stringList(approved.header))) return refused("test_worksheet_not_approved");
  if (isOnboardingStatsTitle(approved.worksheetTitle)) return refused("test_worksheet_not_approved");
  if (
    approved.spreadsheetId !== request.spreadsheetId ||
    approved.worksheetId !== request.worksheetId ||
    approved.worksheetTitle !== request.worksheetTitle ||
    approved.schemaVersion !== COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V3
  ) {
    return refused("test_worksheet_not_approved");
  }
  const control = approved.controlBasis;
  const basis =
    control && typeof control === "object" && !Array.isArray(control)
      ? String((control as { establishControl?: unknown }).establishControl ?? "")
      : "";
  if (!SELECTABLE_CONTROL.has(basis)) return refused("test_worksheet_not_approved");
  const otherOwner = await db.companySheetsDestination.findFirst({
    where: { spreadsheetId: approved.spreadsheetId, clientAccountId: { not: clientAccountId } },
    select: { id: true },
  });
  if (otherOwner) return refused("tenant_mismatch", 403);
  const destination = await db.companySheetsDestination.findUnique({ where: { clientAccountId } });
  if (destination && destination.spreadsheetId === approved.spreadsheetId && destination.destinationRevision !== approved.destinationRevision) {
    return refused("onboarding_test_destination_changed");
  }
  const connection = await findCompanyGoogleConnection(db);
  if (!connection || connection.status !== "connected") return refused("google_not_connected", 409);
  if (destination && destination.companyConnectionId !== connection.id) return refused("company_connection_changed");
  const existing = await db.companySheetsDeliveryJob.findUnique({ where: { idempotencyKey: key } });
  if (existing) {
    if (
      existing.kind !== ONBOARDING_CAPTURED_TEST_KIND ||
      existing.clientAccountId !== clientAccountId ||
      existing.spreadsheetId !== approved.spreadsheetId ||
      existing.worksheetId !== approved.worksheetId ||
      existing.sourceLeadEventId !== request.sourceLeadEventId
    ) {
      return refused("production_idempotency_guard", 409, existing.id);
    }
    if (existing.status === "succeeded") return { ok: true, job: existing, execute: false };
    if (existing.appendStartedAt && existing.status !== "succeeded") return uncertainResult(existing, appendUncertainty(existing));
    if (existing.status === "uncertain") return refused(existing.lastError ?? "uncertain", 409, existing.id);
    if (existing.status === "running") return uncertainResult(existing, "in_flight");
    return { ok: true, job: existing, execute: true };
  }
  const blocker = await db.companySheetsDeliveryJob.findFirst({
    where: {
      spreadsheetId: approved.spreadsheetId,
      worksheetId: approved.worksheetId,
      OR: [{ status: "uncertain" }, { status: "running", appendStartedAt: { not: null } }],
    },
    select: { id: true },
  });
  if (blocker) return refused("worksheet_blocked");
  const header = [...(companySheetsCampaignHeader(COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V3) ?? [])];
  try {
    const job = await db.$transaction(async (tx) => {
      const created = await tx.companySheetsDeliveryJob.create({
        data: {
          kind: ONBOARDING_CAPTURED_TEST_KIND,
          status: "queued",
          clientAccountId,
          companyConnectionId: connection.id,
          destinationId: destination && destination.spreadsheetId === approved.spreadsheetId ? destination.id : null,
          spreadsheetId: approved.spreadsheetId,
          spreadsheetUrl:
            destination && destination.spreadsheetId === approved.spreadsheetId
              ? destination.spreadsheetUrl
              : `https://docs.google.com/spreadsheets/d/${approved.spreadsheetId}`,
          worksheetId: approved.worksheetId,
          worksheetTitle: approved.worksheetTitle,
          controlBasis: basis,
          destinationUpdatedAt: approved.updatedAt,
          headerContract: header,
          schemaVersion: COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V3,
          destinationRevision: approved.destinationRevision,
          sourceLeadEventId: request.sourceLeadEventId,
          contentSha256: sha256(JSON.stringify(request.values)),
          idempotencyKey: key,
          rowsTotal: 1,
          rowsWritten: 0,
        },
      });
      await tx.companySheetsDeliveryRow.create({
        data: {
          jobId: created.id,
          spreadsheetId: approved.spreadsheetId,
          worksheetId: approved.worksheetId,
          stableRowId: key,
          ordinal: 0,
          valuesJson: request.values,
          status: "pending",
        },
      });
      return created;
    });
    return { ok: true, job, execute: true };
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "P2002") {
      const raced = await db.companySheetsDeliveryJob.findUnique({ where: { idempotencyKey: key } });
      if (raced?.status === "succeeded") return { ok: true, job: raced, execute: false };
      if (raced?.appendStartedAt) return uncertainResult(raced, appendUncertainty(raced));
      if (raced?.status === "uncertain") return refused(raced.lastError ?? "uncertain", 409, raced.id);
      if (raced?.status === "running") return uncertainResult(raced, "in_flight");
      if (raced && (raced.status === "queued" || raced.status === "retryable")) {
        return { ok: true, job: raced, execute: true };
      }
    }
    throw err;
  }
}

/**
 * Appends one exact-v3 captured-test row through executeCompanySheetsDeliveryJob.
 * The global execution flag can stay off. Campaign dispatch is not enabled.
 */
export async function appendOnboardingCapturedTestRow(
  request: OnboardingCapturedTestAppendRequest,
  deps: CompanySheetsDeliveryDeps = {}
): Promise<OnboardingCapturedTestAppendResult> {
  const db = deps.db ?? prisma;
  const before = await db.companySheetsDestination.findUnique({ where: { clientAccountId: request.clientAccountId.trim() } });
  const beforeSwitches = switchSnapshot(before);
  const enqueued = await enqueueOnboardingCapturedTestJob(request, deps);
  if (!enqueued.ok) return enqueued;
  if (!enqueued.execute) {
    return {
      ok: true,
      status: "succeeded",
      rowsWritten: enqueued.job.rowsWritten,
      appended: false,
      jobId: enqueued.job.id,
      externalCallExecuted: false,
    };
  }
  const executed = await executeCompanySheetsDeliveryJob(enqueued.job.id, {
    ...deps,
    controlledCampaignTest: false,
    controlledOnboardingCapturedTest: true,
  });
  const after = await db.companySheetsDestination.findUnique({ where: { clientAccountId: request.clientAccountId.trim() } });
  if (JSON.stringify(switchSnapshot(after)) !== JSON.stringify(beforeSwitches)) {
    return refused("delivery_switch_changed", 500, enqueued.job.id);
  }
  const job = await db.companySheetsDeliveryJob.findUnique({ where: { id: enqueued.job.id } });
  if (!executed.ok) {
    if (executed.code === "already_running") {
      return job ? uncertainResult(job, "in_flight") : refused("already_running", 409, enqueued.job.id);
    }
    if (job?.status === "uncertain" && job.appendStartedAt) return uncertainResult(job, appendUncertainty(job));
    return refused(job?.lastError ?? executed.code, executed.statusCode, enqueued.job.id);
  }
  if (executed.status === "succeeded" && executed.rowsWritten >= 1) {
    return {
      ok: true,
      status: "succeeded",
      rowsWritten: executed.rowsWritten,
      appended: executed.appended,
      jobId: enqueued.job.id,
      externalCallExecuted: executed.appended,
    };
  }
  return refused(job?.lastError ?? "test_row_not_written", 409, enqueued.job.id);
}

function switchSnapshot(
  row: {
    campaignDispatchEnabled: boolean;
    agedDispatchEnabled: boolean;
    enabled: boolean;
    deliveryExecution: string;
    writeReadiness: string;
    canaryApproved: boolean;
    campaignDispatchNotBefore: Date | null;
  } | null
) {
  if (!row) return null;
  return {
    campaignDispatchEnabled: row.campaignDispatchEnabled,
    agedDispatchEnabled: row.agedDispatchEnabled,
    enabled: row.enabled,
    deliveryExecution: row.deliveryExecution,
    writeReadiness: row.writeReadiness,
    canaryApproved: row.canaryApproved,
    campaignDispatchNotBefore: row.campaignDispatchNotBefore?.toISOString() ?? null,
  };
}
