/**
 * LO-1055 production recovery — read-only diagnosis of why pending_review rows
 * are blocked by the review activation path while 73 sibling rows are already
 * `available`.
 *
 * Compares sourceLane / sourceProvider / verification / lot provenance between
 * the already-available cohort and the pending_review cohort. PII-free.
 */

import { prisma } from "../lib/db.js";
import { prismaCommerceNicheWhere } from "../services/commerce/commerce-niche-match.js";
import { resolveCanonicalSourceLane } from "../services/fulfillment-execution/lf2-source-lane.service.js";
import {
  REVIEW_RECOGNIZED_PROVIDERS,
  REVIEW_RECOGNIZED_SOURCE_LANES,
} from "../services/lead-inventory-review/lead-inventory-review.constants.js";

const STATES = ["IN", "SC", "AZ"];
const NICHE = "vet";

function tally<T>(rows: T[], pick: (row: T) => string): Record<string, number> {
  return rows.reduce<Record<string, number>>((acc, row) => {
    const key = pick(row);
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
}

async function describeCohort(status: "available" | "pending_review") {
  const rows = await prisma.leadInventoryItem.findMany({
    where: {
      status,
      inventoryClass: "aged",
      commerceExcludedAt: null,
      ...prismaCommerceNicheWhere(NICHE),
      normalizedState: { in: STATES },
      inventoryLot: { status: "active" },
    },
    select: {
      id: true,
      sourceLane: true,
      sourceProvider: true,
      availableAt: true,
      quarantineReason: true,
      metadataJson: true,
      inventoryLotId: true,
      sourceLeadEventId: true,
      inventoryLot: { select: { lotKey: true, sourceLane: true, sourceProvider: true, status: true } },
      sourceLeadEvent: {
        select: {
          id: true,
          sourceLeadUid: true,
          sourceProvider: true,
          sourceSystem: true,
          normalizedPayloadJson: true,
          enrichmentMetadataJson: true,
          receivedAt: true,
        },
      },
    },
  });

  const leadUids = rows.map((r) => r.sourceLeadEvent?.sourceLeadUid).filter((v): v is string => !!v);
  const verifications = await prisma.leadVerificationResult.findMany({
    where: { leadUid: { in: leadUids } },
    select: { leadUid: true, verificationStatus: true, duplicateStatus: true },
  });
  const byEvent = new Map(verifications.map((v) => [v.leadUid, v]));
  const verificationFor = (row: (typeof rows)[number]) =>
    row.sourceLeadEvent?.sourceLeadUid ? byEvent.get(row.sourceLeadEvent.sourceLeadUid) : undefined;

  console.log(`\n================ cohort status=${status} (n=${rows.length}) ================`);
  console.log("item.sourceLane        :", JSON.stringify(tally(rows, (r) => r.sourceLane ?? "<null>")));
  console.log("item.sourceProvider    :", JSON.stringify(tally(rows, (r) => r.sourceProvider ?? "<null>")));
  console.log("lot.sourceLane         :", JSON.stringify(tally(rows, (r) => r.inventoryLot.sourceLane ?? "<null>")));
  console.log("lot.sourceProvider     :", JSON.stringify(tally(rows, (r) => r.inventoryLot.sourceProvider ?? "<null>")));
  console.log("lot.lotKey             :", JSON.stringify(tally(rows, (r) => r.inventoryLot.lotKey ?? "<null>")));
  console.log(
    "event canonical lane   :",
    JSON.stringify(tally(rows, (r) => (r.sourceLeadEvent ? resolveCanonicalSourceLane(r.sourceLeadEvent) ?? "<null>" : "<no event>")))
  );
  console.log(
    "lane recognized        :",
    JSON.stringify(
      tally(rows, (r) => {
        const itemLane = r.sourceLane?.trim().toLowerCase() || null;
        const eventLane = r.sourceLeadEvent ? resolveCanonicalSourceLane(r.sourceLeadEvent) : null;
        const resolved = itemLane || eventLane;
        const ok =
          !!resolved &&
          (REVIEW_RECOGNIZED_SOURCE_LANES.has(resolved) || resolved === "manual_import_csv_import");
        return `${ok}`;
      })
    )
  );
  console.log(
    "provider recognized    :",
    JSON.stringify(
      tally(rows, (r) => `${!!r.sourceProvider && REVIEW_RECOGNIZED_PROVIDERS.has(r.sourceProvider)}`)
    )
  );
  console.log("verificationStatus     :", JSON.stringify(tally(rows, (r) => verificationFor(r)?.verificationStatus ?? "<no row>")));
  console.log("duplicateStatus        :", JSON.stringify(tally(rows, (r) => verificationFor(r)?.duplicateStatus ?? "<no row>")));
  console.log("availableAt present    :", JSON.stringify(tally(rows, (r) => `${r.availableAt != null}`)));
  console.log(
    "metadata.importRequestId:",
    JSON.stringify(
      tally(rows, (r) => {
        const meta = r.metadataJson as Record<string, unknown> | null;
        const v = meta?.importRequestId;
        return `${typeof v === "string" && v.trim().length > 0}`;
      })
    )
  );
  console.log(
    "metadata keys          :",
    JSON.stringify(
      tally(rows, (r) => Object.keys((r.metadataJson as Record<string, unknown>) ?? {}).sort().join("|") || "<empty>")
    )
  );
  return rows;
}

async function main(): Promise<void> {
  console.log("[preflight] db host:", /@([^/:]+)/.exec(process.env.DATABASE_URL ?? "")?.[1] ?? "unknown");
  await describeCohort("available");
  await describeCohort("pending_review");

  // Which review action rows previously activated inventory in this cohort?
  const actions = await prisma.leadInventoryReviewAction.findMany({
    orderBy: { createdAt: "desc" },
    take: 15,
    select: {
      requestId: true,
      actionType: true,
      actionStatus: true,
      requestedCount: true,
      eligibleCount: true,
      appliedCount: true,
      blockedCount: true,
      createdAt: true,
      committedAt: true,
    },
  });
  console.log("\n================ recent LeadInventoryReviewAction rows ================");
  for (const a of actions) {
    console.log(
      `${a.createdAt.toISOString()} ${a.requestId} type=${a.actionType} status=${a.actionStatus} ` +
        `requested=${a.requestedCount} eligible=${a.eligibleCount} applied=${a.appliedCount} blocked=${a.blockedCount}`
    );
  }
  if (actions.length === 0) console.log("(none)");
}

main()
  .catch((error) => {
    console.error("[fatal]", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
