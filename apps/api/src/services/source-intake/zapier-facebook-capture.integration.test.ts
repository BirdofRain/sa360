import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { PrismaClient } from "@prisma/client";

import { assertSafeTestDatabaseUrl } from "../../lib/safe-test-database-url.js";
import { prisma } from "../../lib/db.js";
import { claimSourceLeadEventByCanonicalIdentity } from "../../repositories/source-lead-event.repository.js";
import { FacebookCaptureIntakeDisabledError } from "./facebook-capture-gate.js";
import { isSettledCaptureOnlyFacebookEvent } from "./facebook-capture-provenance.js";
import { processFacebookSourceLead } from "./facebook-lead-intake.service.js";
import { processMetaLeadgenFetch } from "./meta-leadgen-fetch.service.js";
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
    capture: process.env.SA360_FACEBOOK_CAPTURE_INTAKE_ENABLED,
  };

  before(async () => {
    const url = assertSafeTestDatabaseUrl(integrationUrlRaw);
    process.env.DATABASE_URL = url;
    delete process.env.SA360_LEADCONDUIT_MASTER_CLIENT_ACCOUNT_ID;
    delete process.env.SA360_FACEBOOK_MASTER_CLIENT_ACCOUNT_ID;
    process.env.SA360_FACEBOOK_CAPTURE_INTAKE_ENABLED = "true";
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
    if (savedMaster.capture === undefined) {
      delete process.env.SA360_FACEBOOK_CAPTURE_INTAKE_ENABLED;
    } else {
      process.env.SA360_FACEBOOK_CAPTURE_INTAKE_ENABLED = savedMaster.capture;
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
    assert.equal(captured.delivery.thisRequestAttempted, false);
    assert.equal(captured.delivery.historicalOutcome, "not_recorded");
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
      actor: "admin_coc_admin",
      requestId: "req_synthetic_reeval",
    });
    assert.equal(updated.unchanged, false);
    assert.equal(updated.association.clientAccountId, clientA);
    assert.equal(updated.submittedAt, "2025-11-04T15:04:00.000Z");
    assert.equal(updated.inventory.mutated, false);
    assert.equal(updated.delivery.thisRequestAttempted, false);
    assert.equal(updated.delivery.historicalOutcome, "not_recorded");
    const after = await db.sourceLeadEvent.findUnique({ where: { id: captured.sourceEventId } });
    assert.equal(after?.clientAccountIdResolved, clientA);
    assert.equal(after?.status, "normalized");
    const audit = (
      after?.enrichmentMetadataJson as {
        associationAudit?: Array<{ actor?: string | null; requestId?: string | null }>;
      }
    )?.associationAudit;
    assert.equal(audit?.length, 1);
    assert.equal(audit?.[0]?.actor, "admin_coc_admin");
    assert.equal(audit?.[0]?.requestId, "req_synthetic_reeval");

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

  it("completes an incomplete Meta raw event from a later Zapier payload", async () => {
    const stamp = uniqueStamp();
    const leadgenId = facebookId("92", stamp);
    const pageId = facebookId("82", stamp);
    const formId = facebookId("72", stamp);
    rememberLead(leadgenId);
    const clientAccountId = await client(`${stamp}m`);
    const confirmed = await confirmFacebookFormAssociation({ pageId, formId, clientAccountId });
    funnelIds.push(confirmed.item.id);
    const receivedAt = new Date("2025-11-04T16:00:00.000Z");
    const storedSubmittedAt = "2025-11-04T15:04:00.000Z";
    const rawMeta = {
      object: "page",
      entry: [{ id: pageId, changes: [{ value: { leadgen_id: leadgenId } }] }],
    };
    const raw = await db.sourceLeadEvent.create({
      data: {
        sourceProvider: "facebook",
        sourceSystem: "meta_lead_ads",
        sourceType: "lead_form",
        sourceRouteKey: "meta_leadgen",
        sourceLeadId: leadgenId,
        sourceLeadUid: buildFacebookLeadUid(leadgenId),
        status: "received",
        rawPayloadJson: rawMeta,
        receivedAt,
        webhookRequestLogId: `wh_${stamp}`,
        errorSummary: "graph_unavailable",
        enrichmentMetadataJson: {
          metaLeadgenFetch: { state: "failed", graphOutcome: "unavailable" },
          submittedAt: storedSubmittedAt,
        },
      },
    });

    const captured = await processZapierFacebookCapture({
      rawPayload: {
        leadgen_id: leadgenId,
        page_id: pageId,
        form_id: formId,
        first_name: "Sam",
        last_name: "Rivera",
        email: `sam.${stamp}@example.test`,
        submitted_at: "2026-01-01T00:00:00.000Z",
        campaign_id: facebookId("62", stamp),
      },
    });
    assert.equal(captured.replayed, false);
    assert.equal(captured.supplementedExistingEvent, true);
    assert.equal(captured.sourceEventId, raw.id);
    assert.equal(captured.submittedAt, storedSubmittedAt);
    assert.equal(captured.receivedAt, receivedAt.toISOString());
    assert.equal(captured.provenance.thisRequest, "zapier_facebook");
    assert.equal(captured.provenance.originalIntakeMethod, "meta_lead_ads");
    assert.equal(captured.association.outcome, "associated");
    assert.equal(captured.association.clientAccountId, clientAccountId);
    assert.equal(captured.delivery.thisRequestAttempted, false);
    assert.equal(captured.delivery.historicalOutcome, "not_recorded");

    const stored = await db.sourceLeadEvent.findUnique({ where: { id: raw.id } });
    assert.equal(stored?.status, "normalized");
    assert.equal(stored?.webhookRequestLogId, `wh_${stamp}`);
    assert.equal(stored?.sourceLeadUid, buildFacebookLeadUid(leadgenId));
    assert.deepEqual(stored?.rawPayloadJson, rawMeta);
    assert.equal(stored?.receivedAt.toISOString(), receivedAt.toISOString());
    const enrichment = stored?.enrichmentMetadataJson as {
      intakeMethod?: string;
      originalIntakeMethod?: string;
      supplementedByIntakeMethod?: string;
      captureSettled?: boolean;
      metaLeadgenFetch?: { state?: string };
      submittedAt?: string;
    };
    assert.equal(enrichment.intakeMethod, undefined);
    assert.equal(enrichment.originalIntakeMethod, "meta_lead_ads");
    assert.equal(enrichment.supplementedByIntakeMethod, "zapier_facebook");
    assert.equal(enrichment.captureSettled, true);
    assert.equal(enrichment.metaLeadgenFetch?.state, "failed");
    assert.equal(enrichment.submittedAt, storedSubmittedAt);
    const contact = (stored?.normalizedPayloadJson as { contact?: Record<string, string> }).contact;
    assert.equal(contact?.first_name, "Sam");
    assert.equal(contact?.email, `sam.${stamp}@example.test`);
    assert.equal(stored?.sourceCampaignId, facebookId("62", stamp));

    const replay = await processZapierFacebookCapture({
      rawPayload: {
        leadgen_id: leadgenId,
        page_id: pageId,
        form_id: formId,
        first_name: "Changed",
      },
    });
    assert.equal(replay.replayed, true);
    assert.equal(replay.supplementedExistingEvent, false);
    const afterReplay = await db.sourceLeadEvent.findUnique({ where: { id: raw.id } });
    assert.deepEqual(afterReplay?.rawPayloadJson, rawMeta);
    assert.equal(
      (afterReplay?.normalizedPayloadJson as { contact?: { first_name?: string } }).contact?.first_name,
      "Sam"
    );

    const meta = await processFacebookSourceLead({
      fields: {
        leadgenId,
        formId,
        firstName: "Graph",
        lastName: "Person",
        email: `graph.${stamp}@example.test`,
      },
      rawPayloadJson: { leadgen_id: leadgenId, replaced: true },
      masterClientAccountId: "lal_master_vet",
      routingEnabled: true,
    });
    assert.equal(meta.replayed, true);
    assert.equal(meta.sourceEventId, raw.id);
    const afterMeta = await db.sourceLeadEvent.findUnique({ where: { id: raw.id } });
    assert.deepEqual(afterMeta?.rawPayloadJson, rawMeta);
    assert.equal(afterMeta?.routingDryRunDecisionId, null);
    assert.equal(afterMeta?.deliveredAt, null);
    const rows = await db.sourceLeadEvent.count({
      where: { sourceProvider: "facebook", sourceSystem: "meta_lead_ads", sourceLeadId: leadgenId },
    });
    assert.equal(rows, 1);
  });

  it("keeps one event when Meta claim and Zapier capture arrive together", async () => {
    const stamp = uniqueStamp();
    const leadgenId = facebookId("93", stamp);
    const pageId = facebookId("83", stamp);
    const formId = facebookId("73", stamp);
    rememberLead(leadgenId);
    const [claimed, captured] = await Promise.all([
      claimSourceLeadEventByCanonicalIdentity({
        sourceProvider: "facebook",
        sourceSystem: "meta_lead_ads",
        sourceType: "lead_form",
        sourceRouteKey: "meta_leadgen",
        sourceLeadId: leadgenId,
        sourceLeadUid: buildFacebookLeadUid(leadgenId),
        status: "received",
        rawPayloadJson: { object: "page", leadgen_id: leadgenId },
        receivedAt: new Date("2025-11-04T16:00:00.000Z"),
        errorSummary: "graph_unavailable",
      }),
      processZapierFacebookCapture({
        rawPayload: {
          leadgen_id: leadgenId,
          page_id: pageId,
          form_id: formId,
          first_name: "Sam",
          email: `sam.${stamp}@example.test`,
          submitted_at: "2025-11-04T15:04:00.000Z",
        },
      }),
    ]);
    const rows = await db.sourceLeadEvent.findMany({
      where: { sourceProvider: "facebook", sourceSystem: "meta_lead_ads", sourceLeadId: leadgenId },
    });
    assert.equal(rows.length, 1);
    assert.equal(captured.sourceEventId, rows[0]?.id);
    assert.equal(claimed.event.id, rows[0]?.id);
    const contact = (rows[0]?.normalizedPayloadJson as { contact?: { first_name?: string } } | null)?.contact;
    assert.equal(contact?.first_name, "Sam");
    assert.equal(rows[0]?.deliveredAt, null);
    assert.equal(rows[0]?.routingDryRunDecisionId, null);
  });

  it("returns a finalized Meta event unchanged and reports historical delivery", async () => {
    const stamp = uniqueStamp();
    const leadgenId = facebookId("94", stamp);
    rememberLead(leadgenId);
    const receivedAt = new Date("2025-11-04T16:00:00.000Z");
    const deliveredAt = new Date("2025-11-06T00:00:00.000Z");
    const rawPayload = { object: "page", leadgen_id: leadgenId, marker: "original-meta" };
    const normalized = {
      contact: { first_name: "Original" },
      source: { submitted_at: "2025-11-04T15:04:00.000Z" },
    };
    const existing = await db.sourceLeadEvent.create({
      data: {
        sourceProvider: "facebook",
        sourceSystem: "meta_lead_ads",
        sourceType: "lead_form",
        sourceRouteKey: "meta_leadgen",
        sourceLeadId: leadgenId,
        sourceLeadUid: buildFacebookLeadUid(leadgenId),
        status: "delivered",
        rawPayloadJson: rawPayload,
        normalizedPayloadJson: normalized,
        normalizedAt: new Date("2025-11-05T00:00:00.000Z"),
        receivedAt,
        deliveredAt,
        enrichmentMetadataJson: { submittedAt: "2025-11-04T15:04:00.000Z" },
      },
    });
    const replay = await processZapierFacebookCapture({
      rawPayload: {
        leadgen_id: leadgenId,
        page_id: facebookId("84", stamp),
        form_id: facebookId("74", stamp),
        first_name: "Sam",
        submitted_at: "2026-01-01T00:00:00.000Z",
      },
    });
    assert.equal(replay.replayed, true);
    assert.equal(replay.supplementedExistingEvent, false);
    assert.equal(replay.sourceEventId, existing.id);
    assert.equal(replay.submittedAt, "2025-11-04T15:04:00.000Z");
    assert.equal(replay.delivery.thisRequestAttempted, false);
    assert.equal(replay.delivery.historicalOutcome, "delivered");
    assert.equal(replay.delivery.historicalDeliveredAt, deliveredAt.toISOString());
    assert.equal(replay.inventory.tracked, false);
    assert.equal(replay.inventory.saleEligible, false);
    assert.equal(replay.inventory.mutated, false);
    const stored = await db.sourceLeadEvent.findUnique({ where: { id: existing.id } });
    assert.equal(stored?.status, "delivered");
    assert.equal(stored?.deliveredAt?.toISOString(), deliveredAt.toISOString());
    assert.deepEqual(stored?.rawPayloadJson, rawPayload);
    assert.deepEqual(stored?.normalizedPayloadJson, normalized);
    const rows = await db.sourceLeadEvent.count({
      where: { sourceProvider: "facebook", sourceSystem: "meta_lead_ads", sourceLeadId: leadgenId },
    });
    assert.equal(rows, 1);
  });

  it("reports an existing inventory item as not evaluated on replay", async () => {
    const stamp = uniqueStamp();
    const leadgenId = facebookId("95", stamp);
    rememberLead(leadgenId);
    const captured = await processZapierFacebookCapture({
      rawPayload: {
        leadgen_id: leadgenId,
        page_id: facebookId("85", stamp),
        form_id: facebookId("75", stamp),
        first_name: "Sam",
      },
    });
    const lot = await db.inventoryLot.create({
      data: {
        lotKey: `fb-cap-replay-${stamp}`,
        displayName: "Synthetic replay lot",
        sourceProvider: "facebook",
        sourceLane: "zapier_facebook_test",
        nicheKey: "health",
        inventoryClass: "aged",
      },
    });
    lotIds.push(lot.id);
    const item = await db.leadInventoryItem.create({
      data: {
        inventoryLotId: lot.id,
        sourceLeadEventId: captured.sourceEventId,
        generatedAt: new Date("2025-11-04T15:04:00.000Z"),
        normalizedState: "TX",
        nicheKey: "health",
        sourceProvider: "facebook",
        sourceLane: "zapier_facebook_test",
        inventoryClass: "aged",
      },
    });
    const before = await db.sourceLeadEvent.findUnique({ where: { id: captured.sourceEventId } });
    const replay = await processZapierFacebookCapture({
      rawPayload: { leadgen_id: leadgenId, first_name: "Changed" },
    });
    assert.equal(replay.replayed, true);
    assert.equal(replay.inventory.tracked, true);
    assert.equal(replay.inventory.mutated, false);
    assert.equal(replay.inventory.saleEligible, "not_evaluated");
    assert.equal(replay.inventory.reason, "existing_inventory_item_not_modified");
    assert.equal(replay.delivery.thisRequestAttempted, false);
    assert.equal(replay.delivery.historicalOutcome, "not_recorded");
    const after = await db.sourceLeadEvent.findUnique({
      where: { id: captured.sourceEventId },
      include: { leadInventoryItem: true },
    });
    assert.equal(after?.leadInventoryItem?.id, item.id);
    assert.deepEqual(after?.rawPayloadJson, before?.rawPayloadJson);
    assert.deepEqual(after?.normalizedPayloadJson, before?.normalizedPayloadJson);
  });

  it("leaves unsupported Meta and LeadConduit events unchanged during reevaluation", async () => {
    const stamp = uniqueStamp();
    const rawId = facebookId("96", stamp);
    const routedId = facebookId("97", stamp);
    const legacyId = facebookId("98", stamp);
    rememberLead(rawId);
    rememberLead(routedId);
    rememberLead(legacyId);
    const raw = await db.sourceLeadEvent.create({
      data: {
        sourceProvider: "facebook",
        sourceSystem: "meta_lead_ads",
        sourceType: "lead_form",
        sourceLeadId: rawId,
        sourceLeadUid: buildFacebookLeadUid(rawId),
        status: "received",
        rawPayloadJson: { object: "page", marker: "raw-meta" },
        errorSummary: "graph_unavailable",
        receivedAt: new Date("2025-11-04T16:00:00.000Z"),
      },
    });
    const routed = await db.sourceLeadEvent.create({
      data: {
        sourceProvider: "facebook",
        sourceSystem: "meta_lead_ads",
        sourceType: "lead_form",
        sourceLeadId: routedId,
        sourceLeadUid: buildFacebookLeadUid(routedId),
        status: "routing_matched",
        rawPayloadJson: { object: "page", marker: "routed-meta" },
        normalizedAt: new Date("2025-11-05T00:00:00.000Z"),
        receivedAt: new Date("2025-11-04T16:00:00.000Z"),
      },
    });
    const legacy = await db.sourceLeadEvent.create({
      data: {
        sourceProvider: "facebook",
        sourceSystem: "external_vendor",
        sourceType: "webhook",
        sourceLeadId: legacyId,
        sourceLeadUid: `external-${legacyId}`,
        status: "routing_unmatched",
        rawPayloadJson: { leadgen_id: legacyId, first_name: "Legacy" },
        receivedAt: new Date("2025-11-04T16:00:00.000Z"),
      },
    });
    for (const event of [raw, routed, legacy]) {
      await assert.rejects(
        () => reevaluateFacebookCaptureAssociation({ sourceEventId: event.id }),
        (error: unknown) =>
          error instanceof FacebookCaptureReevaluationError && error.code === "unsupported_capture_record"
      );
    }
    const rawAfter = await db.sourceLeadEvent.findUnique({ where: { id: raw.id } });
    const routedAfter = await db.sourceLeadEvent.findUnique({ where: { id: routed.id } });
    const legacyAfter = await db.sourceLeadEvent.findUnique({ where: { id: legacy.id } });
    assert.equal(rawAfter?.status, "received");
    assert.equal(rawAfter?.errorSummary, "graph_unavailable");
    assert.deepEqual(rawAfter?.rawPayloadJson, raw.rawPayloadJson);
    assert.equal(routedAfter?.status, "routing_matched");
    assert.deepEqual(routedAfter?.rawPayloadJson, routed.rawPayloadJson);
    assert.equal(legacyAfter?.status, "routing_unmatched");
    assert.deepEqual(legacyAfter?.rawPayloadJson, legacy.rawPayloadJson);
  });

  it("keeps association history when reevaluation appends past fifty entries", async () => {
    const stamp = uniqueStamp();
    const leadgenId = facebookId("99", stamp);
    const pageId = facebookId("89", stamp);
    const formId = facebookId("79", stamp);
    rememberLead(leadgenId);
    const clientAccountId = await client(`${stamp}h`);
    const captured = await processZapierFacebookCapture({
      rawPayload: { leadgen_id: leadgenId, page_id: pageId, form_id: formId, first_name: "Sam" },
    });
    const seeded = Array.from({ length: 50 }, (_, index) => ({
      at: "2025-01-01T00:00:00.000Z",
      action: "seed",
      n: index,
    }));
    const current = await db.sourceLeadEvent.findUnique({ where: { id: captured.sourceEventId } });
    const enrichment = current?.enrichmentMetadataJson as Record<string, unknown>;
    await db.sourceLeadEvent.update({
      where: { id: captured.sourceEventId },
      data: {
        enrichmentMetadataJson: { ...enrichment, associationAudit: seeded },
      },
    });
    const confirmed = await confirmFacebookFormAssociation({ pageId, formId, clientAccountId });
    funnelIds.push(confirmed.item.id);
    const [first, second] = await Promise.all([
      reevaluateFacebookCaptureAssociation({
        sourceEventId: captured.sourceEventId,
        actor: "admin_coc_admin",
        requestId: "req_parallel",
      }),
      reevaluateFacebookCaptureAssociation({
        sourceEventId: captured.sourceEventId,
        actor: "admin_coc_admin",
        requestId: "req_parallel_2",
      }),
    ]);
    assert.equal([first.unchanged, second.unchanged].filter((value) => value === false).length, 1);
    const stored = await db.sourceLeadEvent.findUnique({ where: { id: captured.sourceEventId } });
    const audit = (stored?.enrichmentMetadataJson as { associationAudit?: Array<{ n?: number; action?: string }> })
      .associationAudit;
    assert.equal(audit?.length, 51);
    assert.equal(audit?.[0]?.n, 0);
    assert.equal(audit?.[50]?.action, "reevaluate_association");
    assert.equal(stored?.clientAccountIdResolved, clientAccountId);
  });

  it("creates no rows when capture writes are disabled", async () => {
    const stamp = uniqueStamp();
    const leadgenId = facebookId("90", stamp);
    rememberLead(leadgenId);
    const previous = process.env.SA360_FACEBOOK_CAPTURE_INTAKE_ENABLED;
    delete process.env.SA360_FACEBOOK_CAPTURE_INTAKE_ENABLED;
    try {
      await assert.rejects(
        () => processZapierFacebookCapture({ rawPayload: { leadgen_id: leadgenId, first_name: "Sam" } }),
        (error: unknown) => error instanceof FacebookCaptureIntakeDisabledError
      );
      await assert.rejects(
        () =>
          confirmFacebookFormAssociation({
            pageId: facebookId("80", stamp),
            formId: facebookId("70", stamp),
            clientAccountId: `missing_${stamp}`,
          }),
        (error: unknown) => error instanceof FacebookCaptureIntakeDisabledError
      );
    } finally {
      process.env.SA360_FACEBOOK_CAPTURE_INTAKE_ENABLED = previous ?? "true";
    }
    const rows = await db.sourceLeadEvent.count({ where: { sourceLeadId: leadgenId } });
    assert.equal(rows, 0);
  });

  it("Meta graph failure persist keeps a Zapier settlement that landed after the unsettled read", async () => {
    const stamp = uniqueStamp();
    const leadgenId = facebookId("64", stamp);
    const pageId = facebookId("54", stamp);
    const formId = facebookId("44", stamp);
    rememberLead(leadgenId);
    const clientAccountId = await client(`${stamp}r`);
    const confirmed = await confirmFacebookFormAssociation({ pageId, formId, clientAccountId });
    funnelIds.push(confirmed.item.id);
    const receivedAt = new Date("2025-11-04T16:00:00.000Z");
    const submittedAt = "2025-11-04T15:04:00.000Z";
    const rawMeta = {
      object: "page",
      entry: [{ id: pageId, changes: [{ value: { leadgen_id: leadgenId, form_id: formId } }] }],
    };
    const created = await db.sourceLeadEvent.create({
      data: {
        sourceProvider: "facebook",
        sourceSystem: "meta_lead_ads",
        sourceType: "lead_form",
        sourceRouteKey: "meta_leadgen",
        sourceLeadId: leadgenId,
        sourceLeadUid: buildFacebookLeadUid(leadgenId),
        status: "received",
        rawPayloadJson: rawMeta,
        receivedAt,
        webhookRequestLogId: `wh_${stamp}`,
        errorSummary: "graph_unavailable",
        enrichmentMetadataJson: { submittedAt },
      },
    });
    let staleRead: Awaited<ReturnType<typeof db.sourceLeadEvent.findUnique>> = null;
    let staleWrites = 0;
    const result = await processMetaLeadgenFetch(
      { leadgenId, sourceLeadEventId: created.id, jobId: `job_${stamp}`, attemptNumber: 2 },
      {
        getMetaWebhookConfigImpl: () => ({
          verifyToken: "vt",
          appSecret: "s",
          accessToken: "tok",
          accessTokenPageId: null,
          graphApiVersion: "v22.0",
          masterClientAccountId: "lal_master_vet",
          directIntakeEnabled: false,
          intakeEnabled: true,
          graphFetchEnabled: true,
          routingEnabled: true,
          fixtureEnabled: false,
        }),
        fetchMetaLeadDetailsImpl: async () => {
          const prepared = await db.sourceLeadEvent.findUnique({ where: { id: created.id } });
          assert.equal(prepared?.status, "received");
          assert.equal(isSettledCaptureOnlyFacebookEvent(prepared), false);
          assert.deepEqual(prepared?.rawPayloadJson, rawMeta);
          staleRead = prepared;
          return { ok: false, status: 503, body: { error: "unavailable" } };
        },
        beforeGraphFailurePersistImpl: async () => {
          assert.ok(staleRead);
          assert.equal(isSettledCaptureOnlyFacebookEvent(staleRead), false);
          const captured = await processZapierFacebookCapture({
            rawPayload: {
              leadgen_id: leadgenId,
              page_id: pageId,
              form_id: formId,
              first_name: "Sam",
              last_name: "Rivera",
              email: `sam.${stamp}@example.test`,
              submitted_at: submittedAt,
            },
          });
          assert.equal(captured.supplementedExistingEvent, true);
          assert.equal(captured.sourceEventId, created.id);
          assert.equal(captured.delivery.thisRequestAttempted, false);
        },
        findByIdImpl: async () => {
          if (!staleRead) throw new Error("failure persist read ran before the unsettled snapshot");
          return staleRead;
        },
        updateEventImpl: async (id, data) => {
          staleWrites += 1;
          return db.sourceLeadEvent.update({ where: { id }, data });
        },
      }
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.graphFetched, true);
      assert.equal(result.graphOutcome, "retryable_failure");
    }
    assert.equal(staleWrites, 0);
    const stored = await db.sourceLeadEvent.findUnique({
      where: { id: created.id },
      include: { leadInventoryItem: true, fulfillmentOutboxItems: true },
    });
    assert.ok(stored);
    assert.equal(stored?.status, "normalized");
    assert.equal(stored?.deliveredAt, null);
    assert.equal(stored?.approvedAt, null);
    assert.equal(stored?.routingDryRunDecisionId, null);
    assert.equal(stored?.leadInventoryItem, null);
    assert.equal(stored?.fulfillmentOutboxItems.length, 0);
    assert.equal(stored?.webhookRequestLogId, `wh_${stamp}`);
    assert.equal(stored?.sourceLeadUid, buildFacebookLeadUid(leadgenId));
    assert.equal(stored?.receivedAt.toISOString(), receivedAt.toISOString());
    assert.deepEqual(stored?.rawPayloadJson, rawMeta);
    assert.equal(stored?.clientAccountIdResolved, clientAccountId);
    const enrichment = stored?.enrichmentMetadataJson as {
      captureOnly?: boolean;
      captureSettled?: boolean;
      intakeMethod?: string;
      originalIntakeMethod?: string;
      supplementedByIntakeMethod?: string;
      submittedAt?: string;
      association?: { outcome?: string; clientAccountId?: string };
    };
    assert.equal(enrichment.captureOnly, true);
    assert.equal(enrichment.captureSettled, true);
    assert.equal(enrichment.intakeMethod, undefined);
    assert.equal(enrichment.originalIntakeMethod, "meta_lead_ads");
    assert.equal(enrichment.supplementedByIntakeMethod, "zapier_facebook");
    assert.equal(enrichment.submittedAt, submittedAt);
    assert.equal(enrichment.association?.outcome, "associated");
    assert.equal(enrichment.association?.clientAccountId, clientAccountId);
    const normalized = stored?.normalizedPayloadJson as {
      contact?: { first_name?: string; email?: string };
      source?: { submitted_at?: string };
    };
    assert.equal(normalized.contact?.first_name, "Sam");
    assert.equal(normalized.contact?.email, `sam.${stamp}@example.test`);
    assert.equal(normalized.source?.submitted_at, submittedAt);
    const rows = await db.sourceLeadEvent.count({
      where: { sourceProvider: "facebook", sourceSystem: "meta_lead_ads", sourceLeadId: leadgenId },
    });
    assert.equal(rows, 1);
  });
});
