/**
 * LOCAL / NON-PRODUCTION DEMO — Admin multi-source LeadCapture association.
 *
 * Proves ClientAccount → many SourceFunnels cardinality, ordinary associate
 * never silently reassigns, explicit reassign + clear semantics, and that
 * correction counts match seeded matching inventory.
 *
 * Safety:
 * - Refuses remote DATABASE_URL hosts
 * - Prefers SA360_TEST_DATABASE_URL when it is a local *test* database
 * - Does not change inventory_only / routing / LeadCapture webhooks
 *
 * Usage (repo root):
 *   pnpm --filter @sa360/api exec tsx src/scripts/demo-admin-leadcapture-multi-source.ts
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";

import { assertLocalDemoDatabaseUrl } from "../lib/local-demo-database-url.js";
import { assertSafeTestDatabaseUrl } from "../lib/safe-test-database-url.js";
import { isOriginClientBuyerIneligible } from "../services/ppl-fulfillment/origin-client-exclusion.js";
import {
  associateSourceFunnelByPageUrl,
  clearSourceFunnelAssociation,
  isSourceFunnelOriginCorrectionError,
  reassignSourceFunnelOrigin,
} from "../services/source-intake/source-funnel.service.js";
import { listSourceFunnelsForClient } from "../repositories/source-funnel.repository.js";
import { sortSourceFunnelsForClientList } from "../services/source-intake/source-funnel-admin.present.js";

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../.env") });

const CLIENT_A = "madison_test_client";
const CLIENT_B = "madison_test_other";
const CLIENT_C = "madison_test_conflict";
const SLUGS = ["dn_omzoj", "6rci-usi", "third-demo-source"] as const;
const PARENT_KEYS = SLUGS.map((slug) => `my.leadcapture.io/p/${slug}`);
const DEMO_LOT_KEY = "adm_lc_demo_lot";
const DEMO_EVENT_PREFIX = "adm_lc_demo_evt_";

function resolveDemoDatabaseUrl(): string {
  const testUrl = process.env.SA360_TEST_DATABASE_URL?.trim();
  if (testUrl) return assertSafeTestDatabaseUrl(testUrl);
  return assertLocalDemoDatabaseUrl(process.env.DATABASE_URL);
}

function confirmedSlugs(
  rows: Array<{ associationStatus: string; pageSlug: string | null }>
): string[] {
  return rows
    .filter((row) => row.associationStatus === "confirmed")
    .map((row) => row.pageSlug)
    .filter((slug): slug is string => Boolean(slug))
    .sort();
}

async function seedMatchingInventory(
  db: PrismaClient,
  input: {
    parentUrlKey: string;
    originClientAccountId: string | null;
    count: number;
    tag: string;
  }
): Promise<string[]> {
  const eventIds: string[] = [];
  const lot = await db.inventoryLot.upsert({
    where: { lotKey: DEMO_LOT_KEY },
    create: {
      lotKey: DEMO_LOT_KEY,
      displayName: "Admin LeadCapture multi-source demo lot",
      sourceProvider: "leadcapture_io",
      sourceLane: "leadcapture_io_nextgen",
      nicheKey: "vet_fex",
      inventoryClass: "fresh",
      exclusivityMode: "exclusive",
      status: "active",
    },
    update: {},
  });
  for (let i = 0; i < input.count; i++) {
    const eventId = `${DEMO_EVENT_PREFIX}${input.tag}_${i}`;
    eventIds.push(eventId);
    await db.sourceLeadEvent.create({
      data: {
        id: eventId,
        sourceProvider: "leadcapture_io",
        sourceSystem: "leadcapture_io_nextgen",
        sourceType: "webhook",
        sourceCampaignId: input.parentUrlKey,
        status: "normalized",
        rawPayloadJson: { demo: true, tag: input.tag },
      },
    });
    await db.leadInventoryItem.create({
      data: {
        inventoryLotId: lot.id,
        sourceLeadEventId: eventId,
        generatedAt: new Date("2026-09-10T00:00:00.000Z"),
        normalizedState: "NC",
        nicheKey: "vet_fex",
        sourceProvider: "leadcapture_io",
        sourceLane: "leadcapture_io_nextgen",
        inventoryClass: "fresh",
        exclusivityMode: "exclusive",
        status: "available",
        availableAt: new Date("2026-09-10T00:00:00.000Z"),
        originClientAccountId: input.originClientAccountId,
      },
    });
  }
  return eventIds;
}

async function cleanupDemoRows(db: PrismaClient) {
  await db.leadInventoryItem.deleteMany({
    where: { sourceLeadEventId: { startsWith: DEMO_EVENT_PREFIX } },
  });
  await db.sourceLeadEvent.deleteMany({
    where: { id: { startsWith: DEMO_EVENT_PREFIX } },
  });
  await db.inventoryLot.deleteMany({ where: { lotKey: DEMO_LOT_KEY } });
  await db.sourceFunnel.deleteMany({
    where: {
      OR: [
        { originClientAccountId: { in: [CLIENT_A, CLIENT_B, CLIENT_C] } },
        { suggestedClientAccountId: { in: [CLIENT_A, CLIENT_B, CLIENT_C] } },
        { provider: "leadcapture_io", parentUrlKey: { in: PARENT_KEYS } },
      ],
    },
  });
  await db.clientAccount.deleteMany({
    where: { clientAccountId: { in: [CLIENT_A, CLIENT_B, CLIENT_C] } },
  });
}

async function main() {
  const databaseUrl = resolveDemoDatabaseUrl();
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

  const lines: string[] = [];
  const log = (msg: string) => {
    lines.push(msg);
    console.log(msg);
  };

  try {
    await cleanupDemoRows(db);
    await db.clientAccount.createMany({
      data: [
        { clientAccountId: CLIENT_A, clientDisplayName: "Madison Test Client", status: "active" },
        { clientAccountId: CLIENT_B, clientDisplayName: "Other Origin Client", status: "active" },
        { clientAccountId: CLIENT_C, clientDisplayName: "Conflict Origin Client", status: "active" },
      ],
    });

    const first = await associateSourceFunnelByPageUrl(
      { originClientAccountId: CLIENT_A, pageUrlOrSlug: "dn_omzoj" },
      db
    );
    log(`associate dn_omzoj → confirmed=${first.sourceFunnel.associationStatus} created=${first.created} firstSeenAt=${first.sourceFunnel.firstSeenAt}`);

    const second = await associateSourceFunnelByPageUrl(
      { originClientAccountId: CLIENT_A, pageUrlOrSlug: "https://my.leadcapture.io/p/6rci-usi?v=1789074011990" },
      db
    );
    log(`associate 6rci-usi → confirmed=${second.sourceFunnel.associationStatus} created=${second.created}`);

    const third = await associateSourceFunnelByPageUrl(
      { originClientAccountId: CLIENT_A, pageUrlOrSlug: "third-demo-source" },
      db
    );
    log(`associate third-demo-source → confirmed=${third.sourceFunnel.associationStatus} created=${third.created}`);

    const afterThree = sortSourceFunnelsForClientList(await listSourceFunnelsForClient(CLIENT_A, db));
    const threeSlugs = confirmedSlugs(afterThree);
    log(`Client A confirmed sources (${threeSlugs.length}): ${threeSlugs.join(", ")}`);
    if (threeSlugs.length !== 3) {
      throw new Error(`expected 3 confirmed sources, got ${threeSlugs.length}`);
    }
    const firstSeenNull = afterThree.filter((row) => row.firstSeenAt == null);
    log(`pre-registered waiting-for-first-lead rows: ${firstSeenNull.length}`);
    log(`P2 same-origin exclusion: ${isOriginClientBuyerIneligible(CLIENT_A, CLIENT_A)}`);

    await seedMatchingInventory(db, {
      parentUrlKey: PARENT_KEYS[1],
      originClientAccountId: CLIENT_A,
      count: 2,
      tag: "copy",
    });
    await seedMatchingInventory(db, {
      parentUrlKey: PARENT_KEYS[0],
      originClientAccountId: CLIENT_A,
      count: 2,
      tag: "dn_a",
    });
    await seedMatchingInventory(db, {
      parentUrlKey: PARENT_KEYS[0],
      originClientAccountId: null,
      count: 1,
      tag: "dn_null",
    });
    await seedMatchingInventory(db, {
      parentUrlKey: PARENT_KEYS[0],
      originClientAccountId: CLIENT_C,
      count: 1,
      tag: "dn_conflict",
    });
    log("seeded matching inventory: 2 on 6rci-usi (origin A); 2 A + 1 NULL + 1 C on dn_omzoj");

    const cleared = await clearSourceFunnelAssociation(second.sourceFunnel.id, db);
    log(`clear 6rci-usi → status=${cleared.sourceFunnel.associationStatus} origin=${cleared.sourceFunnel.originClientAccountId} clearedInventoryCount=${cleared.clearedInventoryCount}`);
    const stillExists = await db.sourceFunnel.findUnique({ where: { id: second.sourceFunnel.id } });
    if (!stillExists) throw new Error("clear deleted the SourceFunnel");
    const afterClear = confirmedSlugs(
      sortSourceFunnelsForClientList(await listSourceFunnelsForClient(CLIENT_A, db))
    );
    log(`Client A after clear (${afterClear.length}): ${afterClear.join(", ")}`);
    if (afterClear.includes("6rci-usi") || !afterClear.includes("dn_omzoj") || !afterClear.includes("third-demo-source")) {
      throw new Error("clear did not leave the other two sources confirmed");
    }

    try {
      await associateSourceFunnelByPageUrl(
        { originClientAccountId: CLIENT_B, pageUrlOrSlug: "dn_omzoj" },
        db
      );
      throw new Error("ordinary associate silently reassigned dn_omzoj");
    } catch (err) {
      if (!isSourceFunnelOriginCorrectionError(err) || err.code !== "confirm_requires_explicit_reassign") {
        throw err;
      }
      log(`ordinary associate of dn_omzoj onto Client B blocked: ${err.code} current=${err.currentOriginClientAccountId}`);
    }

    const reassigned = await reassignSourceFunnelOrigin(
      { sourceFunnelId: first.sourceFunnel.id, originClientAccountId: CLIENT_B },
      db
    );
    log(
      `reassign dn_omzoj A→B newlyStamped=${reassigned.newlyStamped} reassigned=${reassigned.reassigned} conflictsSkipped=${reassigned.conflictsSkipped}`
    );

    const aFinal = confirmedSlugs(
      sortSourceFunnelsForClientList(await listSourceFunnelsForClient(CLIENT_A, db))
    );
    const bFinal = confirmedSlugs(
      sortSourceFunnelsForClientList(await listSourceFunnelsForClient(CLIENT_B, db))
    );
    log(`Client A final confirmed: ${aFinal.join(", ") || "(none)"}`);
    log(`Client B final confirmed: ${bFinal.join(", ") || "(none)"}`);
    if (aFinal.join(",") !== "third-demo-source") {
      throw new Error(`Client A should only have third-demo-source, got ${aFinal.join(",")}`);
    }
    if (bFinal.join(",") !== "dn_omzoj") {
      throw new Error(`Client B should only have dn_omzoj, got ${bFinal.join(",")}`);
    }

    const dnInventory = await db.leadInventoryItem.findMany({
      where: { sourceLeadEventId: { startsWith: `${DEMO_EVENT_PREFIX}dn_` } },
      select: { originClientAccountId: true, sourceLeadEventId: true },
    });
    const origins = dnInventory
      .map((row) => `${row.sourceLeadEventId}=${row.originClientAccountId ?? "null"}`)
      .sort();
    log(`dn_omzoj inventory origins after reassign: ${origins.join("; ")}`);
    const stampedB = dnInventory.filter((row) => row.originClientAccountId === CLIENT_B).length;
    const stillC = dnInventory.filter((row) => row.originClientAccountId === CLIENT_C).length;
    if (stampedB !== 3 || stillC !== 1) {
      throw new Error(`expected 3 items stamped to B and 1 conflict left on C, got B=${stampedB} C=${stillC}`);
    }
    if (reassigned.reassigned !== 2 || reassigned.newlyStamped !== 1 || reassigned.conflictsSkipped !== 1) {
      throw new Error(
        `unexpected reassign counts newlyStamped=${reassigned.newlyStamped} reassigned=${reassigned.reassigned} conflictsSkipped=${reassigned.conflictsSkipped}`
      );
    }
    if (cleared.clearedInventoryCount !== 2) {
      throw new Error(`expected clear count 2, got ${cleared.clearedInventoryCount}`);
    }
    log(`P2 after reassign: buyer B ineligible for origin B=${isOriginClientBuyerIneligible(CLIENT_B, CLIENT_B)}`);
    log("DEMO_OK");
  } finally {
    await cleanupDemoRows(db);
    await db.$disconnect();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
