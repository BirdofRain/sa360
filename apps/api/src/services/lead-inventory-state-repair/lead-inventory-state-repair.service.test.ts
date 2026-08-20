import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CANONICAL_US_STATE_CODES,
  INVENTORY_STATE_REPAIR_COMMIT_CONFIRMATION,
  INVENTORY_STATE_REPAIR_QUARANTINE_REASON,
  isCanonicalUsStateCode,
} from "@sa360/shared";

import {
  commitInventoryStateRepair,
  computeRepairSetSha256,
  INVENTORY_STATE_REPAIR_SET_SCHEMA,
  previewInventoryStateRepair,
  serializeRepairSet,
} from "./lead-inventory-state-repair.service.js";

process.env.DATABASE_URL ??= "postgresql://sa360:sa360password@127.0.0.1:5432/sa360_test";

const REPAIRABLE_PENDING: Array<{ id: string; normalizedState: string; proposed: string }> = [
  { id: "inv_repair_01", normalizedState: "Charleston sc", proposed: "SC" },
  { id: "inv_repair_02", normalizedState: "Durham nc", proposed: "NC" },
  { id: "inv_repair_03", normalizedState: "Dover Pa", proposed: "PA" },
  { id: "inv_repair_04", normalizedState: "CT CT CT", proposed: "CT" },
  { id: "inv_repair_05", normalizedState: "Philadelphia Pennsylvania", proposed: "PA" },
  { id: "inv_repair_06", normalizedState: "Tn.", proposed: "TN" },
  { id: "inv_repair_07", normalizedState: "Ma.", proposed: "MA" },
  { id: "inv_repair_08", normalizedState: "N.H.", proposed: "NH" },
  { id: "inv_repair_09", normalizedState: "Oregon.", proposed: "OR" },
];

const UNRESOLVED_PENDING = [
  "Mass",
  "Fla",
  "Fla.",
  "Ark",
  "Tenn",
  "South Columbia",
  "Oklahola",
  "WXzhi gwashingto",
  "Peoria Illois",
  "Tecas",
  "alzbams",
  "NotAState",
  "ZZZ",
] as const;

type StoredItem = {
  id: string;
  sourceLeadEventId: string;
  generatedAt: Date;
  normalizedState: string;
  nicheKey: string;
  sourceProvider: string;
  sourceLane: string;
  inventoryLotId: string;
  phoneFingerprint: string | null;
  emailFingerprint: string | null;
  status: string;
  quarantineReason: string | null;
  metadataJson: unknown;
  inventoryLot: { lotKey: string; displayName: string };
  sourceLeadEvent: { sourceLeadId: string | null; normalizedPayloadJson: unknown };
  leadAllocations: Array<{ id: string; status: string }>;
};

function identitySnapshot(item: StoredItem) {
  return {
    id: item.id,
    sourceLeadEventId: item.sourceLeadEventId,
    generatedAt: item.generatedAt.toISOString(),
    nicheKey: item.nicheKey,
    sourceProvider: item.sourceProvider,
    sourceLane: item.sourceLane,
    inventoryLotId: item.inventoryLotId,
    phoneFingerprint: item.phoneFingerprint,
    emailFingerprint: item.emailFingerprint,
  };
}

function makeItem(partial: Partial<StoredItem> & Pick<StoredItem, "id" | "normalizedState" | "status">): StoredItem {
  const n = partial.id.replace(/\W/g, "");
  return {
    sourceLeadEventId: `sle_${n}`,
    generatedAt: new Date("2024-01-15T12:00:00.000Z"),
    nicheKey: "vet",
    sourceProvider: "leadcapture_io",
    sourceLane: "leadcapture_io",
    inventoryLotId: "lot_vet_legacy",
    phoneFingerprint: `phone_${n}`,
    emailFingerprint: `email_${n}`,
    quarantineReason: null,
    metadataJson: { existing: true },
    inventoryLot: {
      lotKey: "campaign:leadcapture_io:LCIO_LEGACY_VET:vet",
      displayName: "legacy vet",
    },
    sourceLeadEvent: { sourceLeadId: `src_${n}`, normalizedPayloadJson: { contact: {} } },
    leadAllocations: [],
    ...partial,
  };
}

function productionLikeItems(extras: StoredItem[] = []): StoredItem[] {
  const repairable = REPAIRABLE_PENDING.map((row) =>
    makeItem({
      id: row.id,
      normalizedState: row.normalizedState,
      status: "pending_review",
    })
  );
  const unresolved = UNRESOLVED_PENDING.map((state, index) =>
    makeItem({
      id: `inv_unresolved_${String(index + 1).padStart(2, "0")}`,
      normalizedState: state,
      status: "pending_review",
    })
  );
  return [
    ...repairable,
    ...unresolved,
    makeItem({ id: "inv_clean_nc", normalizedState: "NC", status: "available" }),
    ...extras,
  ];
}

function matchesWhere(item: StoredItem, where: Record<string, unknown> | undefined): boolean {
  if (!where) return true;
  for (const [key, value] of Object.entries(where)) {
    if (key === "NOT" && value && typeof value === "object") {
      const inner = value as { normalizedState?: { in?: string[] } };
      if (inner.normalizedState?.in && inner.normalizedState.in.includes(item.normalizedState)) {
        return false;
      }
      continue;
    }
    if (item[key as keyof StoredItem] !== value) return false;
  }
  return true;
}

function createRepairDb(
  items: StoredItem[],
  opts?: { onTransactionStart?: () => void }
) {
  const stats = {
    itemCreates: 0,
    itemDeletes: 0,
    eventCreates: 0,
    eventDeletes: 0,
    allocationCreates: 0,
    allocationDeletes: 0,
    buyerCreates: 0,
    buyerDeletes: 0,
    itemUpdates: 0,
    updatedIds: [] as string[],
  };
  const buyerDelivered: Array<{ leadInventoryItemId: string }> = [];

  const restoreItems = (snapshot: StoredItem[]) => {
    items.splice(0, items.length, ...structuredClone(snapshot));
  };

  const db = {
    stats,
    items,
    buyerDelivered,
    leadInventoryItem: {
      findMany: async ({ where }: { where?: Record<string, unknown> }) =>
        items.filter((item) => matchesWhere(item, where)).map((item) => ({ ...item })),
      updateMany: async ({
        where,
        data,
      }: {
        where?: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        let count = 0;
        for (const item of items) {
          if (!matchesWhere(item, where)) continue;
          if (typeof data.normalizedState === "string") item.normalizedState = data.normalizedState;
          if (typeof data.status === "string") item.status = data.status;
          if (typeof data.quarantineReason === "string") item.quarantineReason = data.quarantineReason;
          if ("metadataJson" in data) item.metadataJson = data.metadataJson;
          stats.itemUpdates += 1;
          stats.updatedIds.push(item.id);
          count += 1;
        }
        return { count };
      },
      create: async () => {
        stats.itemCreates += 1;
        return {};
      },
      delete: async () => {
        stats.itemDeletes += 1;
        return {};
      },
      deleteMany: async () => {
        stats.itemDeletes += 1;
        return { count: 0 };
      },
      groupBy: async ({ by }: { by: string[] }) => {
        const groups = new Map<string, { normalizedState: string; status?: string; _count: { _all: number } }>();
        for (const item of items) {
          const key = by.includes("status") ? `${item.normalizedState}::${item.status}` : item.normalizedState;
          const current = groups.get(key);
          if (current) current._count._all += 1;
          else {
            groups.set(key, {
              normalizedState: item.normalizedState,
              ...(by.includes("status") ? { status: item.status } : {}),
              _count: { _all: 1 },
            });
          }
        }
        return [...groups.values()];
      },
    },
    sourceLeadEvent: {
      create: async () => {
        stats.eventCreates += 1;
        return {};
      },
      delete: async () => {
        stats.eventDeletes += 1;
        return {};
      },
      deleteMany: async () => {
        stats.eventDeletes += 1;
        return { count: 0 };
      },
    },
    leadAllocation: {
      create: async () => {
        stats.allocationCreates += 1;
        return {};
      },
      delete: async () => {
        stats.allocationDeletes += 1;
        return {};
      },
      deleteMany: async () => {
        stats.allocationDeletes += 1;
        return { count: 0 };
      },
    },
    buyerDeliveredIdentity: {
      findMany: async ({ where }: { where?: { leadInventoryItemId?: { in?: string[] } } }) => {
        const allowed = new Set(where?.leadInventoryItemId?.in ?? []);
        return buyerDelivered.filter((row) => allowed.size === 0 || allowed.has(row.leadInventoryItemId));
      },
      create: async () => {
        stats.buyerCreates += 1;
        return {};
      },
      delete: async () => {
        stats.buyerDeletes += 1;
        return {};
      },
      deleteMany: async () => {
        stats.buyerDeletes += 1;
        return { count: 0 };
      },
    },
    leadInventoryFacetBuild: {
      findFirst: async () => null,
    },
    leadInventoryFacetSupplyAggregate: {
      groupBy: async () => [],
    },
    $queryRaw: async () =>
      items
        .filter((item) => !isCanonicalUsStateCode(item.normalizedState))
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        .map((item) => ({ id: item.id })),
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      opts?.onTransactionStart?.();
      const itemSnapshot = structuredClone(items);
      const statsSnapshot = {
        ...stats,
        updatedIds: [...stats.updatedIds],
      };
      try {
        return await fn(db);
      } catch (err) {
        restoreItems(itemSnapshot);
        stats.itemCreates = statsSnapshot.itemCreates;
        stats.itemDeletes = statsSnapshot.itemDeletes;
        stats.eventCreates = statsSnapshot.eventCreates;
        stats.eventDeletes = statsSnapshot.eventDeletes;
        stats.allocationCreates = statsSnapshot.allocationCreates;
        stats.allocationDeletes = statsSnapshot.allocationDeletes;
        stats.buyerCreates = statsSnapshot.buyerCreates;
        stats.buyerDeletes = statsSnapshot.buyerDeletes;
        stats.itemUpdates = statsSnapshot.itemUpdates;
        stats.updatedIds = [...statsSnapshot.updatedIds];
        throw err;
      }
    },
  };
  return db;
}

function commitArgs(expectedSetSha256?: string) {
  return {
    mode: "state-repair-commit" as const,
    expectedDbHost: "127.0.0.1",
    operator: "agent-o",
    confirmation: INVENTORY_STATE_REPAIR_COMMIT_CONFIRMATION,
    expectedSetSha256,
  };
}

test("commit refuses without explicit mode, host, operator, confirmation, and set fingerprint", async () => {
  const missingMode = await commitInventoryStateRepair(
    {
      mode: "state-repair-preview",
      expectedDbHost: "127.0.0.1",
      operator: "agent-o",
      confirmation: INVENTORY_STATE_REPAIR_COMMIT_CONFIRMATION,
      expectedSetSha256: "abc",
    },
    {} as never
  );
  assert.equal(missingMode.ok, false);
  if (!missingMode.ok) assert.equal(missingMode.error, "explicit_commit_mode_required");

  const missingConfirm = await commitInventoryStateRepair(
    {
      mode: "state-repair-commit",
      expectedDbHost: "127.0.0.1",
      operator: "agent-o",
      confirmation: "NOPE",
      expectedSetSha256: "abc",
    },
    {} as never
  );
  assert.equal(missingConfirm.ok, false);
  if (!missingConfirm.ok) assert.equal(missingConfirm.error, "confirmation_required");

  const missingSet = await commitInventoryStateRepair(
    {
      mode: "state-repair-commit",
      expectedDbHost: "127.0.0.1",
      operator: "agent-o",
      confirmation: INVENTORY_STATE_REPAIR_COMMIT_CONFIRMATION,
    },
    {} as never
  );
  assert.equal(missingSet.ok, false);
  if (!missingSet.ok) assert.equal(missingSet.error, "expected_set_sha256_required");
});

test("repair set fingerprint is deterministic and PII-free", () => {
  const rows = [
    {
      id: "b",
      normalizedState: "Mass",
      status: "pending_review",
      classification: "UNRESOLVED_INVALID_STATE" as const,
      proposedState: null,
    },
    {
      id: "a",
      normalizedState: "Charleston sc",
      status: "pending_review",
      classification: "REPAIRABLE_CANONICAL_STATE" as const,
      proposedState: "SC",
    },
  ];
  const payload = serializeRepairSet(rows);
  assert.match(payload, new RegExp(`^${INVENTORY_STATE_REPAIR_SET_SCHEMA}\\n`));
  assert.ok(payload.indexOf("id\ta") < 0);
  assert.ok(payload.startsWith(`${INVENTORY_STATE_REPAIR_SET_SCHEMA}\na\t`));
  assert.equal(payload.includes("email"), false);
  assert.equal(payload.includes("phone"), false);
  assert.equal(computeRepairSetSha256(rows), computeRepairSetSha256([...rows].reverse()));
});

test("A/B/F/G/H/I exact-set write behavior for the authorized 22-row population", async () => {
  const items = productionLikeItems();
  const db = createRepairDb(items);
  const charlestonBefore = items.find((item) => item.id === "inv_repair_01")!;
  const unresolvedBefore = items.find((item) => item.id === "inv_unresolved_01")!;
  const charlestonIdentity = identitySnapshot(charlestonBefore);
  const unresolvedIdentity = identitySnapshot(unresolvedBefore);
  const itemCountBefore = items.length;

  const preview = await previewInventoryStateRepair(
    { expectedDbHost: "127.0.0.1", operator: "agent-o" },
    db as never
  );
  assert.equal(preview.ok, true);
  assert.equal(preview.invalidInventoryStateTotal, 22);
  assert.equal(preview.repairableCount, 9);
  assert.equal(preview.unresolvedCount, 13);
  assert.equal(preview.conflictingCount, 0);
  assert.equal(preview.progressedInvalidCount, 0);
  assert.equal(preview.repairSetSchema, INVENTORY_STATE_REPAIR_SET_SCHEMA);
  assert.match(preview.repairSetSha256, /^[a-f0-9]{64}$/);

  const committed = await commitInventoryStateRepair(commitArgs(preview.repairSetSha256), db as never);
  assert.equal(committed.ok, true);
  if (!committed.ok) throw new Error("expected commit");
  assert.equal(committed.repairedCount, 9);
  assert.equal(committed.quarantinedCount, 0);
  assert.equal(committed.metadataOnlyCount, 13);
  assert.equal(
    committed.repairedCount + committed.metadataOnlyCount + committed.quarantinedCount,
    22
  );

  const charleston = items.find((item) => item.id === "inv_repair_01")!;
  assert.equal(charleston.normalizedState, "SC");
  assert.equal(charleston.status, "pending_review");
  assert.deepEqual(identitySnapshot(charleston), charlestonIdentity);
  assert.equal(isCanonicalUsStateCode(charleston.normalizedState), true);

  for (const row of REPAIRABLE_PENDING) {
    const item = items.find((candidate) => candidate.id === row.id)!;
    assert.equal(item.normalizedState, row.proposed, row.id);
    assert.equal(item.status, "pending_review", row.id);
  }

  const unresolved = items.find((item) => item.id === "inv_unresolved_01")!;
  assert.equal(unresolved.normalizedState, "Mass");
  assert.equal(unresolved.status, "pending_review");
  assert.equal(unresolved.quarantineReason, null);
  assert.deepEqual(identitySnapshot(unresolved), unresolvedIdentity);
  const meta = unresolved.metadataJson as { stateRepair?: { classification?: string } };
  assert.equal(meta.stateRepair?.classification, "UNRESOLVED_INVALID_STATE");

  const clean = items.find((item) => item.id === "inv_clean_nc")!;
  assert.equal(clean.normalizedState, "NC");
  assert.equal(clean.status, "available");
  assert.equal(db.stats.updatedIds.includes("inv_clean_nc"), false);
  assert.deepEqual(
    [...new Set(db.stats.updatedIds)].sort(),
    [...REPAIRABLE_PENDING.map((row) => row.id), ...UNRESOLVED_PENDING.map((_, i) => `inv_unresolved_${String(i + 1).padStart(2, "0")}`)].sort()
  );

  assert.equal(items.length, itemCountBefore);
  assert.equal(db.stats.itemCreates, 0);
  assert.equal(db.stats.itemDeletes, 0);
  assert.equal(db.stats.eventCreates, 0);
  assert.equal(db.stats.eventDeletes, 0);
  assert.equal(db.stats.allocationCreates, 0);
  assert.equal(db.stats.allocationDeletes, 0);
  assert.equal(db.stats.buyerCreates, 0);
  assert.equal(db.stats.buyerDeletes, 0);

  const post = await previewInventoryStateRepair(
    { expectedDbHost: "127.0.0.1", operator: "agent-o" },
    db as never
  );
  assert.equal(post.invalidInventoryStateTotal, 13);
  assert.equal(post.repairableCount, 0);
  assert.equal(post.unresolvedCount, 13);
  assert.equal(post.expectedInvalidReviewCount, 13);
  assert.notEqual(post.repairSetSha256, preview.repairSetSha256);

  const updatesAfterFirst = db.stats.itemUpdates;
  const second = await commitInventoryStateRepair(commitArgs(preview.repairSetSha256), db as never);
  assert.equal(second.ok, false);
  if (!second.ok) assert.equal(second.error, "repair_set_changed");
  assert.equal(db.stats.itemUpdates, updatesAfterFirst);
});

test("C. unresolved available row is quarantined and is no longer sellable", async () => {
  const items = [
    makeItem({
      id: "inv_available_unresolved",
      normalizedState: "South Columbia",
      status: "available",
    }),
  ];
  const db = createRepairDb(items);
  const preview = await previewInventoryStateRepair(
    { expectedDbHost: "127.0.0.1", operator: "agent-o" },
    db as never
  );
  assert.equal(preview.sellableUnresolvedCount, 1);
  const committed = await commitInventoryStateRepair(commitArgs(preview.repairSetSha256), db as never);
  assert.equal(committed.ok, true);
  if (!committed.ok) throw new Error("expected commit");
  assert.equal(committed.quarantinedCount, 1);
  assert.equal(items[0]?.normalizedState, "South Columbia");
  assert.equal(items[0]?.status, "quarantined");
  assert.equal(items[0]?.quarantineReason, INVENTORY_STATE_REPAIR_QUARANTINE_REASON);
  assert.notEqual(items[0]?.status, "available");
});

test("D. progressed invalid inventory hard-stops commit before writes", async () => {
  const items = [
    makeItem({
      id: "inv_reserved_dirty",
      normalizedState: "Charleston sc",
      status: "reserved",
      leadAllocations: [{ id: "alloc_1", status: "reserved" }],
    }),
  ];
  const db = createRepairDb(items);
  const preview = await previewInventoryStateRepair(
    { expectedDbHost: "127.0.0.1", operator: "agent-o" },
    db as never
  );
  assert.equal(preview.progressedInvalidCount, 1);
  assert.equal(preview.repairableCount, 1);
  const committed = await commitInventoryStateRepair(commitArgs(preview.repairSetSha256), db as never);
  assert.equal(committed.ok, false);
  if (!committed.ok) {
    assert.equal(committed.error, "progressed_invalid_inventory_requires_manual_review");
  }
  assert.equal(db.stats.itemUpdates, 0);
  assert.equal(items[0]?.normalizedState, "Charleston sc");
  assert.equal(items[0]?.status, "reserved");
});

test("E. set fingerprint mismatch rejects commit before writes", async () => {
  const items = productionLikeItems();
  const db = createRepairDb(items);
  const preview = await previewInventoryStateRepair(
    { expectedDbHost: "127.0.0.1", operator: "agent-o" },
    db as never
  );
  const committed = await commitInventoryStateRepair(commitArgs("0".repeat(64)), db as never);
  assert.equal(committed.ok, false);
  if (!committed.ok) assert.equal(committed.error, "repair_set_changed");
  assert.equal(db.stats.itemUpdates, 0);
  assert.equal(items.find((item) => item.id === "inv_repair_01")?.normalizedState, "Charleston sc");
  assert.notEqual(preview.repairSetSha256, "0".repeat(64));
});

test("canonical allowlist used by fingerprint still has 51 codes", () => {
  assert.equal(CANONICAL_US_STATE_CODES.length, 51);
  assert.equal(CANONICAL_US_STATE_CODES.includes("DC"), true);
});

test("A. repairable pending_review becoming reserved after preflight rolls back with 0 writes", async () => {
  const items = productionLikeItems();
  const db = createRepairDb(items, {
    onTransactionStart: () => {
      const row = items.find((item) => item.id === "inv_repair_01");
      if (row) {
        row.status = "reserved";
        row.leadAllocations = [{ id: "alloc_race", status: "reserved" }];
      }
    },
  });
  const preview = await previewInventoryStateRepair(
    { expectedDbHost: "127.0.0.1", operator: "agent-o" },
    db as never
  );
  assert.equal(preview.progressedInvalidCount, 0);
  const committed = await commitInventoryStateRepair(commitArgs(preview.repairSetSha256), db as never);
  assert.equal(committed.ok, false);
  if (!committed.ok) {
    assert.ok(
      committed.error === "progressed_invalid_inventory_requires_manual_review" ||
        committed.error === "repair_set_changed"
    );
  }
  assert.equal(db.stats.itemUpdates, 0);
  assert.equal(items.find((item) => item.id === "inv_repair_01")?.normalizedState, "Charleston sc");
  assert.equal(items.find((item) => item.id === "inv_repair_01")?.status, "reserved");
  assert.equal(items.find((item) => item.id === "inv_repair_02")?.normalizedState, "Durham nc");
});

test("B. unresolved pending_review becoming reserved after preflight rolls back with 0 writes", async () => {
  const items = productionLikeItems();
  const db = createRepairDb(items, {
    onTransactionStart: () => {
      const row = items.find((item) => item.id === "inv_unresolved_01");
      if (row) {
        row.status = "reserved";
        row.leadAllocations = [{ id: "alloc_race", status: "reserved" }];
      }
    },
  });
  const preview = await previewInventoryStateRepair(
    { expectedDbHost: "127.0.0.1", operator: "agent-o" },
    db as never
  );
  const committed = await commitInventoryStateRepair(commitArgs(preview.repairSetSha256), db as never);
  assert.equal(committed.ok, false);
  if (!committed.ok) {
    assert.ok(
      committed.error === "progressed_invalid_inventory_requires_manual_review" ||
        committed.error === "repair_set_changed"
    );
  }
  assert.equal(db.stats.itemUpdates, 0);
  assert.equal(items.find((item) => item.id === "inv_unresolved_01")?.normalizedState, "Mass");
  assert.equal(items.find((item) => item.id === "inv_unresolved_01")?.status, "reserved");
  assert.equal(items.find((item) => item.id === "inv_repair_01")?.normalizedState, "Charleston sc");
});

test("C. one of 22 changing status after authorization rolls back every row", async () => {
  const items = productionLikeItems();
  const db = createRepairDb(items, {
    onTransactionStart: () => {
      const row = items.find((item) => item.id === "inv_repair_05");
      if (row) row.status = "available";
    },
  });
  const preview = await previewInventoryStateRepair(
    { expectedDbHost: "127.0.0.1", operator: "agent-o" },
    db as never
  );
  const committed = await commitInventoryStateRepair(commitArgs(preview.repairSetSha256), db as never);
  assert.equal(committed.ok, false);
  if (!committed.ok) assert.equal(committed.error, "repair_set_changed");
  assert.equal("committed" in committed && committed.committed === true, false);
  assert.equal(db.stats.itemUpdates, 0);
  assert.equal(items.find((item) => item.id === "inv_repair_05")?.status, "available");
  assert.equal(items.find((item) => item.id === "inv_repair_05")?.normalizedState, "Philadelphia Pennsylvania");
  for (const row of REPAIRABLE_PENDING.filter((item) => item.id !== "inv_repair_05")) {
    const item = items.find((candidate) => candidate.id === row.id)!;
    assert.equal(item.normalizedState, row.normalizedState, row.id);
    assert.equal(item.status, "pending_review", row.id);
  }
  for (const [index, state] of UNRESOLVED_PENDING.entries()) {
    const id = `inv_unresolved_${String(index + 1).padStart(2, "0")}`;
    const item = items.find((candidate) => candidate.id === id)!;
    assert.equal(item.normalizedState, state, id);
    assert.equal(item.status, "pending_review", id);
  }
});

test("D. one row normalizedState changing after authorization rolls back the set", async () => {
  const items = productionLikeItems();
  const db = createRepairDb(items, {
    onTransactionStart: () => {
      const row = items.find((item) => item.id === "inv_repair_01");
      if (row) row.normalizedState = "Charleston sc CHANGED";
    },
  });
  const preview = await previewInventoryStateRepair(
    { expectedDbHost: "127.0.0.1", operator: "agent-o" },
    db as never
  );
  const committed = await commitInventoryStateRepair(commitArgs(preview.repairSetSha256), db as never);
  assert.equal(committed.ok, false);
  if (!committed.ok) assert.equal(committed.error, "repair_set_changed");
  assert.equal(db.stats.itemUpdates, 0);
  assert.equal(items.find((item) => item.id === "inv_repair_01")?.normalizedState, "Charleston sc CHANGED");
  assert.equal(items.find((item) => item.id === "inv_repair_02")?.normalizedState, "Durham nc");
});

test("E/F. unchanged 22-row set commits only when every authorized mutation reconciles", async () => {
  const items = productionLikeItems();
  const db = createRepairDb(items);
  const preview = await previewInventoryStateRepair(
    { expectedDbHost: "127.0.0.1", operator: "agent-o" },
    db as never
  );
  const committed = await commitInventoryStateRepair(commitArgs(preview.repairSetSha256), db as never);
  assert.equal(committed.ok, true);
  if (!committed.ok) throw new Error("expected commit");
  assert.equal(committed.committed, true);
  assert.equal(committed.repairedCount, 9);
  assert.equal(committed.metadataOnlyCount, 13);
  assert.equal(committed.quarantinedCount, 0);
  assert.equal(
    committed.repairedCount + committed.metadataOnlyCount + committed.quarantinedCount,
    preview.repairSetItemCount
  );
  assert.equal(preview.repairSetItemCount, 22);
  for (const row of REPAIRABLE_PENDING) {
    assert.equal(items.find((item) => item.id === row.id)?.normalizedState, row.proposed);
    assert.equal(items.find((item) => item.id === row.id)?.status, "pending_review");
  }
  for (const [index, state] of UNRESOLVED_PENDING.entries()) {
    const id = `inv_unresolved_${String(index + 1).padStart(2, "0")}`;
    assert.equal(items.find((item) => item.id === id)?.normalizedState, state);
    assert.equal(items.find((item) => item.id === id)?.status, "pending_review");
  }
});

