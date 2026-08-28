import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { PrismaClient } from "@prisma/client";

import { assertSafeTestDatabaseUrl } from "../../lib/safe-test-database-url.js";
import type { SendTransactionalEmailInput } from "../../lib/transactional-email.js";
import {
  commitBuyerCsvExport,
  getBuyerCsvExportDownload,
  markSpreadsheetDelivered,
  previewBuyerCsvExport,
} from "./buyer-csv-export.service.js";
import { commitPplInventorySelection } from "./inventory-selection.service.js";
import { seedPplAgedBetaFixtures } from "./ppl-beta-fixtures.js";

const integrationUrlRaw =
  process.env.SA360_PPL_INTEGRATION_DATABASE_URL?.trim() ||
  process.env.SA360_TEST_DATABASE_URL?.trim() ||
  "";
const runIntegration = Boolean(integrationUrlRaw);
const emailSuffix = `${Date.now()}`;
const ownerEmail = `buyer-${emailSuffix}@valleyvet.example`;
const otherEmail = `other-${emailSuffix}@foreign.example`;

describe("delivery release customer notification", { skip: !runIntegration }, () => {
  let db: PrismaClient;

  before(async () => {
    const integrationUrl = assertSafeTestDatabaseUrl(integrationUrlRaw);
    process.env.DATABASE_URL = integrationUrl;
    process.env.SA360_PPL_SELECTION_ENABLED = "true";
    process.env.SA360_PPL_LOCAL_MIN_QTY = "1";
    process.env.SA360_PPL_CSV_EXPORT_ENABLED = "true";
    process.env.ADMIN_COC_BASE_URL = "https://portal.example.com";
    db = new PrismaClient({ datasources: { db: { url: integrationUrl } } });
  });

  after(async () => {
    await db?.$disconnect();
  });

  async function seedReleasedPath(opts?: { portalLoginEmail?: string | null }) {
    const fixtures = await seedPplAgedBetaFixtures(db);
    await db.clientAccount.update({
      where: { clientAccountId: fixtures.buyerClientId },
      data: {
        portalEnabled: true,
        portalLoginEmail: opts && "portalLoginEmail" in opts ? opts.portalLoginEmail : ownerEmail,
        portalDisplayName: "Valley Vet",
      },
    });
    await db.clientAccount.update({
      where: { clientAccountId: fixtures.otherBuyerClientId },
      data: {
        portalEnabled: true,
        portalLoginEmail: otherEmail,
        portalDisplayName: "Other Buyer",
      },
    });
    const commit = await commitPplInventorySelection(
      {
        orderId: fixtures.orderId,
        requestedQuantity: 1,
        commerceAgeBucketKeys: ["COMMERCE_1_3_MO", "COMMERCE_3_6_MO", "COMMERCE_6_9_MO", "COMMERCE_12_MO_PLUS"],
        idempotencyKey: `notify-select-${fixtures.orderId}`,
      },
      db
    );
    assert.equal(commit.ok, true);
    if (!commit.ok) throw new Error("selection_failed");
    return fixtures;
  }

  it("does not email on preview, export commit, or internal CSV download", async () => {
    const sendCalls: SendTransactionalEmailInput[] = [];
    const send = async (input: SendTransactionalEmailInput) => {
      sendCalls.push(input);
      return { ok: true, id: "should_not_fire" };
    };
    const fixtures = await seedReleasedPath();
    const preview = await previewBuyerCsvExport({ orderId: fixtures.orderId }, db);
    assert.equal(preview.ok, true);

    const committed = await commitBuyerCsvExport(
      { orderId: fixtures.orderId, idempotencyKey: `notify-export-${fixtures.orderId}` },
      db
    );
    assert.equal(committed.ok, true);
    if (!committed.ok) return;

    const afterCommit = await db.leadDeliveryExportPackage.findUniqueOrThrow({
      where: { id: committed.exportId },
    });
    assert.equal(afterCommit.spreadsheetDeliveredAt, null);
    assert.equal(afterCommit.customerReleaseNotifyStatus, null);

    const download = await getBuyerCsvExportDownload(committed.exportId, db);
    assert.equal(download.ok, true);
    const afterDownload = await db.leadDeliveryExportPackage.findUniqueOrThrow({
      where: { id: committed.exportId },
    });
    assert.equal(afterDownload.spreadsheetDeliveredAt, null);
    assert.equal(afterDownload.customerReleaseNotifyStatus, null);
    assert.equal(sendCalls.length, 0);

    const failed = await markSpreadsheetDelivered(
      {
        exportId: committed.exportId,
        confirmationPhrase: "NOT THE PHRASE",
        idempotencyKey: `notify-fail-${committed.exportId}`,
      },
      db,
      { send }
    );
    assert.equal(failed.ok, false);
    assert.equal(sendCalls.length, 0);
    const afterFail = await db.leadDeliveryExportPackage.findUniqueOrThrow({
      where: { id: committed.exportId },
    });
    assert.equal(afterFail.spreadsheetDeliveredAt, null);
    assert.equal(afterFail.customerReleaseNotifyStatus, null);
  });

  it("sends one customer email after the first successful release and ignores replays", async () => {
    const sendCalls: SendTransactionalEmailInput[] = [];
    const send = async (input: SendTransactionalEmailInput) => {
      sendCalls.push(input);
      return { ok: true, id: `email_${sendCalls.length}` };
    };
    const fixtures = await seedReleasedPath();
    const committed = await commitBuyerCsvExport(
      { orderId: fixtures.orderId, idempotencyKey: `notify-export-ok-${fixtures.orderId}` },
      db
    );
    assert.equal(committed.ok, true);
    if (!committed.ok) return;

    const identitiesBefore = await db.buyerDeliveredIdentity.count({
      where: { leadAllocationId: { in: committed.allocationIds } },
    });
    assert.equal(identitiesBefore, 0);

    const released = await markSpreadsheetDelivered(
      {
        exportId: committed.exportId,
        confirmationPhrase: "MARK SPREADSHEET DELIVERED",
        idempotencyKey: `notify-del-${committed.exportId}`,
        deliveredBy: "operator_alex",
      },
      db,
      { send }
    );
    assert.equal(released.ok, true);
    if (!released.ok) return;
    assert.equal(released.idempotentReplay, false);
    assert.equal(released.customerNotification?.status, "sent");
    assert.equal(sendCalls.length, 1);
    assert.equal(sendCalls[0]?.to, ownerEmail);
    assert.match(String(sendCalls[0]?.text), /https:\/\/portal\.example\.com\/portal\/orders\//);
    assert.doesNotMatch(String(sendCalls[0]?.text), /csv|allocation|operator_alex/i);
    assert.equal(sendCalls[0]?.idempotencyKey, `delivery-release:${committed.exportId}`);

    const identitiesAfter = await db.buyerDeliveredIdentity.count({
      where: { leadAllocationId: { in: released.allocationIds } },
    });
    assert.equal(identitiesAfter, released.allocationIds.length);

    const replay = await markSpreadsheetDelivered(
      {
        exportId: committed.exportId,
        confirmationPhrase: "MARK SPREADSHEET DELIVERED",
        idempotencyKey: `notify-del-${committed.exportId}`,
        deliveredBy: "operator_alex",
      },
      db,
      { send }
    );
    assert.equal(replay.ok, true);
    if (!replay.ok) return;
    assert.equal(replay.idempotentReplay, true);
    assert.equal(replay.customerNotification?.status, "sent");

    const revisit = await markSpreadsheetDelivered(
      {
        exportId: committed.exportId,
        confirmationPhrase: "MARK SPREADSHEET DELIVERED",
        idempotencyKey: `notify-del-other-${committed.exportId}`,
        deliveredBy: "operator_alex",
      },
      db,
      { send }
    );
    assert.equal(revisit.ok, true);
    assert.equal(sendCalls.length, 1);

    const pkg = await db.leadDeliveryExportPackage.findUniqueOrThrow({
      where: { id: committed.exportId },
    });
    assert.ok(pkg.spreadsheetDeliveredAt);
    assert.equal(pkg.customerReleaseNotifyStatus, "sent");
  });

  it("keeps release successful when the recipient is missing or the provider fails", async () => {
    const fixtures = await seedReleasedPath({ portalLoginEmail: null });
    const committed = await commitBuyerCsvExport(
      { orderId: fixtures.orderId, idempotencyKey: `notify-export-skip-${fixtures.orderId}` },
      db
    );
    assert.equal(committed.ok, true);
    if (!committed.ok) return;

    const sendCalls: SendTransactionalEmailInput[] = [];
    const skipped = await markSpreadsheetDelivered(
      {
        exportId: committed.exportId,
        confirmationPhrase: "MARK SPREADSHEET DELIVERED",
        idempotencyKey: `notify-skip-${committed.exportId}`,
      },
      db,
      {
        send: async (input) => {
          sendCalls.push(input);
          return { ok: true, id: "should_not_send" };
        },
      }
    );
    assert.equal(skipped.ok, true);
    if (!skipped.ok) return;
    assert.equal(skipped.customerNotification?.status, "skipped");
    assert.equal(sendCalls.length, 0);
    const skippedPkg = await db.leadDeliveryExportPackage.findUniqueOrThrow({
      where: { id: committed.exportId },
    });
    assert.ok(skippedPkg.spreadsheetDeliveredAt);
    assert.equal(skippedPkg.customerReleaseNotifyStatus, "skipped");

    const fixturesFail = await seedReleasedPath();
    const committedFail = await commitBuyerCsvExport(
      { orderId: fixturesFail.orderId, idempotencyKey: `notify-export-fail-${fixturesFail.orderId}` },
      db
    );
    assert.equal(committedFail.ok, true);
    if (!committedFail.ok) return;

    const failedNotify = await markSpreadsheetDelivered(
      {
        exportId: committedFail.exportId,
        confirmationPhrase: "MARK SPREADSHEET DELIVERED",
        idempotencyKey: `notify-provfail-${committedFail.exportId}`,
      },
      db,
      { send: async () => ({ ok: false, error: "Resend 503: unavailable" }) }
    );
    assert.equal(failedNotify.ok, true);
    if (!failedNotify.ok) return;
    assert.equal(failedNotify.customerNotification?.status, "failed");
    const failedPkg = await db.leadDeliveryExportPackage.findUniqueOrThrow({
      where: { id: committedFail.exportId },
    });
    assert.ok(failedPkg.spreadsheetDeliveredAt);
    assert.equal(failedPkg.customerReleaseNotifyStatus, "failed");

    const recoveredCalls: SendTransactionalEmailInput[] = [];
    const recovered = await markSpreadsheetDelivered(
      {
        exportId: committedFail.exportId,
        confirmationPhrase: "MARK SPREADSHEET DELIVERED",
        idempotencyKey: `notify-provfail-${committedFail.exportId}`,
      },
      db,
      {
        send: async (input) => {
          recoveredCalls.push(input);
          return { ok: true, id: "email_recovered" };
        },
      }
    );
    assert.equal(recovered.ok, true);
    if (!recovered.ok) return;
    assert.equal(recovered.idempotentReplay, true);
    assert.equal(recovered.customerNotification?.status, "sent");
    assert.equal(recoveredCalls.length, 1);
    assert.equal(recoveredCalls[0]?.to, ownerEmail);

    const replay = await markSpreadsheetDelivered(
      {
        exportId: committedFail.exportId,
        confirmationPhrase: "MARK SPREADSHEET DELIVERED",
        idempotencyKey: `notify-provfail-${committedFail.exportId}`,
      },
      db,
      {
        send: async (input) => {
          recoveredCalls.push(input);
          return { ok: true, id: "email_dup" };
        },
      }
    );
    assert.equal(replay.ok, true);
    assert.equal(recoveredCalls.length, 1);
  });
});
