import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import type { PrismaClient } from "@prisma/client";

import { assertSafeTestDatabaseUrl } from "../../lib/safe-test-database-url.js";
import { prisma } from "../../lib/db.js";
import type { MetaWebhookConfig } from "../../lib/meta-webhook.js";
import { claimSourceLeadEventByCanonicalIdentity } from "../../repositories/source-lead-event.repository.js";
import { isSettledCaptureOnlyFacebookEvent } from "./facebook-capture-provenance.js";
import { confirmFacebookFormAssociation } from "./facebook-form-association.service.js";
import { buildFacebookLeadUid } from "./facebook-lead-normalizer.js";
import {
  processMetaLeadgenFetch,
  recordMetaNotificationRedelivery,
} from "./meta-leadgen-fetch.service.js";
import { processZapierFacebookCapture } from "./zapier-facebook-capture.service.js";

const integrationUrlRaw = process.env.SA360_TEST_DATABASE_URL?.trim() || "";
const runIntegration = Boolean(integrationUrlRaw);

function uniqueStamp(): string {
  return `${Date.now()}${Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, "0")}`;
}

/** Numeric Facebook id. Marker in the first two digits so the stamp cannot erase it. */
function facebookId(marker: string, stamp: string): string {
  return `${marker}${stamp}`.slice(0, 16);
}

/** Pilot posture: intake + Graph on, routing OFF, no master client. */
function pilotConfig(overrides: Partial<MetaWebhookConfig> = {}): MetaWebhookConfig {
  return {
    verifyToken: "vt",
    appSecret: "s",
    accessToken: "tok",
    accessTokenPageId: null,
    graphApiVersion: "v25.0",
    masterClientAccountId: null,
    directIntakeEnabled: false,
    intakeEnabled: true,
    graphFetchEnabled: true,
    routingEnabled: false,
    fixtureEnabled: false,
    ...overrides,
  };
}

function graphLead(input: {
  leadgenId: string;
  formId: string;
  email: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
  createdTime?: string;
  custom?: Record<string, string>;
}) {
  const fieldData: Array<{ name: string; values: string[] }> = [
    { name: "first_name", values: [input.firstName ?? "Pilot"] },
    { name: "last_name", values: [input.lastName ?? "Lead"] },
    { name: "email", values: [input.email] },
    { name: "phone_number", values: [input.phone ?? "+14155550100"] },
  ];
  for (const [name, value] of Object.entries(input.custom ?? {})) {
    fieldData.push({ name, values: [value] });
  }
  return {
    id: input.leadgenId,
    created_time: input.createdTime ?? "2026-10-01T15:04:00+0000",
    form_id: input.formId,
    ad_id: "120200000000000001",
    ad_name: "Pilot ad",
    adset_id: "120200000000000002",
    campaign_id: "120200000000000003",
    campaign_name: "Pilot campaign",
    platform: "fb",
    field_data: fieldData,
  };
}

describe("Meta-first Lead Ads capture (no master client, Page+Form association)", { skip: !runIntegration }, () => {
  let db: PrismaClient;
  const leadgenIds: string[] = [];
  const clientIds: string[] = [];
  const funnelIds: string[] = [];
  const saved = {
    master: process.env.SA360_FACEBOOK_MASTER_CLIENT_ACCOUNT_ID,
    capture: process.env.SA360_FACEBOOK_CAPTURE_INTAKE_ENABLED,
  };

  before(async () => {
    const url = assertSafeTestDatabaseUrl(integrationUrlRaw);
    process.env.DATABASE_URL = url;
    delete process.env.SA360_FACEBOOK_MASTER_CLIENT_ACCOUNT_ID;
    process.env.SA360_FACEBOOK_CAPTURE_INTAKE_ENABLED = "true";
    db = prisma;
    await db.$queryRaw`SELECT 1`;
  });

  after(async () => {
    if (saved.master === undefined) delete process.env.SA360_FACEBOOK_MASTER_CLIENT_ACCOUNT_ID;
    else process.env.SA360_FACEBOOK_MASTER_CLIENT_ACCOUNT_ID = saved.master;
    if (saved.capture === undefined) delete process.env.SA360_FACEBOOK_CAPTURE_INTAKE_ENABLED;
    else process.env.SA360_FACEBOOK_CAPTURE_INTAKE_ENABLED = saved.capture;
    if (leadgenIds.length > 0) {
      const events = await db.sourceLeadEvent.findMany({
        where: { sourceLeadId: { in: leadgenIds } },
        select: { id: true },
      });
      const ids = events.map((e) => e.id);
      if (ids.length > 0) {
        await db.leadInventoryItem.deleteMany({ where: { sourceLeadEventId: { in: ids } } });
        await db.fulfillmentOutbox.deleteMany({ where: { sourceLeadEventId: { in: ids } } });
        await db.sourceLeadEvent.deleteMany({ where: { id: { in: ids } } });
      }
    }
    if (funnelIds.length > 0) await db.sourceFunnel.deleteMany({ where: { id: { in: funnelIds } } });
    if (clientIds.length > 0) {
      await db.clientAccount.deleteMany({ where: { clientAccountId: { in: clientIds } } });
    }
  });

  async function client(suffix: string): Promise<string> {
    const clientAccountId = `meta_pilot_${suffix}`;
    clientIds.push(clientAccountId);
    await db.clientAccount.create({
      data: { clientAccountId, clientDisplayName: `Synthetic ${suffix}`, status: "active" },
    });
    return clientAccountId;
  }

  async function associate(pageId: string, formId: string, clientAccountId: string) {
    const confirmed = await confirmFacebookFormAssociation({ pageId, formId, clientAccountId });
    funnelIds.push(confirmed.item.id);
    return confirmed.item.id;
  }

  async function claimRaw(leadgenId: string, pageId: string, formId: string) {
    leadgenIds.push(leadgenId);
    const claimed = await claimSourceLeadEventByCanonicalIdentity({
      sourceProvider: "facebook",
      sourceSystem: "meta_lead_ads",
      sourceType: "lead_form",
      sourceRouteKey: formId,
      sourceLeadId: leadgenId,
      sourceLeadUid: buildFacebookLeadUid(leadgenId),
      status: "received",
      rawPayloadJson: { envelope: { leadgenId, pageId, formId, createdTime: "2026-10-01T15:04:00.000Z" } },
      errorSummary: "Queued for Meta Graph fetch.",
      receivedAt: new Date("2026-10-01T15:04:05.000Z"),
    });
    assert.equal(claimed.created, true);
    return claimed.event;
  }

  async function assertNoSideEffects(eventId: string) {
    const stored = await db.sourceLeadEvent.findUnique({
      where: { id: eventId },
      include: { leadInventoryItem: true, fulfillmentOutboxItems: true },
    });
    assert.ok(stored);
    assert.equal(stored.leadInventoryItem, null);
    assert.equal(stored.fulfillmentOutboxItems.length, 0);
    assert.equal(stored.routingDryRunDecisionId, null);
    assert.equal(stored.routingRuleIdResolved, null);
    assert.equal(stored.destinationLocationIdResolved, null);
    assert.equal(stored.approvedAt, null);
    assert.equal(stored.deliveredAt, null);
    const allocations = await db.leadAllocation.count({ where: { sourceLeadEventId: eventId } });
    assert.equal(allocations, 0);
    const dispatch = await db.metaDispatchAttempt.count({ where: { eventUuid: stored.sourceLeadUid ?? "" } });
    assert.equal(dispatch, 0);
    return stored;
  }

  it("Meta-first lead reaches the same capture + association outcome as a Zapier-first lead", async () => {
    const stamp = uniqueStamp();
    const leadgenId = facebookId("31", stamp);
    const pageId = facebookId("21", stamp);
    const formId = facebookId("11", stamp);
    const clientAccountId = await client(stamp);
    const funnelId = await associate(pageId, formId, clientAccountId);
    const event = await claimRaw(leadgenId, pageId, formId);

    let graphCalls = 0;
    const result = await processMetaLeadgenFetch(
      { leadgenId, sourceLeadEventId: event.id, jobId: `job_${stamp}` },
      {
        getMetaWebhookConfigImpl: () => pilotConfig(),
        fetchMetaLeadDetailsImpl: async () => {
          graphCalls += 1;
          return {
            ok: true,
            status: 200,
            body: graphLead({
              leadgenId,
              formId,
              email: `meta.first.${stamp}@example.test`,
              custom: { which_branch_did_you_serve_in: "Army", are_you_a_veteran: "Yes" },
            }),
          };
        },
        processFacebookSourceLeadImpl: async () => {
          throw new Error("lifecycle normalize (master client) must not run on the pilot capture path");
        },
      }
    );
    assert.equal(graphCalls, 1);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.graphFetched, true);
    assert.equal(result.intake, undefined);
    assert.ok(result.capture);
    assert.equal(result.capture.captureOutcome, "captured");
    assert.equal(result.capture.association.outcome, "associated");
    assert.equal(result.capture.association.clientAccountId, clientAccountId);
    assert.equal(result.capture.association.sourceFunnelId, funnelId);
    assert.equal(result.capture.sourceClientAccountId, clientAccountId);

    const stored = await assertNoSideEffects(event.id);
    assert.equal(stored.status, "normalized");
    assert.equal(stored.clientAccountIdResolved, clientAccountId);
    assert.equal(stored.errorSummary, null);
    assert.equal(stored.sourceCampaignId, "120200000000000003");
    assert.equal(stored.sourceCampaignName, "Pilot campaign");
    assert.equal(isSettledCaptureOnlyFacebookEvent(stored), true);

    // Raw notification envelope + token-free Graph body are both retained.
    const raw = stored.rawPayloadJson as { envelope?: { pageId?: string }; lead?: { id?: string } };
    assert.equal(raw.envelope?.pageId, pageId);
    assert.equal(raw.lead?.id, leadgenId);
    assert.doesNotMatch(JSON.stringify(stored.rawPayloadJson), /\btok\b|access_token/);

    const normalized = stored.normalizedPayloadJson as {
      schema_version?: string;
      contact?: Record<string, string>;
      source?: Record<string, string>;
      custom_fields?: Record<string, string>;
      association?: { outcome?: string; client_account_id?: string | null };
    };
    assert.equal(normalized.schema_version, "sa360.facebook_capture.v1");
    assert.equal(normalized.contact?.lead_uid, buildFacebookLeadUid(leadgenId));
    assert.equal(normalized.contact?.email, `meta.first.${stamp}@example.test`);
    assert.equal(normalized.contact?.phone_e164, "+14155550100");
    assert.equal(normalized.source?.provider, "facebook");
    assert.equal(normalized.source?.source_system, "meta_lead_ads");
    assert.equal(normalized.source?.intake_method, "meta_lead_ads");
    assert.equal(normalized.source?.leadgen_id, leadgenId);
    assert.equal(normalized.source?.page_id, pageId);
    assert.equal(normalized.source?.form_id, formId);
    assert.equal(normalized.source?.platform, "fb");
    // Original Meta timestamp preserved (not the SA360 receive time).
    assert.equal(normalized.source?.submitted_at, "2026-10-01T15:04:00.000Z");
    assert.equal(normalized.source?.received_at, "2026-10-01T15:04:05.000Z");
    assert.deepEqual(normalized.custom_fields, {
      which_branch_did_you_serve_in: "Army",
      are_you_a_veteran: "Yes",
    });
    assert.equal(normalized.association?.outcome, "associated");
    assert.equal(normalized.association?.client_account_id, clientAccountId);

    const enrichment = stored.enrichmentMetadataJson as Record<string, unknown> & {
      association?: { outcome?: string; clientAccountId?: string };
      metaLeadgenFetch?: { state?: string; graphOutcome?: string; graphStatus?: number; tokenScope?: string };
      inventory?: { thisRequestTracked?: boolean; saleEligible?: boolean };
      delivery?: { thisRequestAttempted?: boolean };
    };
    assert.equal(enrichment.captureOnly, true);
    assert.equal(enrichment.captureSettled, true);
    // Provenance is Meta; Zapier is never fabricated.
    assert.equal(enrichment.intakeMethod, "meta_lead_ads");
    assert.equal(enrichment.intakeProvenance, "meta");
    assert.equal(enrichment.supplementedByIntakeMethod, undefined);
    assert.equal(enrichment.association?.outcome, "associated");
    assert.equal(enrichment.metaLeadgenFetch?.state, "captured");
    assert.equal(enrichment.metaLeadgenFetch?.graphOutcome, "success");
    assert.equal(enrichment.metaLeadgenFetch?.graphStatus, 200);
    assert.equal(enrichment.metaLeadgenFetch?.tokenScope, "unbound");
    assert.equal(enrichment.inventory?.thisRequestTracked, false);
    assert.equal(enrichment.inventory?.saleEligible, false);
    assert.equal(enrichment.delivery?.thisRequestAttempted, false);

    // Same leadgen_id again (Meta redelivery → worker job): idempotent, no second Graph call.
    const replay = await processMetaLeadgenFetch(
      { leadgenId, sourceLeadEventId: event.id, jobId: `job_${stamp}_replay` },
      {
        getMetaWebhookConfigImpl: () => pilotConfig(),
        fetchMetaLeadDetailsImpl: async () => {
          throw new Error("Graph must not be called for a settled lead");
        },
      }
    );
    assert.equal(replay.ok, true);
    if (replay.ok) assert.equal(replay.skipped, "already_processed");
    assert.equal(graphCalls, 1);

    // A Zapier-first arrival for the same lead after Meta settled it is a pure replay.
    const zapier = await processZapierFacebookCapture({
      rawPayload: { leadgen_id: leadgenId, page_id: pageId, form_id: formId, email: "other@example.test" },
    });
    assert.equal(zapier.replayed, true);
    assert.equal(zapier.supplementedExistingEvent, false);
    assert.equal(zapier.sourceEventId, event.id);
    assert.equal(zapier.provenance.originalIntakeMethod, "meta_lead_ads");
    const after = await db.sourceLeadEvent.findUnique({ where: { id: event.id } });
    assert.equal((after?.normalizedPayloadJson as { contact?: { email?: string } }).contact?.email, `meta.first.${stamp}@example.test`);
    const rows = await db.sourceLeadEvent.count({ where: { sourceLeadId: leadgenId } });
    assert.equal(rows, 1);
  });

  it("missing association retains the submission with an actionable diagnostic and no master fallback", async () => {
    const stamp = uniqueStamp();
    const leadgenId = facebookId("32", stamp);
    const pageId = facebookId("22", stamp);
    const formId = facebookId("12", stamp);
    const event = await claimRaw(leadgenId, pageId, formId);

    const result = await processMetaLeadgenFetch(
      { leadgenId, sourceLeadEventId: event.id, jobId: `job_${stamp}` },
      {
        // A configured master must still not be used for association.
        getMetaWebhookConfigImpl: () => pilotConfig({ masterClientAccountId: "lal_master_vet" }),
        fetchMetaLeadDetailsImpl: async () => ({
          ok: true,
          status: 200,
          body: graphLead({ leadgenId, formId, email: `meta.unassoc.${stamp}@example.test` }),
        }),
      }
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.capture?.association.outcome, "unassociated");
    assert.equal(result.capture?.sourceClientAccountId, null);
    assert.match(result.capture?.nextAction ?? "", /Facebook Intake|associat/i);

    const stored = await assertNoSideEffects(event.id);
    assert.equal(stored.status, "normalized");
    assert.notEqual(stored.status, "needs_review");
    assert.equal(stored.clientAccountIdResolved, null);
    const enrichment = stored.enrichmentMetadataJson as {
      association?: { outcome?: string; pageId?: string; formId?: string; explanation?: string };
    };
    assert.equal(enrichment.association?.outcome, "unassociated");
    assert.equal(enrichment.association?.pageId, pageId);
    assert.equal(enrichment.association?.formId, formId);
    assert.ok((enrichment.association?.explanation ?? "").length > 20);
    const normalized = stored.normalizedPayloadJson as { contact?: { email?: string } };
    assert.equal(normalized.contact?.email, `meta.unassoc.${stamp}@example.test`);
  });

  it("association flag off still captures and marks association_disabled", async () => {
    const stamp = uniqueStamp();
    const leadgenId = facebookId("33", stamp);
    const pageId = facebookId("23", stamp);
    const formId = facebookId("13", stamp);
    const clientAccountId = await client(`${stamp}d`);
    await associate(pageId, formId, clientAccountId);
    const event = await claimRaw(leadgenId, pageId, formId);

    process.env.SA360_FACEBOOK_CAPTURE_INTAKE_ENABLED = "false";
    try {
      const result = await processMetaLeadgenFetch(
        { leadgenId, sourceLeadEventId: event.id, jobId: `job_${stamp}` },
        {
          getMetaWebhookConfigImpl: () => pilotConfig(),
          fetchMetaLeadDetailsImpl: async () => ({
            ok: true,
            status: 200,
            body: graphLead({ leadgenId, formId, email: `meta.disabled.${stamp}@example.test` }),
          }),
        }
      );
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.capture?.captureOutcome, "captured");
      assert.equal(result.capture?.association.outcome, "association_disabled");
      assert.equal(result.capture?.sourceClientAccountId, null);
    } finally {
      process.env.SA360_FACEBOOK_CAPTURE_INTAKE_ENABLED = "true";
    }
    const stored = await assertNoSideEffects(event.id);
    assert.equal(stored.status, "normalized");
    assert.equal(stored.clientAccountIdResolved, null);
    assert.equal(isSettledCaptureOnlyFacebookEvent(stored), true);
    const enrichment = stored.enrichmentMetadataJson as { association?: { explanation?: string } };
    assert.match(enrichment.association?.explanation ?? "", /SA360_FACEBOOK_CAPTURE_INTAKE_ENABLED/);
  });

  it("two different leadgen_ids with identical contact data for different client forms stay distinct", async () => {
    const stamp = uniqueStamp();
    const leadA = facebookId("34", stamp);
    const leadB = facebookId("35", stamp);
    const pageId = facebookId("24", stamp);
    const formA = facebookId("14", stamp);
    const formB = facebookId("15", stamp);
    const clientA = await client(`${stamp}a`);
    const clientB = await client(`${stamp}b`);
    await associate(pageId, formA, clientA);
    await associate(pageId, formB, clientB);
    const eventA = await claimRaw(leadA, pageId, formA);
    const eventB = await claimRaw(leadB, pageId, formB);

    const sharedContact = {
      email: `same.person.${stamp}@example.test`,
      phone: "+14155550199",
      firstName: "Same",
      lastName: "Person",
    };
    const a = await processMetaLeadgenFetch(
      { leadgenId: leadA, sourceLeadEventId: eventA.id, jobId: `job_${stamp}_a` },
      {
        getMetaWebhookConfigImpl: () => pilotConfig(),
        fetchMetaLeadDetailsImpl: async () => ({
          ok: true,
          status: 200,
          body: graphLead({ leadgenId: leadA, formId: formA, ...sharedContact }),
        }),
      }
    );
    const b = await processMetaLeadgenFetch(
      { leadgenId: leadB, sourceLeadEventId: eventB.id, jobId: `job_${stamp}_b` },
      {
        getMetaWebhookConfigImpl: () => pilotConfig(),
        fetchMetaLeadDetailsImpl: async () => ({
          ok: true,
          status: 200,
          body: graphLead({ leadgenId: leadB, formId: formB, ...sharedContact }),
        }),
      }
    );
    assert.equal(a.ok, true);
    assert.equal(b.ok, true);
    if (!a.ok || !b.ok) return;
    assert.equal(a.capture?.sourceClientAccountId, clientA);
    assert.equal(b.capture?.sourceClientAccountId, clientB);
    assert.notEqual(a.capture?.sourceEventId, b.capture?.sourceEventId);

    const storedA = await assertNoSideEffects(eventA.id);
    const storedB = await assertNoSideEffects(eventB.id);
    assert.equal(storedA.status, "normalized");
    assert.equal(storedB.status, "normalized");
    assert.notEqual(storedA.status, "duplicate_blocked");
    assert.notEqual(storedB.status, "duplicate_blocked");
    assert.equal(storedA.clientAccountIdResolved, clientA);
    assert.equal(storedB.clientAccountIdResolved, clientB);
    assert.notEqual(storedA.sourceLeadUid, storedB.sourceLeadUid);
    const rows = await db.sourceLeadEvent.count({
      where: { sourceLeadId: { in: [leadA, leadB] }, sourceSystem: "meta_lead_ads" },
    });
    assert.equal(rows, 2);
  });

  it("concurrent Meta Graph settle and Zapier capture for one leadgen_id produce exactly one settled row", async () => {
    const stamp = uniqueStamp();
    const leadgenId = facebookId("36", stamp);
    const pageId = facebookId("26", stamp);
    const formId = facebookId("16", stamp);
    const clientAccountId = await client(`${stamp}c`);
    await associate(pageId, formId, clientAccountId);
    const event = await claimRaw(leadgenId, pageId, formId);

    let releaseGraph!: () => void;
    const graphGate = new Promise<void>((resolve) => {
      releaseGraph = resolve;
    });
    let markGraphStarted!: () => void;
    const graphStarted = new Promise<void>((resolve) => {
      markGraphStarted = resolve;
    });
    const metaRun = processMetaLeadgenFetch(
      { leadgenId, sourceLeadEventId: event.id, jobId: `job_${stamp}` },
      {
        getMetaWebhookConfigImpl: () => pilotConfig(),
        fetchMetaLeadDetailsImpl: async () => {
          // The worker has taken the fetching lease and released the lock.
          // Graph is slow; Zapier lands while the Meta worker holds no lock.
          markGraphStarted();
          await graphGate;
          return {
            ok: true,
            status: 200,
            body: graphLead({ leadgenId, formId, email: `meta.conc.${stamp}@example.test` }),
          };
        },
      }
    );
    await graphStarted;
    const zapier = await processZapierFacebookCapture({
      rawPayload: {
        leadgen_id: leadgenId,
        page_id: pageId,
        form_id: formId,
        first_name: "Zap",
        last_name: "First",
        email: `zapier.conc.${stamp}@example.test`,
        submitted_at: "2026-10-01T15:04:00.000Z",
      },
    });
    assert.equal(zapier.supplementedExistingEvent, true);
    assert.equal(zapier.sourceEventId, event.id);
    releaseGraph();
    const meta = await metaRun;
    assert.equal(meta.ok, true);
    if (meta.ok) {
      // Meta sees the Zapier-settled row under the lock and does not overwrite it.
      assert.equal(meta.skipped, "already_processed");
      assert.equal(meta.graphFetched, true);
    }
    const stored = await assertNoSideEffects(event.id);
    assert.equal(isSettledCaptureOnlyFacebookEvent(stored), true);
    assert.equal(stored.clientAccountIdResolved, clientAccountId);
    const normalized = stored.normalizedPayloadJson as { contact?: { email?: string; first_name?: string } };
    assert.equal(normalized.contact?.email, `zapier.conc.${stamp}@example.test`);
    assert.equal(normalized.contact?.first_name, "Zap");
    const enrichment = stored.enrichmentMetadataJson as { originalIntakeMethod?: string; supplementedByIntakeMethod?: string };
    assert.equal(enrichment.originalIntakeMethod, "meta_lead_ads");
    assert.equal(enrichment.supplementedByIntakeMethod, "zapier_facebook");
    const rows = await db.sourceLeadEvent.count({ where: { sourceLeadId: leadgenId } });
    assert.equal(rows, 1);
  });

  it("Meta redelivery of an unprocessed lead is bookkept without clobbering raw or diagnostics", async () => {
    const stamp = uniqueStamp();
    const leadgenId = facebookId("37", stamp);
    const pageId = facebookId("27", stamp);
    const formId = facebookId("17", stamp);
    const event = await claimRaw(leadgenId, pageId, formId);
    await db.sourceLeadEvent.update({
      where: { id: event.id },
      data: {
        errorSummary: "Meta Graph rejected the Page access token (status 400). Graph error 190.",
        enrichmentMetadataJson: {
          metaLeadgenFetch: { ownerId: "job_x", state: "failed", graphOutcome: "auth_failure", liveDelivery: false, capiDispatched: false },
        },
      },
    });

    await recordMetaNotificationRedelivery({
      leadgenId,
      eventId: event.id,
      envelope: { leadgenId, pageId, formId, adId: "120200000000000009" },
      receivedAt: new Date("2026-10-01T15:10:00.000Z"),
      webhookRequestLogId: `wh_${stamp}_2`,
      errorSummaryIfEmpty: "Queued for Meta Graph fetch.",
    });
    await recordMetaNotificationRedelivery({
      leadgenId,
      eventId: event.id,
      envelope: { leadgenId, pageId, formId },
      receivedAt: new Date("2026-10-01T15:20:00.000Z"),
      webhookRequestLogId: `wh_${stamp}_3`,
    });

    const stored = await db.sourceLeadEvent.findUnique({ where: { id: event.id } });
    assert.ok(stored);
    // Failure diagnostic preserved (not replaced by the "queued" placeholder).
    assert.match(stored.errorSummary ?? "", /Graph error 190/);
    const raw = stored.rawPayloadJson as {
      envelope?: { createdTime?: string };
      redelivery?: { count?: number; lastReceivedAt?: string; lastWebhookRequestLogId?: string; lastEnvelope?: { adId?: string } };
    };
    // Original envelope retained; redeliveries appended.
    assert.equal(raw.envelope?.createdTime, "2026-10-01T15:04:00.000Z");
    assert.equal(raw.redelivery?.count, 2);
    assert.equal(raw.redelivery?.lastReceivedAt, "2026-10-01T15:20:00.000Z");
    assert.equal(raw.redelivery?.lastWebhookRequestLogId, `wh_${stamp}_3`);
    const enrichment = stored.enrichmentMetadataJson as { metaLeadgenFetch?: { state?: string } };
    assert.equal(enrichment.metaLeadgenFetch?.state, "failed");
    assert.equal(stored.status, "received");
  });

  it("token and Graph failures never settle capture; a later retry captures the same identity once", async () => {
    const stamp = uniqueStamp();
    const leadgenId = facebookId("38", stamp);
    const pageId = facebookId("28", stamp);
    const otherPageId = facebookId("29", stamp);
    const formId = facebookId("18", stamp);
    const clientAccountId = await client(`${stamp}r`);
    const funnelId = await associate(pageId, formId, clientAccountId);
    const event = await claimRaw(leadgenId, pageId, formId);

    type Stored = NonNullable<Awaited<ReturnType<typeof db.sourceLeadEvent.findUnique>>>;
    async function assertNotSettled(label: string): Promise<Stored> {
      const stored = await assertNoSideEffects(event.id);
      assert.equal(stored.status, "received", `${label}: status`);
      assert.equal(stored.normalizedPayloadJson, null, `${label}: no normalized payload before Graph data`);
      assert.equal(stored.normalizedAt, null, `${label}: normalizedAt`);
      assert.equal(stored.clientAccountIdResolved, null, `${label}: no association before capture`);
      assert.equal(isSettledCaptureOnlyFacebookEvent(stored), false, `${label}: captureSettled`);
      const raw = stored.rawPayloadJson as { envelope?: { pageId?: string; formId?: string }; lead?: unknown };
      assert.equal(raw.envelope?.pageId, pageId, `${label}: raw envelope retained`);
      assert.equal(raw.envelope?.formId, formId, `${label}: raw envelope retained`);
      assert.equal(raw.lead, undefined, `${label}: no Graph lead body persisted`);
      assert.doesNotMatch(JSON.stringify(stored), /\btok\b|access_token/, `${label}: token-free`);
      return stored;
    }
    const enrichmentOf = (stored: Stored) =>
      stored.enrichmentMetadataJson as {
        captureSettled?: boolean;
        metaLeadgenFetch?: {
          state?: string;
          graphOutcome?: string;
          graphStatus?: number;
          graphError?: { code?: number | string } | null;
          attempt?: number;
        };
      };

    let graphCalls = 0;
    let graphResponse: { ok: boolean; status: number; body: Record<string, unknown> | null } = {
      ok: false,
      status: 400,
      body: { error: { code: 190, type: "OAuthException", message: "Error validating access token" } },
    };
    const deps = (config: MetaWebhookConfig) => ({
      getMetaWebhookConfigImpl: () => config,
      fetchMetaLeadDetailsImpl: async () => {
        graphCalls += 1;
        return graphResponse;
      },
      processFacebookSourceLeadImpl: async () => {
        throw new Error("lifecycle normalize must not run on the pilot capture path");
      },
    });

    // 1. Page-bound token for a different Page: terminal, no Graph call, nothing settled.
    const tokenMiss = await processMetaLeadgenFetch(
      { leadgenId, sourceLeadEventId: event.id, jobId: `job_${stamp}`, attemptNumber: 1 },
      deps(pilotConfig({ accessTokenPageId: otherPageId }))
    );
    assert.equal(tokenMiss.ok, false);
    if (tokenMiss.ok) return;
    assert.equal(tokenMiss.retryable, false);
    assert.equal(tokenMiss.error, "graph_token_unavailable");
    assert.equal(graphCalls, 0);
    let stored = await assertNotSettled("token_unavailable");
    assert.equal(enrichmentOf(stored).metaLeadgenFetch?.state, "failed");
    assert.equal(enrichmentOf(stored).metaLeadgenFetch?.graphOutcome, "token_unavailable");
    assert.match(stored.errorSummary ?? "", /META_PAGE_ACCESS_TOKEN/);
    assert.match(stored.errorSummary ?? "", new RegExp(pageId));

    // 2. Operator binds the right Page, but the token is expired (190): terminal, retained.
    const expired = await processMetaLeadgenFetch(
      { leadgenId, sourceLeadEventId: event.id, jobId: `job_${stamp}_2`, attemptNumber: 1 },
      deps(pilotConfig({ accessTokenPageId: pageId }))
    );
    assert.equal(expired.ok, false);
    if (expired.ok) return;
    assert.equal(expired.retryable, false);
    assert.equal(expired.error, "graph_auth_failure");
    assert.equal(graphCalls, 1);
    stored = await assertNotSettled("auth_failure");
    assert.equal(enrichmentOf(stored).metaLeadgenFetch?.state, "failed");
    assert.equal(enrichmentOf(stored).metaLeadgenFetch?.graphOutcome, "auth_failure");
    assert.equal(String(enrichmentOf(stored).metaLeadgenFetch?.graphError?.code), "190");
    assert.match(stored.errorSummary ?? "", /190/);

    // 3. Fresh token, but Graph is rate limited (code 4): retryable, still nothing settled.
    graphResponse = {
      ok: false,
      status: 400,
      body: { error: { code: 4, message: "Application request limit reached", is_transient: true } },
    };
    const limited = await processMetaLeadgenFetch(
      { leadgenId, sourceLeadEventId: event.id, jobId: `job_${stamp}_3`, attemptNumber: 1 },
      deps(pilotConfig({ accessTokenPageId: pageId }))
    );
    assert.equal(limited.ok, false);
    if (limited.ok) return;
    assert.equal(limited.retryable, true);
    assert.equal(graphCalls, 2);
    stored = await assertNotSettled("rate_limited");
    assert.equal(enrichmentOf(stored).metaLeadgenFetch?.state, "retrying");
    assert.equal(enrichmentOf(stored).metaLeadgenFetch?.graphOutcome, "retryable_failure");

    // 4. BullMQ retry succeeds: the lead body and the capture land in one transaction.
    graphResponse = {
      ok: true,
      status: 200,
      body: graphLead({ leadgenId, formId, email: `recovered.${stamp}@example.test` }),
    };
    const recovered = await processMetaLeadgenFetch(
      { leadgenId, sourceLeadEventId: event.id, jobId: `job_${stamp}_3`, attemptNumber: 2 },
      deps(pilotConfig({ accessTokenPageId: pageId }))
    );
    assert.equal(recovered.ok, true);
    if (!recovered.ok) return;
    assert.equal(graphCalls, 3);
    assert.equal(recovered.capture?.captureOutcome, "captured");
    assert.equal(recovered.capture?.association.outcome, "associated");
    assert.equal(recovered.capture?.association.sourceFunnelId, funnelId);
    assert.equal(recovered.capture?.sourceClientAccountId, clientAccountId);

    const settled = await assertNoSideEffects(event.id);
    assert.equal(settled.status, "normalized");
    assert.equal(settled.clientAccountIdResolved, clientAccountId);
    assert.equal(isSettledCaptureOnlyFacebookEvent(settled), true);
    assert.equal(settled.errorSummary, null);
    const raw = settled.rawPayloadJson as { envelope?: { pageId?: string }; lead?: { id?: string } };
    assert.equal(raw.envelope?.pageId, pageId, "original envelope survives every failure");
    assert.equal(raw.lead?.id, leadgenId, "Graph body persisted with the capture");
    const normalized = settled.normalizedPayloadJson as { contact?: { email?: string }; source?: { intake_method?: string } };
    assert.equal(normalized.contact?.email, `recovered.${stamp}@example.test`);
    assert.equal(normalized.source?.intake_method, "meta_lead_ads");
    const enrichment = enrichmentOf(settled);
    assert.equal(enrichment.metaLeadgenFetch?.state, "captured");
    assert.equal(enrichment.metaLeadgenFetch?.graphOutcome, "success");
    assert.equal(enrichment.metaLeadgenFetch?.attempt, 2);
    assert.equal(await db.sourceLeadEvent.count({ where: { sourceLeadId: leadgenId } }), 1);

    // 5. A late retry of the same job after settle is a no-op and never calls Graph again.
    const late = await processMetaLeadgenFetch(
      { leadgenId, sourceLeadEventId: event.id, jobId: `job_${stamp}_3`, attemptNumber: 3 },
      deps(pilotConfig({ accessTokenPageId: pageId }))
    );
    assert.equal(late.ok, true);
    if (late.ok) assert.equal(late.skipped, "already_processed");
    assert.equal(graphCalls, 3);
  });
});
