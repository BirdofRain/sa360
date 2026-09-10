import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { PrismaClient } from "@prisma/client";

import { assertSafeTestDatabaseUrl } from "../../lib/safe-test-database-url.js";
import { isOriginClientBuyerIneligible } from "../ppl-fulfillment/origin-client-exclusion.js";
import { processLeadCaptureNextGenLeadCreated } from "./leadcapture-nextgen-intake.service.js";
import {
  clearSourceFunnelAssociation,
  confirmSourceFunnelOrigin,
  isSourceFunnelOriginCorrectionError,
  reassignSourceFunnelOrigin,
} from "./source-funnel.service.js";

const integrationUrlRaw = process.env.SA360_TEST_DATABASE_URL?.trim() || "";
const runIntegration = Boolean(integrationUrlRaw);

const PREFIX = "sf_corr";
const CLIENT_A = `${PREFIX}_a`;
const CLIENT_B = `${PREFIX}_b`;
const CLIENT_C = `${PREFIX}_c`;
const CLIENT_UNRELATED = `${PREFIX}_unrelated`;
const FUNNEL_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeee0201";

function nextgenPayload(input: {
  leadId: string;
  email: string;
  phone: string;
}): Record<string, unknown> {
  return {
    provider: "leadcapture_io",
    sa360_source_system: "leadcapture_io_nextgen",
    sa360_source_platform: "leadcapture_io",
    funnel_id: FUNNEL_ID,
    funnel_name: "Life Insurance For Veterans - Unknown Correction Name",
    lead_id: input.leadId,
    submitted_at: "2026-01-01T00:00:00.000Z",
    first_name: "Origin",
    last_name: "Correction",
    email: input.email,
    phone: input.phone,
    state: "NC",
  };
}

describe("SourceFunnel origin correction", { skip: !runIntegration }, () => {
  let db: PrismaClient;
  const createdEventIds: string[] = [];
  const createdClientIds = [CLIENT_A, CLIENT_B, CLIENT_C, CLIENT_UNRELATED];

  before(async () => {
    const url = assertSafeTestDatabaseUrl(integrationUrlRaw);
    process.env.DATABASE_URL = url;
    db = new PrismaClient({ datasources: { db: { url } } });
    await db.leadInventoryItem.deleteMany({
      where: { originClientAccountId: { in: createdClientIds } },
    });
    await db.sourceFunnel.deleteMany({
      where: {
        OR: [
          { originClientAccountId: { in: createdClientIds } },
          { suggestedClientAccountId: { in: createdClientIds } },
          { provider: "leadcapture_io", providerFunnelId: FUNNEL_ID },
        ],
      },
    });
    await db.clientAccount.deleteMany({ where: { clientAccountId: { in: createdClientIds } } });
    await db.clientAccount.createMany({
      data: [
        { clientAccountId: CLIENT_A, clientDisplayName: "Correction Client A", status: "active" },
        { clientAccountId: CLIENT_B, clientDisplayName: "Correction Client B", status: "active" },
        { clientAccountId: CLIENT_C, clientDisplayName: "Correction Client C", status: "active" },
        {
          clientAccountId: CLIENT_UNRELATED,
          clientDisplayName: "Correction Unrelated Buyer",
          status: "active",
        },
      ],
    });
  });

  after(async () => {
    if (createdEventIds.length > 0) {
      await db.leadInventoryItem.deleteMany({
        where: { sourceLeadEventId: { in: createdEventIds } },
      });
      await db.sourceLeadEvent.deleteMany({ where: { id: { in: createdEventIds } } });
    }
    await db.sourceFunnel.deleteMany({
      where: { provider: "leadcapture_io", providerFunnelId: FUNNEL_ID },
    });
    await db.clientAccount.deleteMany({ where: { clientAccountId: { in: createdClientIds } } });
    await db?.$disconnect();
  });

  it("confirms, rejects silent reassignment, reassigns with conflict counts, and clears matching stamps", async () => {
    const stampedA = await processLeadCaptureNextGenLeadCreated({
      rawPayload: nextgenPayload({
        leadId: "d1111111-2222-4333-8444-555555555701",
        email: "sf.corr.a@example.test",
        phone: "5550109701",
      }),
      stageOverride: "inventory_only",
    });
    const willBeNull = await processLeadCaptureNextGenLeadCreated({
      rawPayload: nextgenPayload({
        leadId: "d1111111-2222-4333-8444-555555555702",
        email: "sf.corr.null@example.test",
        phone: "5550109702",
      }),
      stageOverride: "inventory_only",
    });
    const thirdParty = await processLeadCaptureNextGenLeadCreated({
      rawPayload: nextgenPayload({
        leadId: "d1111111-2222-4333-8444-555555555703",
        email: "sf.corr.c@example.test",
        phone: "5550109703",
      }),
      stageOverride: "inventory_only",
    });
    createdEventIds.push(stampedA.sourceEventId, willBeNull.sourceEventId, thirdParty.sourceEventId);

    const funnel = await db.sourceFunnel.findUnique({
      where: {
        provider_providerFunnelId: {
          provider: "leadcapture_io",
          providerFunnelId: FUNNEL_ID,
        },
      },
    });
    assert.ok(funnel);
    assert.equal(funnel.associationStatus, "unassociated");
    assert.equal(funnel.originClientAccountId, null);

    const confirmed = await confirmSourceFunnelOrigin(
      { sourceFunnelId: funnel.id, originClientAccountId: CLIENT_A },
      db
    );
    assert.equal(confirmed.sourceFunnel.associationStatus, "confirmed");
    assert.equal(confirmed.sourceFunnel.originClientAccountId, CLIENT_A);
    assert.equal(confirmed.sourceFunnel.suggestedClientAccountId, null);
    assert.equal(confirmed.backfilledInventoryCount, 3);

    const afterConfirm = await db.leadInventoryItem.findMany({
      where: { sourceLeadEventId: { in: createdEventIds } },
    });
    assert.equal(afterConfirm.length, 3);
    assert.ok(afterConfirm.every((row) => row.originClientAccountId === CLIENT_A));

    const confirmAgain = await confirmSourceFunnelOrigin(
      { sourceFunnelId: funnel.id, originClientAccountId: CLIENT_A },
      db
    );
    assert.equal(confirmAgain.sourceFunnel.associationStatus, "confirmed");
    assert.equal(confirmAgain.sourceFunnel.originClientAccountId, CLIENT_A);
    assert.equal(confirmAgain.backfilledInventoryCount, 0);

    await assert.rejects(
      () =>
        confirmSourceFunnelOrigin(
          { sourceFunnelId: funnel.id, originClientAccountId: CLIENT_B },
          db
        ),
      (err: unknown) => {
        assert.equal(isSourceFunnelOriginCorrectionError(err), true);
        if (!isSourceFunnelOriginCorrectionError(err)) return false;
        assert.equal(err.code, "confirm_requires_explicit_reassign");
        assert.equal(err.currentOriginClientAccountId, CLIENT_A);
        assert.equal(err.requestedOriginClientAccountId, CLIENT_B);
        return true;
      }
    );

    const stillA = await db.sourceFunnel.findUnique({ where: { id: funnel.id } });
    assert.equal(stillA?.originClientAccountId, CLIENT_A);
    const unchangedAfterReject = await db.leadInventoryItem.findMany({
      where: { sourceLeadEventId: { in: createdEventIds } },
    });
    assert.ok(unchangedAfterReject.every((row) => row.originClientAccountId === CLIENT_A));

    await db.leadInventoryItem.update({
      where: { sourceLeadEventId: willBeNull.sourceEventId },
      data: { originClientAccountId: null },
    });
    await db.leadInventoryItem.update({
      where: { sourceLeadEventId: thirdParty.sourceEventId },
      data: { originClientAccountId: CLIENT_C },
    });

    const reassigned = await reassignSourceFunnelOrigin(
      { sourceFunnelId: funnel.id, originClientAccountId: CLIENT_B },
      db
    );
    assert.equal(reassigned.sourceFunnel.associationStatus, "confirmed");
    assert.equal(reassigned.sourceFunnel.originClientAccountId, CLIENT_B);
    assert.equal(reassigned.newlyStamped, 1);
    assert.equal(reassigned.reassigned, 1);
    assert.equal(reassigned.conflictsSkipped, 1);

    const afterReassign = await db.leadInventoryItem.findMany({
      where: { sourceLeadEventId: { in: createdEventIds } },
    });
    const byEvent = Object.fromEntries(
      afterReassign.map((row) => [row.sourceLeadEventId, row.originClientAccountId])
    );
    assert.equal(byEvent[stampedA.sourceEventId], CLIENT_B);
    assert.equal(byEvent[willBeNull.sourceEventId], CLIENT_B);
    assert.equal(byEvent[thirdParty.sourceEventId], CLIENT_C);

    assert.equal(isOriginClientBuyerIneligible(CLIENT_B, CLIENT_B), true);
    assert.equal(isOriginClientBuyerIneligible(byEvent[stampedA.sourceEventId], CLIENT_B), true);
    assert.equal(isOriginClientBuyerIneligible(byEvent[stampedA.sourceEventId], CLIENT_A), false);
    assert.equal(
      isOriginClientBuyerIneligible(byEvent[stampedA.sourceEventId], CLIENT_UNRELATED),
      false
    );
    assert.equal(isOriginClientBuyerIneligible(byEvent[thirdParty.sourceEventId], CLIENT_B), false);
    assert.equal(isOriginClientBuyerIneligible(byEvent[thirdParty.sourceEventId], CLIENT_C), true);

    const cleared = await clearSourceFunnelAssociation(funnel.id, db);
    assert.equal(cleared.sourceFunnel.associationStatus, "unassociated");
    assert.equal(cleared.sourceFunnel.originClientAccountId, null);
    assert.equal(cleared.clearedInventoryCount, 2);

    const afterClear = await db.leadInventoryItem.findMany({
      where: { sourceLeadEventId: { in: createdEventIds } },
    });
    const clearedByEvent = Object.fromEntries(
      afterClear.map((row) => [row.sourceLeadEventId, row.originClientAccountId])
    );
    assert.equal(clearedByEvent[stampedA.sourceEventId], null);
    assert.equal(clearedByEvent[willBeNull.sourceEventId], null);
    assert.equal(clearedByEvent[thirdParty.sourceEventId], CLIENT_C);
    assert.equal(
      isOriginClientBuyerIneligible(clearedByEvent[stampedA.sourceEventId], CLIENT_B),
      false
    );
  });
});
