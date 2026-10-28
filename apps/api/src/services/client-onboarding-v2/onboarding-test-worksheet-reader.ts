/**
 * Read-only header and control check for an explicitly chosen worksheet.
 * It does not append, update, bind a tab, or fall back to the saved
 * production destination or the first tab.
 */

import { createHash } from "node:crypto";

import type { PrismaClient } from "@prisma/client";

import { prisma } from "../../lib/db.js";
import { isCompanyGoogleSheetsEnabled } from "../../lib/company-google-sheets-env.js";
import { getSpreadsheetMetadata, getWorksheetGridBounds } from "../google-sheets/google-sheets-http-client.js";
import { getSheetValues, quoteSheetTitle } from "../company-sheets-dispatch/company-sheets-onboarding-read.js";
import {
  classifyExactV3Grid,
  gridBoundsFrom,
  gridRange,
  historicalDataRowsFromProof,
  type GridBounds,
} from "./onboarding-test-grid.js";
import {
  establishControl,
  loadReadyConnection,
  type CompanySheetsDeps,
} from "../company-google/company-sheets-destination.service.js";
import type { WorksheetHeaderRead } from "./onboarding-config.service.js";

type HeaderReaderDeps = CompanySheetsDeps & {
  getValues?: typeof getSheetValues;
};

export type ExplicitWorksheetTarget = {
  spreadsheetId: string;
  worksheetId: number;
};

export type OnboardingSheetReread = {
  header: string[];
  headerSha256: string;
  control: { establishControl: string; checkedAt: string } | null;
  ownerClientAccountId: string;
  destinationRevision: number;
  historicalDataRows: "empty" | "has_rows" | "truncated" | "unproven";
};

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function explicitTarget(target: ExplicitWorksheetTarget | null | undefined): ExplicitWorksheetTarget | null {
  if (!target) return null;
  const spreadsheetId = target.spreadsheetId.trim();
  if (!spreadsheetId || spreadsheetId.length > 200) return null;
  if (!Number.isInteger(target.worksheetId) || target.worksheetId < 0) return null;
  return { spreadsheetId, worksheetId: target.worksheetId };
}

/**
 * Reads one worksheet the caller named. A missing id returns null.
 * Another client's destination spreadsheet returns null before Google is called.
 */
export async function readExplicitOnboardingTestWorksheetHeader(
  clientAccountId: string,
  target: ExplicitWorksheetTarget | null | undefined,
  deps: HeaderReaderDeps = {}
): Promise<WorksheetHeaderRead | null> {
  const chosen = explicitTarget(target);
  if (!chosen) return null;
  const env = deps.env ?? process.env;
  if (!isCompanyGoogleSheetsEnabled(env)) return null;
  const db = deps.db ?? prisma;
  const clientId = clientAccountId.trim();
  if (!clientId) return null;
  const otherOwner = await db.companySheetsDestination.findFirst({
    where: { spreadsheetId: chosen.spreadsheetId, clientAccountId: { not: clientId } },
    select: { id: true },
  });
  if (otherOwner) return null;
  const otherWorksheet = await db.clientOnboardingTestWorksheet.findFirst({
    where: {
      spreadsheetId: chosen.spreadsheetId,
      worksheetId: chosen.worksheetId,
      clientAccountId: { not: clientId },
    },
    select: { id: true },
  });
  if (otherWorksheet) return null;
  const ready = await loadReadyConnection({ ...deps, env, db });
  if (!ready.ok) return null;
  const metadataResult = await (deps.getMetadata ?? getSpreadsheetMetadata)(
    { spreadsheetId: chosen.spreadsheetId, accessToken: ready.accessToken },
    deps.fetchImpl
  );
  if (!metadataResult.ok) return null;
  const worksheet = metadataResult.metadata.worksheets.find((sheet) => sheet.sheetId === chosen.worksheetId);
  if (!worksheet || worksheet.sheetType !== "GRID") return null;
  const read = await (deps.getValues ?? getSheetValues)(
    {
      spreadsheetId: chosen.spreadsheetId,
      range: `${quoteSheetTitle(worksheet.title)}!A1:ZZ1`,
      accessToken: ready.accessToken,
    },
    deps.fetchImpl
  );
  if (!read.ok) return null;
  const bounds = await gridBoundsFor(worksheet, chosen.spreadsheetId, ready.accessToken, deps);
  const formula = bounds
    ? await (deps.getValues ?? getSheetValues)(
        {
          spreadsheetId: chosen.spreadsheetId,
          range: `${quoteSheetTitle(worksheet.title)}!${gridRange(bounds)}`,
          accessToken: ready.accessToken,
          valueRenderOption: "FORMULA",
        },
        deps.fetchImpl
      )
    : null;
  const proof = classifyExactV3Grid(bounds, formula && formula.ok ? formula.values : null);
  const historicalDataRows = historicalDataRowsFromProof(proof);
  const control = await establishControl(
    {
      connection: ready.connection,
      accessToken: ready.accessToken,
      spreadsheetId: chosen.spreadsheetId,
      metadata: metadataResult.metadata,
    },
    { ...deps, env, db }
  );
  const own = await db.companySheetsDestination.findUnique({
    where: { clientAccountId: clientId },
    select: { spreadsheetId: true, destinationRevision: true },
  });
  const destinationRevision = own && own.spreadsheetId === chosen.spreadsheetId ? own.destinationRevision : 1;
  return {
    spreadsheetId: chosen.spreadsheetId,
    worksheetId: chosen.worksheetId,
    worksheetTitle: worksheet.title,
    header: read.values[0] ?? [],
    control: {
      establishControl: control.ok ? control.controlBasis : control.code,
      checkedAt: new Date().toISOString(),
    },
    destinationRevision,
    historicalDataRows,
  };
}

async function gridBoundsFor(
  worksheet: { sheetId: number; rowCount?: number; columnCount?: number },
  spreadsheetId: string,
  accessToken: string,
  deps: HeaderReaderDeps
): Promise<GridBounds | null> {
  const declared = gridBoundsFrom(worksheet.rowCount, worksheet.columnCount);
  if (declared) return declared;
  const fetched = await getWorksheetGridBounds({ spreadsheetId, accessToken }, deps.fetchImpl);
  if (!fetched.ok) return null;
  const match = fetched.worksheets.find((sheet) => sheet.sheetId === worksheet.sheetId);
  return match ? gridBoundsFrom(match.rowCount, match.columnCount) : null;
}

export function createOnboardingTestWorksheetHeaderReader(
  deps: HeaderReaderDeps = {}
): (clientAccountId: string, target?: ExplicitWorksheetTarget | null) => Promise<WorksheetHeaderRead | null> {
  return (clientAccountId, target) => readExplicitOnboardingTestWorksheetHeader(clientAccountId, target, deps);
}

/**
 * Execute-time row-1 reread for Agent E's captured-test `rereadSheet` option.
 * The sheet id comes from the planned snapshot. A failed read returns null.
 */
export async function rereadOnboardingCapturedTestSheet(
  sheet: {
    spreadsheetId: string;
    worksheetId: number;
    ownerClientAccountId: string;
  },
  deps: HeaderReaderDeps = {}
): Promise<OnboardingSheetReread | null> {
  const db: PrismaClient = deps.db ?? prisma;
  const approved = await db.clientOnboardingTestWorksheet.findUnique({
    where: { clientAccountId: sheet.ownerClientAccountId },
  });
  if (
    !approved ||
    approved.clientAccountId !== sheet.ownerClientAccountId ||
    approved.spreadsheetId !== sheet.spreadsheetId ||
    approved.worksheetId !== sheet.worksheetId
  ) {
    return null;
  }
  const header = await readExplicitOnboardingTestWorksheetHeader(
    sheet.ownerClientAccountId,
    { spreadsheetId: sheet.spreadsheetId, worksheetId: sheet.worksheetId },
    deps
  );
  if (!header) return null;
  return {
    header: header.header,
    headerSha256: sha256(JSON.stringify(header.header)),
    control: header.control,
    ownerClientAccountId: approved.clientAccountId,
    destinationRevision: approved.destinationRevision,
    historicalDataRows: header.historicalDataRows,
  };
}
