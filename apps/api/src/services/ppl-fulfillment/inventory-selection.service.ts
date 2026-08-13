import type {
  InventoryLot,
  LeadInventoryItem,
  Prisma,
  PrismaClient,
  SourceLeadEvent,
} from "@prisma/client";
import { Prisma as PrismaNamespace } from "@prisma/client";

import { prisma } from "../../lib/db.js";
import { fingerprintIdentityValue } from "../../lib/identity-fingerprint.js";
import { readNormalizedLeadIdentity } from "../../lib/normalized-lead-identity.js";
import {
  INVENTORY_CHANGED_RETRY_REASON,
  isPrismaSerializableConflict,
} from "../../lib/prisma-serializable-conflict.js";
import { findLeadOrderById } from "../../repositories/lead-order.repository.js";
import { buildReservationIdempotencyKey } from "../fulfillment-execution/fulfillment-execution-keys.js";
import { reserveLeadAllocationAtomicTx } from "../fulfillment-execution/reservation.service.js";
import { calculateInventoryAgeDays } from "../lead-inventory/lead-inventory-age.js";
import {
  type CommerceAgeBucketKey,
  type CommerceAgeBucketRequestKey,
  expandCommerceAgeBucketRanges,
  generatedAtFilterForCommerceAgeRanges,
  parseCommerceAgeBucketKeys,
  resolveCommerceAgeBucketKey,
} from "./commerce-age-buckets.js";
import {
  computePartialFulfillmentEconomics,
  type PartialFulfillmentEconomics,
} from "./partial-fulfillment-economics.js";
import { resolveSelectionCommerceBuckets } from "./priced-bucket-enforcement.js";
import { loadPricedPplOrderLine } from "./ppl-order-pricing.js";
import {
  isItemExcludedByProtectedAgents,
  listActiveExclusions,
  type ProtectedAgentExclusionRecord,
} from "./protected-agent-exclusion.service.js";

export const PPL_ALLOCATION_POLICY_VERSION = "ppl-aged-inventory-selection-v1";
/** Production minimum requested quantity for PPL selection (no commercial floor). */
export const PPL_PRODUCTION_MIN_QTY = 1;

/** Ordered candidate page size for bounded inventory scans. */
export const PPL_SELECTION_PAGE_SIZE = 250;
/** Hard ceiling on inventory rows scanned per selection (preview/commit/replacement). */
export const PPL_SELECTION_MAX_SCANNED_ROWS = 5_000;
/**
 * Extra eligible candidates collected beyond requestedQuantity so commit-time
 * revalidation can absorb a small number of races without a second full scan.
 */
export const PPL_SELECTION_ELIGIBLE_SAFETY_MARGIN = 25;

export function isPplSelectionEnabled(): boolean {
  return process.env.SA360_PPL_SELECTION_ENABLED === "true";
}

/** Production rule: any positive integer quantity is accepted. */
export function resolvePplMinQuantity(): number {
  return PPL_PRODUCTION_MIN_QTY;
}

export function validatePplRequestedQuantity(
  requestedQuantity: number
): { ok: true } | { ok: false; code: "invalid_requested_quantity" } {
  if (
    !Number.isFinite(requestedQuantity) ||
    !Number.isInteger(requestedQuantity) ||
    requestedQuantity < resolvePplMinQuantity()
  ) {
    return { ok: false, code: "invalid_requested_quantity" };
  }
  return { ok: true };
}

export function computeShortfallQuantity(
  requestedQuantity: number,
  selectedQuantity: number
): number {
  return Math.max(0, requestedQuantity - selectedQuantity);
}

export type PplInventoryCandidate = {
  item: LeadInventoryItem;
  inventoryLot: Pick<InventoryLot, "supplierAccountId" | "status">;
  sourceLeadEvent: Pick<
    SourceLeadEvent,
    "id" | "normalizedPayloadJson" | "enrichmentMetadataJson"
  >;
  ageDays: number;
  commerceAgeBucketKey: CommerceAgeBucketKey | null;
  phoneFingerprint: string | null;
  emailFingerprint: string | null;
};

export type PplExclusionCounts = {
  sameBuyerPriorDelivery: number;
  currentBatchDuplicate: number;
  protectedAgent: number;
  invalidIdentity: number;
  unavailableInventory: number;
  ageBucketMismatch: number;
};

export type PplSelectionScanDiagnostics = {
  rowsScanned: number;
  pagesRead: number;
  eligibleQuantity: number;
  selectedQuantity: number;
  /** Confirmed shortfall only when selectionComplete is true; else 0. */
  shortfallQuantity: number;
  scanCeilingHit: boolean;
  /** True when DB candidates were exhausted or requested quantity was satisfied. */
  selectionComplete: boolean;
};

export type PplInventorySelectionResult =
  | {
      ok: true;
      orderId: string;
      requestedQuantity: number;
      selectedQuantity: number;
      eligibleQuantity: number;
      shortfallQuantity: number;
      selectedItemIds: string[];
      allocationIds?: string[];
      commerceAgeBucketKeys: CommerceAgeBucketRequestKey[];
      exclusionCounts?: PplExclusionCounts;
      diagnostics?: PplSelectionScanDiagnostics;
      /** Present when the order has a priced LeadOrderLine snapshot. */
      economics?: PartialFulfillmentEconomics;
      pricedCommerceAgeBucketKey?: CommerceAgeBucketKey;
      unitPriceCents?: number;
      pricingVersion?: string;
    }
  | {
      ok: false;
      code:
        | "selection_disabled"
        | "order_not_found"
        | "order_not_active"
        | "unsupported_order_kind"
        | "invalid_requested_quantity"
        | "priced_bucket_mismatch"
        | "shortage"
        | "no_inventory"
        | "scan_limit_reached"
        | "reservation_conflict"
        | "idempotency_replay_failed";
      reasons: string[];
      eligibleQuantity?: number;
      requestedQuantity?: number;
      selectedQuantity?: number;
      shortfallQuantity?: number;
      exclusionCounts?: PplExclusionCounts;
      diagnostics?: PplSelectionScanDiagnostics;
      economics?: PartialFulfillmentEconomics;
    };

const MAX_SELECTION_SERIALIZABLE_ATTEMPTS = 3;

function parseOrderStates(statesJson: unknown): string[] {
  if (!Array.isArray(statesJson)) return [];
  return statesJson.map((state) => String(state).trim().toUpperCase()).filter(Boolean);
}

function buildIdentityFingerprints(normalizedPayloadJson: unknown): {
  phoneFingerprint: string | null;
  emailFingerprint: string | null;
} {
  const identity = readNormalizedLeadIdentity(normalizedPayloadJson);
  return {
    phoneFingerprint: identity?.phoneE164
      ? fingerprintIdentityValue("phone", identity.phoneE164)
      : null,
    emailFingerprint: identity?.email
      ? fingerprintIdentityValue("email", identity.email)
      : null,
  };
}

export function matchesCommerceAgeBucketFilter(
  commerceAgeBucketKey: CommerceAgeBucketKey | null,
  requestedBucketKeys: CommerceAgeBucketRequestKey[],
  ageDays?: number
): boolean {
  if (requestedBucketKeys.length === 0) return commerceAgeBucketKey != null;
  if (
    commerceAgeBucketKey &&
    requestedBucketKeys.includes(commerceAgeBucketKey as CommerceAgeBucketRequestKey)
  ) {
    return true;
  }
  // Legacy COMMERCE_6_12_MO request matches either new 6–9 or 9–12 candidate key.
  if (
    requestedBucketKeys.includes("COMMERCE_6_12_MO") &&
    (commerceAgeBucketKey === "COMMERCE_6_9_MO" || commerceAgeBucketKey === "COMMERCE_9_12_MO")
  ) {
    return true;
  }
  if (
    ageDays != null &&
    requestedBucketKeys.includes("COMMERCE_6_12_MO") &&
    ageDays >= 180 &&
    ageDays < 365
  ) {
    return true;
  }
  return false;
}

export function sortCandidatesFcfs<T extends { generatedAt: Date; id: string }>(
  items: T[]
): T[] {
  return [...items].sort((a, b) => {
    const generatedDiff = a.generatedAt.getTime() - b.generatedAt.getTime();
    if (generatedDiff !== 0) return generatedDiff;
    return a.id.localeCompare(b.id);
  });
}

export function dedupeCandidatesByIdentityFingerprints(
  candidates: PplInventoryCandidate[],
  seenPhoneFingerprints: Set<string>,
  seenEmailFingerprints: Set<string>
): PplInventoryCandidate[] {
  const selected: PplInventoryCandidate[] = [];
  const batchPhones = new Set<string>();
  const batchEmails = new Set<string>();

  for (const candidate of candidates) {
    if (candidate.phoneFingerprint) {
      if (
        seenPhoneFingerprints.has(candidate.phoneFingerprint) ||
        batchPhones.has(candidate.phoneFingerprint)
      ) {
        continue;
      }
    }
    if (candidate.emailFingerprint) {
      if (
        seenEmailFingerprints.has(candidate.emailFingerprint) ||
        batchEmails.has(candidate.emailFingerprint)
      ) {
        continue;
      }
    }

    if (candidate.phoneFingerprint) batchPhones.add(candidate.phoneFingerprint);
    if (candidate.emailFingerprint) batchEmails.add(candidate.emailFingerprint);
    selected.push(candidate);
  }

  return selected;
}

function buildPplSelectionAllocationIdempotencyKey(batchKey: string, itemId: string): string {
  return `ppl-selection:${batchKey.trim()}:${itemId.trim()}`;
}

function buildPplSelectionBatchPrefix(batchKey: string): string {
  return `ppl-selection:${batchKey.trim()}:`;
}

function emptyExclusionCounts(): PplExclusionCounts {
  return {
    sameBuyerPriorDelivery: 0,
    currentBatchDuplicate: 0,
    protectedAgent: 0,
    invalidIdentity: 0,
    unavailableInventory: 0,
    ageBucketMismatch: 0,
  };
}

async function loadBuyerSeenFingerprints(clientAccountId: string, db: PrismaClient) {
  const rows = await db.buyerDeliveredIdentity.findMany({
    where: { clientAccountId: clientAccountId.trim() },
    select: { phoneFingerprint: true, emailFingerprint: true },
  });

  const phoneFingerprints = new Set<string>();
  const emailFingerprints = new Set<string>();
  for (const row of rows) {
    if (row.phoneFingerprint) phoneFingerprints.add(row.phoneFingerprint);
    if (row.emailFingerprint) emailFingerprints.add(row.emailFingerprint);
  }
  return { phoneFingerprints, emailFingerprints };
}

type InventoryScanRow = LeadInventoryItem & {
  inventoryLot: Pick<InventoryLot, "supplierAccountId" | "status">;
  sourceLeadEvent: Pick<
    SourceLeadEvent,
    "id" | "normalizedPayloadJson" | "enrichmentMetadataJson"
  >;
};

function buildCommerceGeneratedAtWhere(
  commerceAgeBucketKeys: CommerceAgeBucketRequestKey[],
  evaluatedAt: Date
): Prisma.LeadInventoryItemWhereInput {
  const ranges = expandCommerceAgeBucketRanges(commerceAgeBucketKeys);
  const filters = generatedAtFilterForCommerceAgeRanges(ranges, evaluatedAt);
  if (filters.length === 0) {
    // No commercial aged inventory when buckets cannot be resolved.
    return { id: { in: [] } };
  }
  if (filters.length === 1) {
    const only = filters[0]!;
    return {
      generatedAt: {
        ...(only.gt ? { gt: only.gt } : {}),
        lte: only.lte,
      },
    };
  }
  return {
    OR: filters.map((filter) => ({
      generatedAt: {
        ...(filter.gt ? { gt: filter.gt } : {}),
        lte: filter.lte,
      },
    })),
  };
}

function cursorWhere(
  cursor: { generatedAt: Date; id: string } | null
): Prisma.LeadInventoryItemWhereInput | undefined {
  if (!cursor) return undefined;
  return {
    OR: [
      { generatedAt: { gt: cursor.generatedAt } },
      {
        generatedAt: cursor.generatedAt,
        id: { gt: cursor.id },
      },
    ],
  };
}

export type BoundedEligibleQueryResult = {
  candidates: PplInventoryCandidate[];
  exclusionCounts: PplExclusionCounts;
  rowsScanned: number;
  pagesRead: number;
  scanCeilingHit: boolean;
};

/**
 * Bounded FCFS candidate scan: page ordered available aged inventory, classify
 * in Node, stop once targetEligible is collected or scan ceiling is hit.
 * Never materializes the full inventory corpus.
 */
export async function queryEligibleInventoryCandidatesBounded(
  input: {
    nicheKey: string;
    states: string[];
    commerceAgeBucketKeys: CommerceAgeBucketRequestKey[];
    clientAccountId: string;
    exclusions: ProtectedAgentExclusionRecord[];
    evaluatedAt: Date;
    /** Stop once this many eligible candidates are collected (request + safety margin). */
    targetEligible: number;
    excludeInventoryItemIds?: string[];
    excludePhoneFingerprints?: string[];
    excludeEmailFingerprints?: string[];
    pageSize?: number;
    maxScannedRows?: number;
  },
  db: PrismaClient
): Promise<BoundedEligibleQueryResult> {
  const pageSize = input.pageSize ?? PPL_SELECTION_PAGE_SIZE;
  const maxScannedRows = input.maxScannedRows ?? PPL_SELECTION_MAX_SCANNED_ROWS;
  const targetEligible = Math.max(0, input.targetEligible);

  const excludeItemIds = new Set(
    (input.excludeInventoryItemIds ?? []).map((id) => id.trim()).filter(Boolean)
  );
  const excludePhones = new Set(
    (input.excludePhoneFingerprints ?? []).map((value) => value.trim()).filter(Boolean)
  );
  const excludeEmails = new Set(
    (input.excludeEmailFingerprints ?? []).map((value) => value.trim()).filter(Boolean)
  );

  const { phoneFingerprints, emailFingerprints } = await loadBuyerSeenFingerprints(
    input.clientAccountId,
    db
  );

  const batchPhones = new Set<string>();
  const batchEmails = new Set<string>();
  const candidates: PplInventoryCandidate[] = [];
  const exclusionCounts = emptyExclusionCounts();

  let rowsScanned = 0;
  let pagesRead = 0;
  let scanCeilingHit = false;
  let cursor: { generatedAt: Date; id: string } | null = null;

  const ageGeneratedAtWhere = buildCommerceGeneratedAtWhere(
    input.commerceAgeBucketKeys,
    input.evaluatedAt
  );

  while (candidates.length < targetEligible && rowsScanned < maxScannedRows) {
    const remainingBudget = maxScannedRows - rowsScanned;
    const take = Math.min(pageSize, remainingBudget);
    if (take <= 0) break;

    const cursorClause = cursorWhere(cursor);
    const rows = (await db.leadInventoryItem.findMany({
      where: {
        status: "available",
        inventoryClass: "aged",
        nicheKey: { equals: input.nicheKey.trim(), mode: "insensitive" },
        ...(input.states.length > 0 ? { normalizedState: { in: input.states } } : {}),
        ...(excludeItemIds.size > 0 ? { id: { notIn: [...excludeItemIds] } } : {}),
        inventoryLot: { status: "active" },
        AND: [ageGeneratedAtWhere, ...(cursorClause ? [cursorClause] : [])],
      },
      include: {
        inventoryLot: { select: { supplierAccountId: true, status: true } },
        sourceLeadEvent: {
          select: {
            id: true,
            normalizedPayloadJson: true,
            enrichmentMetadataJson: true,
          },
        },
      },
      orderBy: [{ generatedAt: "asc" }, { id: "asc" }],
      take,
    })) as InventoryScanRow[];

    pagesRead += 1;
    if (rows.length === 0) break;

    for (const row of rows) {
      rowsScanned += 1;
      cursor = { generatedAt: row.generatedAt, id: row.id };

      if (row.status !== "available" || row.inventoryLot.status !== "active") {
        exclusionCounts.unavailableInventory += 1;
        continue;
      }

      const ageDays = calculateInventoryAgeDays(row.generatedAt, input.evaluatedAt);
      const commerceAgeBucketKey = resolveCommerceAgeBucketKey(ageDays);
      if (
        !matchesCommerceAgeBucketFilter(
          commerceAgeBucketKey,
          input.commerceAgeBucketKeys,
          ageDays
        )
      ) {
        exclusionCounts.ageBucketMismatch += 1;
        continue;
      }

      const exclusionInput = {
        inventoryLot: row.inventoryLot,
        sourceLeadEvent: row.sourceLeadEvent,
      };
      if (isItemExcludedByProtectedAgents(exclusionInput, input.exclusions)) {
        exclusionCounts.protectedAgent += 1;
        continue;
      }

      const fingerprints = buildIdentityFingerprints(row.sourceLeadEvent.normalizedPayloadJson);
      if (!fingerprints.phoneFingerprint && !fingerprints.emailFingerprint) {
        exclusionCounts.invalidIdentity += 1;
        continue;
      }

      if (
        (fingerprints.phoneFingerprint &&
          (phoneFingerprints.has(fingerprints.phoneFingerprint) ||
            excludePhones.has(fingerprints.phoneFingerprint))) ||
        (fingerprints.emailFingerprint &&
          (emailFingerprints.has(fingerprints.emailFingerprint) ||
            excludeEmails.has(fingerprints.emailFingerprint)))
      ) {
        exclusionCounts.sameBuyerPriorDelivery += 1;
        continue;
      }

      const batchDup =
        (fingerprints.phoneFingerprint != null &&
          batchPhones.has(fingerprints.phoneFingerprint)) ||
        (fingerprints.emailFingerprint != null &&
          batchEmails.has(fingerprints.emailFingerprint));
      if (batchDup) {
        exclusionCounts.currentBatchDuplicate += 1;
        continue;
      }

      if (fingerprints.phoneFingerprint) batchPhones.add(fingerprints.phoneFingerprint);
      if (fingerprints.emailFingerprint) batchEmails.add(fingerprints.emailFingerprint);

      candidates.push({
        item: row,
        inventoryLot: row.inventoryLot,
        sourceLeadEvent: row.sourceLeadEvent,
        ageDays,
        commerceAgeBucketKey,
        phoneFingerprint: fingerprints.phoneFingerprint,
        emailFingerprint: fingerprints.emailFingerprint,
      });

      if (candidates.length >= targetEligible) break;
    }

    // Short page ⇒ natural DB exhaustion (do not label as scan ceiling).
    if (rows.length < take) break;
    if (rowsScanned >= maxScannedRows && candidates.length < targetEligible) {
      // Full page consumed at the budget limit ⇒ unread rows may remain.
      scanCeilingHit = true;
      break;
    }
  }

  return {
    candidates,
    exclusionCounts,
    rowsScanned,
    pagesRead,
    scanCeilingHit,
  };
}

/** @deprecated Use queryEligibleInventoryCandidatesBounded — kept for narrow callers. */
async function queryEligibleInventoryCandidates(
  input: {
    nicheKey: string;
    states: string[];
    commerceAgeBucketKeys: CommerceAgeBucketRequestKey[];
    clientAccountId: string;
    exclusions: ProtectedAgentExclusionRecord[];
    evaluatedAt: Date;
    excludeInventoryItemIds?: string[];
    excludePhoneFingerprints?: string[];
    excludeEmailFingerprints?: string[];
    targetEligible?: number;
  },
  db: PrismaClient
): Promise<PplInventoryCandidate[]> {
  const result = await queryEligibleInventoryCandidatesBounded(
    {
      ...input,
      targetEligible:
        input.targetEligible ??
        PPL_SELECTION_MAX_SCANNED_ROWS + PPL_SELECTION_ELIGIBLE_SAFETY_MARGIN,
    },
    db
  );
  return result.candidates;
}

/**
 * Diagnostic exclusion breakdown for operator rehearsal / FOWB evidence.
 * Uses the same bounded scan as selection (counts reflect scanned window only).
 */
export async function analyzePplInventoryExclusions(
  input: {
    nicheKey: string;
    states: string[];
    commerceAgeBucketKeys: CommerceAgeBucketRequestKey[];
    clientAccountId: string;
    evaluatedAt?: Date;
    targetEligible?: number;
  },
  db: PrismaClient = prisma
): Promise<PplExclusionCounts> {
  const evaluatedAt = input.evaluatedAt ?? new Date();
  const exclusions = await listActiveExclusions(db);
  const scan = await queryEligibleInventoryCandidatesBounded(
    {
      nicheKey: input.nicheKey,
      states: input.states,
      commerceAgeBucketKeys: input.commerceAgeBucketKeys,
      clientAccountId: input.clientAccountId,
      exclusions,
      evaluatedAt,
      targetEligible: input.targetEligible ?? 1,
    },
    db
  );
  return scan.exclusionCounts;
}

/**
 * Scan ceiling is only an incomplete-search problem when the requested
 * quantity was not satisfied. Collecting the safety margin is best-effort.
 */
export function isIncompleteCandidateSearch(input: {
  scanCeilingHit: boolean;
  selectedQuantity: number;
  requestedQuantity: number;
}): boolean {
  return input.scanCeilingHit && input.selectedQuantity < input.requestedQuantity;
}

function buildScanDiagnostics(input: {
  requestedQuantity: number;
  selectedQuantity: number;
  eligibleQuantity: number;
  rowsScanned: number;
  pagesRead: number;
  scanCeilingHit: boolean;
}): PplSelectionScanDiagnostics {
  const selectionComplete = !isIncompleteCandidateSearch({
    scanCeilingHit: input.scanCeilingHit,
    selectedQuantity: input.selectedQuantity,
    requestedQuantity: input.requestedQuantity,
  });
  return {
    rowsScanned: input.rowsScanned,
    pagesRead: input.pagesRead,
    eligibleQuantity: input.eligibleQuantity,
    selectedQuantity: input.selectedQuantity,
    shortfallQuantity: selectionComplete
      ? computeShortfallQuantity(input.requestedQuantity, input.selectedQuantity)
      : 0,
    scanCeilingHit: input.scanCeilingHit,
    selectionComplete,
  };
}

function buildScanLimitReachedResult(input: {
  requestedQuantity: number;
  eligibleQuantity: number;
  rowsScanned: number;
  pagesRead: number;
  exclusionCounts?: PplExclusionCounts;
}): PplInventorySelectionResult {
  return {
    ok: false,
    code: "scan_limit_reached",
    reasons: ["candidate_scan_incomplete"],
    requestedQuantity: input.requestedQuantity,
    eligibleQuantity: input.eligibleQuantity,
    selectedQuantity: 0,
    // Not a confirmed inventory shortfall — search was truncated.
    shortfallQuantity: undefined,
    exclusionCounts: input.exclusionCounts,
    diagnostics: buildScanDiagnostics({
      requestedQuantity: input.requestedQuantity,
      selectedQuantity: 0,
      eligibleQuantity: input.eligibleQuantity,
      rowsScanned: input.rowsScanned,
      pagesRead: input.pagesRead,
      scanCeilingHit: true,
    }),
  };
}

/**
 * One-for-one replacement selection: qty=1 (min qty does not apply).
 * Original identity fingerprints and inventory item ids are excluded.
 */
export async function selectAndReservePplReplacementCandidate(
  input: {
    orderId: string;
    idempotencyKey: string;
    commerceAgeBucketKeys?: unknown;
    excludeInventoryItemIds?: string[];
    excludePhoneFingerprints?: string[];
    excludeEmailFingerprints?: string[];
  },
  db: PrismaClient = prisma
): Promise<
  | {
      ok: true;
      orderId: string;
      allocationId: string;
      inventoryItemId: string;
      eligibleQuantity: number;
    }
  | {
      ok: false;
      code:
        | "selection_disabled"
        | "order_not_found"
        | "order_not_active"
        | "unsupported_order_kind"
        | "shortage"
        | "scan_limit_reached"
        | "idempotency_replay_failed";
      reasons: string[];
      eligibleQuantity?: number;
      diagnostics?: PplSelectionScanDiagnostics;
    }
> {
  if (!isPplSelectionEnabled()) {
    return {
      ok: false,
      code: "selection_disabled",
      reasons: ["ppl_selection_disabled"],
    };
  }

  const batchKey = input.idempotencyKey.trim();
  if (!batchKey) {
    return {
      ok: false,
      code: "idempotency_replay_failed",
      reasons: ["idempotency_key_required"],
    };
  }

  const existing = await db.leadAllocation.findFirst({
    where: {
      idempotencyKey: buildPplSelectionAllocationIdempotencyKey(batchKey, "replacement"),
    },
    select: { id: true, leadInventoryItemId: true, leadOrderId: true },
  });
  if (existing?.leadInventoryItemId) {
    return {
      ok: true,
      orderId: existing.leadOrderId,
      allocationId: existing.id,
      inventoryItemId: existing.leadInventoryItemId,
      eligibleQuantity: 1,
    };
  }

  const order = await findLeadOrderById(input.orderId, db);
  if (!order) {
    return { ok: false, code: "order_not_found", reasons: ["order_not_found"] };
  }
  if (order.status !== "active" || order.canceledAt || order.completedAt || order.pausedAt) {
    return { ok: false, code: "order_not_active", reasons: ["order_not_active"] };
  }
  if (order.orderKind && order.orderKind !== "pay_per_lead") {
    return {
      ok: false,
      code: "unsupported_order_kind",
      reasons: [`order_kind_${order.orderKind}`],
    };
  }

  const commerceAgeBucketKeys = parseCommerceAgeBucketKeys(input.commerceAgeBucketKeys);
  const exclusions = await listActiveExclusions(db);
  const evaluatedAt = new Date();
  const scan = await queryEligibleInventoryCandidatesBounded(
    {
      nicheKey: order.nicheKey,
      states: parseOrderStates(order.statesJson),
      commerceAgeBucketKeys,
      clientAccountId: order.clientAccountId,
      exclusions,
      evaluatedAt,
      targetEligible: 1 + PPL_SELECTION_ELIGIBLE_SAFETY_MARGIN,
      excludeInventoryItemIds: input.excludeInventoryItemIds,
      excludePhoneFingerprints: input.excludePhoneFingerprints,
      excludeEmailFingerprints: input.excludeEmailFingerprints,
    },
    db
  );
  const eligible = scan.candidates;

  const selected = eligible[0];
  if (!selected) {
    if (scan.scanCeilingHit) {
      return {
        ok: false,
        code: "scan_limit_reached",
        reasons: ["candidate_scan_incomplete"],
        eligibleQuantity: 0,
        diagnostics: buildScanDiagnostics({
          requestedQuantity: 1,
          selectedQuantity: 0,
          eligibleQuantity: 0,
          rowsScanned: scan.rowsScanned,
          pagesRead: scan.pagesRead,
          scanCeilingHit: true,
        }),
      };
    }
    return {
      ok: false,
      code: "shortage",
      reasons: ["eligible_inventory_shortage"],
      eligibleQuantity: 0,
    };
  }

  try {
    const allocationId = await db.$transaction(
      async (tx) => {
        const locked = await tx.$queryRaw<Array<{ id: string; status: string }>>`
          SELECT id, status::text AS status
          FROM "LeadInventoryItem"
          WHERE id = ${selected.item.id}
          FOR UPDATE
        `;
        const lockedRow = locked[0];
        if (!lockedRow || lockedRow.status !== "available") {
          throw new Error("inventory_revalidation_failed");
        }

        const allocation = await tx.leadAllocation.create({
          data: {
            sourceLeadEventId: selected.sourceLeadEvent.id,
            leadOrderId: order.id,
            clientAccountId: order.clientAccountId,
            leadInventoryItemId: selected.item.id,
            status: "shadow",
            allocationPolicyVersion: PPL_ALLOCATION_POLICY_VERSION,
            decisionReasonsJson: [
              "ppl_duplicate_replacement",
              selected.commerceAgeBucketKey ?? "commerce_bucket_unresolved",
            ],
            candidateCount: eligible.length,
            idempotencyKey: buildPplSelectionAllocationIdempotencyKey(batchKey, "replacement"),
            proposedAt: evaluatedAt,
          },
        });

        // One-for-one replacements must not be blocked by the original exact fill.
        // Capacity bump is transactional with the reserve (rolls back on failure).
        await tx.leadOrder.update({
          where: { id: order.id },
          data: {
            proposedQuantity: { increment: 1 },
            requestedQuantity: { increment: 1 },
          },
        });

        const reservationIdempotencyKey = buildReservationIdempotencyKey(allocation.id);
        const reserveResult = await reserveLeadAllocationAtomicTx(
          allocation.id,
          reservationIdempotencyKey,
          tx
        );
        if (!reserveResult.reserved) {
          throw new Error("reservation_failed");
        }
        return allocation.id;
      },
      { isolationLevel: PrismaNamespace.TransactionIsolationLevel.Serializable }
    );

    return {
      ok: true,
      orderId: order.id,
      allocationId,
      inventoryItemId: selected.item.id,
      eligibleQuantity: eligible.length,
    };
  } catch (err) {
    if (
      err instanceof Error &&
      (err.message === "inventory_revalidation_failed" ||
        err.message === "inventory_reserve_failed" ||
        err.message === "reservation_failed" ||
        err.message === "capacity_claim_failed")
    ) {
      return {
        ok: false,
        code: "shortage",
        reasons: [err.message],
        eligibleQuantity: eligible.length,
      };
    }
    if (isPrismaSerializableConflict(err)) {
      return {
        ok: false,
        code: "shortage",
        reasons: [INVENTORY_CHANGED_RETRY_REASON],
        eligibleQuantity: eligible.length,
      };
    }
    throw err;
  }
}

export async function previewPplReplacementCandidate(
  input: {
    orderId: string;
    commerceAgeBucketKeys?: unknown;
    excludeInventoryItemIds?: string[];
    excludePhoneFingerprints?: string[];
    excludeEmailFingerprints?: string[];
  },
  db: PrismaClient = prisma
): Promise<
  | {
      ok: true;
      orderId: string;
      eligibleQuantity: number;
      selectedItemId: string | null;
      diagnostics?: PplSelectionScanDiagnostics;
    }
  | {
      ok: false;
      code:
        | "selection_disabled"
        | "order_not_found"
        | "order_not_active"
        | "unsupported_order_kind"
        | "shortage"
        | "scan_limit_reached";
      reasons: string[];
      eligibleQuantity?: number;
      diagnostics?: PplSelectionScanDiagnostics;
    }
> {
  if (!isPplSelectionEnabled()) {
    return {
      ok: false,
      code: "selection_disabled",
      reasons: ["ppl_selection_disabled"],
    };
  }

  const order = await findLeadOrderById(input.orderId, db);
  if (!order) {
    return { ok: false, code: "order_not_found", reasons: ["order_not_found"] };
  }
  if (order.status !== "active" || order.canceledAt || order.completedAt || order.pausedAt) {
    return { ok: false, code: "order_not_active", reasons: ["order_not_active"] };
  }
  if (order.orderKind && order.orderKind !== "pay_per_lead") {
    return {
      ok: false,
      code: "unsupported_order_kind",
      reasons: [`order_kind_${order.orderKind}`],
    };
  }

  const commerceAgeBucketKeys = parseCommerceAgeBucketKeys(input.commerceAgeBucketKeys);
  const exclusions = await listActiveExclusions(db);
  const scan = await queryEligibleInventoryCandidatesBounded(
    {
      nicheKey: order.nicheKey,
      states: parseOrderStates(order.statesJson),
      commerceAgeBucketKeys,
      clientAccountId: order.clientAccountId,
      exclusions,
      evaluatedAt: new Date(),
      targetEligible: 1 + PPL_SELECTION_ELIGIBLE_SAFETY_MARGIN,
      excludeInventoryItemIds: input.excludeInventoryItemIds,
      excludePhoneFingerprints: input.excludePhoneFingerprints,
      excludeEmailFingerprints: input.excludeEmailFingerprints,
    },
    db
  );
  const eligible = scan.candidates;

  if (eligible.length === 0) {
    if (scan.scanCeilingHit) {
      return {
        ok: false,
        code: "scan_limit_reached",
        reasons: ["candidate_scan_incomplete"],
        eligibleQuantity: 0,
        diagnostics: buildScanDiagnostics({
          requestedQuantity: 1,
          selectedQuantity: 0,
          eligibleQuantity: 0,
          rowsScanned: scan.rowsScanned,
          pagesRead: scan.pagesRead,
          scanCeilingHit: true,
        }),
      };
    }
    return {
      ok: false,
      code: "shortage",
      reasons: ["eligible_inventory_shortage"],
      eligibleQuantity: 0,
      diagnostics: buildScanDiagnostics({
        requestedQuantity: 1,
        selectedQuantity: 0,
        eligibleQuantity: 0,
        rowsScanned: scan.rowsScanned,
        pagesRead: scan.pagesRead,
        scanCeilingHit: false,
      }),
    };
  }

  return {
    ok: true,
    orderId: order.id,
    eligibleQuantity: eligible.length,
    selectedItemId: eligible[0]?.item.id ?? null,
    diagnostics: buildScanDiagnostics({
      requestedQuantity: 1,
      selectedQuantity: 1,
      eligibleQuantity: eligible.length,
      rowsScanned: scan.rowsScanned,
      pagesRead: scan.pagesRead,
      scanCeilingHit: scan.scanCeilingHit,
    }),
  };
}

async function resolveSelectionContext(
  input: {
    orderId: string;
    commerceAgeBucketKeys?: unknown;
    requestedQuantity?: number;
  },
  db: PrismaClient
): Promise<
  | {
      ok: true;
      order: NonNullable<Awaited<ReturnType<typeof findLeadOrderById>>>;
      commerceAgeBucketKeys: CommerceAgeBucketRequestKey[];
      requestedQuantity: number;
      exclusions: ProtectedAgentExclusionRecord[];
      pricedLine: Awaited<ReturnType<typeof loadPricedPplOrderLine>>;
    }
  | { ok: false; result: PplInventorySelectionResult }
> {
  if (!isPplSelectionEnabled()) {
    return {
      ok: false,
      result: {
        ok: false,
        code: "selection_disabled",
        reasons: ["ppl_selection_disabled"],
      },
    };
  }

  const order = await findLeadOrderById(input.orderId, db);
  if (!order) {
    return {
      ok: false,
      result: { ok: false, code: "order_not_found", reasons: ["order_not_found"] },
    };
  }

  if (order.status !== "active" || order.canceledAt || order.completedAt || order.pausedAt) {
    return {
      ok: false,
      result: { ok: false, code: "order_not_active", reasons: ["order_not_active"] },
    };
  }

  if (order.orderKind && order.orderKind !== "pay_per_lead") {
    return {
      ok: false,
      result: {
        ok: false,
        code: "unsupported_order_kind",
        reasons: [`order_kind_${order.orderKind}`],
      },
    };
  }

  const requestedQuantity = input.requestedQuantity ?? order.requestedQuantity ?? order.leadVolume;
  const quantityValidation = validatePplRequestedQuantity(requestedQuantity);
  if (!quantityValidation.ok) {
    return {
      ok: false,
      result: {
        ok: false,
        code: quantityValidation.code,
        reasons: [quantityValidation.code],
        requestedQuantity,
      },
    };
  }

  const requestBuckets = parseCommerceAgeBucketKeys(input.commerceAgeBucketKeys);
  const pricedLine = await loadPricedPplOrderLine(order.id, db);
  const bucketResolution = resolveSelectionCommerceBuckets({
    requestBuckets,
    pricedCommerceAgeBucketKey: pricedLine?.commerceAgeBucketKey ?? null,
  });
  if (!bucketResolution.ok) {
    return {
      ok: false,
      result: {
        ok: false,
        code: bucketResolution.code,
        reasons: bucketResolution.reasons,
        requestedQuantity,
      },
    };
  }
  const commerceAgeBucketKeys = bucketResolution.commerceAgeBucketKeys;

  const exclusions = await listActiveExclusions(db);

  return {
    ok: true,
    order,
    commerceAgeBucketKeys,
    requestedQuantity,
    exclusions,
    pricedLine,
  };
}

export async function previewPplInventorySelection(
  input: {
    orderId: string;
    commerceAgeBucketKeys?: unknown;
    requestedQuantity?: number;
  },
  db: PrismaClient = prisma
): Promise<PplInventorySelectionResult> {
  const context = await resolveSelectionContext(input, db);
  if (!context.ok) return context.result;

  const { order, commerceAgeBucketKeys, requestedQuantity, exclusions, pricedLine } = context;
  const evaluatedAt = new Date();
  const targetEligible = requestedQuantity + PPL_SELECTION_ELIGIBLE_SAFETY_MARGIN;
  const scan = await queryEligibleInventoryCandidatesBounded(
    {
      nicheKey: order.nicheKey,
      states: parseOrderStates(order.statesJson),
      commerceAgeBucketKeys,
      clientAccountId: order.clientAccountId,
      exclusions,
      evaluatedAt,
      targetEligible,
    },
    db
  );

  const eligibleQuantity = scan.candidates.length;
  const selected = scan.candidates.slice(0, requestedQuantity);
  const selectedQuantity = selected.length;
  const attachEconomics = (selectedQty: number, scanLimitReached = false) =>
    pricedLine
      ? {
          economics: computePartialFulfillmentEconomics({
            requestedQuantity,
            selectedQuantity: selectedQty,
            unitPriceCents: pricedLine.unitPriceCents,
            scanLimitReached,
          }),
          pricedCommerceAgeBucketKey: pricedLine.commerceAgeBucketKey,
          unitPriceCents: pricedLine.unitPriceCents,
          pricingVersion: pricedLine.pricingVersion,
        }
      : {};

  if (
    isIncompleteCandidateSearch({
      scanCeilingHit: scan.scanCeilingHit,
      selectedQuantity,
      requestedQuantity,
    })
  ) {
    return {
      ...buildScanLimitReachedResult({
        requestedQuantity,
        eligibleQuantity,
        rowsScanned: scan.rowsScanned,
        pagesRead: scan.pagesRead,
        exclusionCounts: scan.exclusionCounts,
      }),
      ...attachEconomics(0, true),
    };
  }

  const shortfallQuantity = computeShortfallQuantity(requestedQuantity, selectedQuantity);
  const diagnostics = buildScanDiagnostics({
    requestedQuantity,
    selectedQuantity,
    eligibleQuantity,
    rowsScanned: scan.rowsScanned,
    pagesRead: scan.pagesRead,
    scanCeilingHit: scan.scanCeilingHit,
  });

  if (selectedQuantity === 0) {
    return {
      ok: false,
      code: "no_inventory",
      reasons: ["eligible_inventory_shortage"],
      eligibleQuantity: 0,
      requestedQuantity,
      selectedQuantity: 0,
      shortfallQuantity: requestedQuantity,
      exclusionCounts: scan.exclusionCounts,
      diagnostics,
      ...attachEconomics(0),
    };
  }

  return {
    ok: true,
    orderId: order.id,
    requestedQuantity,
    selectedQuantity,
    eligibleQuantity,
    shortfallQuantity,
    selectedItemIds: selected.map((candidate) => candidate.item.id),
    commerceAgeBucketKeys,
    exclusionCounts: scan.exclusionCounts,
    diagnostics,
    ...attachEconomics(selectedQuantity),
  };
}

export async function commitPplInventorySelection(
  input: {
    orderId: string;
    commerceAgeBucketKeys?: unknown;
    requestedQuantity?: number;
    idempotencyKey: string;
  },
  db: PrismaClient = prisma
): Promise<PplInventorySelectionResult> {
  const batchKey = input.idempotencyKey.trim();
  if (!batchKey) {
    return {
      ok: false,
      code: "idempotency_replay_failed",
      reasons: ["idempotency_key_required"],
    };
  }

  const existingAllocations = await db.leadAllocation.findMany({
    where: {
      idempotencyKey: { startsWith: buildPplSelectionBatchPrefix(batchKey) },
    },
    select: { id: true, leadInventoryItemId: true, leadOrderId: true },
    orderBy: { createdAt: "asc" },
  });
  if (existingAllocations.length > 0) {
    const orderId = existingAllocations[0]?.leadOrderId ?? input.orderId.trim();
    const order = await findLeadOrderById(orderId, db);
    const pricedLine = await loadPricedPplOrderLine(orderId, db);
    const requestedQuantity =
      input.requestedQuantity ??
      order?.requestedQuantity ??
      order?.leadVolume ??
      existingAllocations.length;
    const selectedQuantity = existingAllocations.length;
    const commerceAgeBucketKeys = pricedLine
      ? [pricedLine.commerceAgeBucketKey]
      : parseCommerceAgeBucketKeys(input.commerceAgeBucketKeys);
    return {
      ok: true,
      orderId,
      requestedQuantity,
      selectedQuantity,
      eligibleQuantity: selectedQuantity,
      shortfallQuantity: computeShortfallQuantity(requestedQuantity, selectedQuantity),
      selectedItemIds: existingAllocations
        .map((allocation) => allocation.leadInventoryItemId)
        .filter((itemId): itemId is string => itemId != null),
      allocationIds: existingAllocations.map((allocation) => allocation.id),
      commerceAgeBucketKeys,
      ...(pricedLine
        ? {
            economics: computePartialFulfillmentEconomics({
              requestedQuantity,
              selectedQuantity,
              unitPriceCents: pricedLine.unitPriceCents,
            }),
            pricedCommerceAgeBucketKey: pricedLine.commerceAgeBucketKey,
            unitPriceCents: pricedLine.unitPriceCents,
            pricingVersion: pricedLine.pricingVersion,
          }
        : {}),
    };
  }

  const context = await resolveSelectionContext(input, db);
  if (!context.ok) return context.result;

  const { order, commerceAgeBucketKeys, requestedQuantity, exclusions, pricedLine } = context;
  const evaluatedAt = new Date();
  const targetEligible = requestedQuantity + PPL_SELECTION_ELIGIBLE_SAFETY_MARGIN;
  const scan = await queryEligibleInventoryCandidatesBounded(
    {
      nicheKey: order.nicheKey,
      states: parseOrderStates(order.statesJson),
      commerceAgeBucketKeys,
      clientAccountId: order.clientAccountId,
      exclusions,
      evaluatedAt,
      targetEligible,
    },
    db
  );

  const eligible = scan.candidates;
  const eligibleQuantity = eligible.length;
  const selected = eligible.slice(0, requestedQuantity);
  const attachEconomics = (selectedQty: number, scanLimitReached = false) =>
    pricedLine
      ? {
          economics: computePartialFulfillmentEconomics({
            requestedQuantity,
            selectedQuantity: selectedQty,
            unitPriceCents: pricedLine.unitPriceCents,
            scanLimitReached,
          }),
          pricedCommerceAgeBucketKey: pricedLine.commerceAgeBucketKey,
          unitPriceCents: pricedLine.unitPriceCents,
          pricingVersion: pricedLine.pricingVersion,
        }
      : {};

  // Fail closed: never reserve a partial set when the candidate search was truncated.
  if (
    isIncompleteCandidateSearch({
      scanCeilingHit: scan.scanCeilingHit,
      selectedQuantity: selected.length,
      requestedQuantity,
    })
  ) {
    return {
      ...buildScanLimitReachedResult({
        requestedQuantity,
        eligibleQuantity,
        rowsScanned: scan.rowsScanned,
        pagesRead: scan.pagesRead,
        exclusionCounts: scan.exclusionCounts,
      }),
      ...attachEconomics(0, true),
    };
  }

  if (selected.length === 0) {
    const diagnostics = buildScanDiagnostics({
      requestedQuantity,
      selectedQuantity: 0,
      eligibleQuantity: 0,
      rowsScanned: scan.rowsScanned,
      pagesRead: scan.pagesRead,
      scanCeilingHit: scan.scanCeilingHit,
    });
    return {
      ok: false,
      code: "no_inventory",
      reasons: ["eligible_inventory_shortage"],
      eligibleQuantity: 0,
      requestedQuantity,
      selectedQuantity: 0,
      shortfallQuantity: requestedQuantity,
      exclusionCounts: scan.exclusionCounts,
      diagnostics,
      ...attachEconomics(0),
    };
  }

  const allocationIds: string[] = [];
  const shortfallForDecision =
    selected.length < requestedQuantity
      ? `shortfall_${requestedQuantity - selected.length}`
      : null;

  for (let attempt = 0; attempt < MAX_SELECTION_SERIALIZABLE_ATTEMPTS; attempt += 1) {
    allocationIds.length = 0;
    try {
      await db.$transaction(
        async (tx) => {
          for (const candidate of selected) {
            const locked = await tx.$queryRaw<Array<{ id: string; status: string }>>`
              SELECT id, status::text AS status
              FROM "LeadInventoryItem"
              WHERE id = ${candidate.item.id}
              FOR UPDATE
            `;
            const lockedRow = locked[0];
            if (!lockedRow || lockedRow.status !== "available") {
              throw new Error("inventory_revalidation_failed");
            }

            const allocation = await tx.leadAllocation.create({
              data: {
                sourceLeadEventId: candidate.sourceLeadEvent.id,
                leadOrderId: order.id,
                clientAccountId: order.clientAccountId,
                leadInventoryItemId: candidate.item.id,
                status: "shadow",
                allocationPolicyVersion: PPL_ALLOCATION_POLICY_VERSION,
                decisionReasonsJson: [
                  "ppl_aged_inventory_selection",
                  candidate.commerceAgeBucketKey ?? "commerce_bucket_unresolved",
                  ...(shortfallForDecision ? [shortfallForDecision] : []),
                ],
                candidateCount: eligible.length,
                idempotencyKey: buildPplSelectionAllocationIdempotencyKey(
                  batchKey,
                  candidate.item.id
                ),
                proposedAt: evaluatedAt,
              },
            });

            await tx.leadOrder.update({
              where: { id: order.id },
              data: { proposedQuantity: { increment: 1 } },
            });

            const reservationIdempotencyKey = buildReservationIdempotencyKey(allocation.id);
            const reserveResult = await reserveLeadAllocationAtomicTx(
              allocation.id,
              reservationIdempotencyKey,
              tx
            );
            if (!reserveResult.reserved) {
              throw new Error("reservation_failed");
            }

            allocationIds.push(allocation.id);
          }
        },
        { isolationLevel: PrismaNamespace.TransactionIsolationLevel.Serializable }
      );
      break;
    } catch (err) {
      if (err instanceof Error) {
        if (
          err.message === "inventory_revalidation_failed" ||
          err.message === "inventory_reserve_failed" ||
          err.message === "reservation_failed" ||
          err.message === "capacity_claim_failed"
        ) {
          // Domain-only reasons; never forward driver/SQL text.
          return {
            ok: false,
            code: "shortage",
            reasons: [err.message],
            eligibleQuantity,
            requestedQuantity,
            selectedQuantity: 0,
            shortfallQuantity: requestedQuantity,
            exclusionCounts: scan.exclusionCounts,
            diagnostics: buildScanDiagnostics({
              requestedQuantity,
              selectedQuantity: 0,
              eligibleQuantity,
              rowsScanned: scan.rowsScanned,
              pagesRead: scan.pagesRead,
              scanCeilingHit: scan.scanCeilingHit,
            }),
          };
        }
      }
      if (isPrismaSerializableConflict(err)) {
        if (attempt + 1 < MAX_SELECTION_SERIALIZABLE_ATTEMPTS) {
          continue;
        }
        // Serializable TX rolled back — no partial reservation remains.
        return {
          ok: false,
          code: "reservation_conflict",
          reasons: [INVENTORY_CHANGED_RETRY_REASON],
          eligibleQuantity,
          requestedQuantity,
          selectedQuantity: 0,
          shortfallQuantity: requestedQuantity,
        };
      }
      throw err;
    }
  }

  const selectedQuantity = selected.length;
  const shortfallQuantity = computeShortfallQuantity(requestedQuantity, selectedQuantity);

  return {
    ok: true,
    orderId: order.id,
    requestedQuantity,
    selectedQuantity,
    eligibleQuantity,
    shortfallQuantity,
    selectedItemIds: selected.map((candidate) => candidate.item.id),
    allocationIds,
    commerceAgeBucketKeys,
    exclusionCounts: scan.exclusionCounts,
    diagnostics: buildScanDiagnostics({
      requestedQuantity,
      selectedQuantity,
      eligibleQuantity,
      rowsScanned: scan.rowsScanned,
      pagesRead: scan.pagesRead,
      scanCeilingHit: scan.scanCeilingHit,
    }),
    ...attachEconomics(selectedQuantity),
  };
}

export async function releasePplAllocation(
  input: { allocationId: string; reason: string },
  db: PrismaClient = prisma
): Promise<
  | { ok: true }
  | {
      ok: false;
      code:
        | "allocation_not_found"
        | "buyer_already_delivered"
        | "invalid_allocation_status"
        | "release_transition_failed";
    }
> {
  const allocationId = input.allocationId.trim();
  const allocation = await db.leadAllocation.findUnique({
    where: { id: allocationId },
    select: {
      id: true,
      status: true,
      leadOrderId: true,
      leadInventoryItemId: true,
    },
  });
  if (!allocation) {
    return { ok: false, code: "allocation_not_found" };
  }

  const delivered = await db.buyerDeliveredIdentity.findFirst({
    where: { leadAllocationId: allocation.id },
    select: { id: true },
  });
  if (delivered) {
    return { ok: false, code: "buyer_already_delivered" };
  }

  const replacementLocked = await db.leadReplacementRequest.findFirst({
    where: {
      OR: [
        { originalAllocationId: allocation.id },
        { replacementAllocationId: allocation.id },
      ],
      status: { in: ["requested", "approved", "fulfilled"] },
    },
    select: { id: true },
  });
  if (replacementLocked) {
    return { ok: false, code: "buyer_already_delivered" };
  }

  if (allocation.status !== "reserved") {
    return { ok: false, code: "invalid_allocation_status" };
  }

  const now = new Date();
  try {
    await db.$transaction(async (tx) => {
      const released = await tx.leadAllocation.updateMany({
        where: { id: allocation.id, status: "reserved" },
        data: {
          status: "released",
          releasedAt: now,
          releaseReasonJson: { code: input.reason.trim(), detail: null },
        },
      });
      if (released.count !== 1) throw new Error("release_transition_failed");

      const orderUpdated = await tx.$executeRaw`
        UPDATE "LeadOrder"
        SET
          "reservedQuantity" = "reservedQuantity" - 1,
          "updatedAt" = ${now}
        WHERE id = ${allocation.leadOrderId}
          AND "reservedQuantity" > 0
      `;
      if (orderUpdated !== 1) throw new Error("release_transition_failed");

      if (allocation.leadInventoryItemId) {
        const itemUpdated = await tx.leadInventoryItem.updateMany({
          where: {
            id: allocation.leadInventoryItemId,
            status: "reserved",
          },
          data: {
            status: "available",
            reservedAt: null,
          },
        });
        if (itemUpdated.count !== 1) throw new Error("release_transition_failed");
      }
    });
  } catch (err) {
    if (err instanceof Error && err.message === "release_transition_failed") {
      return { ok: false, code: "release_transition_failed" };
    }
    throw err;
  }

  return { ok: true };
}
