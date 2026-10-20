import { randomUUID } from "node:crypto";

import type { CompanySheetsDeliveryJob, CompanySheetsDestination, Prisma, PrismaClient } from "@prisma/client";

import { prisma } from "../../lib/db.js";
import {
  COMPANY_SHEETS_DELIVERY_BATCH_SIZE,
  COMPANY_SHEETS_LEAD_HEADER,
  COMPANY_SHEETS_RECONCILE_ROW_CAP,
  COMPANY_SHEETS_RELEASE_HOLD_PHRASE,
  isCompanyGoogleSheetsEnabled,
  isCompanyGoogleSheetsExecutionEnabled,
  neutralizeSpreadsheetCell,
} from "../../lib/company-google-sheets-env.js";
import { parseCsvDocument, sha256Hex } from "../ppl-fulfillment/buyer-csv-export.service.js";
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

const LOCK_STALE_MS = 120_000;
const AMBIGUOUS = new Set(["network_error", "server_error"]);

export type CompanySheetsDeliveryDeps = CompanySheetsDeps & {
  batchSize?: number;
  maxBatches?: number;
  getValues?: typeof getSheetValues;
  appendValues?: typeof appendSheetValues;
  updateValues?: typeof updateSheetValues;
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

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

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

function literalRow(values: string[]): string[] {
  return values.map((cell) => neutralizeSpreadsheetCell(cell));
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

async function createJob(
  db: PrismaClient,
  input: {
    kind: "lead" | "aged_release" | "canary";
    idempotencyKey: string;
    destination: CompanySheetsDestination;
    header: string[];
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
          worksheetId: input.destination.worksheetId,
          worksheetTitle: input.destination.worksheetTitle,
          controlBasis: input.destination.controlBasis,
          destinationUpdatedAt: input.destination.updatedAt,
          headerContract: input.header,
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
          worksheetId: input.destination.worksheetId,
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
            worksheetId: input.destination.worksheetId,
            worksheetTitle: input.destination.worksheetTitle,
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
  const disabled = executionOff(env);
  if (disabled) return disabled;
  const db = deps.db ?? prisma;
  const id = sourceLeadEventId.trim();
  const lead = await db.sourceLeadEvent.findUnique({ where: { id } });
  if (!lead) return fail("lead_not_found", 404);
  const clientAccountId = lead.clientAccountIdResolved?.trim() ?? "";
  if (!clientAccountId) return fail("client_not_confirmed", 409);
  const destination = await snapshotDestination(clientAccountId, db);
  if (!("spreadsheetId" in destination)) return destination;
  const normalized = asRecord(lead.normalizedPayloadJson) ?? {};
  const first = readString(normalized.first_name ?? normalized.firstName);
  const last = readString(normalized.last_name ?? normalized.lastName);
  const full = [first, last].filter(Boolean).join(" ") || readString(normalized.full_name ?? normalized.fullName ?? normalized.name);
  const stableRowId = `lead:${clientAccountId}:${lead.id}`;
  const values = [
    stableRowId,
    clientAccountId,
    lead.id,
    lead.receivedAt.toISOString(),
    full,
    readString(normalized.email),
    readString(normalized.phone ?? normalized.phone_number ?? normalized.phoneNumber),
  ];
  const idempotencyKey = `lead:${clientAccountId}:${lead.id}`;
  const before = await db.companySheetsDeliveryJob.findUnique({ where: { idempotencyKey } });
  const job = await createJob(db, {
    kind: "lead",
    idempotencyKey,
    destination,
    header: [...COMPANY_SHEETS_LEAD_HEADER],
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
  const disabled = executionOff(env);
  if (disabled) return disabled;
  const db = deps.db ?? prisma;
  const packageRow = await db.leadDeliveryExportPackage.findUnique({ where: { id: exportPackageId.trim() } });
  if (!packageRow) return fail("export_not_found", 404);
  if (!packageRow.spreadsheetDeliveredAt) return fail("release_not_authorized", 409);
  const deliveredAt = packageRow.spreadsheetDeliveredAt;
  const hash = sha256Hex(packageRow.csvContent);
  if (hash !== packageRow.contentSha256) return fail("csv_integrity_mismatch", 409);
  const parsed = parseCsvDocument(packageRow.csvContent);
  const header = parsed[0] ?? [];
  const dataRows = parsed.slice(1).filter((row) => !blankRow(row));
  const allocationIds = Array.isArray(packageRow.allocationIdsJson)
    ? packageRow.allocationIdsJson.filter((id): id is string => typeof id === "string" && id.trim().length > 0)
    : [];
  if (header.length === 0 || dataRows.length === 0) return fail("csv_empty", 409);
  if (dataRows.length !== packageRow.rowCount || allocationIds.length !== dataRows.length) {
    return fail("row_count_mismatch", 409);
  }
  const destination = await snapshotDestination(packageRow.clientAccountId, db);
  if (!("spreadsheetId" in destination)) return destination;
  const sheetHeader = ["delivery_row_id", ...header];
  const rows = dataRows.map((row, index) => {
    const stableRowId = `release:${packageRow.clientAccountId}:${packageRow.leadOrderId}:${packageRow.id}:${allocationIds[index]}`;
    const padded = header.map((_, cellIndex) => row[cellIndex] ?? "");
    return { stableRowId, values: [stableRowId, ...padded] };
  });
  const idempotencyKey = `release:${packageRow.clientAccountId}:${packageRow.leadOrderId}:${packageRow.id}`;
  const before = await db.companySheetsDeliveryJob.findUnique({ where: { idempotencyKey } });
  const job = await createJob(db, {
    kind: "aged_release",
    idempotencyKey,
    destination,
    header: sheetHeader,
    rows,
    leadOrderId: packageRow.leadOrderId,
    exportPackageId: packageRow.id,
    contentSha256: packageRow.contentSha256,
  });
  const after = await db.leadDeliveryExportPackage.findUnique({ where: { id: packageRow.id } });
  if (after?.spreadsheetDeliveredAt?.getTime() !== deliveredAt.getTime()) {
    return fail("release_mutated", 500);
  }
  return { ok: true, job, created: !before };
}

export async function enqueueCompanySheetsCanary(
  input: { clientAccountId: string; idempotencyKey: string; rowCount?: number },
  deps: CompanySheetsDeliveryDeps = {}
): Promise<{ ok: true; job: CompanySheetsDeliveryJob; created: boolean } | DeliveryFailure> {
  const env = deps.env ?? process.env;
  const disabled = executionOff(env);
  if (disabled) return disabled;
  const db = deps.db ?? prisma;
  const clientAccountId = input.clientAccountId.trim();
  const idem = input.idempotencyKey.trim();
  if (!idem || idem.length > 80) return fail("invalid_idempotency_key", 400);
  const destination = await snapshotDestination(clientAccountId, db);
  if (!("spreadsheetId" in destination)) return destination;
  if (!destination.canaryApproved) return fail("canary_not_approved", 409);
  const count = input.rowCount == null ? 2 : input.rowCount;
  if (!Number.isInteger(count) || count < 1 || count > 5) return fail("invalid_canary_size", 400);
  const header = ["delivery_row_id", "sample_formula", "sample_plus", "note"];
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
    header,
    rows,
  });
  return { ok: true, job, created: !before };
}

async function syncEvidence(db: PrismaClient, jobId: string, status: string) {
  await db.companySheetsOrderDeliveryEvidence.updateMany({ where: { jobId }, data: { status } });
}

async function finishJob(
  db: PrismaClient,
  job: CompanySheetsDeliveryJob,
  claimToken: string,
  status: CompanySheetsDeliveryJob["status"],
  extra: { lastError?: string | null; uncertainReason?: string | null; rowsWritten?: number } = {}
) {
  const written =
    extra.rowsWritten ??
    (await db.companySheetsDeliveryRow.count({ where: { jobId: job.id, status: "written" } }));
  await db.companySheetsDeliveryJob.updateMany({
    where: { id: job.id, claimToken },
    data: {
      status,
      rowsWritten: written,
      lastError: extra.lastError === undefined ? undefined : extra.lastError,
      uncertainReason: extra.uncertainReason === undefined ? undefined : extra.uncertainReason,
      finishedAt: status === "running" ? null : new Date(),
    },
  });
  await syncEvidence(db, job.id, status);
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
  const claimToken = randomUUID();
  const stale = new Date(now.getTime() - LOCK_STALE_MS);
  const claimed = await db.companySheetsDeliveryJob.updateMany({
    where: {
      id: jobId,
      OR: [
        { status: { in: ["queued", "retryable"] } },
        { status: "running", startedAt: { lt: stale } },
      ],
    },
    data: {
      status: "running",
      attemptCount: { increment: 1 },
      claimToken,
      startedAt: now,
      finishedAt: null,
      uncertainReason: null,
    },
  });
  if (claimed.count !== 1) {
    const current = await db.companySheetsDeliveryJob.findUnique({ where: { id: jobId } });
    if (!current) return fail("job_not_found", 404);
    return fail(current.status === "uncertain" ? "uncertain" : current.status === "succeeded" ? "already_succeeded" : "already_running", 409);
  }
  const job = await db.companySheetsDeliveryJob.findUnique({ where: { id: jobId } });
  if (!job || job.claimToken !== claimToken) return fail("already_running", 409);
  if (job.kind === "canary") {
    const destination = job.destinationId
      ? await db.companySheetsDestination.findUnique({ where: { id: job.destinationId } })
      : null;
    if (
      !destination?.canaryApproved ||
      destination.spreadsheetId !== job.spreadsheetId ||
      destination.worksheetId !== job.worksheetId
    ) {
      await finishJob(db, job, claimToken, "uncertain", {
        lastError: "canary_destination_changed",
        uncertainReason: "canary_destination_changed",
      });
      return fail("canary_destination_changed", 409);
    }
  }

  const locked = await acquireWorksheetLock(db, job, now);
  if (!locked) {
    await finishJob(db, job, claimToken, "queued", { lastError: "worksheet_busy" });
    return fail("worksheet_busy", 409);
  }
  try {
    const outcome = await runJob(job, claimToken, deps, db, env);
    return outcome;
  } finally {
    await db.companySheetsWorksheetLock.updateMany({
      where: { spreadsheetId: job.spreadsheetId, worksheetId: job.worksheetId, ownerJobId: job.id },
      data: { ownerJobId: null, lockedAt: null },
    });
  }
}

async function acquireWorksheetLock(db: PrismaClient, job: CompanySheetsDeliveryJob, now: Date) {
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
  const stale = new Date(now.getTime() - LOCK_STALE_MS);
  const taken = await db.companySheetsWorksheetLock.updateMany({
    where: {
      spreadsheetId: job.spreadsheetId,
      worksheetId: job.worksheetId,
      OR: [{ ownerJobId: null }, { ownerJobId: job.id }, { lockedAt: { lt: stale } }],
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
    await finishJob(db, job, claimToken, "retryable", { lastError: token.code });
    return fail(token.code, token.code === "google_not_connected" ? 409 : 503);
  }
  if (token.connectionId !== job.companyConnectionId) {
    await finishJob(db, job, claimToken, "uncertain", {
      lastError: "company_connection_changed",
      uncertainReason: "company_connection_changed",
    });
    return fail("company_connection_changed", 409);
  }
  const metadataResult = await (deps.getMetadata ?? getSpreadsheetMetadata)(
    { spreadsheetId: job.spreadsheetId, accessToken: token.accessToken },
    deps.fetchImpl
  );
  if (!metadataResult.ok) {
    await finishJob(db, job, claimToken, "retryable", {
      lastError: metadataResult.reason,
      uncertainReason: null,
    });
    return fail(metadataResult.reason, 502);
  }
  const connection = await db.companyGoogleConnection.findUnique({ where: { id: job.companyConnectionId } });
  if (!connection || connection.status !== "connected") {
    await finishJob(db, job, claimToken, "retryable", { lastError: "google_not_connected" });
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
    await finishJob(db, job, claimToken, "retryable", { lastError: control.code });
    return fail(control.code, control.statusCode);
  }
  const worksheet = metadataResult.metadata.worksheets.find((sheet) => sheet.sheetId === job.worksheetId);
  if (!worksheet || worksheet.sheetType !== "GRID") {
    await finishJob(db, job, claimToken, "retryable", { lastError: "worksheet_unavailable" });
    return fail("worksheet_unavailable", 409);
  }
  const title = quoteSheetTitle(worksheet.title);
  const header = headerOf(job);
  const headerReady = await ensureHeader(job, title, header, token.accessToken, deps, db, claimToken);
  if (!headerReady.ok) return headerReady;
  const reconciled = await reconcilePending(job, title, token.accessToken, deps, db);
  if (!reconciled.ok) {
    await finishJob(db, job, claimToken, "uncertain", {
      lastError: reconciled.reason,
      uncertainReason: reconciled.reason,
    });
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
      await finishJob(db, job, claimToken, "succeeded", { lastError: null, rowsWritten });
      return { ok: true, status: "succeeded", rowsWritten, appended };
    }
    const values = pending.map((row) => literalRow(rowValues(row.valuesJson)));
    const wrote = await (deps.appendValues ?? appendSheetValues)(
      { spreadsheetId: job.spreadsheetId, range: `${title}!A1`, values, accessToken: token.accessToken },
      deps.fetchImpl
    );
    if (!wrote.ok) {
      if (AMBIGUOUS.has(wrote.reason)) {
        const again = await reconcilePending(job, title, token.accessToken, deps, db);
        if (!again.ok) {
          await finishJob(db, job, claimToken, "uncertain", {
            lastError: wrote.reason,
            uncertainReason: "reconcile_incomplete",
          });
          return fail("uncertain", 409);
        }
      }
      const rowsWritten = await db.companySheetsDeliveryRow.count({ where: { jobId: job.id, status: "written" } });
      const remaining = await db.companySheetsDeliveryRow.count({ where: { jobId: job.id, status: "pending" } });
      const status = remaining === 0 ? "succeeded" : "retryable";
      await finishJob(db, job, claimToken, status, {
        lastError: status === "succeeded" ? null : wrote.reason,
        rowsWritten,
      });
      return { ok: true, status, rowsWritten, appended };
    }
    await db.companySheetsDeliveryRow.updateMany({
      where: { id: { in: pending.map((row) => row.id) }, status: "pending" },
      data: { status: "written" },
    });
    const progressed = await db.companySheetsDeliveryRow.count({
      where: { jobId: job.id, status: "written" },
    });
    await db.companySheetsDeliveryJob.updateMany({
      where: { id: job.id, claimToken },
      data: { rowsWritten: progressed },
    });
    appended = true;
  }
  const rowsWritten = await db.companySheetsDeliveryRow.count({ where: { jobId: job.id, status: "written" } });
  const remaining = await db.companySheetsDeliveryRow.count({ where: { jobId: job.id, status: "pending" } });
  const status = remaining === 0 ? "succeeded" : "retryable";
  await finishJob(db, job, claimToken, status, { lastError: remaining === 0 ? null : "batch_limit", rowsWritten });
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
    await finishJob(db, job, claimToken, "retryable", {
      lastError: read.reason,
      uncertainReason: null,
    });
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
      await finishJob(db, job, claimToken, "retryable", {
        lastError: probe.reason,
        uncertainReason: null,
      });
      return fail(probe.reason, 409);
    }
    const occupied = probe.values.some((row) => (row[0] ?? "").trim() !== "");
    if (occupied || probe.values.length >= cap) {
      const reason = occupied ? "header_conflict" : "reconcile_incomplete";
      await finishJob(db, job, claimToken, "uncertain", {
        lastError: reason,
        uncertainReason: reason,
      });
      return fail("uncertain", 409);
    }
    const wrote = await (deps.updateValues ?? updateSheetValues)(
      {
        spreadsheetId: job.spreadsheetId,
        range: `${title}!A1`,
        values: [literalRow(header)],
        accessToken,
      },
      deps.fetchImpl
    );
    if (!wrote.ok) {
      await finishJob(db, job, claimToken, AMBIGUOUS.has(wrote.reason) ? "uncertain" : "retryable", {
        lastError: wrote.reason,
        uncertainReason: AMBIGUOUS.has(wrote.reason) ? "header_outcome_unknown" : null,
      });
      return fail(AMBIGUOUS.has(wrote.reason) ? "uncertain" : wrote.reason, 409);
    }
    return { ok: true };
  }
  if (blankRow(first) && !blankRow(second)) {
    await finishJob(db, job, claimToken, "uncertain", {
      lastError: "header_conflict",
      uncertainReason: "header_conflict",
    });
    return fail("uncertain", 409);
  }
  if (!sameHeader(first ?? [], header)) {
    await finishJob(db, job, claimToken, "uncertain", {
      lastError: "header_mismatch",
      uncertainReason: "header_mismatch",
    });
    return fail("uncertain", 409);
  }
  return { ok: true };
}

async function reconcilePending(
  job: CompanySheetsDeliveryJob,
  title: string,
  accessToken: string,
  deps: CompanySheetsDeliveryDeps,
  db: PrismaClient
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const cap = COMPANY_SHEETS_RECONCILE_ROW_CAP + 1;
  const read = await (deps.getValues ?? getSheetValues)(
    { spreadsheetId: job.spreadsheetId, range: `${title}!A1:A${cap}`, accessToken },
    deps.fetchImpl
  );
  if (!read.ok) return { ok: false, reason: read.reason };
  const seen = new Set(read.values.map((row) => (row[0] ?? "").trim()).filter(Boolean));
  const pending = await db.companySheetsDeliveryRow.findMany({
    where: { jobId: job.id, status: "pending" },
    select: { id: true, stableRowId: true },
  });
  const found = pending.filter((row) => seen.has(row.stableRowId));
  if (found.length > 0) {
    await db.companySheetsDeliveryRow.updateMany({
      where: { id: { in: found.map((row) => row.id) } },
      data: { status: "written" },
    });
  }
  const missing = pending.length - found.length;
  if (read.values.length >= cap && missing > 0) return { ok: false, reason: "reconcile_incomplete" };
  return { ok: true };
}

export async function releaseCompanySheetsDeliveryHold(
  jobId: string,
  confirmation: string,
  deps: CompanySheetsDeliveryDeps = {}
): Promise<{ ok: true; status: "retryable" } | DeliveryFailure> {
  const env = deps.env ?? process.env;
  const disabled = executionOff(env);
  if (disabled) return disabled;
  if (confirmation.trim() !== COMPANY_SHEETS_RELEASE_HOLD_PHRASE) return fail("confirmation_required", 400);
  const db = deps.db ?? prisma;
  const updated = await db.companySheetsDeliveryJob.updateMany({
    where: { id: jobId, status: "uncertain" },
    data: { status: "retryable", uncertainReason: null, lastError: "operator_released_hold" },
  });
  if (updated.count !== 1) return fail("not_uncertain", 409);
  await syncEvidence(db, jobId, "retryable");
  return { ok: true, status: "retryable" };
}

export async function getCompanySheetsOrderEvidenceForClient(
  input: { clientAccountId: string; leadOrderId: string },
  deps: CompanySheetsDeliveryDeps = {}
) {
  const db = deps.db ?? prisma;
  const rows = await db.companySheetsOrderDeliveryEvidence.findMany({
    where: { clientAccountId: input.clientAccountId, leadOrderId: input.leadOrderId },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((row) => ({
    exportPackageId: row.exportPackageId,
    spreadsheetId: row.spreadsheetId,
    spreadsheetUrl: row.spreadsheetUrl,
    worksheetId: row.worksheetId,
    worksheetTitle: row.worksheetTitle,
    status: row.status,
    portalLinkGrantsGoogleAccess: false as const,
    automatedSheetsStatus: row.status,
  }));
}
