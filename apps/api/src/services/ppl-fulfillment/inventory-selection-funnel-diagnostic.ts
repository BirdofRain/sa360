/**
 * Read-only selection funnel for operator preview.
 *
 * Uses the same commerce niche aliases (`prismaCommerceNicheWhere`), commerce
 * age-bucket generatedAt bounds, and buyer-ready / exclusion policy as
 * `queryEligibleInventoryCandidatesBounded`. Counts are aggregate or reason
 * codes only — payloads are not returned.
 *
 * Aged CSV import historically omitted consumer_age and created pending_review
 * rows. Missing consumer age is an informational quality count. It does not
 * remove inventory. The report does not invent consumer age from generatedAt.
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import {
  commerceNicheDisplayName,
  commerceNicheMatchKeys,
  expandCommerceAgeBucketRanges,
  isCanonicalUsStateCode,
} from "@sa360/shared";

import { prisma } from "../../lib/db.js";
import { prismaCommerceNicheWhere } from "../commerce/commerce-niche-match.js";
import {
  AGED_INVENTORY_HISTORICAL_INITIAL_STATUS,
  AGED_INVENTORY_HISTORICAL_NORMALIZED_KEYS,
  AGED_INVENTORY_HISTORICAL_RAW_PAYLOAD_RETAINS_SOURCE_CELLS,
} from "../aged-inventory-import/aged-inventory-import.types.js";
import { recoverStoredConsumerAge } from "../aged-inventory-import/aged-inventory-import-consumer-age.js";
import { isOriginClientBuyerIneligible } from "./origin-client-exclusion.js";
import { readBuyerCsvV3ZipAndAge } from "./buyer-lead-fields.js";
import { evaluatePplBuyerReadyEligibility } from "./ppl-buyer-ready-eligibility.js";
import { isItemExcludedByProtectedAgents } from "./protected-agent-exclusion.service.js";
import {
  buildCommerceGeneratedAtWhere,
  buildIdentityFingerprints,
  loadBuyerSeenFingerprints,
  matchesCommerceAgeBucketFilter,
  parseOrderStates,
  resolveSelectionContext,
  selectionAllowedStates,
} from "./inventory-selection.service.js";
import { calculateInventoryAgeDays } from "../lead-inventory/lead-inventory-age.js";
import { resolveCommerceAgeBucketKey } from "./commerce-age-buckets.js";

const FUNNEL_PAGE_SIZE = 400;
const FUNNEL_MAX_SCAN_ROWS = 50_000;

export type InventoryFunnelStatusBreakdown = {
  available: number;
  pending_review: number;
  reserved: number;
  committed: number;
  other: number;
};

export type InventoryFunnelBuyerReadyBreakdown = {
  ready: number;
  rejected: number;
  missing_consumer_age: number;
  first_name_too_short: number;
  last_name_too_short: number;
  first_name_multipart: number;
  last_name_multipart: number;
};

export type InventorySelectionFunnelReport = {
  orderId: string;
  orderNumber: string;
  nicheKey: string;
  nicheDisplayName: string | null;
  /** Same alias list prismaCommerceNicheWhere expands for this order. */
  nicheAliases: string[];
  nicheMatchPolicy: "commerce_niche_aliases";
  states: string[];
  commerceAgeBucketKeys: string[];
  ageDayRanges: Array<{ minDaysInclusive: number; maxDaysExclusive: number | null }>;
  requestedQuantity: number;
  evaluatedAt: string;
  stages: {
    nicheMatch: number;
    states: number;
    ageBucket: number;
    inventoryClassAged: number;
    activeLot: number;
    status: InventoryFunnelStatusBreakdown;
    commerceExcludedAt: { set: number; null: number };
    commerceIncluded: number;
    validIdentity: number;
    invalidIdentity: number;
    buyerReady: InventoryFunnelBuyerReadyBreakdown;
    protectedAgentExcluded: number;
    afterProtectedAgent: number;
    originClientExcluded: number;
    afterOriginClient: number;
    sameBuyerPriorDelivery: number;
    afterSameBuyer: number;
    withinSelectionDuplicate: number;
    finalEligible: number;
  };
  /**
   * Historical blocker count. Consumer age no longer rejects, so this stays 0.
   * Use eligibleMissingConsumerAge for the informational quality count.
   */
  otherwiseEligibleBlockedByMissingConsumerAge: number;
  /** Final-eligible rows whose exportable consumer age is blank. Not an exclusion. */
  eligibleMissingConsumerAge: number;
  recoverableStoredConsumerAge: number;
  noStoredConsumerAge: number;
  consumerAgeProvenance: {
    normalizedPayload: number;
    rawPayload: number;
    metadataJson: number;
    enrichmentMetadataJson: number;
    none: number;
  };
  pendingReviewConsumerAge: {
    scanned: number;
    normalizedReadable: number;
    recoverableFromStoredSource: number;
    noStoredConsumerAge: number;
  };
  agedImportFieldLoss: {
    historicalCanonicalMappingOmittedConsumerAge: true;
    currentCanonicalMappingSupportsConsumerAge: true;
    historicalNormalizedKeys: readonly string[];
    historicalRawPayloadRetainsSourceCells: false;
    historicalInitialStatus: "pending_review";
    consumerAgeDerivedFromLeadGeneratedAt: false;
    summary: string;
  };
  causes: {
    inventoryActivation: boolean;
    importFieldLoss: boolean;
    buyerReadyPolicy: boolean;
  };
  primaryDisappearance: string;
  summary: string;
  cohortScanTruncated: boolean;
  policyRowsScanned: number;
};

type FunnelScanRow = {
  id: string;
  generatedAt: Date;
  status: string;
  normalizedState: string;
  commerceExcludedAt: Date | null;
  originClientAccountId: string | null;
  metadataJson: Prisma.JsonValue;
  inventoryLot: { supplierAccountId: string | null; status: string };
  sourceLeadEvent: {
    id: string;
    normalizedPayloadJson: Prisma.JsonValue;
    rawPayloadJson: Prisma.JsonValue;
    enrichmentMetadataJson: Prisma.JsonValue;
  };
};

function emptyBuyerReady(): InventoryFunnelBuyerReadyBreakdown {
  return {
    ready: 0,
    rejected: 0,
    missing_consumer_age: 0,
    first_name_too_short: 0,
    last_name_too_short: 0,
    first_name_multipart: 0,
    last_name_multipart: 0,
  };
}

function cursorWhere(
  cursor: { generatedAt: Date; id: string } | null
): Prisma.LeadInventoryItemWhereInput | undefined {
  if (!cursor) return undefined;
  return {
    OR: [
      { generatedAt: { gt: cursor.generatedAt } },
      { generatedAt: cursor.generatedAt, id: { gt: cursor.id } },
    ],
  };
}

function largestDrop(steps: Array<[string, number]>): { code: string; drop: number } {
  let previous = steps[0]?.[1] ?? 0;
  let best = { code: steps[0]?.[0] ?? "niche_aliases", drop: 0 };
  for (const [code, remaining] of steps) {
    const drop = previous - remaining;
    if (drop > best.drop) best = { code, drop };
    previous = remaining;
  }
  return best;
}

export async function diagnosePplInventorySelection(
  input: {
    orderId: string;
    commerceAgeBucketKeys?: unknown;
    requestedQuantity?: number;
  },
  db: PrismaClient = prisma
): Promise<
  | { ok: true; report: InventorySelectionFunnelReport }
  | { ok: false; code: string; reasons: string[] }
> {
  const context = await resolveSelectionContext(input, db);
  if (!context.ok) {
    if (context.result.ok) {
      return { ok: false, code: "selection_context_failed", reasons: ["selection_context_failed"] };
    }
    return { ok: false, code: context.result.code, reasons: context.result.reasons };
  }

  const { order, commerceAgeBucketKeys, requestedQuantity, exclusions } = context;
  const evaluatedAt = new Date();
  const states = selectionAllowedStates(parseOrderStates(order.statesJson));
  const nicheAliases = [...commerceNicheMatchKeys(order.nicheKey)];
  const ageDayRanges = expandCommerceAgeBucketRanges(commerceAgeBucketKeys);

  const emptyStatus = (): InventoryFunnelStatusBreakdown => ({
    available: 0,
    pending_review: 0,
    reserved: 0,
    committed: 0,
    other: 0,
  });

  if (states.length === 0 || nicheAliases.length === 0) {
    const report = buildReport({
      order,
      states,
      nicheAliases,
      commerceAgeBucketKeys,
      ageDayRanges,
      requestedQuantity,
      evaluatedAt,
      counts: {
        nicheMatch: 0,
        states: 0,
        ageBucket: 0,
        inventoryClassAged: 0,
        activeLot: 0,
        status: emptyStatus(),
        commerceSet: 0,
        commerceNull: 0,
        commerceIncluded: 0,
      },
      flow: emptyFlow(),
      truncated: false,
    });
    return { ok: true, report };
  }

  const nicheWhere = prismaCommerceNicheWhere(order.nicheKey);
  const stateWhere: Prisma.LeadInventoryItemWhereInput = { normalizedState: { in: states } };
  const ageWhere = buildCommerceGeneratedAtWhere(commerceAgeBucketKeys, evaluatedAt);
  const agedWhere: Prisma.LeadInventoryItemWhereInput = { inventoryClass: "aged" };
  const lotWhere: Prisma.LeadInventoryItemWhereInput = { inventoryLot: { status: "active" } };

  const stageNiche: Prisma.LeadInventoryItemWhereInput = nicheWhere;
  const stageStates: Prisma.LeadInventoryItemWhereInput = { AND: [nicheWhere, stateWhere] };
  const stageAge: Prisma.LeadInventoryItemWhereInput = { AND: [nicheWhere, stateWhere, ageWhere] };
  const stageAged: Prisma.LeadInventoryItemWhereInput = {
    AND: [nicheWhere, stateWhere, ageWhere, agedWhere],
  };
  const stageLot: Prisma.LeadInventoryItemWhereInput = {
    AND: [nicheWhere, stateWhere, ageWhere, agedWhere, lotWhere],
  };

  const [
    nicheMatch,
    stateMatch,
    ageMatch,
    agedMatch,
    activeLot,
    statusAvailable,
    statusPending,
    statusReserved,
    statusCommitted,
    commerceSet,
    commerceNull,
    commerceIncluded,
  ] = await Promise.all([
    db.leadInventoryItem.count({ where: stageNiche }),
    db.leadInventoryItem.count({ where: stageStates }),
    db.leadInventoryItem.count({ where: stageAge }),
    db.leadInventoryItem.count({ where: stageAged }),
    db.leadInventoryItem.count({ where: stageLot }),
    db.leadInventoryItem.count({ where: { AND: [stageLot, { status: "available" }] } }),
    db.leadInventoryItem.count({ where: { AND: [stageLot, { status: "pending_review" }] } }),
    db.leadInventoryItem.count({ where: { AND: [stageLot, { status: "reserved" }] } }),
    db.leadInventoryItem.count({ where: { AND: [stageLot, { status: "committed" }] } }),
    db.leadInventoryItem.count({
      where: { AND: [stageLot, { commerceExcludedAt: { not: null } }] },
    }),
    db.leadInventoryItem.count({
      where: { AND: [stageLot, { commerceExcludedAt: null }] },
    }),
    db.leadInventoryItem.count({
      where: {
        AND: [stageLot, { status: "available" }, { commerceExcludedAt: null }],
      },
    }),
  ]);

  const knownStatus = statusAvailable + statusPending + statusReserved + statusCommitted;
  const status = {
    available: statusAvailable,
    pending_review: statusPending,
    reserved: statusReserved,
    committed: statusCommitted,
    other: Math.max(0, activeLot - knownStatus),
  };

  const seen = await loadBuyerSeenFingerprints(order.clientAccountId, db);
  const flow = emptyFlow();
  let cursor: { generatedAt: Date; id: string } | null = null;
  let scanned = 0;
  let truncated = false;

  while (scanned < FUNNEL_MAX_SCAN_ROWS) {
    const take = Math.min(FUNNEL_PAGE_SIZE, FUNNEL_MAX_SCAN_ROWS - scanned);
    const cursorClause = cursorWhere(cursor);
    const rows = (await db.leadInventoryItem.findMany({
      where: {
        AND: [stageLot, ...(cursorClause ? [cursorClause] : [])],
      },
      select: {
        id: true,
        generatedAt: true,
        status: true,
        normalizedState: true,
        commerceExcludedAt: true,
        originClientAccountId: true,
        metadataJson: true,
        inventoryLot: { select: { supplierAccountId: true, status: true } },
        sourceLeadEvent: {
          select: {
            id: true,
            normalizedPayloadJson: true,
            rawPayloadJson: true,
            enrichmentMetadataJson: true,
          },
        },
      },
      orderBy: [{ generatedAt: "asc" }, { id: "asc" }],
      take,
    })) as FunnelScanRow[];

    if (rows.length === 0) break;

    for (const row of rows) {
      scanned += 1;
      cursor = { generatedAt: row.generatedAt, id: row.id };
      classifyRow(row, {
        flow,
        exclusions,
        buyerClientAccountId: order.clientAccountId,
        seenPhones: seen.phoneFingerprints,
        seenEmails: seen.emailFingerprints,
        commerceAgeBucketKeys,
        evaluatedAt,
      });
      if (scanned >= FUNNEL_MAX_SCAN_ROWS) {
        truncated = true;
        break;
      }
    }

    if (truncated || rows.length < take) break;
  }

  if (!truncated && scanned < activeLot) {
    // Keyset scan ended early only when the page was short. Exact when scanned === activeLot.
    truncated = false;
  }

  const report = buildReport({
    order,
    states,
    nicheAliases,
    commerceAgeBucketKeys,
    ageDayRanges,
    requestedQuantity,
    evaluatedAt,
    counts: {
      nicheMatch,
      states: stateMatch,
      ageBucket: ageMatch,
      inventoryClassAged: agedMatch,
      activeLot,
      status,
      commerceSet,
      commerceNull,
      commerceIncluded,
    },
    flow,
    truncated: truncated && scanned < activeLot,
  });
  return { ok: true, report };
}

type Flow = ReturnType<typeof emptyFlow>;

function emptyFlow() {
  return {
    validIdentity: 0,
    invalidIdentity: 0,
    buyerReady: emptyBuyerReady(),
    protectedAgentExcluded: 0,
    afterProtectedAgent: 0,
    originClientExcluded: 0,
    afterOriginClient: 0,
    sameBuyerPriorDelivery: 0,
    afterSameBuyer: 0,
    withinSelectionDuplicate: 0,
    finalEligible: 0,
    eligibleMissingConsumerAge: 0,
    blockedSolelyByMissingConsumerAge: 0,
    recoverableStoredConsumerAge: 0,
    noStoredConsumerAge: 0,
    provenance: {
      normalizedPayload: 0,
      rawPayload: 0,
      metadataJson: 0,
      enrichmentMetadataJson: 0,
      none: 0,
    },
    pendingReview: {
      scanned: 0,
      normalizedReadable: 0,
      recoverableFromStoredSource: 0,
      noStoredConsumerAge: 0,
    },
    acceptedPhones: new Set<string>(),
    acceptedEmails: new Set<string>(),
    policyRowsScanned: 0,
  };
}

function classifyRow(
  row: FunnelScanRow,
  input: {
    flow: Flow;
    exclusions: Parameters<typeof isItemExcludedByProtectedAgents>[1];
    buyerClientAccountId: string;
    seenPhones: Set<string>;
    seenEmails: Set<string>;
    commerceAgeBucketKeys: Parameters<typeof matchesCommerceAgeBucketFilter>[1];
    evaluatedAt: Date;
  }
) {
  const { flow } = input;
  const recovered = recoverStoredConsumerAge(
    {
      normalizedPayloadJson: row.sourceLeadEvent.normalizedPayloadJson,
      rawPayloadJson: row.sourceLeadEvent.rawPayloadJson,
      metadataJson: row.metadataJson,
      enrichmentMetadataJson: row.sourceLeadEvent.enrichmentMetadataJson,
    },
    input.evaluatedAt
  );
  if (recovered.location === "normalized_payload") flow.provenance.normalizedPayload += 1;
  else if (recovered.location === "raw_payload") flow.provenance.rawPayload += 1;
  else if (recovered.location === "metadata_json") flow.provenance.metadataJson += 1;
  else if (recovered.location === "enrichment_metadata") flow.provenance.enrichmentMetadataJson += 1;
  else flow.provenance.none += 1;

  if (row.status === "pending_review") {
    flow.pendingReview.scanned += 1;
    if (recovered.location === "normalized_payload") flow.pendingReview.normalizedReadable += 1;
    else if (recovered.age) flow.pendingReview.recoverableFromStoredSource += 1;
    else flow.pendingReview.noStoredConsumerAge += 1;
  }

  if (row.status !== "available" || row.commerceExcludedAt != null) return;
  flow.policyRowsScanned += 1;

  if (!isCanonicalUsStateCode(row.normalizedState)) return;
  const ageDays = calculateInventoryAgeDays(row.generatedAt, input.evaluatedAt);
  const bucket = resolveCommerceAgeBucketKey(ageDays);
  if (!matchesCommerceAgeBucketFilter(bucket, input.commerceAgeBucketKeys, ageDays)) return;

  const protectedHit = isItemExcludedByProtectedAgents(
    { inventoryLot: row.inventoryLot, sourceLeadEvent: row.sourceLeadEvent },
    input.exclusions
  );
  const originHit = isOriginClientBuyerIneligible(
    row.originClientAccountId,
    input.buyerClientAccountId
  );
  const fingerprints = buildIdentityFingerprints(row.sourceLeadEvent.normalizedPayloadJson);
  const identityOk = Boolean(fingerprints.phoneFingerprint || fingerprints.emailFingerprint);
  const buyer = evaluatePplBuyerReadyEligibility(row.sourceLeadEvent.normalizedPayloadJson);
  const exportableAge = readBuyerCsvV3ZipAndAge(row.sourceLeadEvent.normalizedPayloadJson).age;
  const sameBuyer =
    (fingerprints.phoneFingerprint != null &&
      input.seenPhones.has(fingerprints.phoneFingerprint)) ||
    (fingerprints.emailFingerprint != null && input.seenEmails.has(fingerprints.emailFingerprint));

  if (!identityOk) {
    flow.invalidIdentity += 1;
    return;
  }
  flow.validIdentity += 1;
  if (!exportableAge) flow.buyerReady.missing_consumer_age += 1;

  if (!buyer.ok) {
    flow.buyerReady.rejected += 1;
    for (const reason of buyer.reasons) flow.buyerReady[reason] += 1;
  } else {
    flow.buyerReady.ready += 1;
  }

  if (!buyer.ok || protectedHit) {
    if (buyer.ok && protectedHit) flow.protectedAgentExcluded += 1;
  }
  const pastProtected = buyer.ok && !protectedHit;
  if (pastProtected) flow.afterProtectedAgent += 1;
  if (pastProtected && originHit) flow.originClientExcluded += 1;
  const pastOrigin = pastProtected && !originHit;
  if (pastOrigin) flow.afterOriginClient += 1;
  if (pastOrigin && sameBuyer) flow.sameBuyerPriorDelivery += 1;
  const pastSameBuyer = pastOrigin && !sameBuyer;
  if (pastSameBuyer) flow.afterSameBuyer += 1;

  const realDup =
    (fingerprints.phoneFingerprint != null && flow.acceptedPhones.has(fingerprints.phoneFingerprint)) ||
    (fingerprints.emailFingerprint != null && flow.acceptedEmails.has(fingerprints.emailFingerprint));
  if (pastSameBuyer && realDup) flow.withinSelectionDuplicate += 1;
  if (pastSameBuyer && !realDup) {
    flow.finalEligible += 1;
    if (fingerprints.phoneFingerprint) flow.acceptedPhones.add(fingerprints.phoneFingerprint);
    if (fingerprints.emailFingerprint) flow.acceptedEmails.add(fingerprints.emailFingerprint);
    if (!exportableAge) {
      flow.eligibleMissingConsumerAge += 1;
      if (recovered.age && recovered.location !== "normalized_payload") {
        flow.recoverableStoredConsumerAge += 1;
      } else {
        flow.noStoredConsumerAge += 1;
      }
    }
  }
}

function buildReport(input: {
  order: { id: string; orderNumber: string; nicheKey: string };
  states: string[];
  nicheAliases: string[];
  commerceAgeBucketKeys: string[];
  ageDayRanges: Array<{ minDaysInclusive: number; maxDaysExclusive: number | null }>;
  requestedQuantity: number;
  evaluatedAt: Date;
  counts: {
    nicheMatch: number;
    states: number;
    ageBucket: number;
    inventoryClassAged: number;
    activeLot: number;
    status: InventoryFunnelStatusBreakdown;
    commerceSet: number;
    commerceNull: number;
    commerceIncluded: number;
  };
  flow: Flow;
  truncated: boolean;
}): InventorySelectionFunnelReport {
  const stages = {
    nicheMatch: input.counts.nicheMatch,
    states: input.counts.states,
    ageBucket: input.counts.ageBucket,
    inventoryClassAged: input.counts.inventoryClassAged,
    activeLot: input.counts.activeLot,
    status: input.counts.status,
    commerceExcludedAt: { set: input.counts.commerceSet, null: input.counts.commerceNull },
    commerceIncluded: input.counts.commerceIncluded,
    validIdentity: input.flow.validIdentity,
    invalidIdentity: input.flow.invalidIdentity,
    buyerReady: input.flow.buyerReady,
    protectedAgentExcluded: input.flow.protectedAgentExcluded,
    afterProtectedAgent: input.flow.afterProtectedAgent,
    originClientExcluded: input.flow.originClientExcluded,
    afterOriginClient: input.flow.afterOriginClient,
    sameBuyerPriorDelivery: input.flow.sameBuyerPriorDelivery,
    afterSameBuyer: input.flow.afterSameBuyer,
    withinSelectionDuplicate: input.flow.withinSelectionDuplicate,
    finalEligible: input.flow.finalEligible,
  };
  const eligibleMissingConsumerAge = input.flow.eligibleMissingConsumerAge;

  const drop = largestDrop([
    ["niche_aliases", stages.nicheMatch],
    ["states", stages.states],
    ["age_bucket", stages.ageBucket],
    ["inventory_class_aged", stages.inventoryClassAged],
    ["active_lot", stages.activeLot],
    ["status_available", stages.status.available],
    ["commerce_included", stages.commerceIncluded],
    ["valid_identity", stages.validIdentity],
    ["buyer_ready", stages.buyerReady.ready],
    ["protected_agent", stages.afterProtectedAgent],
    ["origin_client", stages.afterOriginClient],
    ["same_buyer", stages.afterSameBuyer],
    ["within_selection_duplicate", stages.finalEligible],
  ]);

  let primaryDisappearance = input.truncated
    ? "cohort_scan_truncated"
    : stages.finalEligible >= input.requestedQuantity
      ? "none"
      : drop.code;
  if (
    !input.truncated &&
    primaryDisappearance === "status_available" &&
    stages.status.pending_review >= stages.status.reserved &&
    stages.status.pending_review >= stages.status.committed &&
    stages.status.pending_review >= stages.status.other
  ) {
    primaryDisappearance = "status_pending_review";
  }

  const causes = {
    inventoryActivation:
      stages.activeLot - stages.status.available > 0 && stages.finalEligible < input.requestedQuantity,
    importFieldLoss: false,
    buyerReadyPolicy: false,
  };

  const summary = input.truncated
    ? "Selection funnel hit its read safety cap before every matching row was classified. Counts above the cap are exact SQL stages; buyer-ready and exclusion counts cover the scanned rows only."
    : primaryDisappearance === "none"
      ? "Eligible inventory covers the requested quantity."
      : `Eligible inventory is short of the requested quantity. Largest drop: ${primaryDisappearance.replaceAll("_", " ")}.`;

  return {
    orderId: input.order.id,
    orderNumber: input.order.orderNumber,
    nicheKey: input.order.nicheKey,
    nicheDisplayName: commerceNicheDisplayName(input.order.nicheKey) ?? null,
    nicheAliases: input.nicheAliases,
    nicheMatchPolicy: "commerce_niche_aliases",
    states: input.states,
    commerceAgeBucketKeys: input.commerceAgeBucketKeys,
    ageDayRanges: input.ageDayRanges,
    requestedQuantity: input.requestedQuantity,
    evaluatedAt: input.evaluatedAt.toISOString(),
    stages,
    otherwiseEligibleBlockedByMissingConsumerAge: input.flow.blockedSolelyByMissingConsumerAge,
    eligibleMissingConsumerAge,
    recoverableStoredConsumerAge: input.flow.recoverableStoredConsumerAge,
    noStoredConsumerAge: input.flow.noStoredConsumerAge,
    consumerAgeProvenance: input.flow.provenance,
    pendingReviewConsumerAge: input.flow.pendingReview,
    agedImportFieldLoss: {
      historicalCanonicalMappingOmittedConsumerAge: true,
      currentCanonicalMappingSupportsConsumerAge: true,
      historicalNormalizedKeys: AGED_INVENTORY_HISTORICAL_NORMALIZED_KEYS,
      historicalRawPayloadRetainsSourceCells: AGED_INVENTORY_HISTORICAL_RAW_PAYLOAD_RETAINS_SOURCE_CELLS,
      historicalInitialStatus: AGED_INVENTORY_HISTORICAL_INITIAL_STATUS,
      consumerAgeDerivedFromLeadGeneratedAt: false,
      summary:
        "Aged CSV canonical mapping did not include consumer_age. Historical commits stored firstName, lastName, email, phone_e164, state, generated_at, niche_key, and product_type, with rawPayloadJson limited to importRequestId and rowNumber. Those rows cannot be backfilled unless a later payload still holds an explicit consumer age. New imports persist a parsed consumer_age when the CSV cell is present. Lead generatedAt is never used as person age.",
    },
    causes,
    primaryDisappearance,
    summary,
    cohortScanTruncated: input.truncated,
    policyRowsScanned: input.flow.policyRowsScanned,
  };
}
