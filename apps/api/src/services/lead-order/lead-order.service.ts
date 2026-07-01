import type { LeadOrderStatus, Prisma } from "@prisma/client";
import { Prisma as PrismaRuntime } from "@prisma/client";

import {
  createLeadOrderRecord,
  findLeadOrderById,
  listLeadOrders,
  nextLeadOrderNumber,
  updateLeadOrderRecord,
  type LeadOrderListFilters,
} from "../../repositories/lead-order.repository.js";
import { findClientAccountById } from "../../repositories/client-account.repository.js";
import type {
  LeadOrderAdminCreateBody,
  LeadOrderAdminUpdateBody,
  LeadOrderClientCreateBody,
} from "../../schemas/lead-order.schema.js";

export type LeadOrderServiceDeps = {
  listLeadOrdersImpl?: typeof listLeadOrders;
  findLeadOrderByIdImpl?: typeof findLeadOrderById;
  createLeadOrderRecordImpl?: typeof createLeadOrderRecord;
  updateLeadOrderRecordImpl?: typeof updateLeadOrderRecord;
  nextLeadOrderNumberImpl?: typeof nextLeadOrderNumber;
};

function statusTimestampPatch(
  nextStatus: LeadOrderStatus,
  now: Date
): Prisma.LeadOrderUpdateInput {
  const patch: Prisma.LeadOrderUpdateInput = { status: nextStatus };
  switch (nextStatus) {
    case "submitted":
      patch.submittedAt = now;
      break;
    case "ready":
      patch.approvedAt = now;
      break;
    case "active":
      patch.activatedAt = now;
      break;
    case "paused":
      patch.pausedAt = now;
      break;
    case "completed":
      patch.completedAt = now;
      break;
    case "canceled":
      patch.canceledAt = now;
      break;
    default:
      break;
  }
  return patch;
}

function parseRequestedStartDate(value: string | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function listLeadOrdersForAudience(
  filters: LeadOrderListFilters,
  deps: LeadOrderServiceDeps = {}
) {
  const list = deps.listLeadOrdersImpl ?? listLeadOrders;
  return list(filters);
}

export async function getLeadOrderForAudience(
  id: string,
  clientAccountId: string | undefined,
  deps: LeadOrderServiceDeps = {}
) {
  const find = deps.findLeadOrderByIdImpl ?? findLeadOrderById;
  const row = await find(id);
  if (!row) return null;
  if (clientAccountId && row.clientAccountId !== clientAccountId) return null;
  return row;
}

export async function createAdminLeadOrder(
  body: LeadOrderAdminCreateBody,
  deps: LeadOrderServiceDeps = {}
) {
  const nextNumber = deps.nextLeadOrderNumberImpl ?? nextLeadOrderNumber;
  const create = deps.createLeadOrderRecordImpl ?? createLeadOrderRecord;
  const now = new Date();
  const status = body.status ?? "submitted";

  return create({
    orderNumber: await nextNumber(),
    clientAccountId: body.clientAccountId,
    clientDisplayName: body.clientDisplayName ?? null,
    status,
    nicheKey: body.nicheKey,
    productType: body.productType ?? null,
    statesJson: body.states,
    leadVolume: body.leadVolume,
    deliveryCadence: body.deliveryCadence ?? null,
    campaignType: body.campaignType,
    crmPackage: body.crmPackage,
    aiVoiceAddon: body.aiVoiceAddon ?? false,
    requestedStartDate: parseRequestedStartDate(body.requestedStartDate),
    deliveryDestinationType: body.deliveryDestinationType ?? null,
    deliveryDestinationLabel: body.deliveryDestinationLabel,
    notes: body.notes ?? null,
    adminNotes: body.adminNotes ?? null,
    routingRuleId: body.routingRuleId ?? null,
    campaignId: body.campaignId ?? null,
    createdByRole: "admin",
    createdByUserId: body.createdByUserId ?? null,
    submittedAt: status === "submitted" || status !== "draft" ? now : null,
    ...(status === "active" ? { activatedAt: now } : {}),
    ...(status === "ready" ? { approvedAt: now } : {}),
  });
}

export async function createClientLeadOrder(
  body: LeadOrderClientCreateBody,
  clientAccountId: string,
  deps: LeadOrderServiceDeps = {}
) {
  const nextNumber = deps.nextLeadOrderNumberImpl ?? nextLeadOrderNumber;
  const create = deps.createLeadOrderRecordImpl ?? createLeadOrderRecord;
  const now = new Date();
  const account = await findClientAccountById(clientAccountId);
  const clientDisplayName = account?.clientDisplayName ?? null;

  return create({
    orderNumber: await nextNumber(),
    clientAccountId,
    clientDisplayName,
    status: "submitted",
    nicheKey: body.nicheKey,
    productType: body.productType ?? null,
    statesJson: body.states,
    leadVolume: body.leadVolume,
    deliveryCadence: body.deliveryCadence ?? null,
    campaignType: body.campaignType,
    crmPackage: body.crmPackage,
    aiVoiceAddon: body.aiVoiceAddon ?? false,
    requestedStartDate: parseRequestedStartDate(body.requestedStartDate),
    deliveryDestinationType: body.deliveryDestinationType ?? null,
    deliveryDestinationLabel: body.deliveryDestinationLabel,
    notes: body.notes ?? null,
    createdByRole: "client",
    createdByUserId: null,
    submittedAt: now,
  });
}

export async function updateAdminLeadOrder(
  id: string,
  body: LeadOrderAdminUpdateBody,
  deps: LeadOrderServiceDeps = {}
) {
  const find = deps.findLeadOrderByIdImpl ?? findLeadOrderById;
  const update = deps.updateLeadOrderRecordImpl ?? updateLeadOrderRecord;
  const existing = await find(id);
  if (!existing) return null;

  const patch: Prisma.LeadOrderUpdateInput = {};
  if (body.adminNotes !== undefined) patch.adminNotes = body.adminNotes ?? null;
  if (body.routingRuleId !== undefined) patch.routingRuleId = body.routingRuleId ?? null;
  if (body.campaignId !== undefined) patch.campaignId = body.campaignId ?? null;
  if (body.clientDisplayName !== undefined) {
    patch.clientDisplayName = body.clientDisplayName ?? null;
  }
  if (body.trustStatusSnapshot !== undefined) {
    patch.trustStatusSnapshotJson =
      body.trustStatusSnapshot === null
        ? PrismaRuntime.JsonNull
        : (body.trustStatusSnapshot as Prisma.InputJsonValue);
  }
  if (body.status !== undefined && body.status !== existing.status) {
    Object.assign(patch, statusTimestampPatch(body.status, new Date()));
  }

  return update(id, patch);
}
