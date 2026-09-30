import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { PrismaClient } from "@prisma/client";

import { assertSafeTestDatabaseUrl } from "../../lib/safe-test-database-url.js";
import { prisma } from "../../lib/db.js";
import { processFacebookSourceLead } from "./facebook-lead-intake.service.js";
import { processLeadConduitFacebookIntake } from "./leadconduit-facebook-intake.service.js";
import {
  FacebookCaptureReevaluationError,
  reevaluateFacebookCaptureAssociation,
} from "./facebook-capture-reevaluate.service.js";
import {
  FacebookFormAssociationError,
  confirmFacebookFormAssociation,
} from "./facebook-form-association.service.js";
import { processZapierFacebookCapture } from "./zapier-facebook-capture.service.js";
import { buildFacebookLeadUid } from "./facebook-lead-normalizer.js";

const integrationUrlRaw = process.env.SA360_TEST_DATABASE_URL?.trim() || "";
const runIntegration = Boolean(integrationUrlRaw);

function uniqueStamp(): string {
  return `${Date.now()}${Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, "0")}`;
}

/** Numeric Facebook id. The marker stays in the first two digits so a 16-digit stamp cannot erase it. */
function facebookId(marker: string, stamp: string): string {
  return `${marker}${stamp}`.slice(0, 16);
}

describe("Zapier Facebook capture-only intake", { skip: !runIntegration }, () => {
  let db: PrismaClient;
  const leadgenIds: string[] = [];
  const clientIds: string[] = [];
  const funnelIds: string[] = [];
  const lotIds: string[] = [];
  const savedMaster = {
    leadconduit: process.env.SA360_LEADCONDUIT_MASTER_CLIENT_ACCOUNT_ID,
    facebook: process.env.SA360_FACEBOOK_MASTER_CLIENT_ACCOUNT_ID,
  };

  before(async () => {
    const url = assertSafeTestDatabaseUrl(integrationUrlRaw);
    process.env.DATABASE_URL = url;
    delete process.env.SA360_LEADCONDUIT_MASTER_CLIENT_ACCOUNT_ID;
    delete process.env.SA360_FACEBOOK_MASTER_CLIENT_ACCOUNT_ID;
    db = prisma;
    await db.$queryRaw`SELECT 1`;
  });

  after(async () => {
    if (savedMaster.leadconduit === undefined) {
      delete process.env.SA360_LEADCONDUIT_MASTER_CLIENT_ACCOUNT_ID;
    } else {
      process.env.SA360_LEADCONDUIT_MASTER_CLIENT_ACCOUNT_ID = savedMaster.leadconduit;
    }
    if (savedMaster.facebook === undefined) {
      delete process.env.SA360_FACEBOOK_MASTER_CLIENT_ACCOUNT_ID;
    } else {
      process.env.SA360_FACEBOOK_MASTER_CLIENT_ACCOUNT_ID = savedMaster.facebook;
    }
    if (leadgenIds.length === 0) return;
    const events = await db.sourceLeadEvent.findMany({
      where: { sourceLeadId: { in: leadgenIds } },
      select: { id: true, sourceLeadUid: true, routingDryRunDecisionId: true },
    });
    const eventIds = events.map((event) => event.id);
    const uids = events.map((event) => event.sourceLeadUid).filter((uid): uid is string => Boolean(uid));
    const decisionIds = events
      .map((event) => event.routingDryRunDecisionId)
      .filter((id): id is string => Boolean(id));
    if (eventIds.length > 0) {
      await db.leadInventoryItem.deleteMany({ where: { sourceLeadEventId: { in: eventIds } } });
      await db.fulfillmentOutbox.deleteMany({ where: { sourceLeadEventId: { in: eventIds } } });
      await db.sourceLeadEvent.deleteMany({ where: { id: { in: eventIds } } });
    }
    if (decisionIds.length > 0 || uids.length > 0) {
      await db.routingDryRunDecision.deleteMany({
        where: {
          OR: [
            ...(decisionIds.length > 0 ? [{ id: { in: decisionIds } }] : []),
            ...(uids.length > 0 ? [{ sourceLeadUid: { in: uids } }] : []),
          ],
        },
      });
    }
    if (lotIds.length > 0) {
      await db.inventoryLot.deleteMany({ where: { id: { in: lotIds } } });
    }
    if (funnelIds.length > 0) {
      await db.sourceFunnel.deleteMany({ where: { id: { in: funnelIds } } });
    }
    if (clientIds.length > 0) {
      await db.clientAccount.deleteMany({ where: { clientAccountId: { in: clientIds } } });
    }
  });

  async function client(suffix: string): Promise<string> {
    const clientAccountId = `fb_cap_${suffix}`;
    clientIds.push(clientAccountId);
    await db.clientAccount.create({
      data: { clientAccountId, clientDisplayName: `Synthetic ${suffix}`, status: "active" },
    });
    return clientAccountId;
  }

  function rememberLead(leadgenId: string) {
    leadgenIds.push(leadgenId);
  }

  it("captures without a master account and associates an exact page and form", async () => {
    const stamp = uniqueStamp();
    const leadgenId = facebookId("91", stamp);
    const pageId = facebookId("81", stamp);
    const formId = facebookId("71", stamp);
    rememberLead(leadgenId);
    const clientAccountId = await client(stamp);
    const confirmed = await confirmFacebookFormAssociation({
      pageId,
      formId,
      clientAccountId,
      formName: "Synthetic label only",
    });
    funnelIds.push(confirmed.item.id);
    assert.equal(confirmed.created, true);
    assert.equal(confirmed.item.clientAccountId, clientAccountId);

    const submittedAt = "2025-11-04T15:04:00.000Z";
    const captured = await processZapierFacebookCapture({
      rawPayload: {
        leadgen_id: leadgenId,
        page_id: pageId,
        form_id: formId,
        first_name: "Sam",
        last_name: "Rivera",
        email: `sam.${stamp}@example.test`,
        phone: "+15555550123",
        submitted_at: submittedAt,
        form_name: "Synthetic Health Form",
      },
    });
    assert.equal(captured.replayed, false);
    assert.equal(captured.association.outcome, "associated");
    assert.equal(captured.association.clientAccountId, clientAccountId);
    assert.equal(captured.inventory.tracked, false);
    assert.equal(captured.inventory.saleEligible, false);
    assert.equal(captured.delivery.attempted, false);
    assert.equal(captured.submittedAt, submittedAt);
    assert.doesNotMatch(captured.nextAction, /approve delivery/i);
    assert.ok(captured.receivedAt);
    assert.notEqual(captured.receivedAt, submittedAt);

    const stored = await db.sourceLeadEvent.findUnique({
      where: { id: captured.sourceEventId },
      include: { leadInventoryItem: true, fulfillmentOutboxItems: true },
    });
    assert.ok(stored);
    assert.equal(stored?.sourceSystem, "meta_lead_ads");
    assert.equal(stored?.sourceLeadUid, buildFacebookLeadUid(leadgenId));
    assert.equal(stored?.clientAccountIdResolved, clientAccountId);
    assert.equal(stored?.leadInventoryItem, null);
    assert.equal(stored?.fulfillmentOutboxItems.length, 0);
    assert.equal(stored?.routingDryRunDecisionId, null);
    assert.equal(stored?.deliveredAt, null);
    const normalized = stored?.normalizedPayloadJson as { source?: Record<string, unknown> };
    assert.equal(normalized.source?.submitted_at, submittedAt);
    assert.equal(normalized.source?.campaign_id, undefined);
    assert.equal(normalized.source?.ad_id, undefined);
    assert.equal("utm_campaign" in (normalized.source ?? {}), false);
    assert.equal(stored?.sourceCampaignId, null);
  });

  it("retains missing and invalid form identity without blocking capture", async () => {
    const stamp = uniqueStamp();
    const missingId = facebookId("61", stamp);
    const invalidId = facebookId("51", stamp);
    rememberLead(missingId);
    rememberLead(invalidId);
    const missing = await processZapierFacebookCapture({
      rawPayload: { leadgen_id: missingId, first_name: "Sam", last_name: "Rivera" },
    });
    assert.equal(missing.association.outcome, "missing_form_identity");
    assert.equal(missing.association.clientAccountId, null);
    assert.equal(missing.capture.outcome, "captured");
    assert.match(missing.association.explanation, /GHL delivery setup is not required/);

    const invalid = await processZapierFacebookCapture({
      rawPayload: {
        leadgen_id: invalidId,
        page_id: "not-a-page",
        form_id: facebookId("41", stamp),
      },
    });
    assert.equal(invalid.association.outcome, "invalid_form_identity");
    assert.equal(invalid.capture.outcome, "captured");
    const stored = await db.sourceLeadEvent.findUnique({ where: { id: invalid.sourceEventId } });
    const source = (stored?.normalizedPayloadJson as { source?: Record<string, unknown> })?.source;
    assert.equal(source?.page_id, undefined);
  });

  it("retries and concurrent submissions share one logical lead", async () => {
    const stamp = uniqueStamp();
    const leadgenId = facebookId("31", stamp);
    const otherId = facebookId("21", stamp);
    rememberLead(leadgenId);
    rememberLead(otherId);
    const payload = {
      leadgen_id: leadgenId,
      page_id: facebookId("11", stamp),
      form_id: facebookId("12", stamp),
      phone: "+15555550199",
      submitted_at: "2025-11-04T15:04:00.000Z",
    };
    const [first, second] = await Promise.all([
      processZapierFacebookCapture({ rawPayload: payload }),
      processZapierFacebookCapture({ rawPayload: payload }),
    ]);
    assert.equal(first.sourceEventId, second.sourceEventId);
    assert.equal(first.replayed || second.replayed, true);
    const rows = await db.sourceLeadEvent.findMany({
      where: { sourceProvider: "facebook", sourceSystem: "meta_lead_ads", sourceLeadId: leadgenId },
    });
    assert.equal(rows.length, 1);

    const samePhone = await processZapierFacebookCapture({
      rawPayload: { ...payload, leadgen_id: otherId },
    });
    assert.notEqual(samePhone.sourceEventId, first.sourceEventId);
  });

  it("replay keeps the stored association until an authorized reevaluation", async () => {
    const stamp = uniqueStamp();
    const leadgenId = facebookId("43", stamp);
    const pageId = facebookId("44", stamp);
    const formId = facebookId("45", stamp);
    rememberLead(leadgenId);
    const clientA = await client(`${stamp}a`);
    const clientB = await client(`${stamp}b`);
    const captured = await processZapierFacebookCapture({
      rawPayload: {
        leadgen_id: leadgenId,
        page_id: pageId,
        form_id: formId,
        submitted_at: "2025-11-04T15:04:00.000Z",
        first_name: "Sam",
      },
    });
    assert.equal(captured.association.outcome, "unassociated");

    const confirmed = await confirmFacebookFormAssociation({ pageId, formId, clientAccountId: clientA });
    funnelIds.push(confirmed.item.id);
    const replay = await processZapierFacebookCapture({
      rawPayload: { leadgen_id: leadgenId, page_id: pageId, form_id: formId },
    });
    assert.equal(replay.replayed, true);
    assert.equal(replay.sourceEventId, captured.sourceEventId);
    assert.equal(replay.association.outcome, "unassociated");
    assert.equal(replay.association.clientAccountId, null);

    const updated = await reevaluateFacebookCaptureAssociation({
      sourceEventId: captured.sourceEventId,
      operatorNote: "synthetic association check",
    });
    assert.equal(updated.unchanged, false);
    assert.equal(updated.association.clientAccountId, clientA);
    assert.equal(updated.submittedAt, "2025-11-04T15:04:00.000Z");
    assert.equal(updated.inventory.mutated, false);
    assert.equal(updated.delivery.attempted, false);
    const after = await db.sourceLeadEvent.findUnique({ where: { id: captured.sourceEventId } });
    assert.equal(after?.clientAccountIdResolved, clientA);
    assert.equal(after?.status, "normalized");
    const audit = (after?.enrichmentMetadataJson as { associationAudit?: unknown[] })?.associationAudit;
    assert.equal(audit?.length, 1);

    const again = await reevaluateFacebookCaptureAssociation({ sourceEventId: captured.sourceEventId });
    assert.equal(again.unchanged, true);
    const afterAgain = await db.sourceLeadEvent.findUnique({ where: { id: captured.sourceEventId } });
    const auditAgain = (afterAgain?.enrichmentMetadataJson as { associationAudit?: unknown[] })
      ?.associationAudit;
    assert.equal(auditAgain?.length, 1);

    await db.sourceFunnel.update({
      where: { id: confirmed.item.id },
      data: { originClientAccountId: clientB },
    });
    await assert.rejects(
      () => reevaluateFacebookCaptureAssociation({ sourceEventId: captured.sourceEventId }),
      (error: unknown) =>
        error instanceof FacebookCaptureReevaluationError &&
        error.code === "conflicting_historical_association"
    );
    const preserved = await db.sourceLeadEvent.findUnique({ where: { id: captured.sourceEventId } });
    assert.equal(preserved?.clientAccountIdResolved, clientA);

    await assert.rejects(
      () =>
        confirmFacebookFormAssociation({
          pageId,
          formId,
          clientAccountId: clientA,
        }),
      (error: unknown) =>
        error instanceof FacebookFormAssociationError && error.code === "association_conflict"
    );
  });

  it("rejects delivered events and events that already have inventory", async () => {
    const stamp = uniqueStamp();
    const deliveredId = facebookId("86", stamp);
    const inventoryId = facebookId("87", stamp);
    rememberLead(deliveredId);
    rememberLead(inventoryId);
    const delivered = await processZapierFacebookCapture({
      rawPayload: {
        leadgen_id: deliveredId,
        page_id: facebookId("88", stamp),
        form_id: facebookId("89", stamp),
      },
    });
    await db.sourceLeadEvent.update({
      where: { id: delivered.sourceEventId },
      data: { status: "delivered", deliveredAt: new Date() },
    });
    await assert.rejects(
      () => reevaluateFacebookCaptureAssociation({ sourceEventId: delivered.sourceEventId }),
      (error: unknown) =>
        error instanceof FacebookCaptureReevaluationError && error.code === "unsupported_transition"
    );

    const inventoried = await processZapierFacebookCapture({
      rawPayload: {
        leadgen_id: inventoryId,
        page_id: facebookId("83", stamp),
        form_id: facebookId("84", stamp),
      },
    });
    const lot = await db.inventoryLot.create({
      data: {
        lotKey: `fb-cap-${stamp}`,
        displayName: "Synthetic capture lot",
        sourceProvider: "facebook",
        sourceLane: "zapier_facebook_test",
        nicheKey: "health",
        inventoryClass: "aged",
      },
    });
    lotIds.push(lot.id);
    await db.leadInventoryItem.create({
      data: {
        inventoryLotId: lot.id,
        sourceLeadEventId: inventoried.sourceEventId,
        generatedAt: new Date("2025-11-04T15:04:00.000Z"),
        normalizedState: "TX",
        nicheKey: "health",
        sourceProvider: "facebook",
        sourceLane: "zapier_facebook_test",
        inventoryClass: "aged",
      },
    });
    await assert.rejects(
      () => reevaluateFacebookCaptureAssociation({ sourceEventId: inventoried.sourceEventId }),
      (error: unknown) =>
        error instanceof FacebookCaptureReevaluationError && error.code === "inventory_record_present"
    );
  });

  it("shares canonical identity with direct Meta and keeps LeadConduit separate", async () => {
    const stamp = uniqueStamp();
    const leadgenId = facebookId("73", stamp);
    rememberLead(leadgenId);
    const captured = await processZapierFacebookCapture({
      rawPayload: {
        leadgen_id: leadgenId,
        page_id: facebookId("74", stamp),
        form_id: facebookId("75", stamp),
        first_name: "Sam",
        submitted_at: "2025-11-04T15:04:00.000Z",
      },
    });
    const meta = await processFacebookSourceLead({
      fields: {
        leadgenId,
        formId: facebookId("75", stamp),
        firstName: "Other",
        lastName: "Person",
        email: `other.${stamp}@example.test`,
        phone: "+15555550111",
      },
      rawPayloadJson: { leadgen_id: leadgenId, replaced: true },
      masterClientAccountId: "lal_master_vet",
      routingEnabled: true,
    });
    assert.equal(meta.replayed, true);
    assert.equal(meta.sourceEventId, captured.sourceEventId);
    const still = await db.sourceLeadEvent.findUnique({ where: { id: captured.sourceEventId } });
    assert.equal((still?.rawPayloadJson as { first_name?: string }).first_name, "Sam");
    assert.equal(still?.routingDryRunDecisionId, null);
    const metaRows = await db.sourceLeadEvent.count({
      where: { sourceProvider: "facebook", sourceSystem: "meta_lead_ads", sourceLeadId: leadgenId },
    });
    assert.equal(metaRows, 1);

    const legacy = await processLeadConduitFacebookIntake({
      rawPayload: {
        leadgen_id: leadgenId,
        page_id: facebookId("74", stamp),
        form_id: facebookId("75", stamp),
        first_name: "Sam",
        last_name: "Rivera",
        email: `legacy.${stamp}@example.test`,
      },
      masterClientAccountId: "lal_master_vet",
    });
    assert.notEqual(legacy.sourceEventId, captured.sourceEventId);
    assert.equal(legacy.sourceSystem, "external_vendor");
    const legacyRow = await db.sourceLeadEvent.findUnique({ where: { id: legacy.sourceEventId } });
    assert.equal(legacyRow?.sourceSystem, "external_vendor");
    assert.notEqual(legacyRow?.sourceLeadUid, still?.sourceLeadUid);
  });
});
