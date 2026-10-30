import assert from "node:assert/strict";
import test from "node:test";

import { Prisma, type PrismaClient } from "@prisma/client";

import { CANONICAL_US_STATE_CODES } from "@sa360/shared";

import { fingerprintPhoneIdentity } from "../../lib/identity-fingerprint.js";
import {
  BUYER_AVAILABILITY_MAX_CLASSIFIED_ROWS,
  BUYER_AVAILABILITY_SNAPSHOT_TIMEOUT_MS,
  buyerAvailabilityQueryStates,
  concreteAvailabilityTierKeys,
  lookupBuyerInventoryAvailability,
  parseBuyerAvailabilityBuckets,
  parseBuyerAvailabilityStates,
  type BuyerInventoryAvailabilityReport,
} from "./buyer-inventory-availability.service.js";

const EVALUATED_AT = new Date("2026-08-24T00:00:00.000Z");
const BUYER_ID = "client_jr_laird";
const DAY_MS = 24 * 60 * 60 * 1000;

type Allocation = { id: string; status: string };
type Funnel = {
  id: string;
  provider: string;
  providerFunnelId: string | null;
  parentUrlKey: string | null;
  pageSlug: string | null;
  associationStatus: string;
  originClientAccountId: string | null;
};
type FakeItem = {
  id: string;
  generatedAt: Date;
  status: string;
  inventoryClass: string;
  nicheKey: string;
  normalizedState: string;
  commerceExcludedAt: Date | null;
  originClientAccountId: string | null;
  metadataJson: Record<string, unknown>;
  inventoryLot: { supplierAccountId: string | null; status: string };
  leadAllocations: Allocation[];
  sourceLeadEvent: {
    id: string;
    sourceProvider: string;
    sourceCampaignId: string | null;
    normalizedPayloadJson: unknown;
    rawPayloadJson: unknown;
    enrichmentMetadataJson: unknown;
  };
};

const OPEN = ["shadow", "reserved", "delivering", "committed", "review_required"];

function daysAgo(days: number): Date {
  return new Date(EVALUATED_AT.getTime() - days * DAY_MS);
}

function payload(phone: string, email: string) {
  return {
    contact: {
      first_name: "Ada",
      last_name: "Lee",
      phone_e164: phone,
      email,
      state: "GA",
    },
    lead_details: { consumer_age: 62 },
  };
}

function makeItem(input: {
  id: string;
  ageDays: number;
  phone: string;
  email?: string;
  origin?: string | null;
  provider?: string;
  campaignId?: string | null;
  status?: string;
  commerceExcludedAt?: Date | null;
  lotStatus?: string;
  supplierAccountId?: string;
  allocations?: Allocation[];
  nicheKey?: string;
  state?: string;
}): FakeItem {
  const body = payload(input.phone, input.email ?? `${input.id}@example.test`);
  return {
    id: input.id,
    generatedAt: daysAgo(input.ageDays),
    status: input.status ?? "available",
    inventoryClass: "aged",
    nicheKey: input.nicheKey ?? "trucker",
    normalizedState: input.state ?? "GA",
    commerceExcludedAt: input.commerceExcludedAt ?? null,
    originClientAccountId: input.origin === undefined ? "client_other" : input.origin,
    metadataJson: {},
    inventoryLot: {
      supplierAccountId: input.supplierAccountId ?? "supplier_ok",
      status: input.lotStatus ?? "active",
    },
    leadAllocations: input.allocations ?? [],
    sourceLeadEvent: {
      id: `evt-${input.id}`,
      sourceProvider: input.provider ?? "manual_import",
      sourceCampaignId: input.campaignId ?? null,
      normalizedPayloadJson: body,
      rawPayloadJson: body,
      enrichmentMetadataJson: {},
    },
  };
}

function matchesWhere(item: FakeItem, where: Record<string, unknown> | undefined): boolean {
  if (!where) return true;
  for (const [key, value] of Object.entries(where)) {
    if (key === "AND") {
      const clauses = Array.isArray(value) ? value : [value];
      if (!clauses.every((clause) => matchesWhere(item, clause as Record<string, unknown>))) {
        return false;
      }
      continue;
    }
    if (key === "OR") {
      const clauses = value as Record<string, unknown>[];
      if (!clauses.some((clause) => matchesWhere(item, clause))) return false;
      continue;
    }
    if (key === "NOT") {
      if (matchesWhere(item, value as Record<string, unknown>)) return false;
      continue;
    }
    if (key === "inventoryLot") {
      const expected = value as { status?: string };
      if (expected.status && item.inventoryLot.status !== expected.status) return false;
      continue;
    }
    if (key === "leadAllocations") {
      const rel = value as {
        none?: { status?: { in?: string[] } };
        some?: { status?: { in?: string[] } };
      };
      const statuses = item.leadAllocations.map((row) => row.status);
      if (rel.none?.status?.in && statuses.some((status) => rel.none?.status?.in?.includes(status))) {
        return false;
      }
      if (rel.some?.status?.in && !statuses.some((status) => rel.some?.status?.in?.includes(status))) {
        return false;
      }
      continue;
    }
    if (key === "sourceLeadEvent") {
      const spec = value as { sourceProvider?: string };
      if (spec.sourceProvider && item.sourceLeadEvent.sourceProvider !== spec.sourceProvider) {
        return false;
      }
      continue;
    }
    if (key === "normalizedState") {
      const list = (value as { in: string[] }).in;
      if (!list.includes(item.normalizedState)) return false;
      continue;
    }
    if (key === "nicheKey") {
      const spec = value as { equals: string; mode?: string };
      const actual = spec.mode === "insensitive" ? item.nicheKey.toLowerCase() : item.nicheKey;
      const expected = spec.mode === "insensitive" ? spec.equals.toLowerCase() : spec.equals;
      if (actual !== expected) return false;
      continue;
    }
    if (key === "originClientAccountId") {
      if (value === null) {
        if (item.originClientAccountId != null) return false;
      } else if (typeof value === "string") {
        if (item.originClientAccountId !== value) return false;
      } else if (value && typeof value === "object" && "not" in value) {
        const notValue = (value as { not: string | null }).not;
        if (notValue === null) {
          if (item.originClientAccountId == null) return false;
        } else if (
          item.originClientAccountId == null ||
          item.originClientAccountId === notValue
        ) {
          return false;
        }
      } else {
        throw new Error("unhandled origin filter");
      }
      continue;
    }
    if (key === "commerceExcludedAt") {
      if (value === null) {
        if (item.commerceExcludedAt != null) return false;
      } else if (value && typeof value === "object" && "not" in value) {
        if (item.commerceExcludedAt == null) return false;
      } else {
        throw new Error("unhandled commerceExcludedAt filter");
      }
      continue;
    }
    if (key === "generatedAt") {
      if (value instanceof Date) {
        if (item.generatedAt.getTime() !== value.getTime()) return false;
      } else {
        const spec = value as { gt?: Date; lte?: Date };
        const time = item.generatedAt.getTime();
        if (spec.gt && !(time > spec.gt.getTime())) return false;
        if (spec.lte && !(time <= spec.lte.getTime())) return false;
      }
      continue;
    }
    if (key === "sourceProvider") {
      if (item.sourceLeadEvent.sourceProvider !== value) return false;
      continue;
    }
    if (key === "id") {
      if (value && typeof value === "object" && "in" in value) {
        const ids = (value as { in: string[] }).in;
        if (!ids.includes(item.id)) return false;
      } else {
        const spec = value as { gt?: string };
        if (spec.gt && !(item.id > spec.gt)) return false;
      }
      continue;
    }
    if (key === "status" || key === "inventoryClass") {
      if (item[key] !== value) return false;
      continue;
    }
    throw new Error(`unhandled where key ${key}`);
  }
  return true;
}

function buildFake(input: {
  items: FakeItem[];
  funnels?: Funnel[];
  priorPhones?: string[];
  exclusions?: Array<{ matchType: string; matchValue: string; active: boolean }>;
  fingerprintError?: boolean;
}) {
  const writeAttempts: string[] = [];
  const transactions: Array<{ isolationLevel?: string; timeout?: number; maxWait?: number }> = [];
  let readOnlyStatements = 0;
  const rejectWrite = (model: string) => {
    writeAttempts.push(model);
    throw new Error(`unexpected_write:${model}`);
  };
  const funnels = input.funnels ?? [];
  const db = {
    clientAccount: {
      findUnique: async ({ where }: { where: { clientAccountId: string } }) =>
        where.clientAccountId === BUYER_ID
          ? { clientAccountId: BUYER_ID, clientDisplayName: "JR Laird" }
          : null,
    },
    buyerDeliveredIdentity: {
      findMany: async () => {
        if (input.fingerprintError) throw new Error("history_unavailable");
        return (input.priorPhones ?? []).map((phone) => ({
          phoneFingerprint: fingerprintPhoneIdentity(phone),
          emailFingerprint: null,
        }));
      },
      create: async () => rejectWrite("buyerDeliveredIdentity"),
    },
    protectedAgentExclusion: {
      findMany: async () =>
        (input.exclusions ?? []).filter((row) => row.active).map((row, index) => ({
          id: `ex-${index}`,
          ...row,
          note: null,
          createdAt: EVALUATED_AT,
          updatedAt: EVALUATED_AT,
        })),
    },
    sourceFunnel: {
      findUnique: async ({ where }: { where: Record<string, { provider?: string; providerFunnelId?: string; parentUrlKey?: string }> }) => {
        if (where.provider_providerFunnelId) {
          const key = where.provider_providerFunnelId;
          return (
            funnels.find(
              (row) =>
                row.provider === key.provider && row.providerFunnelId === key.providerFunnelId
            ) ?? null
          );
        }
        if (where.provider_parentUrlKey) {
          const key = where.provider_parentUrlKey;
          return (
            funnels.find(
              (row) => row.provider === key.provider && row.parentUrlKey === key.parentUrlKey
            ) ?? null
          );
        }
        return null;
      },
      findMany: async ({ where }: { where: { provider: string; pageSlug: string; associationStatus: string } }) =>
        funnels.filter(
          (row) =>
            row.provider === where.provider &&
            row.pageSlug === where.pageSlug &&
            row.associationStatus === where.associationStatus &&
            row.originClientAccountId != null
        ),
      create: async () => rejectWrite("sourceFunnel"),
      update: async () => rejectWrite("sourceFunnel"),
    },
    leadOrder: { create: async () => rejectWrite("leadOrder") },
    leadAllocation: { create: async () => rejectWrite("leadAllocation") },
    $executeRawUnsafe: async (sql: string) => {
      if (sql !== "SET TRANSACTION READ ONLY") {
        throw new Error(`unexpected_sql:${sql}`);
      }
      readOnlyStatements += 1;
      return 0;
    },
    $transaction: async (
      fn: (tx: unknown) => Promise<unknown>,
      options?: { isolationLevel?: string; timeout?: number; maxWait?: number }
    ) => {
      transactions.push(options ?? {});
      return fn(db);
    },
    leadInventoryItem: {
      count: async ({ where }: { where: Record<string, unknown> }) =>
        input.items.filter((item) => matchesWhere(item, where)).length,
      findMany: async (args: { where: Record<string, unknown>; take: number }) => {
        const rows = input.items
          .filter((item) => matchesWhere(item, args.where))
          .sort((a, b) => {
            const delta = a.generatedAt.getTime() - b.generatedAt.getTime();
            if (delta !== 0) return delta;
            return a.id.localeCompare(b.id);
          })
          .slice(0, args.take);
        return rows.map((row) => ({
          ...row,
          leadAllocations: row.leadAllocations
            .filter((allocation) => OPEN.includes(allocation.status))
            .map((allocation) => ({ id: allocation.id })),
        }));
      },
      create: async () => rejectWrite("leadInventoryItem"),
      update: async () => rejectWrite("leadInventoryItem"),
      updateMany: async () => rejectWrite("leadInventoryItem"),
      delete: async () => rejectWrite("leadInventoryItem"),
      deleteMany: async () => rejectWrite("leadInventoryItem"),
    },
  };
  return {
    db: db as unknown as PrismaClient,
    writeAttempts,
    transactions,
    readOnlyStatements: () => readOnlyStatements,
  };
}

async function lookup(
  items: FakeItem[],
  extra: {
    funnels?: Funnel[];
    priorPhones?: string[];
    exclusions?: Array<{ matchType: string; matchValue: string; active: boolean }>;
    fingerprintError?: boolean;
    states?: string[];
    /** Pass no `states` field, which means every canonical US state. */
    omitStates?: boolean;
    nicheKey?: string;
    commerceAgeBucketKeys?: string[];
    maxClassifiedRows?: number;
    continuePastPassCeiling?: boolean;
    pageSize?: number;
    clientAccountId?: string;
  } = {}
) {
  const fake = buildFake({
    items,
    funnels: extra.funnels,
    priorPhones: extra.priorPhones,
    exclusions: extra.exclusions,
    fingerprintError: extra.fingerprintError,
  });
  const result = await lookupBuyerInventoryAvailability(
    {
      clientAccountId: extra.clientAccountId ?? BUYER_ID,
      nicheKey: extra.nicheKey ?? "trucker",
      ...(extra.omitStates ? {} : { states: extra.states ?? ["GA"] }),
      commerceAgeBucketKeys: extra.commerceAgeBucketKeys,
      evaluatedAt: EVALUATED_AT,
      maxClassifiedRows: extra.maxClassifiedRows,
      ...(extra.continuePastPassCeiling == null
        ? {}
        : { continuePastPassCeiling: extra.continuePastPassCeiling }),
      pageSize: extra.pageSize,
    },
    fake.db
  );
  return {
    result,
    writeAttempts: fake.writeAttempts,
    transactions: fake.transactions,
    readOnlyStatements: fake.readOnlyStatements,
  };
}

function ok(result: Awaited<ReturnType<typeof lookup>>["result"]): BuyerInventoryAvailabilityReport {
  if (result.ok === false) throw new Error(result.code);
  return result;
}

test("same-origin stamp is excluded and unrelated origin stays eligible", async () => {
  const { result, writeAttempts } = await lookup([
    makeItem({ id: "same", ageDays: 60, phone: "+14045550101", origin: BUYER_ID }),
    makeItem({ id: "other", ageDays: 61, phone: "+14045550102", origin: "client_unrelated" }),
  ]);
  const report = ok(result);
  assert.equal(report.buyer.clientDisplayName, "JR Laird");
  assert.equal(report.nicheKey, "trucker");
  assert.equal(report.stateScope, "selected");
  assert.deepEqual(report.states, ["GA"]);
  assert.equal(report.queryCompleteness, "complete");
  assert.equal(report.eligibleCountSemantics, "exact");
  assert.equal(report.eligibleTotal, 1);
  assert.equal(report.structuralCohort.stampedSameOrigin, 1);
  assert.equal(report.structuralCohort.stampedOtherOrigin, 1);
  assert.equal(report.exclusionReasons.originClientStamped.count, 1);
  assert.equal(report.exclusionReasons.originClientStamped.countSemantics, "exact");
  assert.equal(report.effects.orderCreated, false);
  assert.equal(report.effects.reservationCreated, false);
  assert.equal(report.effects.deliveryRecorded, false);
  assert.equal(report.effects.csvGenerated, false);
  assert.equal(report.effects.sourceDataMutated, false);
  assert.equal(report.scan.usesSelectionRowCap, false);
  assert.equal(writeAttempts.length, 0);
  const json = JSON.stringify(report);
  assert.equal(json.includes("+1404"), false);
  assert.equal(json.includes("Ada"), false);
  assert.equal(json.includes("Lee"), false);
  assert.equal(json.includes("@example.test"), false);
  assert.equal(json.includes("normalizedPayloadJson"), false);
});

test("unknown origin is not buyer-eligible, including an unconfirmed funnel", async () => {
  const { result } = await lookup([
    makeItem({
      id: "csv-null",
      ageDays: 70,
      phone: "+14045550111",
      origin: null,
      provider: "manual_import",
    }),
    makeItem({
      id: "no-funnel",
      ageDays: 71,
      phone: "+14045550112",
      origin: null,
      provider: "leadcapture_io",
      campaignId: "missing-funnel",
    }),
    makeItem({
      id: "suggested",
      ageDays: 72,
      phone: "+14045550113",
      origin: null,
      provider: "leadcapture_io",
      campaignId: "funnel-suggested",
    }),
  ], {
    funnels: [
      {
        id: "funnel-suggested",
        provider: "leadcapture_io",
        providerFunnelId: "funnel-suggested",
        parentUrlKey: null,
        pageSlug: null,
        associationStatus: "suggested",
        originClientAccountId: "client_unrelated",
      },
    ],
  });
  const report = ok(result);
  assert.equal(report.eligibleTotal, 0);
  assert.equal(report.eligibleCountSemantics, "exact");
  assert.equal(report.structuralCohort.unstampedNotReconcilable, 1);
  assert.equal(report.exclusionReasons.originUnresolved.count, 3);
  assert.equal(report.provenance.unresolvedReasons.provider_not_reconcilable, 1);
  assert.equal(report.provenance.unresolvedReasons.no_registered_source, 1);
  assert.equal(report.provenance.unresolvedReasons.source_not_confirmed, 1);
  assert.match(report.provenance.coverageNote, /not counted as buyer-eligible/);
});

test("confirmed source funnel origin is reconciled and same-origin funnel inventory is excluded", async () => {
  const { result } = await lookup(
    [
      makeItem({
        id: "reconciled-other",
        ageDays: 80,
        phone: "+14045550121",
        origin: null,
        provider: "leadcapture_io",
        campaignId: "funnel-other",
      }),
      makeItem({
        id: "reconciled-buyer",
        ageDays: 81,
        phone: "+14045550122",
        origin: null,
        provider: "leadcapture_io",
        campaignId: "my.leadcapture.io/p/jr-trucker",
      }),
    ],
    {
      funnels: [
        {
          id: "funnel-other",
          provider: "leadcapture_io",
          providerFunnelId: "funnel-other",
          parentUrlKey: null,
          pageSlug: null,
          associationStatus: "confirmed",
          originClientAccountId: "client_unrelated",
        },
        {
          id: "funnel-page",
          provider: "leadcapture_io",
          providerFunnelId: null,
          parentUrlKey: "my.leadcapture.io/p/jr-trucker",
          pageSlug: "jr-trucker",
          associationStatus: "confirmed",
          originClientAccountId: BUYER_ID,
        },
      ],
    }
  );
  const report = ok(result);
  assert.equal(report.eligibleTotal, 1);
  assert.equal(report.provenance.reconciledFromSourceFunnel, 2);
  assert.equal(report.exclusionReasons.originClientReconciled.count, 1);
  assert.equal(report.structuralCohort.stampedSameOrigin, 0);
});

test("prior buyer delivery fingerprint excludes an unrelated-origin lead", async () => {
  const phone = "+14045550131";
  const { result } = await lookup(
    [makeItem({ id: "seen", ageDays: 90, phone, origin: "client_unrelated" })],
    { priorPhones: [phone] }
  );
  const report = ok(result);
  assert.equal(report.eligibleTotal, 0);
  assert.equal(report.exclusionReasons.sameBuyerPriorDelivery.count, 1);
  const tier = report.ageTiers.find((row) => row.commerceAgeBucketKey === "COMMERCE_3_6_MO");
  assert.equal(tier?.eligible, 0);
  assert.equal(tier?.countSemantics, "exact");
});

test("ownership-aware dedupe keeps a cross-client copy when the buyer origin row is excluded", async () => {
  const phone = "+14045550141";
  const { result } = await lookup([
    makeItem({ id: "buyer-origin", ageDays: 100, phone, origin: BUYER_ID }),
    makeItem({ id: "other-origin", ageDays: 40, phone, origin: "client_unrelated" }),
  ]);
  const report = ok(result);
  assert.equal(report.eligibleTotal, 1);
  assert.equal(report.exclusionReasons.currentBatchDuplicate.count, 0);
  assert.equal(report.exclusionReasons.originClientStamped.count, 1);
  assert.equal(
    report.ageTiers.find((row) => row.commerceAgeBucketKey === "COMMERCE_1_3_MO")?.eligible,
    1
  );
});

test("two eligible cross-client copies of one consumer count once", async () => {
  const phone = "+14045550151";
  const { result } = await lookup([
    makeItem({ id: "older-copy", ageDays: 120, phone, origin: "client_a" }),
    makeItem({ id: "newer-copy", ageDays: 45, phone, origin: "client_b" }),
  ]);
  const report = ok(result);
  assert.equal(report.eligibleTotal, 1);
  assert.equal(report.exclusionReasons.currentBatchDuplicate.count, 1);
  assert.equal(
    report.ageTiers.find((row) => row.commerceAgeBucketKey === "COMMERCE_3_6_MO")?.eligible,
    1
  );
  assert.equal(
    report.ageTiers.find((row) => row.commerceAgeBucketKey === "COMMERCE_1_3_MO")?.eligible,
    0
  );
});

test("commerce age boundaries land in the exact tier and day 29 does not", async () => {
  const boundaries = [29, 30, 89, 90, 179, 180, 269, 270, 364, 365];
  const { result } = await lookup(
    boundaries.map((ageDays) =>
      makeItem({
        id: `age-${ageDays}`,
        ageDays,
        phone: `+1404555${String(2000 + ageDays)}`,
        origin: "client_unrelated",
      })
    )
  );
  const report = ok(result);
  assert.equal(report.queryCompleteness, "complete");
  assert.equal(report.eligibleCountSemantics, "exact");
  assert.equal(report.structuralCohort.rows, 9);
  assert.equal(report.eligibleTotal, 9);
  const eligible = Object.fromEntries(
    report.ageTiers.map((tier) => [tier.commerceAgeBucketKey, tier.eligible])
  );
  assert.deepEqual(eligible, {
    COMMERCE_1_3_MO: 2,
    COMMERCE_3_6_MO: 2,
    COMMERCE_6_9_MO: 2,
    COMMERCE_9_12_MO: 2,
    COMMERCE_12_MO_PLUS: 1,
  });
  assert.equal(report.ageTiers.every((tier) => tier.countSemantics === "exact"), true);
  assert.equal(report.eligibleByState.find((row) => row.state === "GA")?.eligible, 9);
});

test("6–12 union counts unique phones once across 6–9 and 9–12", async () => {
  const { result } = await lookup(
    [
      makeItem({
        id: "six-tx",
        ageDays: 200,
        phone: "+14045550201",
        state: "TX",
        origin: "client_unrelated",
      }),
      makeItem({
        id: "nine-fl",
        ageDays: 300,
        phone: "+14045550202",
        state: "FL",
        origin: "client_unrelated",
      }),
      makeItem({
        id: "outside-tx",
        ageDays: 40,
        phone: "+14045550209",
        state: "TX",
        origin: "client_unrelated",
      }),
    ],
    { states: ["TX", "FL", "GA"], commerceAgeBucketKeys: ["COMMERCE_6_12_MO"] }
  );
  const report = ok(result);
  assert.equal(report.queryCompleteness, "complete");
  assert.equal(report.eligibleTotal, 2);
  assert.deepEqual(
    Object.fromEntries(report.ageTiers.map((tier) => [tier.commerceAgeBucketKey, tier.eligible])),
    { COMMERCE_6_9_MO: 1, COMMERCE_9_12_MO: 1 }
  );
  assert.deepEqual(
    Object.fromEntries(report.eligibleByState.map((row) => [row.state, row.eligible])),
    { TX: 1, FL: 1, GA: 0 }
  );
  assert.equal(
    report.eligibleByState.every((row) => row.countSemantics === "exact"),
    true
  );
  const summed = report.eligibleByState.reduce((sum, row) => sum + (row.eligible ?? 0), 0);
  assert.equal(summed, report.eligibleTotal);
});

test("a shared phone in both 6–9 and 9–12 counts once for the union", async () => {
  const phone = "+14045550203";
  const { result } = await lookup(
    [
      makeItem({
        id: "older-fl",
        ageDays: 300,
        phone,
        state: "FL",
        origin: "client_a",
      }),
      makeItem({
        id: "younger-tx",
        ageDays: 200,
        phone,
        state: "TX",
        origin: "client_b",
      }),
    ],
    { states: ["TX", "FL"], commerceAgeBucketKeys: ["COMMERCE_6_12_MO"] }
  );
  const report = ok(result);
  assert.equal(report.eligibleTotal, 1);
  assert.equal(report.exclusionReasons.currentBatchDuplicate.count, 1);
  assert.equal(
    report.ageTiers.find((tier) => tier.commerceAgeBucketKey === "COMMERCE_9_12_MO")?.eligible,
    1
  );
  assert.equal(
    report.ageTiers.find((tier) => tier.commerceAgeBucketKey === "COMMERCE_6_9_MO")?.eligible,
    0
  );
  assert.deepEqual(
    Object.fromEntries(report.eligibleByState.map((row) => [row.state, row.eligible])),
    { TX: 0, FL: 1 }
  );
});

test("6–12 day boundaries stay inside the constituent tiers", async () => {
  const ages = [179, 180, 269, 270, 364, 365];
  const { result } = await lookup(
    ages.map((ageDays) =>
      makeItem({
        id: `bound-${ageDays}`,
        ageDays,
        phone: `+1404555${String(3000 + ageDays)}`,
        state: "GA",
        origin: "client_unrelated",
      })
    ),
    { commerceAgeBucketKeys: ["COMMERCE_6_12_MO"] }
  );
  const report = ok(result);
  assert.equal(report.eligibleTotal, 4);
  assert.deepEqual(
    Object.fromEntries(report.ageTiers.map((tier) => [tier.commerceAgeBucketKey, tier.eligible])),
    { COMMERCE_6_9_MO: 2, COMMERCE_9_12_MO: 2 }
  );
  assert.equal(report.eligibleByState.find((row) => row.state === "GA")?.eligible, 4);
});

test("each priced range query counts only its own boundary days", async () => {
  const cases = [
    { key: "COMMERCE_1_3_MO", inside: [30, 89], outside: [29, 90] },
    { key: "COMMERCE_3_6_MO", inside: [90, 179], outside: [89, 180] },
    { key: "COMMERCE_6_9_MO", inside: [180, 269], outside: [179, 270] },
    { key: "COMMERCE_9_12_MO", inside: [270, 364], outside: [269, 365] },
    { key: "COMMERCE_12_MO_PLUS", inside: [365], outside: [364] },
  ] as const;
  for (const entry of cases) {
    const ages = [...entry.inside, ...entry.outside];
    const { result } = await lookup(
      ages.map((ageDays) =>
        makeItem({
          id: `${entry.key}-${ageDays}`,
          ageDays,
          phone: `+1404555${String(4000 + ageDays)}`,
          state: "GA",
          origin: "client_unrelated",
        })
      ),
      { commerceAgeBucketKeys: [entry.key] }
    );
    const report = ok(result);
    assert.deepEqual(report.requestedCommerceAgeBucketKeys, [entry.key]);
    assert.equal(report.ageTiers.length, 1);
    assert.equal(report.ageTiers[0]?.commerceAgeBucketKey, entry.key);
    assert.equal(report.ageTiers[0]?.eligible, entry.inside.length);
    assert.equal(report.eligibleTotal, entry.inside.length);
    assert.equal(report.eligibleByState.find((row) => row.state === "GA")?.eligible, entry.inside.length);
    assert.equal(report.eligibleByState.find((row) => row.state === "GA")?.countSemantics, "exact");
  }
});

test("an incomplete classification is a lower bound and does not report a 5,000-row total", async () => {
  const { result } = await lookup(
    [
      makeItem({ id: "oldest", ageDays: 400, phone: "+14045550161", origin: "client_unrelated" }),
      makeItem({ id: "middle", ageDays: 200, phone: "+14045550162", origin: "client_unrelated" }),
      makeItem({ id: "young", ageDays: 40, phone: "+14045550163", origin: "client_unrelated" }),
    ],
    { maxClassifiedRows: 1, pageSize: 1 }
  );
  const report = ok(result);
  assert.equal(report.queryCompleteness, "incomplete");
  assert.equal(report.eligibleCountSemantics, "lower_bound");
  assert.equal(report.eligibleTotal, 1);
  assert.notEqual(report.eligibleTotal, 5000);
  assert.equal(report.scan.ceilingHit, true);
  assert.equal(report.scan.usesSelectionRowCap, false);
  assert.equal(report.scan.selectionScanCeiling, 5000);
  assert.equal(report.scan.classificationCeiling, 1);
  assert.ok(report.scan.classificationCeiling < BUYER_AVAILABILITY_MAX_CLASSIFIED_ROWS);
  assert.equal(report.scan.rowsUnclassified, 2);
  assert.match(report.summary, /lower bound/);
  const byTier = Object.fromEntries(
    report.ageTiers.map((tier) => [tier.commerceAgeBucketKey, tier.countSemantics])
  );
  assert.equal(byTier.COMMERCE_12_MO_PLUS, "lower_bound");
  assert.equal(byTier.COMMERCE_6_9_MO, "not_reached");
  assert.equal(byTier.COMMERCE_1_3_MO, "not_reached");
  assert.equal(
    report.ageTiers.find((tier) => tier.commerceAgeBucketKey === "COMMERCE_1_3_MO")?.eligible,
    null
  );
  assert.equal(report.structuralCohort.countSemantics, "exact");
  assert.equal(report.structuralCohort.rows, 3);
  assert.deepEqual(report.eligibleByState, [
    { state: "GA", eligible: 1, countSemantics: "lower_bound" },
  ]);
});

test("an incomplete scan does not report an unscanned state as zero inventory", async () => {
  const { result } = await lookup(
    [
      makeItem({ id: "ga-old", ageDays: 400, phone: "+14045550171", state: "GA", origin: "client_unrelated" }),
      makeItem({ id: "tx-young", ageDays: 40, phone: "+14045550172", state: "TX", origin: "client_unrelated" }),
    ],
    { states: ["GA", "TX"], maxClassifiedRows: 1, pageSize: 1 }
  );
  const report = ok(result);
  assert.equal(report.queryCompleteness, "incomplete");
  assert.deepEqual(report.eligibleByState, [
    { state: "GA", eligible: 1, countSemantics: "lower_bound" },
    { state: "TX", eligible: null, countSemantics: "not_reached" },
  ]);
});

test("reservations, open allocations, commerce exclusion, and protected agents are excluded", async () => {
  const { result } = await lookup(
    [
      makeItem({
        id: "reserved",
        ageDays: 50,
        phone: "+14045550171",
        origin: "client_unrelated",
        status: "reserved",
      }),
      makeItem({
        id: "allocated",
        ageDays: 51,
        phone: "+14045550172",
        origin: "client_unrelated",
        allocations: [{ id: "alloc-1", status: "reserved" }],
      }),
      makeItem({
        id: "killed",
        ageDays: 52,
        phone: "+14045550173",
        origin: "client_unrelated",
        commerceExcludedAt: EVALUATED_AT,
      }),
      makeItem({
        id: "protected",
        ageDays: 53,
        phone: "+14045550174",
        origin: "client_unrelated",
        supplierAccountId: "supplier_blocked",
      }),
      makeItem({ id: "sellable", ageDays: 54, phone: "+14045550175", origin: "client_unrelated" }),
    ],
    {
      exclusions: [
        { matchType: "supplier_account_id", matchValue: "supplier_blocked", active: true },
      ],
    }
  );
  const report = ok(result);
  assert.equal(report.eligibleTotal, 1);
  assert.equal(report.structuralCohort.reserved, 1);
  assert.equal(report.structuralCohort.openAllocationOnAvailable, 1);
  assert.equal(report.structuralCohort.commerceExcluded, 1);
  assert.equal(report.exclusionReasons.existingAllocation.count, 1);
  assert.equal(report.exclusionReasons.existingAllocation.countSemantics, "exact");
  assert.equal(report.exclusionReasons.protectedAgent.count, 1);
  assert.equal(report.exclusionReasons.commerceExcluded.count, 1);
});

test("fingerprint load failure does not report a zero-eligible catalog", async () => {
  const { result } = await lookup(
    [makeItem({ id: "ready", ageDays: 40, phone: "+14045550181", origin: "client_unrelated" })],
    { fingerprintError: true }
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "historical_delivery_suppression_unavailable");
});

test("invalid niche, state, and unknown buyer fail before a misleading count", async () => {
  const missingBuyer = await lookup([], { clientAccountId: "missing" });
  assert.equal(missingBuyer.result.ok, false);
  if (!missingBuyer.result.ok) assert.equal(missingBuyer.result.code, "buyer_not_found");

  const badNiche = await lookup([], { nicheKey: "not-a-niche" });
  assert.equal(badNiche.result.ok, false);
  if (!badNiche.result.ok) assert.equal(badNiche.result.code, "invalid_niche");

  const badState = await lookup([], { states: ["Georgia"] });
  assert.equal(badState.result.ok, false);
  if (!badState.result.ok) assert.equal(badState.result.code, "invalid_states");
  assert.equal(badState.transactions.length, 0);
});

test("a successful lookup is one read-only repeatable-read snapshot", async () => {
  const { result, transactions, readOnlyStatements } = await lookup([
    makeItem({ id: "other", ageDays: 61, phone: "+14045550102", origin: "client_unrelated" }),
  ]);
  const report = ok(result);
  assert.equal(report.snapshot.isolation, "repeatable_read");
  assert.equal(report.snapshot.consistent, true);
  assert.equal(report.snapshot.readOnly, true);
  assert.equal(report.snapshot.scope, "transaction_start");
  assert.equal(transactions.length, 1);
  assert.equal(transactions[0]?.isolationLevel, Prisma.TransactionIsolationLevel.RepeatableRead);
  assert.equal(transactions[0]?.timeout, BUYER_AVAILABILITY_SNAPSHOT_TIMEOUT_MS);
  assert.equal(readOnlyStatements(), 1);
});

test("each priced age range is queried directly and the legacy 6–12 union stays isolated", () => {
  const priced = [
    "COMMERCE_1_3_MO",
    "COMMERCE_3_6_MO",
    "COMMERCE_6_9_MO",
    "COMMERCE_9_12_MO",
    "COMMERCE_12_MO_PLUS",
  ] as const;
  for (const key of priced) {
    const parsed = parseBuyerAvailabilityBuckets([key]);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) continue;
    assert.deepEqual(concreteAvailabilityTierKeys(parsed.keys), [key]);
  }
  const union = parseBuyerAvailabilityBuckets(["COMMERCE_6_12_MO"]);
  assert.equal(union.ok, true);
  if (union.ok) {
    assert.deepEqual(concreteAvailabilityTierKeys(union.keys), [
      "COMMERCE_6_9_MO",
      "COMMERCE_9_12_MO",
    ]);
  }
  assert.equal(parseBuyerAvailabilityBuckets(["not-a-bucket"]).ok, false);
});

test("snapshot startup failure does not return a torn exact count", async () => {
  const fake = buildFake({
    items: [makeItem({ id: "other", ageDays: 61, phone: "+14045550102", origin: "client_unrelated" })],
  });
  (fake.db as unknown as { $transaction: () => Promise<never> }).$transaction = async () => {
    const error = new Error("Transaction API error: Unable to start a transaction in the given time");
    (error as { code?: string }).code = "P2028";
    throw error;
  };
  const result = await lookupBuyerInventoryAvailability(
    {
      clientAccountId: BUYER_ID,
      nicheKey: "trucker",
      states: ["GA"],
      evaluatedAt: EVALUATED_AT,
    },
    fake.db
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "availability_snapshot_unavailable");
});

test("blank or omitted states count every canonical state and keep buyer rules", async () => {
  const seenPhone = "+14045550304";
  const items = [
    makeItem({ id: "ga-ready", ageDays: 40, phone: "+14045550301", state: "GA", origin: "client_unrelated" }),
    makeItem({ id: "tx-ready", ageDays: 100, phone: "+14045550302", state: "TX", origin: "client_unrelated" }),
    makeItem({ id: "fl-origin", ageDays: 60, phone: "+14045550303", state: "FL", origin: BUYER_ID }),
    makeItem({ id: "ny-seen", ageDays: 50, phone: seenPhone, state: "NY", origin: "client_unrelated" }),
    makeItem({
      id: "il-allocated",
      ageDays: 55,
      phone: "+14045550305",
      state: "IL",
      origin: "client_unrelated",
      allocations: [{ id: "alloc-il", status: "reserved" }],
    }),
    makeItem({
      id: "oh-commerce",
      ageDays: 70,
      phone: "+14045550306",
      state: "OH",
      origin: "client_unrelated",
      commerceExcludedAt: EVALUATED_AT,
    }),
    makeItem({
      id: "pa-protected",
      ageDays: 80,
      phone: "+14045550307",
      state: "PA",
      origin: "client_unrelated",
      supplierAccountId: "supplier_blocked",
    }),
    makeItem({
      id: "wa-vet",
      ageDays: 45,
      phone: "+14045550308",
      state: "WA",
      origin: "client_unrelated",
      nicheKey: "vet",
    }),
    makeItem({
      id: "zz-noncanonical",
      ageDays: 45,
      phone: "+14045550309",
      state: "ZZ",
      origin: "client_unrelated",
    }),
    makeItem({ id: "ca-young", ageDays: 20, phone: "+14045550310", state: "CA", origin: "client_unrelated" }),
  ];
  const extra = {
    priorPhones: [seenPhone],
    exclusions: [{ matchType: "supplier_account_id", matchValue: "supplier_blocked", active: true }],
  };

  for (const mode of ["omit", "empty"] as const) {
    const { result, writeAttempts } = await lookup(items, {
      ...extra,
      ...(mode === "omit" ? { omitStates: true } : { states: [] }),
    });
    const report = ok(result);
    assert.equal(report.stateScope, "all", mode);
    assert.deepEqual(report.states, [...CANONICAL_US_STATE_CODES]);
    assert.equal(report.queryCompleteness, "complete", mode);
    assert.equal(report.eligibleCountSemantics, "exact", mode);
    assert.equal(report.eligibleTotal, 2, mode);
    assert.match(report.summary, /All states\. Exact buyer-eligible count is 2\./);
    assert.equal(report.summary.includes("not a nationwide total"), false);
    assert.equal(report.structuralCohort.rows, 7, mode);
    assert.equal(report.structuralCohort.stampedSameOrigin, 1, mode);
    assert.equal(report.exclusionReasons.originClientStamped.count, 1, mode);
    assert.equal(report.exclusionReasons.sameBuyerPriorDelivery.count, 1, mode);
    assert.equal(report.exclusionReasons.existingAllocation.count, 1, mode);
    assert.equal(report.exclusionReasons.commerceExcluded.count, 1, mode);
    assert.equal(report.exclusionReasons.protectedAgent.count, 1, mode);
    assert.equal(report.effects.orderCreated, false);
    assert.equal(writeAttempts.length, 0);
    const byTier = Object.fromEntries(
      report.ageTiers.map((tier) => [tier.commerceAgeBucketKey, tier.eligible])
    );
    assert.deepEqual(byTier, {
      COMMERCE_1_3_MO: 1,
      COMMERCE_3_6_MO: 1,
      COMMERCE_6_9_MO: 0,
      COMMERCE_9_12_MO: 0,
      COMMERCE_12_MO_PLUS: 0,
    });
    assert.equal(report.ageTiers.every((tier) => tier.countSemantics === "exact"), true);
    const byState = Object.fromEntries(
      report.eligibleByState.map((row) => [row.state, row.eligible])
    );
    assert.equal(byState.GA, 1);
    assert.equal(byState.TX, 1);
    assert.equal(byState.FL, 0);
    assert.equal(byState.ZZ, undefined);
    assert.equal(
      report.eligibleByState.reduce((sum, row) => sum + (row.eligible ?? 0), 0),
      report.eligibleTotal
    );
  }

  const selected = ok(
    (await lookup(items, { ...extra, states: ["ga", "TX"] })).result
  );
  assert.equal(selected.stateScope, "selected");
  assert.deepEqual(selected.states, ["GA", "TX"]);
  assert.equal(selected.eligibleTotal, 2);
  assert.equal(selected.queryCompleteness, "complete");
  assert.deepEqual(
    Object.fromEntries(selected.eligibleByState.map((row) => [row.state, row.eligible])),
    { GA: 1, TX: 1 }
  );

  const georgiaOnly = ok((await lookup(items, { ...extra, states: ["GA"] })).result);
  assert.equal(georgiaOnly.stateScope, "selected");
  assert.equal(georgiaOnly.eligibleTotal, 1);
  assert.deepEqual(georgiaOnly.states, ["GA"]);
  assert.equal(georgiaOnly.eligibleByState.find((row) => row.state === "TX"), undefined);
});

test("invalid nonblank states do not become an all-states search", async () => {
  assert.deepEqual(parseBuyerAvailabilityStates(undefined), {
    ok: true,
    stateScope: "all",
    states: [],
  });
  assert.deepEqual(parseBuyerAvailabilityStates([]), {
    ok: true,
    stateScope: "all",
    states: [],
  });
  assert.deepEqual(parseBuyerAvailabilityStates(["  ", ""]), {
    ok: true,
    stateScope: "all",
    states: [],
  });
  assert.equal(buyerAvailabilityQueryStates({ stateScope: "all", states: [] }).length, 51);

  for (const states of [["Georgia"], ["ZZ"], ["GA", "ZZ"], ["GA", "not-a-state"]]) {
    const parsed = parseBuyerAvailabilityStates(states);
    assert.equal(parsed.ok, false, states.join(","));
    const { result, transactions } = await lookup([], { states });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "invalid_states");
    assert.equal(transactions.length, 0);
  }
});

test("an unfinished nationwide scan is a lower bound, not the eligible total", async () => {
  const { result } = await lookup(
    [
      makeItem({
        id: "fl-origin-old",
        ageDays: 500,
        phone: "+14045550321",
        state: "FL",
        origin: BUYER_ID,
      }),
      makeItem({
        id: "tx-ready",
        ageDays: 400,
        phone: "+14045550323",
        state: "TX",
        origin: "client_unrelated",
      }),
      makeItem({
        id: "ga-ready",
        ageDays: 40,
        phone: "+14045550322",
        state: "GA",
        origin: "client_unrelated",
      }),
    ],
    { omitStates: true, maxClassifiedRows: 1, pageSize: 1 }
  );
  const report = ok(result);
  assert.equal(report.stateScope, "all");
  assert.equal(report.queryCompleteness, "incomplete");
  assert.equal(report.eligibleCountSemantics, "lower_bound");
  assert.equal(report.scan.ceilingHit, true);
  assert.equal(report.eligibleTotal, 1);
  assert.equal(report.structuralCohort.stampedSameOrigin, 1);
  assert.match(report.summary, /All states/);
  assert.match(report.summary, /not a nationwide total/);
  assert.match(report.summary, /Classification stopped at the 1-row ceiling/);
  assert.equal(report.summary.includes("Exact buyer-eligible count"), false);
  assert.equal(report.eligibleByState.find((row) => row.state === "TX")?.countSemantics, "lower_bound");
  assert.equal(report.eligibleByState.find((row) => row.state === "TX")?.eligible, 1);
  assert.equal(report.eligibleByState.find((row) => row.state === "GA")?.countSemantics, "not_reached");
  assert.equal(report.eligibleByState.find((row) => row.state === "GA")?.eligible, null);
  assert.equal(report.eligibleByState.find((row) => row.state === "FL")?.eligible, null);
  const oldestTier = report.ageTiers.find((tier) => tier.commerceAgeBucketKey === "COMMERCE_12_MO_PLUS");
  assert.equal(oldestTier?.countSemantics, "lower_bound");
  assert.equal(oldestTier?.eligible, 1);
  const youngTier = report.ageTiers.find((tier) => tier.commerceAgeBucketKey === "COMMERCE_1_3_MO");
  assert.equal(youngTier?.countSemantics, "not_reached");
  assert.equal(youngTier?.eligible, null);
});

test("passes continue under one snapshot and do not double-count or reset exclusions", async () => {
  const sharedPhone = "+14045550401";
  const laterPhone = "+14045550402";
  const seenPhone = "+14045550403";
  const { result, transactions } = await lookup(
    [
      makeItem({
        id: "pass-1",
        ageDays: 140,
        phone: sharedPhone,
        state: "GA",
        origin: "client_unrelated",
      }),
      makeItem({
        id: "pass-2-dup",
        ageDays: 130,
        phone: sharedPhone,
        state: "TX",
        origin: "client_unrelated",
      }),
      makeItem({
        id: "pass-3-protected",
        ageDays: 120,
        phone: "+14045550409",
        state: "FL",
        origin: "client_unrelated",
        supplierAccountId: "supplier_blocked",
      }),
      makeItem({
        id: "pass-4-seen",
        ageDays: 110,
        phone: seenPhone,
        state: "NY",
        origin: "client_unrelated",
      }),
      makeItem({
        id: "pass-5-new",
        ageDays: 100,
        phone: laterPhone,
        state: "WA",
        origin: "client_unrelated",
      }),
      makeItem({
        id: "same-origin",
        ageDays: 150,
        phone: "+14045550408",
        state: "OH",
        origin: BUYER_ID,
      }),
      makeItem({
        id: "younger-tier",
        ageDays: 40,
        phone: "+14045550407",
        state: "CA",
        origin: "client_unrelated",
      }),
    ],
    {
      omitStates: true,
      commerceAgeBucketKeys: ["COMMERCE_3_6_MO"],
      maxClassifiedRows: 1,
      continuePastPassCeiling: true,
      pageSize: 1,
      priorPhones: [seenPhone],
      exclusions: [
        { matchType: "supplier_account_id", matchValue: "supplier_blocked", active: true },
      ],
    }
  );
  const report = ok(result);
  assert.equal(transactions.length, 1);
  assert.equal(report.stateScope, "all");
  assert.equal(report.queryCompleteness, "complete");
  assert.equal(report.eligibleCountSemantics, "exact");
  assert.equal(report.scan.ceilingHit, false);
  assert.equal(report.scan.classificationCeiling, 1);
  assert.equal(report.scan.continuedPastPassCeiling, true);
  assert.ok((report.scan.classificationPasses ?? 0) > 1);
  assert.equal(report.eligibleTotal, 2);
  assert.equal(report.exclusionReasons.currentBatchDuplicate.count, 1);
  assert.equal(report.exclusionReasons.protectedAgent.count, 1);
  assert.equal(report.exclusionReasons.sameBuyerPriorDelivery.count, 1);
  assert.equal(report.exclusionReasons.originClientStamped.count, 1);
  assert.equal(
    report.ageTiers.find((tier) => tier.commerceAgeBucketKey === "COMMERCE_3_6_MO")?.eligible,
    2
  );
  assert.equal(
    report.ageTiers.find((tier) => tier.commerceAgeBucketKey === "COMMERCE_1_3_MO"),
    undefined
  );
  assert.match(report.summary, /Exact buyer-eligible count is 2/);
  assert.match(report.summary, /All states/);
  assert.equal(report.summary.includes("not a nationwide total"), false);
  const byState = Object.fromEntries(report.eligibleByState.map((row) => [row.state, row.eligible]));
  assert.equal(byState.GA, 1);
  assert.equal(byState.TX, 0);
  assert.equal(byState.WA, 1);
  assert.equal(byState.FL, 0);
  assert.equal(byState.NY, 0);
});
