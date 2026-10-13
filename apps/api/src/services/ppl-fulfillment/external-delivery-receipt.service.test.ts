import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import type { PrismaClient } from "@prisma/client";

import {
  fingerprintIdentityValue,
  fingerprintPhoneIdentity,
} from "../../lib/identity-fingerprint.js";
import {
  EXTERNAL_RECEIPT_APPLY_PHRASE,
  EXTERNAL_RECEIPT_CONNECTED_NOTE,
  EXTERNAL_RECEIPT_IDENTITY_CONFLICT,
  EXTERNAL_RECEIPT_LOOKUP_BATCH,
  ExternalReceiptSuppressionUnavailableError,
  applyExternalDeliveryReceipts,
  buildInventoryFingerprintIndex,
  classifyReceiptRows,
  computeReceiptContentChecksum,
  fingerprintReceiptContact,
  getExternalDeliveryReceiptBatch,
  isPplExternalReceiptImportEnabled,
  isPplExternalReceiptSuppressionEnforced,
  listExternalDeliveryReceiptBatches,
  loadAppliedExternalReceiptFingerprints,
  parseExternalReceiptCsvDocument,
  previewExternalDeliveryReceipts,
  reconcileOccupiedRows,
} from "./external-delivery-receipt.service.js";
import { loadBuyerSeenFingerprints } from "./inventory-selection.service.js";

const originalImportFlag = process.env.SA360_PPL_EXTERNAL_RECEIPT_IMPORT_ENABLED;
const originalSuppressionFlag = process.env.SA360_PPL_EXTERNAL_RECEIPT_SUPPRESSION_ENABLED;

afterEach(() => {
  if (originalImportFlag === undefined) delete process.env.SA360_PPL_EXTERNAL_RECEIPT_IMPORT_ENABLED;
  else process.env.SA360_PPL_EXTERNAL_RECEIPT_IMPORT_ENABLED = originalImportFlag;
  if (originalSuppressionFlag === undefined) {
    delete process.env.SA360_PPL_EXTERNAL_RECEIPT_SUPPRESSION_ENABLED;
  } else {
    process.env.SA360_PPL_EXTERNAL_RECEIPT_SUPPRESSION_ENABLED = originalSuppressionFlag;
  }
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

  it("enforces applied suppression unless explicitly set to false", () => {
    delete process.env.SA360_PPL_EXTERNAL_RECEIPT_SUPPRESSION_ENABLED;
    assert.equal(isPplExternalReceiptSuppressionEnforced(), true);
    process.env.SA360_PPL_EXTERNAL_RECEIPT_SUPPRESSION_ENABLED = "true";
    assert.equal(isPplExternalReceiptSuppressionEnforced(), true);
    process.env.SA360_PPL_EXTERNAL_RECEIPT_SUPPRESSION_ENABLED = "false";
    assert.equal(isPplExternalReceiptSuppressionEnforced(), false);
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
    assert.equal(reconciled.connectedIdentityCount, 0);
    assert.equal(reconciled.identityConflictCount, 0);
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
    $transaction: async <T>(fn: (tx: PrismaClient) => Promise<T>) => fn(db as unknown as PrismaClient),
    buyerExternalDeliveryImportBatch: {
      findUnique: async ({ where }: { where: { id?: string; requestId?: string } }) => {
        const row = batches.find((b) => b.id === where.id || b.requestId === where.requestId);
        if (!row) return null;
        return { ...row, receipts: receipts.filter((r) => r.importBatchId === row.id) };
      },
      findMany: async () => batches.map((row) => ({ ...row })),
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
          confirmedUnmatchedCount: 0,
          sourceEvidence: null,
          unmatchedDeliveriesConfirmed: false,
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
        skip,
        take,
      }: {
        where: { clientAccountId?: string; applyStatus?: string; importBatchId?: string };
        skip?: number;
        take?: number;
      }) => {
        let rows = receipts.filter((row) => {
          if (where.clientAccountId && row.clientAccountId !== where.clientAccountId) return false;
          if (where.applyStatus && row.applyStatus !== where.applyStatus) return false;
          if (where.importBatchId && row.importBatchId !== where.importBatchId) return false;
          return true;
        });
        if (typeof skip === "number") rows = rows.slice(skip);
        if (typeof take === "number") rows = rows.slice(0, take);
        return rows;
      },
      count: async ({ where }: { where: { importBatchId: string } }) =>
        receipts.filter((row) => row.importBatchId === where.importBatchId).length,
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
        data: { applyStatus: string; deliveryEvidenceStatus?: string };
      }) => {
        let count = 0;
        for (const row of receipts) {
          if (row.importBatchId !== where.importBatchId) continue;
          if (row.applyStatus !== where.applyStatus) continue;
          if (where.matchStatus && row.matchStatus !== where.matchStatus) continue;
          if (where.id?.in && !where.id.in.includes(String(row.id))) continue;
          row.applyStatus = data.applyStatus;
          if (data.deliveryEvidenceStatus) row.deliveryEvidenceStatus = data.deliveryEvidenceStatus;
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
    const appliedPhone = fingerprintPhoneIdentity("+12025550100");
    assert.ok(appliedPhone);
    assert.ok(seen.phoneFingerprints.has(appliedPhone));
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

    const listed = await listExternalDeliveryReceiptBatches("client_1", db);
    assert.equal(listed.length, 47);
    assert.equal(listed.filter((row) => row.status === "previewed").length, 46);
    assert.ok(listed.every((row) => row.receipts.length === 0));

    const page = await getExternalDeliveryReceiptBatch({ batchId: "batch_1", offset: 0, limit: 1 }, db);
    assert.equal(page.ok, true);
    if (!page.ok) return;
    assert.equal(page.receiptTotal, 2);
    assert.equal(page.item.receipts.length, 1);
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

describe("operator-confirmed unmatched historical deliveries", () => {
  it("does not apply unmatched rows without operator confirmation and source evidence", async () => {
    process.env.SA360_PPL_EXTERNAL_RECEIPT_IMPORT_ENABLED = "true";
    const db = receiptDb();
    const previewed = await previewExternalDeliveryReceipts(
      {
        clientAccountId: "client_1",
        requestId: "imp-unmatched-guard",
        rows: [{ rowNumber: 1, phone: "+12025550199", email: "history@example.test" }],
        inventory: [],
      },
      db
    );
    assert.equal(previewed.ok, true);
    if (!previewed.ok) return;
    assert.equal(previewed.item.receipts[0]?.matchStatus, "unmatched");
    assert.equal(previewed.item.receipts[0]?.deliveryEvidenceStatus, "unverified");

    const refused = await applyExternalDeliveryReceipts(
      {
        batchId: previewed.item.id,
        confirmationPhrase: EXTERNAL_RECEIPT_APPLY_PHRASE,
        confirmUnmatchedHistoricalDeliveries: true,
      },
      db
    );
    assert.equal(refused.ok, false);
    if (!refused.ok) assert.equal(refused.code, "source_evidence_required");

    const appliedWithoutConfirm = await applyExternalDeliveryReceipts(
      { batchId: previewed.item.id, confirmationPhrase: EXTERNAL_RECEIPT_APPLY_PHRASE },
      db
    );
    assert.equal(appliedWithoutConfirm.ok, true);
    if (!appliedWithoutConfirm.ok) return;
    assert.equal(appliedWithoutConfirm.item.receipts[0]?.applyStatus, "preview");
    assert.equal(appliedWithoutConfirm.item.receipts[0]?.matchStatus, "unmatched");
  });

  it("applies unmatched and email-only identities after audited operator confirmation", async () => {
    process.env.SA360_PPL_EXTERNAL_RECEIPT_IMPORT_ENABLED = "true";
    const db = receiptDb({
      inventory: [
        {
          id: "inv_a",
          sourceLeadEventId: "evt_a",
          phoneFingerprint: fingerprintPhoneIdentity("+12025550110"),
          emailFingerprint: null,
        },
        {
          id: "inv_b",
          sourceLeadEventId: "evt_b",
          phoneFingerprint: fingerprintPhoneIdentity("+12025550110"),
          emailFingerprint: fingerprintIdentityValue("email", "shared@example.test"),
        },
      ],
    });
    const previewed = await previewExternalDeliveryReceipts(
      {
        clientAccountId: "client_1",
        requestId: "imp-unmatched-confirm",
        rows: [
          { rowNumber: 1, email: "email-only@example.test" },
          { rowNumber: 2, phone: "+12025550110", email: "shared@example.test" },
          { rowNumber: 3, phone: "+12025550999", rejectedBeforeDelivery: true },
          { rowNumber: 4, firstName: "Only", lastName: "Name", malformed: true },
        ],
      },
      db
    );
    assert.equal(previewed.ok, true);
    if (!previewed.ok) return;
    assert.equal(previewed.item.receipts.find((row) => row.rowNumber === 1)?.matchStatus, "unmatched");
    assert.equal(previewed.item.receipts.find((row) => row.rowNumber === 2)?.matchStatus, "ambiguous");

    const applied = await applyExternalDeliveryReceipts(
      {
        batchId: previewed.item.id,
        confirmationPhrase: EXTERNAL_RECEIPT_APPLY_PHRASE,
        appliedBy: "operator_test",
        confirmUnmatchedHistoricalDeliveries: true,
        sourceEvidence: "synthetic workbook tab Final 10/12 — operator confirmed historical delivery",
      },
      db
    );
    assert.equal(applied.ok, true);
    if (!applied.ok) return;
    assert.equal(applied.item.unmatchedDeliveriesConfirmed, true);
    assert.equal(applied.item.confirmedUnmatchedCount, 2);
    assert.equal(applied.item.sourceEvidence?.includes("Final 10/12"), true);
    assert.equal(applied.item.receipts.find((row) => row.rowNumber === 1)?.applyStatus, "applied");
    assert.equal(applied.item.receipts.find((row) => row.rowNumber === 1)?.matchStatus, "unmatched");
    assert.equal(
      applied.item.receipts.find((row) => row.rowNumber === 1)?.deliveryEvidenceStatus,
      "operator_confirmed"
    );
    assert.equal(applied.item.receipts.find((row) => row.rowNumber === 2)?.applyStatus, "applied");
    assert.equal(applied.item.receipts.find((row) => row.rowNumber === 2)?.matchStatus, "ambiguous");
    assert.equal(
      applied.item.receipts.find((row) => row.rowNumber === 3)?.applyStatus,
      "suppressed_rejected_before_delivery"
    );
    assert.equal(applied.item.receipts.find((row) => row.rowNumber === 4)?.applyStatus, "skipped");
    assert.equal(applied.item.wroteBuyerDeliveredIdentity, false);
    assert.equal(db.deliveredWrites.length, 0);

    const seen = await loadAppliedExternalReceiptFingerprints("client_1", db);
    const emailOnly = fingerprintIdentityValue("email", "email-only@example.test");
    assert.ok(emailOnly);
    assert.ok(seen.emailFingerprints.has(emailOnly));
    assert.equal(seen.phoneFingerprints.size, 1);

    const otherBuyer = await loadAppliedExternalReceiptFingerprints("client_2", db);
    assert.equal(otherBuyer.phoneFingerprints.size, 0);
    assert.equal(otherBuyer.emailFingerprints.size, 0);
  });
});

describe("applied suppression survives import disable", () => {
  async function appliedReceiptDb() {
    process.env.SA360_PPL_EXTERNAL_RECEIPT_IMPORT_ENABLED = "true";
    const db = receiptDb();
    const previewed = await previewExternalDeliveryReceipts(
      {
        clientAccountId: "client_1",
        requestId: "imp-enforce",
        rows: [{ rowNumber: 1, phone: "+12025550100", email: "ada@example.test" }],
        inventory: [
          {
            phoneFingerprint: fingerprintPhoneIdentity("+12025550100"),
            emailFingerprint: fingerprintIdentityValue("email", "ada@example.test"),
            sourceLeadEventId: "evt_1",
            inventoryItemId: "inv_1",
          },
        ],
      },
      db
    );
    assert.equal(previewed.ok, true);
    if (!previewed.ok) return db;
    const applied = await applyExternalDeliveryReceipts(
      { batchId: previewed.item.id, confirmationPhrase: EXTERNAL_RECEIPT_APPLY_PHRASE },
      db
    );
    assert.equal(applied.ok, true);
    return db;
  }

  it("keeps applied fingerprints after the import UI flag is disabled", async () => {
    const db = await appliedReceiptDb();
    delete process.env.SA360_PPL_EXTERNAL_RECEIPT_IMPORT_ENABLED;
    const seen = await loadAppliedExternalReceiptFingerprints("client_1", db);
    const phone = fingerprintPhoneIdentity("+12025550100");
    assert.ok(phone);
    assert.ok(seen.phoneFingerprints.has(phone));

    const buyerSeen = await loadBuyerSeenFingerprints("client_1", db);
    assert.ok(buyerSeen.phoneFingerprints.has(phone));

    const blocked = await previewExternalDeliveryReceipts(
      {
        clientAccountId: "client_1",
        requestId: "imp-new-after-off",
        rows: [{ rowNumber: 1, phone: "+12025550111" }],
      },
      db
    );
    assert.equal(blocked.ok, false);
    if (!blocked.ok) assert.equal(blocked.code, "feature_disabled");
  });

  it("fails closed when suppression is disabled but applied receipts exist", async () => {
    const db = await appliedReceiptDb();
    process.env.SA360_PPL_EXTERNAL_RECEIPT_SUPPRESSION_ENABLED = "false";
    await assert.rejects(
      () => loadAppliedExternalReceiptFingerprints("client_1", db),
      (error: unknown) => error instanceof ExternalReceiptSuppressionUnavailableError
    );
    await assert.rejects(
      () => loadBuyerSeenFingerprints("client_1", db),
      (error: unknown) => error instanceof ExternalReceiptSuppressionUnavailableError
    );
  });

  it("fails closed when the applied-receipt query throws", async () => {
    process.env.SA360_PPL_EXTERNAL_RECEIPT_IMPORT_ENABLED = "true";
    const db = {
      buyerExternalDeliveryReceipt: {
        findMany: async () => {
          throw new Error("receipt table unavailable");
        },
      },
    } as unknown as import("@prisma/client").PrismaClient;
    await assert.rejects(
      () => loadAppliedExternalReceiptFingerprints("client_1", db),
      (error: unknown) => error instanceof ExternalReceiptSuppressionUnavailableError
    );
  });

  it("repeats an approved import without creating a second suppression set", async () => {
    const db = await appliedReceiptDb();
    process.env.SA360_PPL_EXTERNAL_RECEIPT_IMPORT_ENABLED = "true";
    const replay = await applyExternalDeliveryReceipts(
      { batchId: "batch_1", confirmationPhrase: EXTERNAL_RECEIPT_APPLY_PHRASE },
      db
    );
    assert.equal(replay.ok, true);
    if (!replay.ok) return;
    assert.equal(replay.item.status, "applied");
    const seen = await loadAppliedExternalReceiptFingerprints("client_1", db);
    assert.equal(seen.phoneFingerprints.size, 1);
    assert.equal(seen.emailFingerprints.size, 1);
  });
});

describe("synthetic 3260 / 44 / 3304 delivery accounting", () => {
  it("confirms 3260 delivered records and never marks the 44 rejected originals", async () => {
    process.env.SA360_PPL_EXTERNAL_RECEIPT_IMPORT_ENABLED = "true";
    const delivered = Array.from({ length: 3260 }, (_, index) => ({
      rowNumber: index + 1,
      phone: `+1202555${String(index).padStart(4, "0")}`,
      email: `delivered${index}@example.test`,
    }));
    const rejected = Array.from({ length: 44 }, (_, index) => ({
      rowNumber: 3261 + index,
      phone: `+1202666${String(index).padStart(4, "0")}`,
      email: `omitted${index}@example.test`,
      rejectedBeforeDelivery: true,
    }));
    const originalExportCount = delivered.length + rejected.length;
    assert.equal(originalExportCount, 3304);

    const header = "Phone,Email,Rejected Before Delivery";
    const csv = [
      header,
      ...delivered.map((row) => `${row.phone},${row.email},false`),
      ...rejected.map((row) => `${row.phone},${row.email},true`),
    ].join("\n");
    const parsed = parseExternalReceiptCsvDocument(csv);
    assert.equal(parsed.headerRowCount, 1);
    assert.equal(parsed.rows.length, 3304);

    const inventory = delivered.map((row, index) => ({
      phoneFingerprint: fingerprintPhoneIdentity(row.phone ?? ""),
      emailFingerprint: fingerprintIdentityValue("email", row.email ?? ""),
      sourceLeadEventId: `evt_${index}`,
      inventoryItemId: `inv_${index}`,
    }));
    const db = receiptDb();
    const previewed = await previewExternalDeliveryReceipts(
      {
        clientAccountId: "client_1",
        requestId: "imp-3260",
        csvText: csv,
        inventory,
      },
      db
    );
    assert.equal(previewed.ok, true);
    if (!previewed.ok) return;
    assert.equal(previewed.item.headerRowCount, 1);
    assert.equal(previewed.item.occupiedRowCount, 3304);
    assert.equal(previewed.item.uniqueLeadCount, 3304);
    assert.equal(previewed.item.rejectedBeforeDeliveryCount, 44);
    assert.equal(previewed.item.matchedCount, 3260);

    const applied = await applyExternalDeliveryReceipts(
      { batchId: previewed.item.id, confirmationPhrase: EXTERNAL_RECEIPT_APPLY_PHRASE },
      db
    );
    assert.equal(applied.ok, true);
    if (!applied.ok) return;
    assert.equal(applied.item.receipts.filter((row) => row.applyStatus === "applied").length, 3260);
    assert.equal(
      applied.item.receipts.filter((row) => row.applyStatus === "suppressed_rejected_before_delivery")
        .length,
      44
    );
    const seen = await loadAppliedExternalReceiptFingerprints("client_1", db);
    assert.equal(seen.phoneFingerprints.size, 3260);
    assert.equal(seen.emailFingerprints.size, 3260);
    for (const row of rejected) {
      const phone = fingerprintPhoneIdentity(row.phone);
      const email = fingerprintIdentityValue("email", row.email);
      assert.ok(phone && !seen.phoneFingerprints.has(phone));
      assert.ok(email && !seen.emailFingerprints.has(email));
    }
  });

  it("does not count historical cross-tab duplicates as multiple consumer deliveries", () => {
    const firstTab = Array.from({ length: 20 }, (_, index) => ({
      rowNumber: index + 1,
      phone: `+1202555${String(index).padStart(4, "0")}`,
      email: `dup${index}@example.test`,
    }));
    const secondTab = [
      ...firstTab.slice(0, 5).map((row, index) => ({ ...row, rowNumber: index + 1 })),
      { rowNumber: 6, phone: "+12025550999", email: "new@example.test" },
    ];
    const combined = classifyReceiptRows(
      [...firstTab, ...secondTab.map((row, index) => ({ ...row, rowNumber: 100 + index }))],
      []
    );
    assert.equal(combined.reconciliation.uniqueLeadCount, 21);
    assert.equal(combined.reconciliation.extraOccupiedRowCount, 5);
    assert.equal(
      combined.receipts.filter((row) => row.matchStatus === "extra_occupied_row").length,
      5
    );
  });
});

describe("indexed historical matching scale", () => {
  it("resolves 22,592 rows against a 259,000-record inventory through fingerprint maps", () => {
    const sharedPhone = fingerprintPhoneIdentity("+12025550000");
    const inventory = Array.from({ length: 259_000 }, (_, index) => {
      const phone = `+1202${String(555_0000 + (index % 200_000)).padStart(7, "0")}`;
      return {
        phoneFingerprint: fingerprintPhoneIdentity(phone),
        emailFingerprint: fingerprintIdentityValue("email", `inv${index}@example.test`),
        sourceLeadEventId: `evt_${index}`,
        inventoryItemId: `inv_${index}`,
      };
    });
    inventory[1] = {
      ...inventory[1]!,
      phoneFingerprint: sharedPhone,
    };

    const uniqueIdentities = 17_544;
    const rows = Array.from({ length: 22_592 }, (_, index) => {
      const identity = index % uniqueIdentities;
      return {
        rowNumber: index + 1,
        phone: `+1202555${String(identity % 10_000).padStart(4, "0")}`,
        email: `consumer${identity}@example.test`,
      };
    });

    const started = performance.now();
    const index = buildInventoryFingerprintIndex(inventory);
    assert.equal(index.size, 259_000);
    const classified = classifyReceiptRows(rows, inventory);
    const elapsedMs = performance.now() - started;

    assert.equal(classified.reconciliation.occupiedRowCount, 22_592);
    // Phones wrap every 10_000, so pair-unique identities collapse into 10_000 OR-groups.
    assert.equal(classified.reconciliation.uniqueLeadCount, 10_000);
    assert.equal(classified.reconciliation.connectedIdentityCount, uniqueIdentities - 10_000);
    assert.equal(classified.reconciliation.extraOccupiedRowCount, 22_592 - uniqueIdentities);
    assert.ok(classified.receipts.some((row) => row.matchStatus === "ambiguous"));
    assert.ok(elapsedMs < 8_000, `indexed classify exceeded budget: ${elapsedMs}ms`);
  });
});

describe("phone-OR-email historical identity grouping", () => {
  it("connects same phone with a different email and keeps both emails", async () => {
    process.env.SA360_PPL_EXTERNAL_RECEIPT_IMPORT_ENABLED = "true";
    const classified = classifyReceiptRows(
      [
        { rowNumber: 1, phone: "+12025550100", email: "one@example.test" },
        { rowNumber: 2, phone: "+12025550100", email: "two@example.test" },
      ],
      []
    );
    assert.equal(classified.reconciliation.uniqueLeadCount, 1);
    assert.equal(classified.reconciliation.connectedIdentityCount, 1);
    assert.equal(classified.reconciliation.extraOccupiedRowCount, 0);
    assert.equal(classified.receipts[1]?.applyNote, EXTERNAL_RECEIPT_CONNECTED_NOTE);
    assert.equal(classified.receipts[1]?.applyStatus, "preview");

    const db = receiptDb();
    const previewed = await previewExternalDeliveryReceipts(
      {
        clientAccountId: "client_1",
        requestId: "imp-same-phone",
        rows: [
          { rowNumber: 1, phone: "+12025550100", email: "one@example.test" },
          { rowNumber: 2, phone: "+12025550100", email: "two@example.test" },
        ],
        inventory: [],
      },
      db
    );
    assert.equal(previewed.ok, true);
    if (!previewed.ok) return;
    const applied = await applyExternalDeliveryReceipts(
      {
        batchId: previewed.item.id,
        confirmationPhrase: EXTERNAL_RECEIPT_APPLY_PHRASE,
        confirmUnmatchedHistoricalDeliveries: true,
        sourceEvidence: "synthetic same-phone alternate email",
      },
      db
    );
    assert.equal(applied.ok, true);
    if (!applied.ok) return;
    const seen = await loadAppliedExternalReceiptFingerprints("client_1", db);
    assert.equal(seen.phoneFingerprints.size, 1);
    assert.equal(seen.emailFingerprints.size, 2);
  });

  it("connects same email with a different phone and keeps both phones", () => {
    const classified = classifyReceiptRows(
      [
        { rowNumber: 1, phone: "+12025550100", email: "shared@example.test" },
        { rowNumber: 2, phone: "+12025550101", email: "shared@example.test" },
      ],
      []
    );
    assert.equal(classified.reconciliation.uniqueLeadCount, 1);
    assert.equal(classified.reconciliation.connectedIdentityCount, 1);
    assert.equal(classified.receipts[1]?.applyNote, EXTERNAL_RECEIPT_CONNECTED_NOTE);
  });

  it("connects phone-only to a later phone-plus-email row without dropping the email", () => {
    const classified = classifyReceiptRows(
      [
        { rowNumber: 1, phone: "+12025550100" },
        { rowNumber: 2, phone: "+12025550100", email: "later@example.test" },
      ],
      []
    );
    assert.equal(classified.reconciliation.uniqueLeadCount, 1);
    assert.equal(classified.reconciliation.connectedIdentityCount, 1);
    assert.equal(classified.receipts[1]?.emailFingerprint, fingerprintIdentityValue("email", "later@example.test"));
    assert.equal(classified.receipts[1]?.applyStatus, "preview");
  });

  it("connects email-only to a later phone-plus-email row without dropping the phone", () => {
    const classified = classifyReceiptRows(
      [
        { rowNumber: 1, email: "only@example.test" },
        { rowNumber: 2, phone: "+12025550100", email: "only@example.test" },
      ],
      []
    );
    assert.equal(classified.reconciliation.uniqueLeadCount, 1);
    assert.equal(classified.reconciliation.connectedIdentityCount, 1);
    assert.ok(classified.receipts[1]?.phoneFingerprint);
    assert.equal(classified.receipts[1]?.applyStatus, "preview");
  });

  it("groups transitive overlaps as one consumer", () => {
    const classified = classifyReceiptRows(
      [
        { rowNumber: 1, phone: "+12025550100", email: "left@example.test" },
        { rowNumber: 2, phone: "+12025550101", email: "left@example.test" },
        { rowNumber: 3, phone: "+12025550101", email: "right@example.test" },
      ],
      []
    );
    assert.equal(classified.reconciliation.uniqueLeadCount, 1);
    assert.equal(classified.reconciliation.connectedIdentityCount, 2);
    assert.equal(classified.reconciliation.identityConflictCount, 0);
  });

  it("marks a merge of two established identities as a conflict requiring review", async () => {
    process.env.SA360_PPL_EXTERNAL_RECEIPT_IMPORT_ENABLED = "true";
    const classified = classifyReceiptRows(
      [
        { rowNumber: 1, phone: "+12025550100", email: "ada@example.test" },
        { rowNumber: 2, phone: "+12025550101", email: "bea@example.test" },
        { rowNumber: 3, phone: "+12025550100", email: "bea@example.test" },
      ],
      []
    );
    assert.equal(classified.reconciliation.uniqueLeadCount, 2);
    assert.equal(classified.reconciliation.identityConflictCount, 1);
    assert.equal(classified.receipts[2]?.matchStatus, EXTERNAL_RECEIPT_IDENTITY_CONFLICT);
    assert.equal(classified.receipts[2]?.applyStatus, "skipped");

    const db = receiptDb();
    const previewed = await previewExternalDeliveryReceipts(
      {
        clientAccountId: "client_1",
        requestId: "imp-conflict",
        rows: [
          { rowNumber: 1, phone: "+12025550100", email: "ada@example.test" },
          { rowNumber: 2, phone: "+12025550101", email: "bea@example.test" },
          { rowNumber: 3, phone: "+12025550100", email: "bea@example.test" },
        ],
        inventory: [],
      },
      db
    );
    assert.equal(previewed.ok, true);
    if (!previewed.ok) return;
    const applied = await applyExternalDeliveryReceipts(
      {
        batchId: previewed.item.id,
        confirmationPhrase: EXTERNAL_RECEIPT_APPLY_PHRASE,
        confirmUnmatchedHistoricalDeliveries: true,
        sourceEvidence: "synthetic conflict must not apply the bridge row",
      },
      db
    );
    assert.equal(applied.ok, true);
    if (!applied.ok) return;
    assert.equal(applied.item.receipts.find((row) => row.rowNumber === 3)?.applyStatus, "skipped");
    const seen = await loadAppliedExternalReceiptFingerprints("client_1", db);
    assert.equal(seen.phoneFingerprints.size, 2);
    assert.equal(seen.emailFingerprints.size, 2);
  });

  it("does not let a rejected-before-delivery connected row create delivered suppression", async () => {
    process.env.SA360_PPL_EXTERNAL_RECEIPT_IMPORT_ENABLED = "true";
    const db = receiptDb();
    const previewed = await previewExternalDeliveryReceipts(
      {
        clientAccountId: "client_1",
        requestId: "imp-rejected-alt",
        rows: [
          { rowNumber: 1, phone: "+12025550100", email: "keep@example.test" },
          {
            rowNumber: 2,
            phone: "+12025550100",
            email: "rejected-alt@example.test",
            rejectedBeforeDelivery: true,
          },
        ],
        inventory: [],
      },
      db
    );
    assert.equal(previewed.ok, true);
    if (!previewed.ok) return;
    assert.equal(
      previewed.item.receipts[1]?.applyStatus,
      "suppressed_rejected_before_delivery"
    );
    const applied = await applyExternalDeliveryReceipts(
      {
        batchId: previewed.item.id,
        confirmationPhrase: EXTERNAL_RECEIPT_APPLY_PHRASE,
        confirmUnmatchedHistoricalDeliveries: true,
        sourceEvidence: "rejected alternate email must stay out of suppression",
      },
      db
    );
    assert.equal(applied.ok, true);
    if (!applied.ok) return;
    const seen = await loadAppliedExternalReceiptFingerprints("client_1", db);
    const rejectedEmail = fingerprintIdentityValue("email", "rejected-alt@example.test");
    const keptEmail = fingerprintIdentityValue("email", "keep@example.test");
    assert.ok(keptEmail && seen.emailFingerprints.has(keptEmail));
    assert.ok(rejectedEmail && !seen.emailFingerprints.has(rejectedEmail));
  });

  it("treats the same identity across separate batches as one suppression set", async () => {
    process.env.SA360_PPL_EXTERNAL_RECEIPT_IMPORT_ENABLED = "true";
    const db = receiptDb();
    const rows = [{ rowNumber: 1, phone: "+12025550100", email: "repeat@example.test" }];
    const first = await previewExternalDeliveryReceipts(
      { clientAccountId: "client_1", requestId: "imp-batch-a", rows, inventory: [] },
      db
    );
    const second = await previewExternalDeliveryReceipts(
      { clientAccountId: "client_1", requestId: "imp-batch-b", rows, inventory: [] },
      db
    );
    assert.equal(first.ok && second.ok, true);
    if (!first.ok || !second.ok) return;
    await applyExternalDeliveryReceipts(
      {
        batchId: first.item.id,
        confirmationPhrase: EXTERNAL_RECEIPT_APPLY_PHRASE,
        confirmUnmatchedHistoricalDeliveries: true,
        sourceEvidence: "batch a",
      },
      db
    );
    await applyExternalDeliveryReceipts(
      {
        batchId: second.item.id,
        confirmationPhrase: EXTERNAL_RECEIPT_APPLY_PHRASE,
        confirmUnmatchedHistoricalDeliveries: true,
        sourceEvidence: "batch b",
      },
      db
    );
    const seen = await loadAppliedExternalReceiptFingerprints("client_1", db);
    assert.equal(seen.phoneFingerprints.size, 1);
    assert.equal(seen.emailFingerprints.size, 1);
    const other = await loadAppliedExternalReceiptFingerprints("client_2", db);
    assert.equal(other.phoneFingerprints.size, 0);
    assert.equal(other.emailFingerprints.size, 0);
  });
});


