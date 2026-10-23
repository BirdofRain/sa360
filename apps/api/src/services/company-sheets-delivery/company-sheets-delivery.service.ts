import { randomUUID } from "node:crypto";

import type { CompanySheetsDeliveryJob, CompanySheetsDestination, Prisma, PrismaClient } from "@prisma/client";
import { COMPANY_SHEETS_EXECUTION_LEASE_MS } from "@sa360/shared";

import { prisma } from "../../lib/db.js";
import {
  COMPANY_SHEETS_CANARY_HEADER,
  COMPANY_SHEETS_CANARY_SCHEMA_VERSION,
  COMPANY_SHEETS_DELIVERY_BATCH_SIZE,
  COMPANY_SHEETS_RECONCILE_ROW_CAP,
  COMPANY_SHEETS_RELEASE_HOLD_PHRASE,
  companySheetsCampaignHeader,
  companySheetsDeliveryState,
  companySheetsTabUrl,
  isCompanyGoogleSheetsEnabled,
  isCompanyGoogleSheetsExecutionEnabled,
} from "../../lib/company-google-sheets-env.js";
import { companySheetsCampaignRowValues } from "./company-sheets-campaign-row.js";
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

const AMBIGUOUS = new Set(["network_error", "server_error", "malformed_response"]);

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
    kind: "lead" | "aged_release" | "canary";
    idempotencyKey: string;
    destination: CompanySheetsDestination;
    contract: BoundContract;
    rows: Array<{ stableRowId: string; values: string[] }>;
    sourceLeadEventId?: string | null;
    leadOrderId?: string | null;
    exportPackageId?: string | null;
    contentSha256?: string | null;
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
          headerContract: input.contract.header,
          schemaVersion: input.contract.schemaVersion,
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
  const expectedHeader = companySheetsCampaignHeader(contract.schemaVersion);
  if (!expectedHeader || !sameContractHeader(contract.header, expectedHeader)) {
    return fail("schema_mismatch", 409);
  }
  const stableRowId = `lead:${clientAccountId}:${lead.id}`;
  const values = companySheetsCampaignRowValues({
    schemaVersion: contract.schemaVersion,
    stableRowId,
    clientAccountId,
    sourceLeadEventId: lead.id,
    receivedAt: lead.receivedAt.toISOString(),
    sourceLeadId: lead.sourceLeadId,
    normalizedPayload: lead.normalizedPayloadJson,
  });
  if (!values) return fail("schema_mismatch", 409);
  const idempotencyKey = `lead:${clientAccountId}:${lead.id}`;
  const before = await db.companySheetsDeliveryJob.findUnique({ where: { idempotencyKey } });
  const job = await createJob(db, {
    kind: "lead",
    idempotencyKey,
    destination,
    contract,
    rows: [{ stableRowId, values }],
    sourceLeadEventId: lead.id,
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
  if (disabled) return disabled;
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
  const title = quoteSheetTitle(worksheet.title);
  const header = headerOf(job);
  const headerReady = await ensureHeader(job, title, header, token.accessToken, deps, db, claimToken);
  if (!headerReady.ok) return headerReady;
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
    const values = pending.map((row) => rawRow(rowValues(row.valuesJson)));
    const marked = await db.companySheetsDeliveryJob.updateMany({
      where: { id: job.id, claimToken, status: "running", appendStartedAt: null },
      data: { appendStartedAt: new Date() },
    });
    if (marked.count !== 1) return lostPreAppend(db, job, claimToken);
    const wrote = await (deps.appendValues ?? appendSheetValues)(
      { spreadsheetId: job.spreadsheetId, range: `${title}!A1`, values, accessToken: token.accessToken },
      deps.fetchImpl
    );
    if (!wrote.ok) {
      if (AMBIGUOUS.has(wrote.reason)) {
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

async function ensureHeader(
  job: CompanySheetsDeliveryJob,
  title: string,
  header: string[],
  accessToken: string,
  deps: CompanySheetsDeliveryDeps,
  db: PrismaClient,
  claimToken: string
): Promise<{ ok: true } | DeliveryFailure> {
  const read = await (deps.getValues ?? getSheetValues)(
    { spreadsheetId: job.spreadsheetId, range: `${title}!A1:ZZ2`, accessToken },
    deps.fetchImpl
  );
  if (!read.ok) {
    const lost = await finishOwned(db, job, claimToken, "retryable", {
      lastError: read.reason,
      uncertainReason: null,
    });
    if (lost) return lost;
    return fail(read.reason, 409);
  }
  const first = read.values[0];
  const second = read.values[1];
  if (blankRow(first) && blankRow(second)) {
    const cap = COMPANY_SHEETS_RECONCILE_ROW_CAP + 1;
    const probe = await (deps.getValues ?? getSheetValues)(
      { spreadsheetId: job.spreadsheetId, range: `${title}!A1:A${cap}`, accessToken },
      deps.fetchImpl
    );
    if (!probe.ok) {
      const lost = await finishOwned(db, job, claimToken, "retryable", {
        lastError: probe.reason,
        uncertainReason: null,
      });
      if (lost) return lost;
      return fail(probe.reason, 409);
    }
    const occupied = probe.values.some((row) => (row[0] ?? "").trim() !== "");
    if (occupied || probe.values.length >= cap) {
      const reason = occupied ? "header_conflict" : "reconcile_incomplete";
      const lost = await finishOwned(db, job, claimToken, "uncertain", {
        lastError: reason,
        uncertainReason: reason,
      });
      if (lost) return lost;
      return fail("uncertain", 409);
    }
    if (!(await claimStillBeforeAppend(db, job.id, claimToken))) return lostPreAppend(db, job, claimToken);
    const wrote = await (deps.updateValues ?? updateSheetValues)(
      {
        spreadsheetId: job.spreadsheetId,
        range: `${title}!A1`,
        values: [rawRow(header)],
        accessToken,
      },
      deps.fetchImpl
    );
    if (!wrote.ok) {
      const lost = await finishOwned(db, job, claimToken, AMBIGUOUS.has(wrote.reason) ? "uncertain" : "retryable", {
        lastError: wrote.reason,
        uncertainReason: AMBIGUOUS.has(wrote.reason) ? "header_outcome_unknown" : null,
      });
      if (lost) return lost;
      return fail(AMBIGUOUS.has(wrote.reason) ? "uncertain" : wrote.reason, 409);
    }
    return { ok: true };
  }
  if (blankRow(first) && !blankRow(second)) {
    const lost = await finishOwned(db, job, claimToken, "uncertain", {
      lastError: "header_conflict",
      uncertainReason: "header_conflict",
    });
    if (lost) return lost;
    return fail("uncertain", 409);
  }
  if (!sameHeader(first ?? [], header)) {
    const lost = await finishOwned(db, job, claimToken, "uncertain", {
      lastError: "header_mismatch",
      uncertainReason: "header_mismatch",
    });
    if (lost) return lost;
    return fail("uncertain", 409);
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
  const read = await (deps.getValues ?? getSheetValues)(
    { spreadsheetId: job.spreadsheetId, range: `${title}!A1:A${cap}`, accessToken },
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
export async function releaseCompanySheetsDeliveryHold(
  jobId: string,
  confirmation: string,
  deps: CompanySheetsDeliveryDeps = {}
): Promise<{ ok: true; status: "retryable" | "succeeded"; appended: false } | DeliveryFailure> {
  const env = deps.env ?? process.env;
  const disabled = executionOff(env);
  if (disabled) return disabled;
  if (confirmation.trim() !== COMPANY_SHEETS_RELEASE_HOLD_PHRASE) return fail("confirmation_required", 400);
  const db = deps.db ?? prisma;
  const job = await db.companySheetsDeliveryJob.findUnique({ where: { id: jobId } });
  if (!job) return fail("job_not_found", 404);
  if (job.status !== "uncertain") return fail("not_uncertain", 409);
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
