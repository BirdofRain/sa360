import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import type { PrismaClient } from "@prisma/client";

import {
  fingerprintIdentityValue,
  fingerprintPhoneIdentity,
} from "../../lib/identity-fingerprint.js";
import {
  EXTERNAL_RECEIPT_APPLY_PHRASE,
  EXTERNAL_RECEIPT_LOOKUP_BATCH,
  applyExternalDeliveryReceipts,
  classifyReceiptRows,
  computeReceiptContentChecksum,
  fingerprintReceiptContact,
  isPplExternalReceiptImportEnabled,
  loadAppliedExternalReceiptFingerprints,
  parseExternalReceiptCsvDocument,
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

  it("treats the extra occupied spreadsheet row as a header, not a second delivery", () => {
    const header = "Phone,Email,Rejected Before Delivery";
    const data = Array.from(
      { length: 3260 },
      (_, index) => `202555${String(index).padStart(4, "0")},lead${index}@example.test,false`
    );
    const parsed = parseExternalReceiptCsvDocument([header, ...data].join("\n"));
    assert.equal(parsed.headerRowCount, 1);
    assert.equal(parsed.rows.length, 3260);
    const reconciled = reconcileOccupiedRows(parsed.rows, parsed.headerRowCount);
    assert.equal(reconciled.headerRowCount, 1);
    assert.equal(reconciled.occupiedRowCount, 3260);
    assert.equal(reconciled.uniqueLeadCount, 3260);
    assert.equal(reconciled.extraOccupiedRowCount, 0);
    assert.equal(reconciled.blankRowCount, 0);
  });

  it("parses quoted CSV cells instead of splitting on commas", () => {
    const csv = [
      '"Phone Number","Email Address","Rejected Before Delivery"',
      '"+1-202-555-0100","ada,lead@example.test","false"',
    ].join("\n");
    const parsed = parseExternalReceiptCsvDocument(csv);
    assert.equal(parsed.headerRowCount, 1);
    assert.equal(parsed.rows.length, 1);
    assert.equal(parsed.rows[0]?.phone, "+1-202-555-0100");
    assert.equal(parsed.rows[0]?.email, "ada,lead@example.test");
  });

  it("writes canonical phone fingerprints and matches 10 / 11 / +1 historical hashes", () => {
    const canonical = fingerprintPhoneIdentity("+12025550100");
    assert.equal(fingerprintReceiptContact({ rowNumber: 1, phone: "2025550100" }).phoneFingerprint, canonical);
    assert.equal(fingerprintReceiptContact({ rowNumber: 1, phone: "12025550100" }).phoneFingerprint, canonical);
    assert.equal(fingerprintReceiptContact({ rowNumber: 1, phone: "+12025550100" }).phoneFingerprint, canonical);

    const historicalTen = fingerprintIdentityValue("phone", "2025550100");
    const classified = classifyReceiptRows(
      [{ rowNumber: 1, phone: "+12025550100", email: "ada@example.test" }],
      [
        {
          phoneFingerprint: historicalTen,
          emailFingerprint: null,
          sourceLeadEventId: "evt_hist",
          inventoryItemId: "inv_hist",
        },
      ]
    );
    assert.equal(classified.receipts[0]?.matchStatus, "matched");
    assert.equal(classified.receipts[0]?.matchedInventoryItemId, "inv_hist");
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
        { rowNumber: 3, firstName: "Only", lastName: "Name", malformed: true },
      ],
      [
        {
          phoneFingerprint: fingerprintPhoneIdentity("+12025550100"),
          emailFingerprint: fingerprintIdentityValue("email", "ada@example.test"),
          sourceLeadEventId: "evt_1",
          inventoryItemId: "inv_1",
        },
      ]
    );
    assert.equal(classified.receipts[0]?.applyStatus, "suppressed_rejected_before_delivery");
    assert.equal(classified.receipts[0]?.matchStatus, "matched");
    assert.equal(classified.receipts[1]?.matchStatus, "blank_skipped");
    assert.equal(classified.receipts[2]?.matchStatus, "malformed");
    assert.equal(classified.reconciliation.occupiedRowCount, 1);
    assert.equal(classified.reconciliation.malformedCount, 1);
  });
});

type InventoryQuery = { phoneFingerprint?: { in: string[] }; emailFingerprint?: { in: string[] } };

function receiptDb(options?: {
  inventory?: Array<{
    id: string;
    sourceLeadEventId: string;
    phoneFingerprint: string | null;
    emailFingerprint: string | null;
  }>;
}) {
  const batches: Array<Record<string, unknown>> = [];
  const receipts: Array<Record<string, unknown>> = [];
  const deliveredWrites: unknown[] = [];
  const inventoryQueries: InventoryQuery[] = [];

  const db = {
    deliveredWrites,
    inventoryQueries,
    $transaction: async <T>(fn: (tx: typeof db) => Promise<T>) => fn(db),
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
        if (batches.some((row) => row.requestId === data.requestId)) {
          const error = new Error("unique");
          (error as { code?: string }).code = "P2002";
          throw error;
        }
        const created = ((data.receipts as { create?: Array<Record<string, unknown>> })?.create ?? []).map(
          (row, index) => {
            const receipt = { id: `rcpt_${batches.length + 1}_${index + 1}`, importBatchId: `batch_${batches.length + 1}`, ...row };
            receipts.push(receipt);
            return receipt;
          }
        );
        const batch = {
          id: `batch_${batches.length + 1}`,
          createdAt: new Date("2026-10-13T00:00:00.000Z"),
          sourceFilename: null,
          contentChecksum: "",
          headerRowCount: 0,
          malformedCount: 0,
          appliedBy: null,
          appliedAt: null,
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
      updateMany: async ({
        where,
        data,
      }: {
        where: { id: string; status?: string };
        data: Record<string, unknown>;
      }) => {
        const batch = batches.find((row) => row.id === where.id);
        if (!batch) return { count: 0 };
        if (where.status && batch.status !== where.status) return { count: 0 };
        Object.assign(batch, data);
        return { count: 1 };
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
        where: {
          importBatchId: string;
          applyStatus: string;
          matchStatus?: string;
          id?: { in: string[] };
        };
        data: { applyStatus: string };
      }) => {
        let count = 0;
        for (const row of receipts) {
          if (row.importBatchId !== where.importBatchId) continue;
          if (row.applyStatus !== where.applyStatus) continue;
          if (where.matchStatus && row.matchStatus !== where.matchStatus) continue;
          if (where.id?.in && !where.id.in.includes(String(row.id))) continue;
          row.applyStatus = data.applyStatus;
          count += 1;
        }
        return { count };
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
      findMany: async ({ where }: { where: InventoryQuery }) => {
        inventoryQueries.push(where);
        const inventory = options?.inventory ?? [];
        return inventory.filter((row) => {
          if (where.phoneFingerprint?.in) {
            return Boolean(row.phoneFingerprint && where.phoneFingerprint.in.includes(row.phoneFingerprint));
          }
          if (where.emailFingerprint?.in) {
            return Boolean(row.emailFingerprint && where.emailFingerprint.in.includes(row.emailFingerprint));
          }
          return false;
        });
      },
    },
  };

  return db as unknown as PrismaClient & {
    deliveredWrites: unknown[];
    inventoryQueries: InventoryQuery[];
  };
}

describe("external receipt preview and apply", () => {
  it("previews without applying suppression or writing delivery identities", async () => {
    process.env.SA360_PPL_EXTERNAL_RECEIPT_IMPORT_ENABLED = "true";
    const db = receiptDb();
    const previewed = await previewExternalDeliveryReceipts(
      {
        clientAccountId: "client_1",
        requestId: "imp-1",
        sourceFilename: "synthetic-receipt.csv",
        createdBy: "operator_test",
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
    assert.equal(previewed.item.sourceFilename, "synthetic-receipt.csv");
    assert.equal(previewed.item.createdBy, "operator_test");
    assert.equal(previewed.item.contentChecksum.length, 64);
    assert.equal(previewed.item.wroteBuyerDeliveredIdentity, false);
    assert.equal(db.deliveredWrites.length, 0);

    const seen = await loadAppliedExternalReceiptFingerprints("client_1", db);
    assert.equal(seen.phoneFingerprints.size, 0);
  });

  it("rejects a request-id replay that carries different file data or a different buyer", async () => {
    process.env.SA360_PPL_EXTERNAL_RECEIPT_IMPORT_ENABLED = "true";
    const db = receiptDb();
    const first = await previewExternalDeliveryReceipts(
      {
        clientAccountId: "client_1",
        requestId: "imp-bound",
        rows: [{ rowNumber: 1, phone: "+12025550100" }],
        inventory: [],
      },
      db
    );
    assert.equal(first.ok, true);

    const same = await previewExternalDeliveryReceipts(
      {
        clientAccountId: "client_1",
        requestId: "imp-bound",
        rows: [{ rowNumber: 1, phone: "+12025550100" }],
        inventory: [],
      },
      db
    );
    assert.equal(same.ok, true);
    if (same.ok) assert.equal(same.idempotentReplay, true);

    const differentFile = await previewExternalDeliveryReceipts(
      {
        clientAccountId: "client_1",
        requestId: "imp-bound",
        rows: [{ rowNumber: 1, phone: "+12025550101" }],
        inventory: [],
      },
      db
    );
    assert.equal(differentFile.ok, false);
    if (!differentFile.ok) assert.equal(differentFile.code, "idempotency_conflict");

    const differentBuyer = await previewExternalDeliveryReceipts(
      {
        clientAccountId: "client_2",
        requestId: "imp-bound",
        rows: [{ rowNumber: 1, phone: "+12025550100" }],
        inventory: [],
      },
      db
    );
    assert.equal(differentBuyer.ok, false);
    if (!differentBuyer.ok) assert.equal(differentBuyer.code, "idempotency_conflict");
  });

  it("applies only confirmed-delivered matches and never marks rejected, unmatched, or malformed rows", async () => {
    process.env.SA360_PPL_EXTERNAL_RECEIPT_IMPORT_ENABLED = "true";
    const db = receiptDb();
    const previewed = await previewExternalDeliveryReceipts(
      {
        clientAccountId: "client_1",
        requestId: "imp-2",
        createdBy: "operator_test",
        rows: [
          { rowNumber: 1, phone: "+12025550100", email: "ada@example.test" },
          {
            rowNumber: 2,
            phone: "+12025550101",
            email: "rejected@example.test",
            rejectedBeforeDelivery: true,
          },
          { rowNumber: 3, phone: "+12025550102", email: "unmatched@example.test" },
          { rowNumber: 4, firstName: "Only", lastName: "Name", malformed: true },
        ],
        inventory: [
          {
            phoneFingerprint: fingerprintPhoneIdentity("+12025550100"),
            emailFingerprint: fingerprintIdentityValue("email", "ada@example.test"),
            sourceLeadEventId: "evt_1",
            inventoryItemId: "inv_1",
          },
          {
            phoneFingerprint: fingerprintPhoneIdentity("+12025550101"),
            emailFingerprint: fingerprintIdentityValue("email", "rejected@example.test"),
            sourceLeadEventId: "evt_2",
            inventoryItemId: "inv_2",
          },
        ],
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
      {
        batchId: previewed.item.id,
        confirmationPhrase: EXTERNAL_RECEIPT_APPLY_PHRASE,
        appliedBy: "operator_test",
      },
      db
    );
    assert.equal(applied.ok, true);
    if (!applied.ok) return;
    assert.equal(applied.item.status, "applied");
    assert.equal(applied.item.appliedBy, "operator_test");
    assert.equal(applied.item.wroteBuyerDeliveredIdentity, false);
    assert.equal(applied.item.receipts.find((row) => row.rowNumber === 1)?.applyStatus, "applied");
    assert.equal(
      applied.item.receipts.find((row) => row.rowNumber === 2)?.applyStatus,
      "suppressed_rejected_before_delivery"
    );
    assert.equal(applied.item.receipts.find((row) => row.rowNumber === 3)?.applyStatus, "preview");
    assert.equal(applied.item.receipts.find((row) => row.rowNumber === 4)?.applyStatus, "skipped");
    assert.equal(db.deliveredWrites.length, 0);

    const seen = await loadAppliedExternalReceiptFingerprints("client_1", db);
    assert.equal(seen.phoneFingerprints.size, 1);
    assert.ok(seen.phoneFingerprints.has(fingerprintPhoneIdentity("+12025550100")));
  });

  it("looks up inventory by batched fingerprints instead of a full scan", async () => {
    process.env.SA360_PPL_EXTERNAL_RECEIPT_IMPORT_ENABLED = "true";
    const phone = "+12025550100";
    const db = receiptDb({
      inventory: [
        {
          id: "inv_1",
          sourceLeadEventId: "evt_1",
          phoneFingerprint: fingerprintPhoneIdentity(phone),
          emailFingerprint: fingerprintIdentityValue("email", "ada@example.test"),
        },
      ],
    });
    const previewed = await previewExternalDeliveryReceipts(
      {
        clientAccountId: "client_1",
        requestId: "imp-indexed",
        rows: [{ rowNumber: 1, phone, email: "ada@example.test" }],
      },
      db
    );
    assert.equal(previewed.ok, true);
    if (!previewed.ok) return;
    assert.ok(db.inventoryQueries.length >= 1);
    assert.ok(
      db.inventoryQueries.every(
        (query) =>
          (query.phoneFingerprint?.in?.length ?? 0) <= EXTERNAL_RECEIPT_LOOKUP_BATCH &&
          (query.emailFingerprint?.in?.length ?? 0) <= EXTERNAL_RECEIPT_LOOKUP_BATCH &&
          Boolean(query.phoneFingerprint?.in || query.emailFingerprint?.in)
      )
    );
    assert.equal(previewed.item.matchedCount, 1);
  });

  it("batches fingerprint lookups for a 22,592-row historical workbook", async () => {
    process.env.SA360_PPL_EXTERNAL_RECEIPT_IMPORT_ENABLED = "true";
    const rows = Array.from({ length: 22_592 }, (_, index) => ({
      rowNumber: index + 1,
      phone: `202555${String(index % 10_000).padStart(4, "0")}`,
      email: `lead${index}@example.test`,
    }));
    const db = receiptDb({ inventory: [] });
    const previewed = await previewExternalDeliveryReceipts(
      {
        clientAccountId: "client_1",
        requestId: "imp-scale",
        sourceFilename: "synthetic-22592.csv",
        rows,
      },
      db
    );
    assert.equal(previewed.ok, true);
    if (!previewed.ok) return;
    assert.equal(previewed.item.occupiedRowCount, 22_592);
    const phoneQueries = db.inventoryQueries.filter((query) => query.phoneFingerprint?.in);
    assert.ok(phoneQueries.length >= 2);
    assert.ok(phoneQueries.every((query) => (query.phoneFingerprint?.in?.length ?? 0) <= 400));
    assert.ok(phoneQueries.every((query) => (query.phoneFingerprint?.in?.length ?? 0) > 0));
  });

  it("imports 47 synthetic tabs as independent batches without applying preview rows", async () => {
    process.env.SA360_PPL_EXTERNAL_RECEIPT_IMPORT_ENABLED = "true";
    const db = receiptDb({
      inventory: [
        {
          id: "inv_tab",
          sourceLeadEventId: "evt_tab",
          phoneFingerprint: fingerprintPhoneIdentity("+12025550100"),
          emailFingerprint: null,
        },
      ],
    });
    for (let tab = 0; tab < 47; tab += 1) {
      const previewed = await previewExternalDeliveryReceipts(
        {
          clientAccountId: "client_1",
          requestId: `imp-tab-${tab}`,
          sourceLabel: `synthetic_tab_${tab}`,
          sourceFilename: `synthetic-tab-${tab}.csv`,
          rows: [
            { rowNumber: 1, phone: "+12025550100" },
            { rowNumber: 2, phone: `+1202555${String(1000 + tab).slice(-4)}` },
          ],
        },
        db
      );
      assert.equal(previewed.ok, true);
      if (!previewed.ok) return;
      assert.equal(previewed.item.status, "previewed");
    }

    const first = await applyExternalDeliveryReceipts(
      { batchId: "batch_1", confirmationPhrase: EXTERNAL_RECEIPT_APPLY_PHRASE },
      db
    );
    assert.equal(first.ok, true);
    if (!first.ok) return;
    assert.equal(first.item.status, "applied");
    assert.equal(first.item.receipts.filter((row) => row.applyStatus === "applied").length, 1);

    const seen = await loadAppliedExternalReceiptFingerprints("client_1", db);
    assert.equal(seen.phoneFingerprints.size, 1);

    const listed = await (await import("./external-delivery-receipt.service.js")).listExternalDeliveryReceiptBatches(
      "client_1",
      db
    );
    assert.equal(listed.length, 47);
    assert.equal(listed.filter((row) => row.status === "previewed").length, 46);
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

  it("checksums the buyer plus row content so identical request ids stay bound", () => {
    const left = computeReceiptContentChecksum({
      clientAccountId: "client_1",
      rows: [{ rowNumber: 1, phone: "+12025550100" }],
    });
    const same = computeReceiptContentChecksum({
      clientAccountId: "client_1",
      rows: [{ rowNumber: 1, phone: "+12025550100" }],
    });
    const otherBuyer = computeReceiptContentChecksum({
      clientAccountId: "client_2",
      rows: [{ rowNumber: 1, phone: "+12025550100" }],
    });
    assert.equal(left, same);
    assert.notEqual(left, otherBuyer);
  });
});
