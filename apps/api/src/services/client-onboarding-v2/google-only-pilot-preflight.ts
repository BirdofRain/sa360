/**
 * Read-only evidence for a future Google Sheets-only pilot.
 * This module has no HTTP route. A timeout or a thrown query is
 * `unavailable`. It is not an empty row set.
 */

import { Prisma, type PrismaClient } from "@prisma/client";

import { prisma } from "../../lib/db.js";
import { COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V3 } from "../../lib/company-google-sheets-env.js";

const GRANT_TABLES = [
  "ClientOnboardingTestWorksheet",
  "ClientOnboardingVerifiedTestIdentity",
  "ClientOnboardingTestRun",
  "ClientOnboardingTestAttempt",
  "CompanySheetsWorksheetLock",
  "CompanySheetsDeliveryJob",
  "CompanySheetsDestination",
  "CompanySheetsDispatchIntent",
  "SourceLeadEvent",
  "LeadInventoryItem",
] as const;

const SELECTABLE_CONTROL = new Set(["company_created", "drive_owner_verified", "approved_shared_drive"]);

export type ReadEvidence<T> =
  | { state: "read"; value: T }
  | { state: "unavailable"; reason: string };

export type GoogleOnlyPilotPreflight = {
  clientAccountId: string;
  worksheet: ReadEvidence<{
    spreadsheetId: string;
    worksheetId: number;
    worksheetTitle: string;
    schemaVersion: string;
    control: string;
  } | null>;
  identities: ReadEvidence<Array<{ email: string | null; phoneE164: string | null; evidenceMethod: string | null }>>;
  runs: ReadEvidence<Array<{ id: string; kind: string; status: string; warningCodes: string[] }>>;
  locks: ReadEvidence<Array<{ spreadsheetId: string; worksheetId: number; ownerJobId: string | null }>>;
  heldAppends: ReadEvidence<Array<{ id: string; status: string; spreadsheetId: string; worksheetId: number }>>;
  unresolvedJobs: ReadEvidence<Array<{ id: string; status: string; kind: string; spreadsheetId: string }>>;
  grants: ReadEvidence<Array<{ tableName: string; canSelect: boolean }>>;
  dispatch: ReadEvidence<{
    spreadsheetId: string;
    campaignWorksheetTitle: string | null;
    campaignSchemaVersion: string | null;
    campaignDispatchEnabled: boolean;
    agedDispatchEnabled: boolean;
    campaignDispatchNotBefore: string | null;
    agedDispatchNotBefore: string | null;
  } | null>;
};

export async function readEvidence<T>(
  label: string,
  query: () => Promise<T>,
  timeoutMs = 8_000
): Promise<ReadEvidence<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const value = await Promise.race([
      query(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timeout:${label}`)), timeoutMs);
      }),
    ]);
    return { state: "read", value };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "query_failed";
    return { state: "unavailable", reason: `${label}: ${reason}` };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function readGoogleOnlyPilotPreflight(
  clientAccountId: string,
  db: PrismaClient = prisma,
  timeoutMs = 8_000
): Promise<GoogleOnlyPilotPreflight> {
  const worksheet = await readEvidence("worksheet", async () => {
    const row = await db.clientOnboardingTestWorksheet.findUnique({ where: { clientAccountId } });
    if (!row) return null;
    const control = asRecord(row.controlBasis);
    return {
      spreadsheetId: row.spreadsheetId,
      worksheetId: row.worksheetId,
      worksheetTitle: row.worksheetTitle,
      schemaVersion: row.schemaVersion,
      control: typeof control?.establishControl === "string" ? control.establishControl : "",
    };
  }, timeoutMs);
  const dispatch = await readEvidence("dispatch", async () => {
    const destination = await db.companySheetsDestination.findUnique({
      where: { clientAccountId },
      include: { tabContracts: true },
    });
    if (!destination) return null;
    const campaign = destination.tabContracts.find((contract) => contract.role === "campaign") ?? null;
    return {
      spreadsheetId: destination.spreadsheetId,
      campaignWorksheetTitle: campaign?.worksheetTitle ?? destination.worksheetTitle,
      campaignSchemaVersion: campaign?.schemaVersion ?? null,
      campaignDispatchEnabled: destination.campaignDispatchEnabled,
      agedDispatchEnabled: destination.agedDispatchEnabled,
      campaignDispatchNotBefore: destination.campaignDispatchNotBefore?.toISOString() ?? null,
      agedDispatchNotBefore: destination.agedDispatchNotBefore?.toISOString() ?? null,
    };
  }, timeoutMs);
  const identities = await readEvidence("identities", async () => {
    const rows = await db.clientOnboardingVerifiedTestIdentity.findMany({
      where: { clientAccountId },
      orderBy: { createdAt: "asc" },
    });
    return rows.map((row) => ({
      email: row.email,
      phoneE164: row.phoneE164,
      evidenceMethod: evidenceMethod(row.evidenceJson),
    }));
  }, timeoutMs);
  const runs = await readEvidence("runs", async () => {
    const rows = await db.clientOnboardingTestRun.findMany({
      where: { clientAccountId },
      orderBy: { createdAt: "asc" },
    });
    return rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      status: row.status,
      warningCodes: stringList(row.warningCodes),
    }));
  }, timeoutMs);
  const locks = worksheet.state === "read" && dispatch.state === "read"
    ? await readEvidence("locks", async () => {
        const ids = [worksheet.value?.spreadsheetId, dispatch.value?.spreadsheetId].filter(
          (id): id is string => Boolean(id)
        );
        if (ids.length === 0) return [];
        const rows = await db.companySheetsWorksheetLock.findMany({
          where: { spreadsheetId: { in: ids } },
        });
        return rows.map((row) => ({
          spreadsheetId: row.spreadsheetId,
          worksheetId: row.worksheetId,
          ownerJobId: row.ownerJobId,
        }));
      }, timeoutMs)
    : ({ state: "unavailable", reason: "locks: spreadsheet ids were not read" } as const);
  const heldAppends = await readEvidence("heldAppends", () =>
    db.companySheetsDeliveryJob.findMany({
      where: {
        clientAccountId,
        appendStartedAt: { not: null },
        status: { not: "succeeded" },
      },
      select: { id: true, status: true, spreadsheetId: true, worksheetId: true },
    }), timeoutMs);
  const unresolvedJobs = await readEvidence("unresolvedJobs", () =>
    db.companySheetsDeliveryJob.findMany({
      where: {
        clientAccountId,
        status: { in: ["queued", "running", "retryable", "uncertain"] },
      },
      select: { id: true, status: true, kind: true, spreadsheetId: true },
    }), timeoutMs);
  const grants = await readEvidence("grants", async () => {
    const rows = await db.$queryRaw<Array<{ table_name: string; can_select: boolean }>>(Prisma.sql`
      SELECT c.relname AS table_name,
             has_table_privilege(current_user, c.oid, 'SELECT') AS can_select
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
        AND c.relname IN (${Prisma.join([...GRANT_TABLES])})
    `);
    return GRANT_TABLES.map((tableName) => ({
      tableName,
      canSelect: rows.some((row) => row.table_name === tableName && row.can_select === true),
    }));
  }, timeoutMs);
  return {
    clientAccountId,
    worksheet,
    identities,
    runs,
    locks,
    heldAppends,
    unresolvedJobs,
    grants,
    dispatch,
  };
}

/**
 * Append stays no-go. A complete local read can only say the stored rows are
 * ready for a later human review. Unavailable evidence is never zero rows.
 */
export function decideGoogleOnlyPilot(report: GoogleOnlyPilotPreflight): {
  setup: "no_go" | "rows_ready_for_human_review";
  append: "no_go";
  reasons: string[];
} {
  const reasons: string[] = ["external append stays no-go"];
  const unavailable = (
    [
      ["worksheet", report.worksheet],
      ["identities", report.identities],
      ["runs", report.runs],
      ["locks", report.locks],
      ["heldAppends", report.heldAppends],
      ["unresolvedJobs", report.unresolvedJobs],
      ["grants", report.grants],
      ["dispatch", report.dispatch],
    ] as const
  ).filter((entry) => entry[1].state === "unavailable");
  if (unavailable.length > 0) {
    reasons.push(
      ...unavailable.map(([label, evidence]) => `${label} unavailable (${evidence.state === "unavailable" ? evidence.reason : label}); this is not an empty result`)
    );
    return { setup: "no_go", append: "no_go", reasons };
  }
  if (report.worksheet.state !== "read" || !report.worksheet.value) {
    reasons.push("no approved test worksheet");
    return { setup: "no_go", append: "no_go", reasons };
  }
  if (report.dispatch.state !== "read" || !report.dispatch.value) {
    reasons.push("no saved company spreadsheet destination");
    return { setup: "no_go", append: "no_go", reasons };
  }
  const worksheet = report.worksheet.value;
  const dispatch = report.dispatch.value;
  if (worksheet.spreadsheetId === dispatch.spreadsheetId) {
    reasons.push("approved worksheet is the saved production spreadsheet");
  }
  if (worksheet.schemaVersion !== COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V3) {
    reasons.push("approved worksheet is not company_sheets_campaign_v3");
  }
  if (!SELECTABLE_CONTROL.has(worksheet.control)) {
    reasons.push("approved worksheet control is not a company-controlled basis");
  }
  if (dispatch.campaignDispatchEnabled || dispatch.agedDispatchEnabled) {
    reasons.push("campaign or aged dispatch is on");
  }
  if (report.identities.state === "read" && report.identities.value.length === 0) {
    reasons.push("no stored test identity");
  }
  if (report.heldAppends.state === "read" && report.heldAppends.value.length > 0) {
    reasons.push("held appendStartedAt");
  }
  if (report.unresolvedJobs.state === "read" && report.unresolvedJobs.value.length > 0) {
    reasons.push("unresolved destination job");
  }
  if (report.locks.state === "read" && report.locks.value.some((lock) => lock.ownerJobId)) {
    reasons.push("worksheet lock is held");
  }
  if (report.runs.state === "read" && report.runs.value.some((run) => run.status === "uncertain" || run.status === "executing")) {
    reasons.push("in-flight or uncertain test run");
  }
  if (report.grants.state === "read" && report.grants.value.some((grant) => !grant.canSelect)) {
    reasons.push("company database select grant is missing");
  }
  const blocking = reasons.filter((reason) => reason !== "external append stays no-go");
  return {
    setup: blocking.length === 0 ? "rows_ready_for_human_review" : "no_go",
    append: "no_go",
    reasons,
  };
}

function evidenceMethod(value: unknown): string | null {
  const record = asRecord(value);
  return typeof record?.method === "string" ? record.method : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
