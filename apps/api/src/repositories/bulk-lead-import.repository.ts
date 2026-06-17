import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../lib/db.js";

export async function createBulkLeadImport(
  data: Prisma.BulkLeadImportCreateInput,
  db: PrismaClient = prisma
) {
  return db.bulkLeadImport.create({ data });
}

export async function findBulkLeadImportById(id: string, db: PrismaClient = prisma) {
  return db.bulkLeadImport.findUnique({ where: { id } });
}

export async function findBulkLeadImportWithRows(id: string, db: PrismaClient = prisma) {
  return db.bulkLeadImport.findUnique({
    where: { id },
    include: {
      rows: { orderBy: { rowNumber: "asc" } },
    },
  });
}

export async function updateBulkLeadImport(
  id: string,
  data: Prisma.BulkLeadImportUpdateInput,
  db: PrismaClient = prisma
) {
  return db.bulkLeadImport.update({ where: { id }, data });
}

export async function listBulkLeadImports(
  opts: { limit?: number; cursor?: string },
  db: PrismaClient = prisma
) {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);
  const cursor = opts.cursor ? { id: opts.cursor } : undefined;
  const items = await db.bulkLeadImport.findMany({
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(cursor ? { cursor, skip: 1 } : {}),
  });
  const hasMore = items.length > limit;
  const page = hasMore ? items.slice(0, limit) : items;
  return { items: page, nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null };
}

export async function createBulkLeadImportRows(
  rows: Prisma.BulkLeadImportRowCreateManyInput[],
  db: PrismaClient = prisma
) {
  return db.bulkLeadImportRow.createMany({ data: rows });
}

export async function listBulkLeadImportRows(
  bulkImportId: string,
  filters?: {
    validationStatus?: Prisma.EnumBulkLeadImportRowValidationStatusFilter["equals"];
    deliveryStatus?: Prisma.EnumBulkLeadImportRowDeliveryStatusFilter["equals"];
    excluded?: boolean;
    limit?: number;
    offset?: number;
  },
  db: PrismaClient = prisma
) {
  const where: Prisma.BulkLeadImportRowWhereInput = { bulkImportId };
  if (filters?.validationStatus) where.validationStatus = filters.validationStatus;
  if (filters?.deliveryStatus) where.deliveryStatus = filters.deliveryStatus;
  if (filters?.excluded !== undefined) where.excluded = filters.excluded;

  return db.bulkLeadImportRow.findMany({
    where,
    orderBy: { rowNumber: "asc" },
    take: filters?.limit,
    skip: filters?.offset,
  });
}

export async function updateBulkLeadImportRow(
  id: string,
  data: Prisma.BulkLeadImportRowUpdateInput,
  db: PrismaClient = prisma
) {
  return db.bulkLeadImportRow.update({ where: { id }, data });
}

export async function countBulkLeadImportRowsByStatus(
  bulkImportId: string,
  db: PrismaClient = prisma
) {
  const groups = await db.bulkLeadImportRow.groupBy({
    by: ["validationStatus", "deliveryStatus", "excluded"],
    where: { bulkImportId },
    _count: { _all: true },
  });
  return groups;
}

export async function createBulkLeadImportMappingTemplate(
  data: Prisma.BulkLeadImportMappingTemplateCreateInput,
  db: PrismaClient = prisma
) {
  return db.bulkLeadImportMappingTemplate.create({ data });
}

export async function listBulkLeadImportMappingTemplates(db: PrismaClient = prisma) {
  return db.bulkLeadImportMappingTemplate.findMany({
    orderBy: [{ updatedAt: "desc" }],
    take: 100,
  });
}

export async function findBulkLeadImportMappingTemplateById(
  id: string,
  db: PrismaClient = prisma
) {
  return db.bulkLeadImportMappingTemplate.findUnique({ where: { id } });
}
