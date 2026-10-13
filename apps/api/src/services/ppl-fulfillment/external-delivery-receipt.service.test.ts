import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import type { PrismaClient } from "@prisma/client";

import { fingerprintIdentityValue } from "../../lib/identity-fingerprint.js";
import {
  EXTERNAL_RECEIPT_APPLY_PHRASE,
  applyExternalDeliveryReceipts,
  classifyReceiptRows,
  isPplExternalReceiptImportEnabled,
  loadAppliedExternalReceiptFingerprints,
  previewExternalDeliveryReceipts,
  reconcileOccupiedRows,
} from "./external-delivery-receipt.service.js";
import { loadBuyerSeenFingerprints } from "./inventory-selection.service.js";

const originalFlag = process.env.SA360_PPL_EXTERNAL_RECEIPT_IMPORT_ENABLED;

afterEach(() => {
  if (originalFlag === undefined) delete process.env.SA360_PPL_EXTERNAL_RECEIPT_IMPORT_ENABLED;
  else process.env.SA360_PPL_EXTERNAL_RECEIPT_IMPORT_ENABLED = originalFlag;
});

describe("external receipt flags and reconciliation", () => {
  it("defaults off and enables only for true", () => {
    delete process.env.SA360_PPL_EXTERNAL_RECEIPT_IMPORT_ENABLED;
    assert.equal(isPplExternalReceiptImportEnabled(), false);
    process.env.SA360_PPL_EXTERNAL_RECEIPT_IMPORT_ENABLED = "1";
    assert.equal(isPplExternalReceiptImportEnabled(), false);
    process.env.SA360_PPL_EXTERNAL_RECEIPT_IMPORT_ENABLED = "true";
    assert.equal(isPplExternalReceiptImportEnabled(), true);
  });

  it("reconciles 3261 occupied spreadsheet rows to 3260 unique leads", () => {
    const rows = Array.from({ length: 3260 }, (_, index) => ({
      rowNumber: index + 1,
      phone: `202555${String(index).padStart(4, "0")}`,
      email: `lead${index}@example.test`,
    }));
    rows.push({
      rowNumber: 3261,
      phone: rows[0]!.phone,
      email: rows[0]!.email,
    });
    const reconciled = reconcileOccupiedRows(rows);
    assert.equal(reconciled.occupiedRowCount, 3261);
    assert.equal(reconciled.uniqueLeadCount, 3260);
    assert.equal(reconciled.extraOccupiedRowCount, 1);
    assert.equal(reconciled.blankRowCount, 0);
  });

  it("does not treat rejected-before-delivery rows as applied deliveries", () => {
    const classified = classifyReceiptRows(
      [
        {
          rowNumber: 1,
          phone: "+12025550100",
          email: "ada@example.test",
          rejectedBeforeDelivery: true,
        },
        { rowNumber: 2, phone: "", email: "" },
      ],
      [
        {
          phoneFingerprint: fingerprintIdentityValue("phone", "+12025550100"),
          emailFingerprint: fingerprintIdentityValue("email", "ada@example.test"),
          sourceLeadEventId: "evt_1",
          inventoryItemId: "inv_1",
        },
      ]
    );
    assert.equal(classified.receipts[0]?.applyStatus, "suppressed_rejected_before_delivery");
    assert.equal(classified.receipts[0]?.matchStatus, "matched");
    assert.equal(classified.receipts[1]?.matchStatus, "blank_skipped");
    assert.equal(classified.reconciliation.occupiedRowCount, 1);
  });
});

function receiptDb() {
  const batches: Array<Record<string, unknown>> = [];
  const receipts: Array<Record<string, unknown>> = [];
  const deliveredWrites: unknown[] = [];

  const db = {
    deliveredWrites,
    buyerExternalDeliveryImportBatch: {
      findUnique: async ({ where }: { where: { id?: string; requestId?: string } }) => {
        const row = batches.find((b) => b.id === where.id || b.requestId === where.requestId);
        if (!row) return null;
        return { ...row, receipts: receipts.filter((r) => r.importBatchId === row.id) };
      },
      findMany: async () =>
        batches.map((row) => ({
          ...row,
          receipts: receipts.filter((r) => r.importBatchId === row.id),
        })),
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const created = ((data.receipts as { create?: Array<Record<string, unknown>> })?.create ?? []).map(
          (row, index) => {
            const receipt = { id: `rcpt_${index + 1}`, importBatchId: "batch_1", ...row };
            receipts.push(receipt);
            return receipt;
          }
        );
        const batch = {
          id: "batch_1",
          createdAt: new Date("2026-10-13T00:00:00.000Z"),
          ...data,
        };
        delete (batch as { receipts?: unknown }).receipts;
        batches.push(batch);
        return { ...batch, receipts: created };
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Record<string, unknown>;
      }) => {
        const batch = batches.find((row) => row.id === where.id);
        if (!batch) throw new Error("missing batch");
        Object.assign(batch, data);
        return { ...batch, receipts: receipts.filter((r) => r.importBatchId === batch.id) };
      },
    },
    buyerExternalDeliveryReceipt: {
      findMany: async ({
        where,
      }: {
        where: { clientAccountId: string; applyStatus: string };
      }) =>
        receipts.filter(
          (row) =>
            row.clientAccountId === where.clientAccountId && row.applyStatus === where.applyStatus
        ),
      updateMany: async ({
        where,
        data,
      }: {
        where: { importBatchId: string; applyStatus: string };
        data: { applyStatus: string };
      }) => {
        for (const row of receipts) {
          if (row.importBatchId === where.importBatchId && row.applyStatus === where.applyStatus) {
            row.applyStatus = data.applyStatus;
          }
        }
        return { count: 1 };
      },
    },
    buyerDeliveredIdentity: {
      findMany: async () => [],
      createMany: async (payload: unknown) => {
        deliveredWrites.push(payload);
        return payload;
      },
    },
    leadInventoryItem: {
      findMany: async () => [],
    },
  };

  return db as unknown as PrismaClient & { deliveredWrites: unknown[] };
}

describe("external receipt preview and apply", () => {
  it("previews without applying suppression or writing delivery identities", async () => {
    process.env.SA360_PPL_EXTERNAL_RECEIPT_IMPORT_ENABLED = "true";
    const db = receiptDb();
    const previewed = await previewExternalDeliveryReceipts(
      {
        clientAccountId: "client_1",
        requestId: "imp-1",
        rows: [
          { rowNumber: 1, phone: "+12025550100", email: "ada@example.test" },
          { rowNumber: 2, phone: "+12025550100", email: "ada@example.test" },
        ],
        inventory: [],
      },
      db
    );
    assert.equal(previewed.ok, true);
    if (!previewed.ok) return;
    assert.equal(previewed.item.status, "previewed");
    assert.equal(previewed.item.applyMode, "preview");
    assert.equal(previewed.item.occupiedRowCount, 2);
    assert.equal(previewed.item.uniqueLeadCount, 1);
    assert.equal(previewed.item.extraOccupiedRowCount, 1);
    assert.equal(previewed.item.wroteBuyerDeliveredIdentity, false);
    assert.equal(db.deliveredWrites.length, 0);

    const seen = await loadAppliedExternalReceiptFingerprints("client_1", db);
    assert.equal(seen.phoneFingerprints.size, 0);
  });

  it("applies suppression only after the confirmation phrase and still never marks delivered", async () => {
    process.env.SA360_PPL_EXTERNAL_RECEIPT_IMPORT_ENABLED = "true";
    const db = receiptDb();
    const previewed = await previewExternalDeliveryReceipts(
      {
        clientAccountId: "client_1",
        requestId: "imp-2",
        rows: [
          { rowNumber: 1, phone: "+12025550100", email: "ada@example.test" },
          {
            rowNumber: 2,
            phone: "+12025550101",
            email: "rejected@example.test",
            rejectedBeforeDelivery: true,
          },
        ],
        inventory: [],
      },
      db
    );
    assert.equal(previewed.ok, true);
    if (!previewed.ok) return;

    const refused = await applyExternalDeliveryReceipts(
      { batchId: previewed.item.id, confirmationPhrase: "please apply" },
      db
    );
    assert.equal(refused.ok, false);

    const applied = await applyExternalDeliveryReceipts(
      { batchId: previewed.item.id, confirmationPhrase: EXTERNAL_RECEIPT_APPLY_PHRASE },
      db
    );
    assert.equal(applied.ok, true);
    if (!applied.ok) return;
    assert.equal(applied.item.status, "applied");
    assert.equal(applied.item.wroteBuyerDeliveredIdentity, false);
    assert.equal(
      applied.item.receipts.find((row) => row.rowNumber === 2)?.applyStatus,
      "suppressed_rejected_before_delivery"
    );
    assert.equal(db.deliveredWrites.length, 0);

    const seen = await loadAppliedExternalReceiptFingerprints("client_1", db);
    assert.equal(seen.phoneFingerprints.size, 1);
    assert.ok(seen.phoneFingerprints.has(fingerprintIdentityValue("phone", "+12025550100")));
  });

  it("does not merge receipts into buyer-seen fingerprints when the flag is off", async () => {
    delete process.env.SA360_PPL_EXTERNAL_RECEIPT_IMPORT_ENABLED;
    const db = receiptDb();
    const seen = await loadBuyerSeenFingerprints("client_1", db);
    assert.equal(seen.phoneFingerprints.size, 0);
    const previewed = await previewExternalDeliveryReceipts(
      {
        clientAccountId: "client_1",
        requestId: "imp-off",
        rows: [{ rowNumber: 1, phone: "+12025550100" }],
      },
      db
    );
    assert.equal(previewed.ok, false);
    if (!previewed.ok) assert.equal(previewed.code, "feature_disabled");
  });
});
