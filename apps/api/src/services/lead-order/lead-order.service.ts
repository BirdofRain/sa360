import type { LeadOrderStatus, Prisma } from "@prisma/client";
import { Prisma as PrismaRuntime } from "@prisma/client";
import {
  agedPplFulfillmentBlocker,
  availabilityInterestCampaignType,
  campaignTypeToAvailabilityOffering,
  canonicalizeCommerceNicheKey,
  isCommerceAgeBucketKey,
  mergeAvailabilityInterestIntoNotes,
  normalizePublicClientCampaignType,
  parseAvailabilityInterestFromNotes,
  preferCanonicalCommerceNicheKey,
} from "@sa360/shared";

import {
  countCommittedAllocationsByOrderIds,
  createLeadOrderRecord,
  findLeadOrderById,
  listLeadOrders,
  nextLeadOrderNumber,
  updateLeadOrderRecord,
  type LeadOrderListFilters,
  type mapLeadOrderRow,
} from "../../repositories/lead-order.repository.js";
import { findClientAccountById } from "../../repositories/client-account.repository.js";
import { isClientAccountReadyToOrder } from "../client-account-profile.present.js";
import type {
  LeadOrderAdminCreateBody,
  LeadOrderAdminUpdateBody,
  LeadOrderClientCreateBody,
} from "../../schemas/lead-order.schema.js";
import {
  assertCanActivateOrder,
  assertCanApproveOrder,
  assertCanCreateWithStatus,
  DEFAULT_LEAD_ORDER_PAYMENT_CONFIRMATION_STATUS,
  isAlreadyApprovedStatus,
  resolvePaymentConfirmationStatus,
  type LeadOrderLifecycleFailure,
  type LeadOrderPaymentConfirmationStatus,
} from "./lead-order-lifecycle.js";
type LeadOrderRecord = ReturnType<typeof mapLeadOrderRow>;

export type LeadOrderMutationSuccess = { ok: true; row: LeadOrderRecord };
export type LeadOrderMutationFailure =
  | { ok: false; notFound: true }
  | (LeadOrderLifecycleFailure & { notFound?: false });
export type LeadOrderMutationResult = LeadOrderMutationSuccess | LeadOrderMutationFailure;

export type LeadOrderServiceDeps = {
  listLeadOrdersImpl?: typeof listLeadOrders;
  findLeadOrderByIdImpl?: typeof findLeadOrderById;
  createLeadOrderRecordImpl?: typeof createLeadOrderRecord;
  updateLeadOrderRecordImpl?: typeof updateLeadOrderRecord;
  nextLeadOrderNumberImpl?: typeof nextLeadOrderNumber;
  findClientAccountByIdImpl?: typeof findClientAccountById;
  countCommittedAllocationsByOrderIdsImpl?: typeof countCommittedAllocationsByOrderIds;
};

type CountableLeadOrder = { id: string; committedAllocationCount?: number };

function existingCommittedCount(row: CountableLeadOrder): number {
  return typeof row.committedAllocationCount === "number" && Number.isFinite(row.committedAllocationCount)
    ? Math.max(0, Math.floor(row.committedAllocationCount))
    : 0;
}

export async function attachCommittedAllocationCounts<T extends CountableLeadOrder>(
  rows: T[],
  deps: LeadOrderServiceDeps = {}
): Promise<Array<T & { committedAllocationCount: number }>> {
  if (rows.length === 0) return [];
  if (
    !deps.countCommittedAllocationsByOrderIdsImpl &&
    (deps.listLeadOrdersImpl || deps.findLeadOrderByIdImpl)
  ) {
    return rows.map((row) => ({
      ...row,
      committedAllocationCount: existingCommittedCount(row),
    }));
  }
  const countFn = deps.countCommittedAllocationsByOrderIdsImpl ?? countCommittedAllocationsByOrderIds;
  const counts = await countFn(rows.map((row) => row.id));
  return rows.map((row) => ({
    ...row,
    committedAllocationCount: counts.get(row.id) ?? existingCommittedCount(row),
  }));
}

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

function lifecycleGuardForStatusChange(
  existing: {
    status: LeadOrderStatus;
    paymentConfirmationStatus?: LeadOrderPaymentConfirmationStatus | null;
  },
  nextStatus: LeadOrderStatus
): LeadOrderLifecycleFailure | null {
  if (nextStatus === "ready") {
    const check = assertCanApproveOrder({
      status: existing.status,
      paymentConfirmationStatus: resolvePaymentConfirmationStatus(
        existing.paymentConfirmationStatus
      ),
    });
    return check.ok ? null : check;
  }
  if (nextStatus === "active") {
    const check = assertCanActivateOrder({ status: existing.status });
    return check.ok ? null : check;
  }
  return null;
}

function paymentDecisionPatch(
  nextPayment: LeadOrderPaymentConfirmationStatus,
  existing: {
    paymentConfirmationStatus?: LeadOrderPaymentConfirmationStatus | null;
    paymentConfirmedAt?: Date | null;
    paymentConfirmedBy?: string | null;
  },
  confirmedBy: string | null,
  now: Date
): Prisma.LeadOrderUpdateInput | null {
  const current = resolvePaymentConfirmationStatus(existing.paymentConfirmationStatus);
  if (current === nextPayment) {
    return null;
  }
  return {
    paymentConfirmationStatus: nextPayment,
    paymentConfirmedAt: now,
    paymentConfirmedBy: confirmedBy,
  };
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

export async function listClientLeadOrders(
  filters: LeadOrderListFilters,
  deps: LeadOrderServiceDeps = {}
) {
  const result = await listLeadOrdersForAudience(filters, deps);
  return {
    items: await attachCommittedAllocationCounts(result.items, deps),
    nextCursor: result.nextCursor,
  };
}

export async function getClientLeadOrder(
  id: string,
  clientAccountId: string | undefined,
  deps: LeadOrderServiceDeps = {}
) {
  const row = await getLeadOrderForAudience(id, clientAccountId, deps);
  if (!row) return null;
  const [hydrated] = await attachCommittedAllocationCounts([row], deps);
  return hydrated ?? null;
}

export async function createAdminLeadOrder(
  body: LeadOrderAdminCreateBody,
  deps: LeadOrderServiceDeps = {}
): Promise<LeadOrderMutationResult> {
  const nextNumber = deps.nextLeadOrderNumberImpl ?? nextLeadOrderNumber;
  const create = deps.createLeadOrderRecordImpl ?? createLeadOrderRecord;
  const now = new Date();
  const status = body.status ?? "submitted";
  const createGuard = assertCanCreateWithStatus({ status });
  if (!createGuard.ok) return createGuard;

  const row = await create({
    orderNumber: await nextNumber(),
    clientAccountId: body.clientAccountId,
    clientDisplayName: body.clientDisplayName ?? null,
    status,
    nicheKey: preferCanonicalCommerceNicheKey(body.nicheKey),
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
    paymentConfirmationStatus: DEFAULT_LEAD_ORDER_PAYMENT_CONFIRMATION_STATUS,
  });
  return { ok: true, row };
}

export const CLIENT_LEAD_ORDER_ACCOUNT_NOT_READY = "ACCOUNT_NOT_READY_TO_ORDER";
export const CLIENT_LEAD_ORDER_INTEREST_REQUIRED = "AVAILABILITY_INTEREST_REQUIRED";
export const CLIENT_LEAD_ORDER_UNSUPPORTED_CAMPAIGN = "UNSUPPORTED_CAMPAIGN_TYPE";
export const CLIENT_LEAD_ORDER_UNSUPPORTED_NICHE = "UNSUPPORTED_COMMERCE_NICHE";
export const CLIENT_LEAD_ORDER_AGED_OPTIONS_REQUIRED = "AGED_COMMERCE_OPTIONS_REQUIRED";

const CLIENT_AGED_OPTIONS_MARKER = "sa360.portalAgedOptions.v1";
const CLIENT_SHORTFALL_POLICIES = new Set([
  "REFUND_UNFILLED",
  "ALLOW_OLDER_WITH_PRICE_ADJUSTMENT",
]);

export const CLIENT_LEAD_ORDER_VALIDATION_CODES = [
  CLIENT_LEAD_ORDER_INTEREST_REQUIRED,
  CLIENT_LEAD_ORDER_UNSUPPORTED_CAMPAIGN,
  CLIENT_LEAD_ORDER_UNSUPPORTED_NICHE,
  CLIENT_LEAD_ORDER_AGED_OPTIONS_REQUIRED,
] as const;

export type ClientLeadOrderValidationCode = (typeof CLIENT_LEAD_ORDER_VALIDATION_CODES)[number];

export type ClientLeadOrderCreateResult =
  | LeadOrderMutationSuccess
  | {
      ok: false;
      code: typeof CLIENT_LEAD_ORDER_ACCOUNT_NOT_READY | ClientLeadOrderValidationCode;
      error: string;
    };

function readClientAgedCommerceOptions(notes: string | null | undefined): {
  requestedAgeBucket: string | null;
  shortfallPolicy: string | null;
} {
  const empty = { requestedAgeBucket: null, shortfallPolicy: null };
  if (!notes) return empty;
  const markerIndex = notes.indexOf(CLIENT_AGED_OPTIONS_MARKER);
  if (markerIndex < 0) return empty;
  const jsonMatch = notes.slice(markerIndex + CLIENT_AGED_OPTIONS_MARKER.length).match(/\{[\s\S]*?\}/);
  if (!jsonMatch) return empty;
  try {
    const parsed: unknown = JSON.parse(jsonMatch[0]);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return empty;
    const raw = parsed as Record<string, unknown>;
    const bucket = typeof raw.requestedAgeBucket === "string" ? raw.requestedAgeBucket.trim() : "";
    const shortfall = typeof raw.shortfallPolicy === "string" ? raw.shortfallPolicy.trim() : "";
    return {
      requestedAgeBucket: isCommerceAgeBucketKey(bucket) ? bucket : null,
      shortfallPolicy: CLIENT_SHORTFALL_POLICIES.has(shortfall) ? shortfall : null,
    };
  } catch {
    return empty;
  }
}

/** Raw client payload. Catalog checks run here even when a caller bypasses Zod. */
export type ClientLeadOrderCreateInput = Omit<
  LeadOrderClientCreateBody,
  "campaignType" | "nicheKey"
> & {
  campaignType: string;
  nicheKey: string;
};

export async function createClientLeadOrder(
  body: ClientLeadOrderCreateInput,
  clientAccountId: string,
  deps: LeadOrderServiceDeps = {}
): Promise<ClientLeadOrderCreateResult> {
  const nextNumber = deps.nextLeadOrderNumberImpl ?? nextLeadOrderNumber;
  const create = deps.createLeadOrderRecordImpl ?? createLeadOrderRecord;
  const findAccount = deps.findClientAccountByIdImpl ?? findClientAccountById;
  const now = new Date();
  const account = await findAccount(clientAccountId);
  if (!account || !isClientAccountReadyToOrder(account.status)) {
    return {
      ok: false,
      code: CLIENT_LEAD_ORDER_ACCOUNT_NOT_READY,
      error: "This account is not ready to place an order.",
    };
  }

  const publicCampaign = normalizePublicClientCampaignType(body.campaignType);
  if (!publicCampaign) {
    return {
      ok: false,
      code: CLIENT_LEAD_ORDER_UNSUPPORTED_CAMPAIGN,
      error: "Choose Aged leads, Fresh leads, or Live transfer.",
    };
  }
  const nicheKey = canonicalizeCommerceNicheKey(body.nicheKey);
  if (!nicheKey) {
    return {
      ok: false,
      code: CLIENT_LEAD_ORDER_UNSUPPORTED_NICHE,
      error: "Choose Veteran, Nurse, or Trucker.",
    };
  }

  const offering = campaignTypeToAvailabilityOffering(publicCampaign);
  const existingInterest = parseAvailabilityInterestFromNotes(body.notes);
  let notes = body.notes ?? null;
  let adminNotes: string | null = null;
  let campaignType: string = publicCampaign;
  if (offering) {
    if (!existingInterest || existingInterest.requestedOffering !== offering) {
      return {
        ok: false,
        code: CLIENT_LEAD_ORDER_INTEREST_REQUIRED,
        error: "Check the box to be notified when this becomes available.",
      };
    }
    notes = mergeAvailabilityInterestIntoNotes(body.notes ?? "", {
      requestedOffering: offering,
      notifyWhenAvailable: true,
      capturedAt: now.toISOString(),
    });
    adminNotes =
      "Interest / Coming soon. Notify when available: Yes. Not an aged lead order — do not activate, reserve, or export.";
    campaignType = availabilityInterestCampaignType(offering);
  } else {
    const aged = readClientAgedCommerceOptions(notes);
    if (!aged.requestedAgeBucket || !aged.shortfallPolicy) {
      return {
        ok: false,
        code: CLIENT_LEAD_ORDER_AGED_OPTIONS_REQUIRED,
        error: "Choose an age bucket and a shortfall preference.",
      };
    }
  }

  const row = await create({
    orderNumber: await nextNumber(),
    clientAccountId,
    clientDisplayName: account.clientDisplayName ?? null,
    status: "submitted",
    nicheKey,
    productType: body.productType ?? null,
    statesJson: body.states,
    leadVolume: body.leadVolume,
    deliveryCadence: body.deliveryCadence ?? null,
    campaignType,
    crmPackage: body.crmPackage,
    aiVoiceAddon: body.aiVoiceAddon ?? false,
    requestedStartDate: parseRequestedStartDate(body.requestedStartDate),
    deliveryDestinationType: body.deliveryDestinationType ?? null,
    deliveryDestinationLabel: body.deliveryDestinationLabel,
    notes,
    adminNotes,
    createdByRole: "client",
    createdByUserId: null,
    submittedAt: now,
    paymentConfirmationStatus: DEFAULT_LEAD_ORDER_PAYMENT_CONFIRMATION_STATUS,
  });
  return { ok: true, row };
}

export async function updateAdminLeadOrder(
  id: string,
  body: LeadOrderAdminUpdateBody,
  deps: LeadOrderServiceDeps = {}
): Promise<LeadOrderMutationResult> {
  const find = deps.findLeadOrderByIdImpl ?? findLeadOrderById;
  const update = deps.updateLeadOrderRecordImpl ?? updateLeadOrderRecord;
  const existing = await find(id);
  if (!existing) return { ok: false, notFound: true };

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
    if (
      (body.status === "ready" || body.status === "active") &&
      agedPplFulfillmentBlocker(existing)
    ) {
      return {
        ok: false,
        error: "availability_interest_only",
        reasons: ["availability_interest_only", "interest_only_not_fulfillable"],
      };
    }
    const guard = lifecycleGuardForStatusChange(existing, body.status);
    if (guard) return guard;
    Object.assign(patch, statusTimestampPatch(body.status, new Date()));
  }

  const row = await update(id, patch);
  return { ok: true, row };
}

export async function confirmLeadOrderPayment(
  id: string,
  confirmedBy: string | null = null,
  deps: LeadOrderServiceDeps = {}
): Promise<LeadOrderMutationResult> {
  return applyPaymentDecision(id, "confirmed", confirmedBy, deps);
}

export async function markLeadOrderPaymentNotRequired(
  id: string,
  confirmedBy: string | null = null,
  deps: LeadOrderServiceDeps = {}
): Promise<LeadOrderMutationResult> {
  return applyPaymentDecision(id, "not_required", confirmedBy, deps);
}

async function applyPaymentDecision(
  id: string,
  nextPayment: LeadOrderPaymentConfirmationStatus,
  confirmedBy: string | null,
  deps: LeadOrderServiceDeps
): Promise<LeadOrderMutationResult> {
  const find = deps.findLeadOrderByIdImpl ?? findLeadOrderById;
  const update = deps.updateLeadOrderRecordImpl ?? updateLeadOrderRecord;
  const existing = await find(id);
  if (!existing) return { ok: false, notFound: true };

  const patch = paymentDecisionPatch(nextPayment, existing, confirmedBy, new Date());
  if (!patch) return { ok: true, row: existing };

  const row = await update(id, patch);
  return { ok: true, row };
}

export async function approveLeadOrder(
  id: string,
  deps: LeadOrderServiceDeps = {}
): Promise<LeadOrderMutationResult> {
  const find = deps.findLeadOrderByIdImpl ?? findLeadOrderById;
  const update = deps.updateLeadOrderRecordImpl ?? updateLeadOrderRecord;
  const existing = await find(id);
  if (!existing) return { ok: false, notFound: true };
  if (agedPplFulfillmentBlocker(existing)) {
    return {
      ok: false,
      error: "availability_interest_only",
      reasons: ["availability_interest_only", "interest_only_not_fulfillable"],
    };
  }

  const paymentConfirmationStatus = resolvePaymentConfirmationStatus(
    existing.paymentConfirmationStatus
  );
  const check = assertCanApproveOrder({
    status: existing.status,
    paymentConfirmationStatus,
  });
  if (!check.ok) return check;

  if (existing.status === "ready" || isAlreadyApprovedStatus(existing.status)) {
    return { ok: true, row: existing };
  }

  const row = await update(id, statusTimestampPatch("ready", new Date()));
  return { ok: true, row };
}
