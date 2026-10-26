import type { CompanySheetsDestination, CompanySpreadsheetCreation, PrismaClient } from "@prisma/client";

import { prisma } from "../lib/db.js";

export async function findClientForCompanySheets(clientAccountId: string, db: PrismaClient = prisma) {
  const id = clientAccountId.trim();
  if (!id) return null;
  return db.clientAccount.findUnique({
    where: { clientAccountId: id },
    select: { clientAccountId: true, clientDisplayName: true },
  });
}

export async function findCompanySpreadsheetCreation(spreadsheetId: string, db: PrismaClient = prisma) {
  const id = spreadsheetId.trim();
  if (!id) return null;
  return db.companySpreadsheetCreation.findUnique({ where: { spreadsheetId: id } });
}

export async function insertCompanySpreadsheetCreation(
  data: {
    companyConnectionId: string;
    spreadsheetId: string;
    spreadsheetTitle: string;
    spreadsheetUrl: string;
    worksheetId: number;
    worksheetTitle: string;
    folderId: string | null;
    folderPlacement: string;
    createdByActor: string | null;
  },
  db: PrismaClient = prisma
): Promise<CompanySpreadsheetCreation> {
  return db.companySpreadsheetCreation.create({
    data: {
      companyConnectionId: data.companyConnectionId,
      spreadsheetId: data.spreadsheetId,
      spreadsheetTitle: data.spreadsheetTitle,
      spreadsheetUrl: data.spreadsheetUrl,
      worksheetId: data.worksheetId,
      worksheetTitle: data.worksheetTitle,
      folderId: data.folderId,
      folderPlacement: data.folderPlacement,
      createdByActor: data.createdByActor,
    },
  });
}

export async function findCompanySheetsDestinationByClient(
  clientAccountId: string,
  db: PrismaClient = prisma
) {
  const id = clientAccountId.trim();
  if (!id) return null;
  return db.companySheetsDestination.findUnique({ where: { clientAccountId: id } });
}

export async function findCompanySheetsDestinationBySpreadsheet(
  spreadsheetId: string,
  db: PrismaClient = prisma
) {
  const id = spreadsheetId.trim();
  if (!id) return null;
  return db.companySheetsDestination.findUnique({ where: { spreadsheetId: id } });
}

export type CompanySheetsDestinationWrite = {
  clientAccountId: string;
  companyConnectionId: string;
  spreadsheetId: string;
  spreadsheetTitle: string | null;
  spreadsheetUrl: string;
  worksheetId: number;
  worksheetTitle: string;
  controlBasis: string;
  companySpreadsheetCreationId: string | null;
  accessStatus: string;
  accessCheckedAt: Date;
  sharingStatus: string;
  intendedRecipientEmail: string | null;
  createdByActor: string | null;
};

export async function saveCompanySheetsDestination(
  input: CompanySheetsDestinationWrite,
  db: PrismaClient = prisma
): Promise<
  | { ok: true; row: CompanySheetsDestination }
  | { ok: false; reason: "spreadsheet_bound_to_other_client" | "destination_conflict" }
> {
  try {
    const row = await db.$transaction(async (tx) => {
      const other = await tx.companySheetsDestination.findUnique({
        where: { spreadsheetId: input.spreadsheetId },
      });
      if (other && other.clientAccountId !== input.clientAccountId) {
        return { conflict: "spreadsheet" as const };
      }
      const existing = await tx.companySheetsDestination.findUnique({
        where: { clientAccountId: input.clientAccountId },
      });
      const data = {
        companyConnectionId: input.companyConnectionId,
        spreadsheetId: input.spreadsheetId,
        spreadsheetTitle: input.spreadsheetTitle,
        spreadsheetUrl: input.spreadsheetUrl,
        worksheetId: input.worksheetId,
        worksheetTitle: input.worksheetTitle,
        controlBasis: input.controlBasis,
        companySpreadsheetCreationId: input.companySpreadsheetCreationId,
        accessStatus: input.accessStatus,
        accessCheckedAt: input.accessCheckedAt,
        writeReadiness: "not_verified",
        deliveryExecution: "disabled",
        sharingStatus: input.sharingStatus,
        intendedRecipientEmail: input.intendedRecipientEmail,
        enabled: false,
        createdByActor: input.createdByActor,
      };
      const now = new Date();
      if (existing && existing.spreadsheetId !== input.spreadsheetId) {
        await tx.companySheetsTabContract.deleteMany({ where: { destinationId: existing.id } });
        const prior = await tx.companySheetsSpreadsheetLink.findFirst({
          where: { clientAccountId: input.clientAccountId, spreadsheetId: existing.spreadsheetId },
        });
        if (!prior) {
          // No link event was stored for the previous spreadsheet. updatedAt is
          // the destination row's last change, so this row is inferred.
          await tx.companySheetsSpreadsheetLink.create({
            data: {
              clientAccountId: input.clientAccountId,
              spreadsheetId: existing.spreadsheetId,
              spreadsheetTitle: existing.spreadsheetTitle,
              spreadsheetUrl: existing.spreadsheetUrl,
              status: "inferred",
              recordedAt: existing.updatedAt,
              supersededAt: now,
            },
          });
        }
      }
      await tx.companySheetsSpreadsheetLink.updateMany({
        where: {
          clientAccountId: input.clientAccountId,
          status: "current",
          spreadsheetId: { not: input.spreadsheetId },
        },
        data: { status: "previous", supersededAt: now },
      });
      const currentLink = await tx.companySheetsSpreadsheetLink.findFirst({
        where: {
          clientAccountId: input.clientAccountId,
          spreadsheetId: input.spreadsheetId,
          status: "current",
        },
      });
      if (!currentLink) {
        await tx.companySheetsSpreadsheetLink.create({
          data: {
            clientAccountId: input.clientAccountId,
            spreadsheetId: input.spreadsheetId,
            spreadsheetTitle: input.spreadsheetTitle,
            spreadsheetUrl: input.spreadsheetUrl,
            status: "current",
            recordedAt: now,
          },
        });
      }
      if (existing) {
        return tx.companySheetsDestination.update({
          where: { id: existing.id },
          data: { ...data, destinationRevision: { increment: 1 } },
        });
      }
      return tx.companySheetsDestination.create({
        data: { clientAccountId: input.clientAccountId, ...data },
      });
    });
    if (row && "conflict" in row) {
      return { ok: false, reason: "spreadsheet_bound_to_other_client" };
    }
    return { ok: true, row };
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "P2002") return { ok: false, reason: "destination_conflict" };
    throw err;
  }
}

export async function updateCompanySheetsAccess(
  input: { clientAccountId: string; accessStatus: string; accessCheckedAt: Date },
  db: PrismaClient = prisma
) {
  const existing = await findCompanySheetsDestinationByClient(input.clientAccountId, db);
  if (!existing) return null;
  return db.companySheetsDestination.update({
    where: { id: existing.id },
    data: {
      accessStatus: input.accessStatus,
      accessCheckedAt: input.accessCheckedAt,
      writeReadiness: "not_verified",
      deliveryExecution: "disabled",
      enabled: false,
    },
  });
}

export async function deleteCompanySheetsDestination(clientAccountId: string, db: PrismaClient = prisma) {
  const existing = await findCompanySheetsDestinationByClient(clientAccountId, db);
  if (!existing) return false;
  await db.companySheetsDestination.delete({ where: { id: existing.id } });
  return true;
}
