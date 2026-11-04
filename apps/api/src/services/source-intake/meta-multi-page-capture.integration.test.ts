import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import type { PrismaClient } from "@prisma/client";

import { prisma } from "../../lib/db.js";
import { assertSafeTestDatabaseUrl } from "../../lib/safe-test-database-url.js";
import { decryptMetaToken } from "../../lib/meta-token-encryption.js";
import { claimSourceLeadEventByCanonicalIdentity } from "../../repositories/source-lead-event.repository.js";
import { confirmFacebookFormAssociation } from "./facebook-form-association.service.js";
import { buildFacebookLeadUid } from "./facebook-lead-normalizer.js";
import { importMetaFormCandidates } from "./meta-capture-inventory.service.js";
import { processMetaLeadgenFetch } from "./meta-leadgen-fetch.service.js";
import { createMetaPageCredential, listMetaPageCredentials } from "./meta-page-token.service.js";
import { processZapierFacebookCapture } from "./zapier-facebook-capture.service.js";

const integrationUrlRaw = process.env.SA360_TEST_DATABASE_URL?.trim() || "";
const runIntegration = Boolean(integrationUrlRaw);
const ENCRYPTION_KEY = "test-meta-token-key-not-a-real-secret";

function stamp(): string {
  return `${Date.now()}${Math.floor(Math.random() * 1000).toString().padStart(3, "0")}`;
}

function facebookId(marker: string, value: string): string {
  return `${marker}${value}`.slice(0, 16);
}

describe("multi-Page Meta capture foundation", { skip: !runIntegration }, () => {
  let db: PrismaClient;
  const leadgenIds: string[] = [];
  const clientIds: string[] = [];
  const funnelIds: string[] = [];
  const credentialIds: string[] = [];
  const pageIds: string[] = [];
  const candidateLabels: string[] = [];
  const saved = {
    key: process.env.META_TOKEN_ENCRYPTION_KEY,
    capture: process.env.SA360_FACEBOOK_CAPTURE_INTAKE_ENABLED,
  };

  before(async () => {
    process.env.DATABASE_URL = assertSafeTestDatabaseUrl(integrationUrlRaw);
    process.env.META_TOKEN_ENCRYPTION_KEY = ENCRYPTION_KEY;
    process.env.SA360_FACEBOOK_CAPTURE_INTAKE_ENABLED = "true";
    db = prisma;
    await db.$queryRaw`SELECT 1`;
  });

  after(async () => {
    if (pageIds.length > 0) {
      await db.metaPageCaptureGrant.deleteMany({ where: { pageId: { in: pageIds } } });
    }
    if (credentialIds.length > 0) {
      await db.metaGraphCredential.deleteMany({ where: { id: { in: credentialIds } } });
    }
    if (candidateLabels.length > 0) {
      await db.metaFormCandidate.deleteMany({ where: { sourceLabel: { in: candidateLabels } } });
    }
    if (leadgenIds.length > 0) {
      const events = await db.sourceLeadEvent.findMany({
        where: { sourceLeadId: { in: leadgenIds } },
        select: { id: true },
      });
      const ids = events.map((event) => event.id);
      if (ids.length > 0) {
        await db.leadInventoryItem.deleteMany({ where: { sourceLeadEventId: { in: ids } } });
        await db.fulfillmentOutbox.deleteMany({ where: { sourceLeadEventId: { in: ids } } });
        await db.leadAllocation.deleteMany({ where: { sourceLeadEventId: { in: ids } } });
        await db.sourceLeadEvent.deleteMany({ where: { id: { in: ids } } });
      }
    }
    if (funnelIds.length > 0) await db.sourceFunnel.deleteMany({ where: { id: { in: funnelIds } } });
    if (clientIds.length > 0) await db.clientAccount.deleteMany({ where: { clientAccountId: { in: clientIds } } });
    if (saved.key === undefined) delete process.env.META_TOKEN_ENCRYPTION_KEY;
    else process.env.META_TOKEN_ENCRYPTION_KEY = saved.key;
    if (saved.capture === undefined) delete process.env.SA360_FACEBOOK_CAPTURE_INTAKE_ENABLED;
    else process.env.SA360_FACEBOOK_CAPTURE_INTAKE_ENABLED = saved.capture;
  });

  function captureConfig() {
    return {
      verifyToken: "vt",
      appSecret: "s",
      accessToken: "EAAB-env-token-must-not-be-used-for-other-pages",
      accessTokenPageId: null,
      unboundPageTokenEnabled: false,
      graphApiVersion: "v25.0",
      masterClientAccountId: null,
      directIntakeEnabled: false,
      intakeEnabled: true,
      graphFetchEnabled: true,
      routingEnabled: false,
      fixtureEnabled: false,
    };
  }

  async function client(id: string): Promise<string> {
    clientIds.push(id);
    await db.clientAccount.create({
      data: { clientAccountId: id, clientDisplayName: id, status: "active" },
    });
    return id;
  }

  async function claim(leadgenId: string, pageId: string, formId: string) {
    leadgenIds.push(leadgenId);
    const claimed = await claimSourceLeadEventByCanonicalIdentity({
      sourceProvider: "facebook",
      sourceSystem: "meta_lead_ads",
      sourceType: "lead_form",
      sourceRouteKey: formId,
      sourceLeadId: leadgenId,
      sourceLeadUid: buildFacebookLeadUid(leadgenId),
      status: "received",
      rawPayloadJson: { envelope: { leadgenId, pageId, formId, adgroupId: "120200000000000222" } },
      receivedAt: new Date("2026-11-04T15:00:00.000Z"),
    });
    assert.equal(claimed.created, true);
    return claimed.event;
  }

  it("uses each Page token only for that Page, retains an unmapped lead, and recovers a disabled grant", async () => {
    const id = stamp();
    const pageA = facebookId("81", id);
    const pageB = facebookId("82", id);
    const formA = facebookId("71", id);
    const formB = facebookId("72", id);
    const tokenA = `EAAB-token-a-${id}-not-real`;
    const tokenB = `EAAB-token-b-${id}-not-real`;
    pageIds.push(pageA, pageB);
    const storedA = await createMetaPageCredential({
      kind: "page_access_token",
      label: `A ${id}`,
      accessToken: tokenA,
      pages: [{ pageId: pageA, captureEnabled: true }],
    });
    const storedB = await createMetaPageCredential({
      kind: "system_user",
      label: `B ${id}`,
      accessToken: tokenB,
      scopes: ["leads_retrieval", "pages_manage_ads", "pages_read_engagement"],
      pages: [{ pageId: pageB, captureEnabled: false }],
    });
    assert.equal(storedA.ok, true);
    assert.equal(storedB.ok, true);
    if (!storedA.ok || !storedB.ok) return;
    credentialIds.push(storedA.credential.id, storedB.credential.id);
    const pageC = facebookId("83", id);
    pageIds.push(pageC);
    const storedC = await createMetaPageCredential({
      kind: "page_access_token",
      label: `C ${id}`,
      accessToken: `EAAB-token-c-${id}-not-real-value`,
      pages: [{ pageId: pageC }],
    });
    assert.equal(storedC.ok, true);
    if (storedC.ok) {
      credentialIds.push(storedC.credential.id);
      assert.equal(storedC.credential.pages[0]?.captureEnabled, false);
    }
    const listed = JSON.stringify(await listMetaPageCredentials());
    assert.equal(listed.includes(tokenA), false);
    assert.equal(listed.includes(tokenB), false);
    const ciphertext = await db.metaGraphCredential.findUnique({
      where: { id: storedA.credential.id },
      select: { tokenCiphertext: true },
    });
    assert.ok(ciphertext);
    assert.equal(ciphertext.tokenCiphertext.includes(tokenA), false);
    assert.equal(decryptMetaToken(ciphertext.tokenCiphertext), tokenA);

    const clientA = await client(`meta_page_${id}`);
    const confirmed = await confirmFacebookFormAssociation({ pageId: pageA, formId: formA, clientAccountId: clientA });
    funnelIds.push(confirmed.item.id);
    const leadA = facebookId("61", id);
    const leadB = facebookId("62", id);
    const leadUnmapped = facebookId("63", id);
    const eventA = await claim(leadA, pageA, formA);
    const eventB = await claim(leadB, pageB, formB);
    const eventUnmapped = await claim(leadUnmapped, pageA, facebookId("73", id));

    const seen: string[] = [];
    const fetched = await processMetaLeadgenFetch(
      { leadgenId: leadA, sourceLeadEventId: eventA.id, jobId: `job_${id}_a` },
      {
        getMetaWebhookConfigImpl: () => captureConfig(),
        fetchMetaLeadDetailsImpl: async (_leadgenId, fetchConfig) => {
          seen.push(fetchConfig.accessToken ?? "");
          return {
            ok: true,
            status: 200,
            body: {
              id: leadA,
              created_time: "2026-11-04T15:04:00+0000",
              form_id: formA,
              ad_id: "120200000000000301",
              adset_id: "120200000000000302",
              campaign_id: "120200000000000303",
              campaign_name: "Page A campaign",
              ad_account_id: "120200000000000399",
              field_data: [
                { name: "email", values: [`a.${id}@example.test`] },
                { name: "utm_source", values: ["facebook"] },
                { name: "which_branch", values: ["Navy"] },
              ],
            },
          };
        },
      }
    );
    assert.deepEqual(seen, [tokenA]);
    assert.equal(fetched.ok, true);
    if (fetched.ok) {
      assert.equal(fetched.capture?.association.outcome, "associated");
      assert.equal(fetched.capture?.sourceClientAccountId, clientA);
    }
    const storedLead = await db.sourceLeadEvent.findUnique({ where: { id: eventA.id } });
    const source = (storedLead?.normalizedPayloadJson as { source?: Record<string, string> } | null)?.source;
    assert.equal(source?.ad_account_id, "120200000000000399");
    assert.equal(source?.utm_source, "facebook");
    assert.equal(source?.adgroup_id, "120200000000000222");
    const custom = (storedLead?.normalizedPayloadJson as { custom_fields?: Record<string, string> } | null)?.custom_fields;
    assert.equal(custom?.which_branch, "Navy");
    const resolveSource = (
      storedLead?.enrichmentMetadataJson as {
        resolveSource?: {
          implemented?: boolean;
          pageFormIdentifiesOneClient?: boolean;
          deliveryOnLaterMatch?: boolean;
          campaignId?: string;
          adAccountId?: string;
          leadgenId?: string;
          associationOutcomeAtCapture?: string;
          reevaluate?: { startsDelivery?: boolean; recapturesLead?: boolean };
        };
      } | null
    )?.resolveSource;
    assert.equal(resolveSource?.implemented, false);
    assert.equal(resolveSource?.pageFormIdentifiesOneClient, false);
    assert.equal(resolveSource?.deliveryOnLaterMatch, false);
    assert.equal(resolveSource?.campaignId, "120200000000000303");
    assert.equal(resolveSource?.adAccountId, "120200000000000399");
    assert.equal(resolveSource?.leadgenId, leadA);
    assert.equal(resolveSource?.associationOutcomeAtCapture, "associated");
    assert.equal(resolveSource?.reevaluate?.startsDelivery, false);
    assert.equal(resolveSource?.reevaluate?.recapturesLead, false);
    assert.equal(await db.leadInventoryItem.count({ where: { sourceLeadEventId: eventA.id } }), 0);

    const replay = await processMetaLeadgenFetch(
      { leadgenId: leadA, sourceLeadEventId: eventA.id, jobId: `job_${id}_replay` },
      {
        getMetaWebhookConfigImpl: () => captureConfig(),
        fetchMetaLeadDetailsImpl: async () => {
          throw new Error("replay must not fetch");
        },
      }
    );
    assert.equal(replay.ok, true);
    if (replay.ok) assert.equal(replay.skipped, "already_processed");

    let blockedCalls = 0;
    const blocked = await processMetaLeadgenFetch(
      { leadgenId: leadB, sourceLeadEventId: eventB.id, jobId: `job_${id}_b` },
      {
        getMetaWebhookConfigImpl: () => captureConfig(),
        fetchMetaLeadDetailsImpl: async () => {
          blockedCalls += 1;
          return { ok: true, status: 200, body: { id: leadB } };
        },
      }
    );
    assert.equal(blockedCalls, 0);
    assert.equal(blocked.ok, false);
    if (!blocked.ok) assert.equal(blocked.graphOutcome, "token_unavailable");
    const blockedRow = await db.sourceLeadEvent.findUnique({ where: { id: eventB.id } });
    assert.match(blockedRow?.errorSummary ?? "", /capture grant is disabled/);
    assert.equal((blockedRow?.errorSummary ?? "").includes(tokenA), false);
    assert.equal((blockedRow?.errorSummary ?? "").includes(tokenB), false);
    const blockedMeta = (blockedRow?.enrichmentMetadataJson as { metaLeadgenFetch?: { tokenBlockReason?: string } } | null)
      ?.metaLeadgenFetch;
    assert.equal(blockedMeta?.tokenBlockReason, "capture_not_allowlisted");

    await db.metaPageCaptureGrant.update({ where: { pageId: pageB }, data: { captureEnabled: true } });
    const recovered = await processMetaLeadgenFetch(
      { leadgenId: leadB, sourceLeadEventId: eventB.id, jobId: `job_${id}_b2` },
      {
        getMetaWebhookConfigImpl: () => captureConfig(),
        fetchMetaLeadDetailsImpl: async (_id, fetchConfig) => {
          assert.equal(fetchConfig.accessToken, tokenB);
          return {
            ok: true,
            status: 200,
            body: {
              id: leadB,
              form_id: formB,
              created_time: "2026-11-04T15:05:00+0000",
              field_data: [{ name: "email", values: [`b.${id}@example.test`] }],
            },
          };
        },
      }
    );
    assert.equal(recovered.ok, true);
    if (recovered.ok) assert.equal(recovered.capture?.association.outcome, "unassociated");
    const unmapped = await processMetaLeadgenFetch(
      { leadgenId: leadUnmapped, sourceLeadEventId: eventUnmapped.id, jobId: `job_${id}_u` },
      {
        getMetaWebhookConfigImpl: () => captureConfig(),
        fetchMetaLeadDetailsImpl: async () => ({
          ok: true,
          status: 200,
          body: {
            id: leadUnmapped,
            form_id: facebookId("73", id),
            created_time: "2026-11-04T15:06:00+0000",
            field_data: [{ name: "email", values: [`u.${id}@example.test`] }],
          },
        }),
      }
    );
    assert.equal(unmapped.ok, true);
    const unmappedRow = await db.sourceLeadEvent.findUnique({ where: { id: eventUnmapped.id } });
    assert.equal(unmappedRow?.clientAccountIdResolved, null);
    assert.equal(unmappedRow?.status, "normalized");
    assert.equal(await db.leadInventoryItem.count({ where: { sourceLeadEventId: eventUnmapped.id } }), 0);
    assert.equal(await db.fulfillmentOutbox.count({ where: { sourceLeadEventId: eventUnmapped.id } }), 0);

    const unknownLead = facebookId("64", id);
    const unknownPage = facebookId("89", id);
    pageIds.push(unknownPage);
    const unknownEvent = await claim(unknownLead, unknownPage, facebookId("74", id));
    let unknownCalls = 0;
    const unknown = await processMetaLeadgenFetch(
      { leadgenId: unknownLead, sourceLeadEventId: unknownEvent.id, jobId: `job_${id}_unknown` },
      {
        getMetaWebhookConfigImpl: () => captureConfig(),
        fetchMetaLeadDetailsImpl: async () => {
          unknownCalls += 1;
          return { ok: true, status: 200, body: { id: unknownLead } };
        },
      }
    );
    assert.equal(unknownCalls, 0);
    assert.equal(unknown.ok, false);
    if (!unknown.ok) assert.equal(unknown.graphOutcome, "token_unavailable");

    const label = `registry_${id}`;
    candidateLabels.push(label);
    const imported = await importMetaFormCandidates({
      sourceLabel: label,
      rows: [
        { pageId: pageA, formId: formA, formName: "Candidate must not replace Danielle" },
        { pageId: pageB, formId: formB, formName: "Shared form id, other page" },
      ],
    });
    assert.equal(imported.createsClient, false);
    const funnelAfter = await db.sourceFunnel.findUnique({ where: { id: confirmed.item.id } });
    assert.equal(funnelAfter?.originClientAccountId, clientA);
    assert.equal(await db.clientAccount.count({ where: { clientAccountId: { contains: label } } }), 0);
  });

  it("concurrent Meta and Zapier arrival still settles one row when the Page token is stored", async () => {
    const id = stamp();
    const pageId = facebookId("85", id);
    const formId = facebookId("75", id);
    const token = `EAAB-concurrent-${id}-not-real`;
    pageIds.push(pageId);
    const stored = await createMetaPageCredential({
      kind: "page_access_token",
      label: `concurrent ${id}`,
      accessToken: token,
      pages: [{ pageId, captureEnabled: true }],
    });
    assert.equal(stored.ok, true);
    if (!stored.ok) return;
    credentialIds.push(stored.credential.id);
    const clientId = await client(`meta_conc_${id}`);
    const confirmed = await confirmFacebookFormAssociation({ pageId, formId, clientAccountId: clientId });
    funnelIds.push(confirmed.item.id);
    const leadgenId = facebookId("65", id);
    const event = await claim(leadgenId, pageId, formId);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started!: () => void;
    const startedGate = new Promise<void>((resolve) => {
      started = resolve;
    });
    const metaRun = processMetaLeadgenFetch(
      { leadgenId, sourceLeadEventId: event.id, jobId: `job_${id}_conc` },
      {
        getMetaWebhookConfigImpl: () => captureConfig(),
        fetchMetaLeadDetailsImpl: async (_id, fetchConfig) => {
          assert.equal(fetchConfig.accessToken, token);
          started();
          await gate;
          return {
            ok: true,
            status: 200,
            body: {
              id: leadgenId,
              form_id: formId,
              created_time: "2026-11-04T15:04:00+0000",
              field_data: [{ name: "email", values: [`meta.${id}@example.test`] }],
            },
          };
        },
      }
    );
    await startedGate;
    const zapier = await processZapierFacebookCapture({
      rawPayload: {
        leadgen_id: leadgenId,
        page_id: pageId,
        form_id: formId,
        first_name: "Zap",
        email: `zap.${id}@example.test`,
        submitted_at: "2026-11-04T15:04:00.000Z",
      },
    });
    release();
    const meta = await metaRun;
    assert.equal(zapier.sourceEventId, event.id);
    assert.equal(meta.ok, true);
    if (meta.ok) assert.equal(meta.skipped, "already_processed");
    const rows = await db.sourceLeadEvent.count({ where: { sourceLeadId: leadgenId } });
    assert.equal(rows, 1);
    const storedRow = await db.sourceLeadEvent.findUnique({ where: { id: event.id } });
    const email = (storedRow?.normalizedPayloadJson as { contact?: { email?: string } } | null)?.contact?.email;
    assert.equal(email, `zap.${id}@example.test`);
    assert.equal(await db.leadInventoryItem.count({ where: { sourceLeadEventId: event.id } }), 0);
  });
});
