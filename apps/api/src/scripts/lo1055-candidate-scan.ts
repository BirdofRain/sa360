/**
 * LO-1055 production recovery — read-only pending_review candidate scan.
 *
 * Enumerates `pending_review` LeadInventoryItem rows that would already satisfy
 * the real LO-1055 selector if their only remaining lifecycle issue were the
 * `pending_review` status. Every substantive policy check is the canonical
 * helper used by `queryEligibleInventoryCandidatesBounded` — this script only
 * swaps `status: "available"` for `status: "pending_review"` and never mutates.
 *
 * Output is PII-free: inventory item ids, ageDays, state, niche key, and
 * blocker reason codes only.
 */

import { writeFileSync } from "node:fs";

import { isCanonicalUsStateCode } from "@sa360/shared";

import { prisma } from "../lib/db.js";
import { prismaCommerceNicheWhere } from "../services/commerce/commerce-niche-match.js";
import { calculateInventoryAgeDays } from "../services/lead-inventory/lead-inventory-age.js";
import { resolveCommerceAgeBucketKey } from "../services/ppl-fulfillment/commerce-age-buckets.js";
import { isOriginClientBuyerIneligible } from "../services/ppl-fulfillment/origin-client-exclusion.js";
import { isPplBuyerReadyLead } from "../services/ppl-fulfillment/ppl-buyer-ready-eligibility.js";
import { isItemExcludedByProtectedAgents } from "../services/ppl-fulfillment/protected-agent-exclusion.service.js";
import {
  buildCommerceGeneratedAtWhere,
  buildIdentityFingerprints,
  loadBuyerSeenFingerprints,
  matchesCommerceAgeBucketFilter,
  parseOrderStates,
  resolveSelectionContext,
  selectionAllowedStates,
} from "../services/ppl-fulfillment/inventory-selection.service.js";

const ORDER_ID = process.env.LO1055_ORDER_ID ?? "cmuvmbg0j0046ni0uiz3is1kg";
const OUT_PATH = process.env.LO1055_SCAN_OUT ?? "lo1055-candidates.json";

type Blocker =
  | "commerce_excluded"
  | "lot_not_active"
  | "non_canonical_state"
  | "age_bucket_mismatch"
  | "protected_agent"
  | "origin_client"
  | "invalid_identity"
  | "not_buyer_ready"
  | "same_buyer_prior_delivery"
  | "within_scan_duplicate";

async function main(): Promise<void> {
  const dbHost = /@([^/:]+)/.exec(process.env.DATABASE_URL ?? "")?.[1] ?? "unknown";
  console.log(`[preflight] db host: ${dbHost}`);

  const context = await resolveSelectionContext(
    { orderId: ORDER_ID, commerceAgeBucketKeys: ["COMMERCE_1_3_MO"], requestedQuantity: 85 },
    prisma
  );
  if (!context.ok) {
    console.error("[fatal] selection context unavailable", context.result);
    process.exitCode = 1;
    return;
  }

  const { order, commerceAgeBucketKeys, requestedQuantity, exclusions } = context;
  console.log(
    `[order] ${order.orderNumber} client=${order.clientAccountId} status=${order.status} ` +
      `niche=${order.nicheKey} requested=${requestedQuantity} buckets=${commerceAgeBucketKeys.join(",")}`
  );

  const states = parseOrderStates(order.statesJson);
  const allowedStates = selectionAllowedStates(states);
  console.log(`[order] states=${allowedStates.join(",")} protectedAgentRules=${exclusions.length}`);

  // --- preflight: existing fulfillment artifacts -------------------------
  const [allocations, exportPackages, deliveredIdentities] = await Promise.all([
    prisma.leadAllocation.groupBy({
      by: ["status"],
      where: { leadOrderId: order.id },
      _count: { _all: true },
    }),
    prisma.leadDeliveryExportPackage.findMany({
      where: { leadOrderId: order.id },
      select: { id: true, rowCount: true, createdAt: true },
    }),
    prisma.buyerDeliveredIdentity.count({ where: { clientAccountId: order.clientAccountId } }),
  ]);
  console.log(
    `[preflight] allocations=${JSON.stringify(allocations.map((a) => ({ status: a.status, n: a._count._all })))} ` +
      `exportPackages=${exportPackages.length} buyerDeliveredIdentity=${deliveredIdentities}`
  );

  // --- pending_review candidate scan (canonical policy) ------------------
  const evaluatedAt = new Date();
  const ageGeneratedAtWhere = buildCommerceGeneratedAtWhere(commerceAgeBucketKeys, evaluatedAt);
  const { phoneFingerprints, emailFingerprints } = await loadBuyerSeenFingerprints(
    order.clientAccountId,
    prisma
  );
  console.log(
    `[preflight] buyerSeenFingerprints phones=${phoneFingerprints.size} emails=${emailFingerprints.size}`
  );

  const rows = await prisma.leadInventoryItem.findMany({
    where: {
      status: "pending_review",
      inventoryClass: "aged",
      commerceExcludedAt: null,
      ...prismaCommerceNicheWhere(order.nicheKey),
      normalizedState: { in: allowedStates },
      inventoryLot: { status: "active" },
      AND: [ageGeneratedAtWhere],
    },
    include: {
      inventoryLot: { select: { supplierAccountId: true, status: true } },
      sourceLeadEvent: {
        select: { id: true, normalizedPayloadJson: true, enrichmentMetadataJson: true },
      },
    },
    orderBy: [{ generatedAt: "asc" }, { id: "asc" }],
  });
  console.log(`[scan] pending_review rows matching cohort filters: ${rows.length}`);

  const blockerCounts = new Map<Blocker, number>();
  const bump = (b: Blocker) => blockerCounts.set(b, (blockerCounts.get(b) ?? 0) + 1);

  const batchPhones = new Set<string>();
  const batchEmails = new Set<string>();
  const eligible: Array<{
    inventoryItemId: string;
    ageDays: number;
    state: string;
    nicheKey: string;
    commerceAgeBucketKey: string;
    generatedAt: string;
  }> = [];
  const blocked: Array<{ inventoryItemId: string; ageDays: number; blocker: Blocker }> = [];

  for (const row of rows) {
    const ageDays = calculateInventoryAgeDays(row.generatedAt, evaluatedAt);
    const record = (blocker: Blocker) => {
      bump(blocker);
      blocked.push({ inventoryItemId: row.id, ageDays, blocker });
    };

    if (row.commerceExcludedAt != null) {
      record("commerce_excluded");
      continue;
    }
    if (row.inventoryLot.status !== "active") {
      record("lot_not_active");
      continue;
    }
    if (!isCanonicalUsStateCode(row.normalizedState)) {
      record("non_canonical_state");
      continue;
    }

    const commerceAgeBucketKey = resolveCommerceAgeBucketKey(ageDays);
    if (!matchesCommerceAgeBucketFilter(commerceAgeBucketKey, commerceAgeBucketKeys, ageDays)) {
      record("age_bucket_mismatch");
      continue;
    }

    const exclusionInput = { inventoryLot: row.inventoryLot, sourceLeadEvent: row.sourceLeadEvent };
    if (isItemExcludedByProtectedAgents(exclusionInput, exclusions)) {
      record("protected_agent");
      continue;
    }
    if (isOriginClientBuyerIneligible(row.originClientAccountId, order.clientAccountId)) {
      record("origin_client");
      continue;
    }

    const fingerprints = buildIdentityFingerprints(row.sourceLeadEvent.normalizedPayloadJson);
    if (!fingerprints.phoneFingerprint && !fingerprints.emailFingerprint) {
      record("invalid_identity");
      continue;
    }
    if (!isPplBuyerReadyLead(row.sourceLeadEvent.normalizedPayloadJson)) {
      record("not_buyer_ready");
      continue;
    }
    if (
      (fingerprints.phoneFingerprint && phoneFingerprints.has(fingerprints.phoneFingerprint)) ||
      (fingerprints.emailFingerprint && emailFingerprints.has(fingerprints.emailFingerprint))
    ) {
      record("same_buyer_prior_delivery");
      continue;
    }
    const dup =
      (fingerprints.phoneFingerprint != null &&
        batchPhones.has(fingerprints.phoneFingerprint)) ||
      (fingerprints.emailFingerprint != null && batchEmails.has(fingerprints.emailFingerprint));
    if (dup) {
      record("within_scan_duplicate");
      continue;
    }
    if (fingerprints.phoneFingerprint) batchPhones.add(fingerprints.phoneFingerprint);
    if (fingerprints.emailFingerprint) batchEmails.add(fingerprints.emailFingerprint);

    eligible.push({
      inventoryItemId: row.id,
      ageDays,
      state: row.normalizedState,
      nicheKey: row.nicheKey,
      commerceAgeBucketKey: commerceAgeBucketKey ?? "unresolved",
      generatedAt: row.generatedAt.toISOString(),
    });
  }

  const ageDaysList = eligible.map((e) => e.ageDays);
  const report = {
    scannedAt: evaluatedAt.toISOString(),
    orderId: order.id,
    orderNumber: order.orderNumber,
    clientAccountId: order.clientAccountId,
    nicheKey: order.nicheKey,
    nicheAliases: Object.keys(prismaCommerceNicheWhere(order.nicheKey)).length > 0 ? "alias_where_applied" : "none",
    states: allowedStates,
    commerceAgeBucketKeys,
    requestedQuantity,
    preflight: {
      allocationsByStatus: allocations.map((a) => ({ status: a.status, count: a._count._all })),
      exportPackages: exportPackages.map((p) => ({
        id: p.id,
        rowCount: p.rowCount,
        createdAt: p.createdAt.toISOString(),
      })),
      buyerDeliveredIdentityCount: deliveredIdentities,
      buyerSeenPhoneFingerprints: phoneFingerprints.size,
      buyerSeenEmailFingerprints: emailFingerprints.size,
    },
    pendingReviewCohortRows: rows.length,
    wouldBeEligibleCount: eligible.length,
    blockedCount: blocked.length,
    blockerCounts: Object.fromEntries(blockerCounts),
    ageDaysRange: ageDaysList.length
      ? { min: Math.min(...ageDaysList), max: Math.max(...ageDaysList) }
      : null,
    stateDistribution: eligible.reduce<Record<string, number>>((acc, e) => {
      acc[e.state] = (acc[e.state] ?? 0) + 1;
      return acc;
    }, {}),
    nicheDistribution: eligible.reduce<Record<string, number>>((acc, e) => {
      acc[e.nicheKey] = (acc[e.nicheKey] ?? 0) + 1;
      return acc;
    }, {}),
    eligible,
    blocked,
  };

  writeFileSync(OUT_PATH, JSON.stringify(report, null, 2), "utf8");
  console.log(
    `[result] wouldBeEligible=${eligible.length} blocked=${blocked.length} ` +
      `blockers=${JSON.stringify(Object.fromEntries(blockerCounts))}`
  );
  console.log(
    `[result] ageDaysRange=${JSON.stringify(report.ageDaysRange)} states=${JSON.stringify(report.stateDistribution)} niches=${JSON.stringify(report.nicheDistribution)}`
  );
  console.log(`[result] written to ${OUT_PATH}`);
}

main()
  .catch((error) => {
    console.error("[fatal]", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
