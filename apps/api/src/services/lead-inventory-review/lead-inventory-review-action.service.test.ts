import { test } from "node:test";
import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";

import { DEFAULT_AGE_BANDS_V1 } from "../lead-inventory/lead-inventory.constants.js";
import {
  commitLeadInventoryReviewAction,
  previewLeadInventoryReviewAction,
} from "./lead-inventory-review-action.service.js";
import { buildReviewSelectionFingerprint } from "./lead-inventory-review-fingerprint.js";
import {
  LEAD_INVENTORY_REVIEW_MAKE_AVAILABLE_CONFIRMATION,
  LEAD_INVENTORY_REVIEW_QUARANTINE_CONFIRMATION,
  LEAD_INVENTORY_REVIEW_REJECT_CONFIRMATION,
} from "@sa360/shared";

function makeItem(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    status: "pending_review",
    generatedAt: new Date("2026-06-01T00:00:00.000Z"),
    normalizedState: "TX",
    nicheKey: "vet",
    productType: "aged",
    sourceProvider: "manual_import",
    sourceLane: "aged_inventory_csv",
    inventoryClass: "aged",
    inventoryLotId: "lot_1",
    sourceLeadEventId: `evt_${id}`,
    quarantineReason: null,
    availableAt: null,
    reservedAt: null,
    committedAt: null,
    withdrawnAt: null,
    expiredAt: null,
    rejectedAt: null,
    maxFulfillments: 1,
    fulfillmentCount: 0,
    metadataJson: { importRequestId: "req-import-1" },
    inventoryLot: {
      id: "lot_1",
      status: "active",
      lotKey: "lot-key-1",
      sourceLane: "aged_inventory_csv",
      sourceProvider: "manual_import",
    },
    sourceLeadEvent: {
      id: `evt_${id}`,
      sourceLeadUid: `uid_${id}`,
      sourceProvider: "manual_import",
      sourceSystem: "csv_import",
      normalizedPayloadJson: {
        phone_e164: "+15550100001",
        email: "masked@example.com",
        state: "TX",
      },
      enrichmentMetadataJson: { sourceLane: "aged_inventory_csv" },
      receivedAt: new Date("2026-06-01T00:00:00.000Z"),
    },
    leadAllocations: [],
    ...overrides,
  };
}

function makeDb(options: {
  items?: ReturnType<typeof makeItem>[];
  existingAction?: Record<string, unknown> | null;
  itemStatusById?: Record<string, string>;
} = {}) {
  const items = options.items ?? [makeItem("item_1")];
  const itemStatusById = options.itemStatusById ?? Object.fromEntries(items.map((i) => [i.id, i.status]));
  const writes: string[] = [];
  const actions: Record<string, unknown>[] = [];
  const itemResults: Record<string, unknown>[] = [];
  let actionSeq = 0;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db: any = {
    leadAgeBandDefinition: {
      findMany: async () => DEFAULT_AGE_BANDS_V1.map((band, index) => ({
        ...band,
        id: `band_${index}`,
        version: "v1",
        active: true,
        effectiveFrom: new Date("2020-01-01T00:00:00.000Z"),
        effectiveTo: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
    },
    leadInventoryItem: {
      findMany: async ({ where }: { where: { id: { in: string[] } } }) =>
        items.filter((item) => where.id.in.includes(item.id)).map((item) => ({
          ...item,
          status: itemStatusById[item.id] ?? item.status,
        })),
      updateMany: async ({
        where,
        data,
      }: {
        where: { id: string; status: string };
        data: Record<string, unknown>;
      }) => {
        if ((itemStatusById[where.id] ?? "pending_review") !== where.status) {
          return { count: 0 };
        }
        itemStatusById[where.id] = String(data.status);
        writes.push(`update:${where.id}:${String(data.status)}`);
        return { count: 1 };
      },
    },
    leadProof: {
      findUnique: async () => ({ proofStatus: "UNREVIEWED" }),
    },
    leadVerificationResult: {
      findUnique: async () => ({
        verificationStatus: "PASSED",
        duplicateStatus: "UNIQUE",
      }),
    },
    leadInventoryReviewAction: {
      findUnique: async ({ where }: { where: { requestId: string } }) => {
        if (options.existingAction && options.existingAction.requestId === where.requestId) {
          return {
            itemResults: [],
            ...options.existingAction,
          };
        }
        const found = actions.find((row) => row.requestId === where.requestId) ?? null;
        if (!found) return null;
        return {
          ...found,
          itemResults: itemResults.filter((row) => row.reviewActionId === found.id),
        };
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        actionSeq += 1;
        const row = { id: `action_${actionSeq}`, ...data, createdAt: new Date(), updatedAt: new Date() };
        actions.push(row);
        writes.push("reviewAction:create");
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = actions.find((entry) => entry.id === where.id);
        Object.assign(row!, data);
        writes.push("reviewAction:update");
        return row!;
      },
    },
    leadInventoryReviewItemResult: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `result_${itemResults.length + 1}`, createdAt: new Date(), ...data };
        itemResults.push(row);
        writes.push("reviewItemResult:create");
        return row;
      },
    },
    $transaction: async <T>(fn: (tx: typeof db) => Promise<T>) => fn(db),
    _writes: writes,
    _actions: actions,
    _itemResults: itemResults,
    _itemStatusById: itemStatusById,
  };

  return db as unknown as PrismaClient & {
    _writes: string[];
    _actions: Record<string, unknown>[];
    _itemResults: Record<string, unknown>[];
    _itemStatusById: Record<string, string>;
  };
}

test("preview performs zero writes and returns confirmation phrase", async () => {
  const db = makeDb();
  const preview = await previewLeadInventoryReviewAction(
    {
      requestId: "req_preview_1",
      actionType: "make_available",
      itemIds: ["item_1"],
      reasonCode: "review_passed",
    },
    db
  );
  assert.equal(preview.ok, true);
  if (!preview.ok) return;
  assert.equal(preview.writesPerformed, 0);
  assert.equal(preview.confirmationPhraseRequired, LEAD_INVENTORY_REVIEW_MAKE_AVAILABLE_CONFIRMATION);
  assert.equal(preview.eligibleCount, 1);
  assert.equal(db._writes.length, 0);
  assert.equal(JSON.stringify(preview).includes("+15550100001"), false);
  assert.equal(JSON.stringify(preview).includes("masked@example.com"), false);
});

test("preview enforces item limit", async () => {
  const db = makeDb();
  const preview = await previewLeadInventoryReviewAction(
    {
      requestId: "req_preview_limit",
      actionType: "quarantine",
      itemIds: Array.from({ length: 101 }, (_, i) => `item_${i}`),
      reasonCode: "operator_quarantine",
    },
    db
  );
  assert.equal(preview.ok, false);
  if (preview.ok) return;
  assert.equal(preview.code, "item_limit_exceeded");
});

test("commit requires feature flag and exact phrase", async () => {
  const prev = process.env.SA360_LEAD_INVENTORY_REVIEW_ENABLED;
  delete process.env.SA360_LEAD_INVENTORY_REVIEW_ENABLED;
  try {
    const db = makeDb();
    const fingerprint = buildReviewSelectionFingerprint({
      actionType: "make_available",
      itemIds: ["item_1"],
      reasonCode: "review_passed",
    });
    const disabled = await commitLeadInventoryReviewAction(
      {
        requestId: "req_commit_disabled",
        actionType: "make_available",
        itemIds: ["item_1"],
        reasonCode: "review_passed",
        selectionFingerprint: fingerprint,
        confirmationPhrase: LEAD_INVENTORY_REVIEW_MAKE_AVAILABLE_CONFIRMATION,
      },
      db
    );
    assert.equal(disabled.ok, false);
    if (!disabled.ok) assert.equal(disabled.code, "review_activation_disabled");

    process.env.SA360_LEAD_INVENTORY_REVIEW_ENABLED = "true";
    const wrong = await commitLeadInventoryReviewAction(
      {
        requestId: "req_commit_wrong",
        actionType: "make_available",
        itemIds: ["item_1"],
        reasonCode: "review_passed",
        selectionFingerprint: fingerprint,
        confirmationPhrase: "WRONG",
      },
      db
    );
    assert.equal(wrong.ok, false);
    if (!wrong.ok) assert.equal(wrong.code, "invalid_confirmation");
  } finally {
    if (prev === undefined) delete process.env.SA360_LEAD_INVENTORY_REVIEW_ENABLED;
    else process.env.SA360_LEAD_INVENTORY_REVIEW_ENABLED = prev;
  }
});

test("commit make_available / quarantine / reject transitions and idempotent replay", async () => {
  const prev = process.env.SA360_LEAD_INVENTORY_REVIEW_ENABLED;
  process.env.SA360_LEAD_INVENTORY_REVIEW_ENABLED = "true";
  try {
    const db = makeDb({ items: [makeItem("item_a"), makeItem("item_b"), makeItem("item_c")] });

    const availableFp = buildReviewSelectionFingerprint({
      actionType: "make_available",
      itemIds: ["item_a"],
      reasonCode: "review_passed",
    });
    const available = await commitLeadInventoryReviewAction(
      {
        requestId: "req_avail_1",
        actionType: "make_available",
        itemIds: ["item_a"],
        reasonCode: "review_passed",
        selectionFingerprint: availableFp,
        confirmationPhrase: LEAD_INVENTORY_REVIEW_MAKE_AVAILABLE_CONFIRMATION,
      },
      db
    );
    assert.equal(available.ok, true);
    if (!available.ok) return;
    assert.equal(available.action.appliedCount, 1);
    assert.equal(db._itemStatusById.item_a, "available");
    assert.ok(db._writes.some((w) => w.startsWith("update:item_a:available")));

    const replay = await commitLeadInventoryReviewAction(
      {
        requestId: "req_avail_1",
        actionType: "make_available",
        itemIds: ["item_a"],
        reasonCode: "review_passed",
        selectionFingerprint: availableFp,
        confirmationPhrase: LEAD_INVENTORY_REVIEW_MAKE_AVAILABLE_CONFIRMATION,
      },
      db
    );
    assert.equal(replay.ok, true);
    if (!replay.ok) return;
    assert.equal(replay.idempotentReplay, true);

    const conflict = await commitLeadInventoryReviewAction(
      {
        requestId: "req_avail_1",
        actionType: "reject",
        itemIds: ["item_a"],
        reasonCode: "operator_rejected",
        selectionFingerprint: buildReviewSelectionFingerprint({
          actionType: "reject",
          itemIds: ["item_a"],
          reasonCode: "operator_rejected",
        }),
        confirmationPhrase: LEAD_INVENTORY_REVIEW_REJECT_CONFIRMATION,
      },
      db
    );
    assert.equal(conflict.ok, false);
    if (!conflict.ok) assert.equal(conflict.code, "request_id_conflict");

    const quarantine = await commitLeadInventoryReviewAction(
      {
        requestId: "req_quar_1",
        actionType: "quarantine",
        itemIds: ["item_b"],
        reasonCode: "operator_quarantine",
        selectionFingerprint: buildReviewSelectionFingerprint({
          actionType: "quarantine",
          itemIds: ["item_b"],
          reasonCode: "operator_quarantine",
        }),
        confirmationPhrase: LEAD_INVENTORY_REVIEW_QUARANTINE_CONFIRMATION,
      },
      db
    );
    assert.equal(quarantine.ok, true);
    if (!quarantine.ok) return;
    assert.equal(db._itemStatusById.item_b, "quarantined");

    const rejected = await commitLeadInventoryReviewAction(
      {
        requestId: "req_rej_1",
        actionType: "reject",
        itemIds: ["item_c"],
        reasonCode: "operator_rejected",
        selectionFingerprint: buildReviewSelectionFingerprint({
          actionType: "reject",
          itemIds: ["item_c"],
          reasonCode: "operator_rejected",
        }),
        confirmationPhrase: LEAD_INVENTORY_REVIEW_REJECT_CONFIRMATION,
      },
      db
    );
    assert.equal(rejected.ok, true);
    if (!rejected.ok) return;
    assert.equal(db._itemStatusById.item_c, "rejected");

    // No allocation/order/delivery/outbox/trust writes in this guarded path.
    assert.equal(db._writes.some((w) => w.includes("allocation")), false);
    assert.equal(db._writes.some((w) => w.includes("delivery")), false);
    assert.equal(db._writes.some((w) => w.includes("trust")), false);
  } finally {
    if (prev === undefined) delete process.env.SA360_LEAD_INVENTORY_REVIEW_ENABLED;
    else process.env.SA360_LEAD_INVENTORY_REVIEW_ENABLED = prev;
  }
});

test("commit blocks stale status and changed fingerprint", async () => {
  const prev = process.env.SA360_LEAD_INVENTORY_REVIEW_ENABLED;
  process.env.SA360_LEAD_INVENTORY_REVIEW_ENABLED = "true";
  try {
    const db = makeDb({
      items: [makeItem("item_stale")],
      itemStatusById: { item_stale: "available" },
    });
    const fingerprint = buildReviewSelectionFingerprint({
      actionType: "make_available",
      itemIds: ["item_stale"],
      reasonCode: "review_passed",
    });
    const mismatched = await commitLeadInventoryReviewAction(
      {
        requestId: "req_fp_mismatch",
        actionType: "make_available",
        itemIds: ["item_stale"],
        reasonCode: "review_passed",
        selectionFingerprint: "b".repeat(64),
        confirmationPhrase: LEAD_INVENTORY_REVIEW_MAKE_AVAILABLE_CONFIRMATION,
      },
      db
    );
    assert.equal(mismatched.ok, false);
    if (!mismatched.ok) assert.equal(mismatched.code, "selection_fingerprint_mismatch");

    // Reset status to pending for preview-eligible path, then force concurrent stale update.
    db._itemStatusById.item_stale = "pending_review";
    const items = [makeItem("item_stale")];
    const db2 = makeDb({ items, itemStatusById: { item_stale: "pending_review" } });
    // Simulate concurrent change after preview by flipping status before updateMany succeeds:
    const originalUpdate = (db2 as unknown as {
      leadInventoryItem: { updateMany: Function };
    }).leadInventoryItem.updateMany;
    (db2 as unknown as { leadInventoryItem: { updateMany: Function } }).leadInventoryItem.updateMany =
      async (args: unknown) => {
        db2._itemStatusById.item_stale = "available";
        return originalUpdate(args);
      };

    const stale = await commitLeadInventoryReviewAction(
      {
        requestId: "req_stale_1",
        actionType: "make_available",
        itemIds: ["item_stale"],
        reasonCode: "review_passed",
        selectionFingerprint: fingerprint,
        confirmationPhrase: LEAD_INVENTORY_REVIEW_MAKE_AVAILABLE_CONFIRMATION,
      },
      db2
    );
    assert.equal(stale.ok, true);
    if (!stale.ok) return;
    assert.equal(stale.action.appliedCount, 0);
    assert.equal(stale.action.blockedCount, 1);
  } finally {
    if (prev === undefined) delete process.env.SA360_LEAD_INVENTORY_REVIEW_ENABLED;
    else process.env.SA360_LEAD_INVENTORY_REVIEW_ENABLED = prev;
  }
});
