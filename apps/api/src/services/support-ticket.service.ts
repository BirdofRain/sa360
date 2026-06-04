import type { Prisma, SupportTicket } from "@prisma/client";

import { prisma } from "../lib/db.js";
import {
  CLOSED_SUPPORT_STATUSES,
  DEFAULT_SUPPORT_TICKET_CATEGORY,
  DEFAULT_SUPPORT_TICKET_PRIORITY,
  DEFAULT_SUPPORT_TICKET_STATUS,
} from "../lib/support-ticket.constants.js";
import {
  appendInternalNote,
  normalizeSupportTicketCategory,
  normalizeSupportTicketPriority,
  normalizeSupportTicketStatus,
} from "../lib/support-ticket.validation.js";
import type {
  SupportTicketCreateBody,
  SupportTicketListQuery,
  SupportTicketUpdateBody,
} from "../schemas/support-ticket.schema.js";

export type SupportTicketDto = ReturnType<typeof serializeSupportTicket>;

export function serializeSupportTicket(row: SupportTicket) {
  return {
    id: row.id,
    ticketNumber: row.ticketNumber,
    source: row.source,
    status: row.status,
    priority: row.priority,
    category: row.category,
    subject: row.subject,
    description: row.description,
    requesterName: row.requesterName,
    requesterEmail: row.requesterEmail,
    requesterUserId: row.requesterUserId,
    assignedToName: row.assignedToName,
    assignedToUserId: row.assignedToUserId,
    clientAccountId: row.clientAccountId,
    masterClientAccountId: row.masterClientAccountId,
    subaccountIdGhl: row.subaccountIdGhl,
    relatedEntityType: row.relatedEntityType,
    relatedEntityId: row.relatedEntityId,
    pagePath: row.pagePath,
    pageUrl: row.pageUrl,
    queryJson: row.queryJson,
    contextJson: row.contextJson,
    userAgent: row.userAgent,
    internalNotes: row.internalNotes,
    resolutionSummary: row.resolutionSummary,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    closedAt: row.closedAt ? row.closedAt.toISOString() : null,
  };
}

export function serializeSupportTicketSummary(row: SupportTicket) {
  return {
    id: row.id,
    ticketNumber: row.ticketNumber,
    status: row.status,
    priority: row.priority,
    category: row.category,
    subject: row.subject,
    descriptionPreview: row.description.length > 120 ? `${row.description.slice(0, 120)}…` : row.description,
    clientAccountId: row.clientAccountId,
    masterClientAccountId: row.masterClientAccountId,
    relatedEntityType: row.relatedEntityType,
    relatedEntityId: row.relatedEntityId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function createSupportTicket(body: SupportTicketCreateBody): Promise<SupportTicket> {
  return prisma.supportTicket.create({
    data: {
      source: "admin_coc",
      status: DEFAULT_SUPPORT_TICKET_STATUS,
      priority: normalizeSupportTicketPriority(body.priority),
      category: normalizeSupportTicketCategory(body.category),
      subject: body.subject ?? null,
      description: body.description,
      requesterName: body.requesterName ?? null,
      requesterEmail: body.requesterEmail ?? null,
      requesterUserId: body.requesterUserId ?? null,
      clientAccountId: body.clientAccountId ?? null,
      masterClientAccountId: body.masterClientAccountId ?? null,
      subaccountIdGhl: body.subaccountIdGhl ?? null,
      relatedEntityType: body.relatedEntityType ?? null,
      relatedEntityId: body.relatedEntityId ?? null,
      pagePath: body.pagePath ?? null,
      pageUrl: body.pageUrl ?? null,
      queryJson: body.queryJson as Prisma.InputJsonValue | undefined,
      contextJson: body.contextJson as Prisma.InputJsonValue | undefined,
      userAgent: body.userAgent ?? null,
    },
  });
}

function buildListWhere(q: SupportTicketListQuery): Prisma.SupportTicketWhereInput {
  const where: Prisma.SupportTicketWhereInput = {};
  if (q.status) where.status = q.status;
  if (q.priority) where.priority = q.priority;
  if (q.category) where.category = q.category;
  if (q.clientAccountId) where.clientAccountId = q.clientAccountId;
  if (q.masterClientAccountId) where.masterClientAccountId = q.masterClientAccountId;
  if (q.search) {
    const s = q.search;
    where.OR = [
      { subject: { contains: s, mode: "insensitive" } },
      { description: { contains: s, mode: "insensitive" } },
      ...(Number.isFinite(Number(s)) ? [{ ticketNumber: Number(s) }] : []),
    ];
  }
  return where;
}

export async function listSupportTickets(q: SupportTicketListQuery) {
  const where = buildListWhere(q);
  const skip = (q.page - 1) * q.limit;
  const [items, total] = await Promise.all([
    prisma.supportTicket.findMany({
      where,
      orderBy: [{ createdAt: "desc" }],
      skip,
      take: q.limit,
    }),
    prisma.supportTicket.count({ where }),
  ]);
  return { items, total, page: q.page, limit: q.limit };
}

export async function getSupportTicketById(id: string): Promise<SupportTicket | null> {
  return prisma.supportTicket.findUnique({ where: { id } });
}

export async function updateSupportTicket(
  id: string,
  body: SupportTicketUpdateBody,
  now = new Date()
): Promise<SupportTicket | null> {
  const existing = await prisma.supportTicket.findUnique({ where: { id } });
  if (!existing) return null;

  const data: Prisma.SupportTicketUpdateInput = {};
  if (body.status !== undefined) {
    const status = normalizeSupportTicketStatus(body.status);
    data.status = status;
    if (CLOSED_SUPPORT_STATUSES.has(status as never)) {
      data.closedAt = existing.closedAt ?? now;
    } else {
      data.closedAt = null;
    }
  }
  if (body.priority !== undefined) data.priority = normalizeSupportTicketPriority(body.priority);
  if (body.category !== undefined) data.category = normalizeSupportTicketCategory(body.category);
  if (body.assignedToName !== undefined) data.assignedToName = body.assignedToName ?? null;
  if (body.assignedToUserId !== undefined) data.assignedToUserId = body.assignedToUserId ?? null;
  if (body.resolutionSummary !== undefined) data.resolutionSummary = body.resolutionSummary ?? null;
  if (body.internalNote !== undefined) {
    data.internalNotes = appendInternalNote(
      existing.internalNotes,
      body.internalNote,
      body.internalNoteBy ?? "admin",
      now
    );
  }

  return prisma.supportTicket.update({ where: { id }, data });
}

export async function getSupportTicketStats(now = new Date()) {
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const [open, inProgress, waiting, resolvedRecent] = await Promise.all([
    prisma.supportTicket.count({ where: { status: "OPEN" } }),
    prisma.supportTicket.count({ where: { status: "IN_PROGRESS" } }),
    prisma.supportTicket.count({ where: { status: "WAITING_ON_USER" } }),
    prisma.supportTicket.count({
      where: {
        status: "RESOLVED",
        updatedAt: { gte: sevenDaysAgo },
      },
    }),
  ]);
  return { open, inProgress, waiting, resolvedRecent };
}

/** For tests — ensure defaults applied when invalid enum strings slip through. */
export function applySupportTicketDefaults(input: {
  status?: string;
  priority?: string;
  category?: string;
}) {
  return {
    status: normalizeSupportTicketStatus(input.status),
    priority: normalizeSupportTicketPriority(input.priority),
    category: normalizeSupportTicketCategory(input.category ?? DEFAULT_SUPPORT_TICKET_CATEGORY),
  };
}
