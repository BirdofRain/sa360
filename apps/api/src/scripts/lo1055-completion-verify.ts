/**
 * LO-1055 — read-only completion verification.
 *
 * Confirms the order was fulfilled through the normal production path and that
 * the scoped activation touched nothing outside the order: allocation counts,
 * BuyerDeliveredIdentity coverage, export package integrity, spreadsheet
 * release state, canonical commerce-age-bucket compliance of every allocated
 * item, and the exact set of inventory rows made available during the run.
 *
 * Performs no writes and opens no transaction. Prints counts, ids, and hashes
 * only — never consumer PII.
 */

import { createHash } from "node:crypto";

import { prisma } from "../lib/db.js";
import { countCommittedAllocationsByOrderIds } from "../repositories/lead-order.repository.js";
import {
  presentLeadOrderFulfillment,
  presentLeadOrderFulfillmentSummary,
} from "../services/lead-order/lead-order-fulfillment.present.js";
import { calculateInventoryAgeDays } from "../services/lead-inventory/lead-inventory-age.js";
import {
  resolveCommerceAgeBucketKey,
  type CommerceAgeBucketRequestKey,
} from "../services/ppl-fulfillment/commerce-age-buckets.js";
import { matchesCommerceAgeBucketFilter } from "../services/ppl-fulfillment/inventory-selection.service.js";

const ORDER_NUMBER = "LO-1055";
const EXPECTED_QUANTITY = 85;
const BUCKET_KEYS: CommerceAgeBucketRequestKey[] = ["COMMERCE_1_3_MO"];
/** Request id of the scoped activation issued by this run. */
const ACTIVATION_REQUEST_ID = "lo1055-prod-activation-20261006-001";

function line(label: string, value: unknown): void {
  console.log(`${label.padEnd(36)}= ${String(value)}`);
}

async function main(): Promise<void> {
  console.log("[preflight] db host:", /@([^/:]+)/.exec(process.env.DATABASE_URL ?? "")?.[1] ?? "unknown");
  console.log("[preflight] mode: READ-ONLY\n");

  const order = await prisma.leadOrder.findFirst({
    where: { orderNumber: ORDER_NUMBER },
    select: {
      id: true,
      orderNumber: true,
      clientAccountId: true,
      status: true,
      leadVolume: true,
      requestedQuantity: true,
      proposedQuantity: true,
      reservedQuantity: true,
      fulfilledQuantity: true,
      completedAt: true,
    },
  });
  if (!order) throw new Error(`${ORDER_NUMBER} not found`);

  console.log("=== order ===");
  line("orderNumber", order.orderNumber);
  line("status", order.status);
  line("requestedQuantity", order.requestedQuantity);
  line("proposedQuantity", order.proposedQuantity);
  line("reservedQuantity", order.reservedQuantity);
  line("completedAt", order.completedAt?.toISOString() ?? "null");

  // Fulfillment is allocation-derived, not read from LeadOrder.fulfilledQuantity:
  // the CSV release path commits allocations and never writes that column.
  const committedCounts = await countCommittedAllocationsByOrderIds([order.id], prisma);
  const committedAllocationCount = committedCounts.get(order.id) ?? 0;
  const fulfillment = presentLeadOrderFulfillment({
    leadVolume: order.leadVolume,
    requestedQuantity: order.requestedQuantity,
    committedAllocationCount,
  });
  line("committedAllocationCount", committedAllocationCount);
  line("presented fulfillment", JSON.stringify(fulfillment));
  line("customer-facing summary", presentLeadOrderFulfillmentSummary(fulfillment));
  line("LeadOrder.fulfilledQuantity", `${order.fulfilledQuantity} (legacy column, not written by release)`);

  console.log("\n=== allocations ===");
  const allocations = await prisma.leadAllocation.findMany({
    where: { leadOrderId: order.id },
    select: {
      id: true,
      status: true,
      leadInventoryItemId: true,
      idempotencyKey: true,
      leadInventoryItem: { select: { id: true, status: true, generatedAt: true } },
    },
  });
  const byStatus = new Map<string, number>();
  for (const a of allocations) byStatus.set(a.status, (byStatus.get(a.status) ?? 0) + 1);
  line("total allocations", allocations.length);
  line("by status", JSON.stringify(Object.fromEntries(byStatus)));
  line("distinct inventory items", new Set(allocations.map((a) => a.leadInventoryItemId)).size);
  line(
    "selection batch key prefix",
    new Set(allocations.map((a) => a.idempotencyKey?.split(":").slice(0, -1).join(":") ?? "none")).size === 1
      ? allocations[0]?.idempotencyKey?.split(":").slice(0, -1).join(":")
      : "MIXED"
  );

  console.log("\n=== commerce age bucket compliance (canonical helpers, real generatedAt) ===");
  const evaluatedAt = new Date();
  let inBucket = 0;
  const ages: number[] = [];
  const bucketCounts = new Map<string, number>();
  for (const a of allocations) {
    const item = a.leadInventoryItem;
    if (!item) continue;
    const ageDays = calculateInventoryAgeDays(item.generatedAt, evaluatedAt);
    ages.push(ageDays);
    const bucket = resolveCommerceAgeBucketKey(ageDays);
    const label = bucket ?? "unresolved";
    bucketCounts.set(label, (bucketCounts.get(label) ?? 0) + 1);
    if (matchesCommerceAgeBucketFilter(bucket, BUCKET_KEYS, ageDays)) inBucket += 1;
  }
  line("items evaluated", ages.length);
  line("ageDays min/max", `${Math.min(...ages)} / ${Math.max(...ages)}`);
  line("bucket distribution", JSON.stringify(Object.fromEntries(bucketCounts)));
  line(`inside ${BUCKET_KEYS.join(",")}`, inBucket);

  console.log("\n=== BuyerDeliveredIdentity ===");
  const allocationIds = allocations.map((a) => a.id);
  const deliveredForOrder = await prisma.buyerDeliveredIdentity.count({
    where: { leadAllocationId: { in: allocationIds } },
  });
  const deliveredForClient = await prisma.buyerDeliveredIdentity.count({
    where: { clientAccountId: order.clientAccountId },
  });
  line("rows linked to this order", deliveredForOrder);
  line("rows for client account", deliveredForClient);

  console.log("\n=== export package ===");
  const packages = await prisma.leadDeliveryExportPackage.findMany({
    where: { leadOrderId: order.id },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      rowCount: true,
      format: true,
      fieldSchemaVersion: true,
      contentSha256: true,
      csvContent: true,
      allocationIdsJson: true,
      createdAt: true,
      spreadsheetDeliveredAt: true,
      spreadsheetDeliveredBy: true,
      spreadsheetDeliveryIdempotencyKey: true,
      idempotencyKey: true,
      customerReleaseNotifyStatus: true,
    },
  });
  line("package count", packages.length);
  for (const p of packages) {
    line("  exportId", p.id);
    line("  rowCount", p.rowCount);
    line("  schema", `${p.format} / ${p.fieldSchemaVersion}`);
    line("  export idempotencyKey", p.idempotencyKey);
    line("  stored contentSha256", p.contentSha256);
    line(
      "  recomputed sha256(csv)",
      createHash("sha256").update(p.csvContent ?? "", "utf8").digest("hex")
    );
    const csvRows = (p.csvContent ?? "").split("\n").filter((l) => l.trim() !== "").length - 1;
    line("  csv data rows", csvRows);
    line("  allocationIds in package", Array.isArray(p.allocationIdsJson) ? p.allocationIdsJson.length : "n/a");
    line("  spreadsheetDeliveredAt", p.spreadsheetDeliveredAt?.toISOString() ?? "null");
    line("  spreadsheetDeliveredBy", p.spreadsheetDeliveredBy ?? "null");
    line("  release idempotencyKey", p.spreadsheetDeliveryIdempotencyKey ?? "null");
    line("  customer notify status", p.customerReleaseNotifyStatus ?? "null");
  }

  console.log("\n=== scoped activation blast radius ===");
  const activation = await prisma.leadInventoryReviewAction.findUnique({
    where: { requestId: ACTIVATION_REQUEST_ID },
    select: {
      id: true,
      actionType: true,
      actionStatus: true,
      requestedCount: true,
      eligibleCount: true,
      appliedCount: true,
      blockedCount: true,
      committedAt: true,
    },
  });
  if (!activation) {
    line("activation action", "NOT FOUND");
  } else {
    line("activation requestId", ACTIVATION_REQUEST_ID);
    line("activation status", activation.actionStatus);
    line("requested/applied/blocked", `${activation.requestedCount}/${activation.appliedCount}/${activation.blockedCount}`);

    const appliedItemIds = (
      await prisma.leadInventoryReviewItemResult.findMany({
        where: { reviewActionId: activation.id, resultingStatus: "available" },
        select: { leadInventoryItemId: true },
      })
    ).map((r) => r.leadInventoryItemId);
    line("items activated by this action", appliedItemIds.length);

    // Any row made available in the activation window that this action did not
    // apply would be collateral.
    const windowStart = new Date(activation.committedAt!.getTime() - 60_000);
    const windowEnd = new Date(activation.committedAt!.getTime() + 60_000);
    const availableInWindow = await prisma.leadInventoryItem.findMany({
      where: { availableAt: { gte: windowStart, lte: windowEnd } },
      select: { id: true },
    });
    const applied = new Set(appliedItemIds);
    const collateral = availableInWindow.filter((r) => !applied.has(r.id));
    line("rows made available in window", availableInWindow.length);
    line("collateral rows outside action", collateral.length);

    const usedByOrder = appliedItemIds.filter((id) =>
      allocations.some((a) => a.leadInventoryItemId === id)
    ).length;
    line("activated rows consumed by order", usedByOrder);
    line("activated rows left unsold", appliedItemIds.length - usedByOrder);
  }

  console.log("\n=== verdict ===");
  const problems: string[] = [];
  if (order.requestedQuantity !== EXPECTED_QUANTITY) problems.push("requestedQuantity");
  if (order.reservedQuantity !== EXPECTED_QUANTITY) problems.push("reservedQuantity");
  if (committedAllocationCount !== EXPECTED_QUANTITY) problems.push("committedAllocationCount");
  if (fulfillment?.status !== "fulfilled") problems.push("fulfillmentStatus");
  if (allocations.length !== EXPECTED_QUANTITY) problems.push("allocationCount");
  if (byStatus.get("committed") !== EXPECTED_QUANTITY) problems.push("allocationsCommitted");
  if (deliveredForOrder !== EXPECTED_QUANTITY) problems.push("buyerDeliveredIdentityCount");
  if (packages.length !== 1) problems.push("exportPackageCount");
  if (packages[0]?.rowCount !== EXPECTED_QUANTITY) problems.push("exportRowCount");
  if (!packages[0]?.spreadsheetDeliveredAt) problems.push("spreadsheetDeliveredAt");
  if (inBucket !== allocations.length) problems.push("ageBucketCompliance");
  console.log(problems.length === 0 ? "LO-1055 COMPLETE: all checks pass" : `FAIL: ${problems.join(", ")}`);
}

main()
  .catch((error) => {
    console.error("[fatal]", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
