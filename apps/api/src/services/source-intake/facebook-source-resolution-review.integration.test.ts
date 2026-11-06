import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import type { PrismaClient } from "@prisma/client";

import { prisma } from "../../lib/db.js";
import { assertSafeTestDatabaseUrl } from "../../lib/safe-test-database-url.js";
import {
  claimSourceLeadEventByCanonicalIdentity,
  withCanonicalSourceLeadLock,
} from "../../repositories/source-lead-event.repository.js";
import { confirmFacebookFormAssociation } from "./facebook-form-association.service.js";
import { buildFacebookLeadUid } from "./facebook-lead-normalizer.js";
import { settleMetaLeadCapture } from "./meta-lead-capture.service.js";
import { loadFacebookSourceResolutionReview } from "./facebook-source-resolution-review.service.js";

const integrationUrlRaw = process.env.SA360_TEST_DATABASE_URL?.trim() || "";
const runIntegration = Boolean(integrationUrlRaw);

function uniqueStamp(): string {
  return `${Date.now()}${Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, "0")}`;
}

function facebookId(marker: string, stamp: string): string {
  return `${marker}${stamp}`.slice(0, 16);
}

describe("Facebook source resolution review", { skip: !runIntegration }, () => {
  let db: PrismaClient;
  const leadgenIds: string[] = [];
  const clientIds: string[] = [];
  const funnelIds: string[] = [];
  const saved = process.env.SA360_FACEBOOK_CAPTURE_INTAKE_ENABLED;

  before(async () => {
    const url = assertSafeTestDatabaseUrl(integrationUrlRaw);
    process.env.DATABASE_URL = url;
    process.env.SA360_FACEBOOK_CAPTURE_INTAKE_ENABLED = "true";
    db = prisma;
    await db.$queryRaw`SELECT 1`;
  });

  after(async () => {
    if (saved === undefined) delete process.env.SA360_FACEBOOK_CAPTURE_INTAKE_ENABLED;
    else process.env.SA360_FACEBOOK_CAPTURE_INTAKE_ENABLED = saved;
    if (leadgenIds.length > 0) {
      await db.sourceLeadEvent.deleteMany({ where: { sourceLeadId: { in: leadgenIds } } });
    }
    if (funnelIds.length > 0) await db.sourceFunnel.deleteMany({ where: { id: { in: funnelIds } } });
    if (clientIds.length > 0) {
      await db.clientAccount.deleteMany({ where: { clientAccountId: { in: clientIds } } });
    }
  });

  async function client(stamp: string): Promise<string> {
    const clientAccountId = `res_rev_${stamp}`;
    clientIds.push(clientAccountId);
    await db.clientAccount.create({
      data: { clientAccountId, clientDisplayName: `Synthetic ${stamp}`, status: "active" },
    });
    return clientAccountId;
  }

  async function settle(input: {
    leadgenId: string;
    pageId?: string;
    formId?: string;
    email: string;
    captureEnabled?: boolean;
  }) {
    leadgenIds.push(input.leadgenId);
    const claimed = await claimSourceLeadEventByCanonicalIdentity({
      sourceProvider: "facebook",
      sourceSystem: "meta_lead_ads",
      sourceType: "lead_form",
      sourceRouteKey: input.formId ?? null,
      sourceLeadId: input.leadgenId,
      sourceLeadUid: buildFacebookLeadUid(input.leadgenId),
      status: "received",
      rawPayloadJson: {
        envelope: { leadgenId: input.leadgenId, pageId: input.pageId ?? null, formId: input.formId ?? null },
        email: input.email,
      },
      errorSummary: null,
      receivedAt: new Date("2026-10-01T15:04:05.000Z"),
    });
    assert.equal(claimed.created, true);
    const settled = await withCanonicalSourceLeadLock(
      "facebook",
      "meta_lead_ads",
      input.leadgenId,
      (tx) =>
        settleMetaLeadCapture(
          {
            event: claimed.event,
            leadgenId: input.leadgenId,
            fields: {
              leadgenId: input.leadgenId,
              pageId: input.pageId,
              formId: input.formId,
              email: input.email,
              firstName: "Synthetic",
              lastName: "Lead",
            },
            rawPayloadJson: {
              envelope: { leadgenId: input.leadgenId },
              email: input.email,
            },
            fetchMeta: { graphOutcome: "ok" },
            now: new Date("2026-10-01T15:05:00.000Z"),
          },
          tx,
          input.captureEnabled === false ? { captureIntakeEnabledImpl: () => false } : {}
        )
    );
    return settled.sourceEventId;
  }

  it("leaves a pre-confirmation capture unstamped and reports the stored outcome", async () => {
    const stamp = uniqueStamp();
    const pageId = facebookId("91", stamp);
    const formBefore = facebookId("81", stamp);
    const formAfter = facebookId("82", stamp);
    const formDisabled = facebookId("83", stamp);
    const clientAccountId = await client(stamp);
    const email = `synthetic-${stamp}@example.test`;

    const earlyId = await settle({
      leadgenId: `lead-early-${stamp}`,
      pageId,
      formId: formBefore,
      email,
    });
    const early = await db.sourceLeadEvent.findUniqueOrThrow({ where: { id: earlyId } });
    assert.equal(early.clientAccountIdResolved, null);

    const confirmed = await confirmFacebookFormAssociation({
      pageId,
      formId: formBefore,
      clientAccountId,
    });
    funnelIds.push(confirmed.item.id);
    const afterConfirm = await db.sourceLeadEvent.findUniqueOrThrow({ where: { id: earlyId } });
    assert.equal(afterConfirm.clientAccountIdResolved, null);

    const laterId = await settle({
      leadgenId: `lead-later-${stamp}`,
      pageId,
      formId: formAfter,
      email,
    });
    const confirmedLater = await confirmFacebookFormAssociation({
      pageId,
      formId: formAfter,
      clientAccountId,
    });
    funnelIds.push(confirmedLater.item.id);
    const laterBefore = await db.sourceLeadEvent.findUniqueOrThrow({ where: { id: laterId } });
    assert.equal(laterBefore.clientAccountIdResolved, null);

    const stampedId = await settle({
      leadgenId: `lead-stamped-${stamp}`,
      pageId,
      formId: formAfter,
      email,
    });
    const stamped = await db.sourceLeadEvent.findUniqueOrThrow({ where: { id: stampedId } });
    assert.equal(stamped.clientAccountIdResolved, clientAccountId);

    const disabledId = await settle({
      leadgenId: `lead-disabled-${stamp}`,
      pageId,
      formId: formDisabled,
      email,
      captureEnabled: false,
    });
    const confirmedDisabled = await confirmFacebookFormAssociation({
      pageId,
      formId: formDisabled,
      clientAccountId,
    });
    funnelIds.push(confirmedDisabled.item.id);
    const disabled = await db.sourceLeadEvent.findUniqueOrThrow({ where: { id: disabledId } });
    assert.equal(disabled.clientAccountIdResolved, null);

    const missingId = await settle({
      leadgenId: `lead-missing-${stamp}`,
      email,
    });

    const earlyReview = await loadFacebookSourceResolutionReview(
      { pageId, formId: formBefore, includeEvents: true },
      db
    );
    assert.equal(earlyReview.writesPerformed, false);
    assert.equal(earlyReview.summary.unstampedDespiteConfirmedOwner, 1);
    assert.equal(earlyReview.groups.total, 1);
    const earlyGroup = earlyReview.groups.items[0];
    assert.ok(earlyGroup);
    assert.equal(earlyGroup.classification, "unstamped_confirmed_owner");
    assert.equal(earlyGroup.confirmedOriginClientAccountId, clientAccountId);
    assert.equal(earlyGroup.campaignId, null);
    assert.equal(earlyGroup.outcomes.unassociated, 1);
    assert.equal(earlyGroup.events[0]?.sourceEventId, earlyId);
    assert.match(earlyGroup.explanation, /recorded unassociated/);
    assert.equal(JSON.stringify(earlyReview).includes(email), false);
    assert.equal(JSON.stringify(earlyReview).includes("rawPayload"), false);

    const stampedReview = await loadFacebookSourceResolutionReview(
      { pageId, formId: formAfter, includeEvents: true },
      db
    );
    assert.equal(stampedReview.summary.unresolvedClient, 1);
    assert.equal(stampedReview.groups.items[0]?.unresolvedEvents, 1);
    assert.deepEqual(
      stampedReview.groups.items[0]?.events.map((event) => event.sourceEventId),
      [laterId]
    );

    const disabledReview = await loadFacebookSourceResolutionReview(
      { pageId, formId: formDisabled, includeEvents: true },
      db
    );
    assert.equal(disabledReview.groups.items[0]?.classification, "unstamped_confirmed_owner");
    assert.equal(disabledReview.groups.items[0]?.outcomes.association_disabled, 1);
    assert.match(disabledReview.groups.items[0]?.explanation ?? "", /association_disabled/);

    const missingReview = await loadFacebookSourceResolutionReview(
      { sourceEventId: missingId, classification: "cannot_identify", includeEvents: true },
      db
    );
    assert.equal(missingReview.summary.cannotIdentify, 1);
    assert.equal(missingReview.groups.items[0]?.classification, "cannot_identify");
    assert.equal(missingReview.groups.items[0]?.pageId, null);
    assert.equal(missingReview.groups.items[0]?.formId, null);
    assert.equal(missingReview.groups.items[0]?.events[0]?.sourceEventId, missingId);
    assert.equal(JSON.stringify(missingReview).includes(email), false);

    const empty = await loadFacebookSourceResolutionReview({ pageId: "900000000000099" }, db);
    assert.equal(empty.summary.events, 0);
    assert.equal(empty.groups.items.length, 0);
    assert.equal(empty.associations.items.length, 0);
  });

  it("pages unresolved groups without returning payload fields", async () => {
    const stamp = uniqueStamp();
    const pageId = facebookId("94", stamp);
    const forms = ["71", "72", "73"].map((marker) => facebookId(marker, stamp));
    for (const [index, formId] of forms.entries()) {
      const leadgenId = `lead-page-${stamp}-${index}`;
      leadgenIds.push(leadgenId);
      await claimSourceLeadEventByCanonicalIdentity({
        sourceProvider: "facebook",
        sourceSystem: "meta_lead_ads",
        sourceType: "lead_form",
        sourceRouteKey: formId,
        sourceLeadId: leadgenId,
        sourceLeadUid: buildFacebookLeadUid(leadgenId),
        status: "normalized",
        rawPayloadJson: { email: `page-${stamp}@example.test` },
        normalizedPayloadJson: {
          source: { page_id: pageId, form_id: formId },
          contact: { email: `page-${stamp}@example.test` },
        },
        enrichmentMetadataJson: {
          captureOnly: true,
          captureSettled: true,
          association: { outcome: "unassociated", pageId, formId, clientAccountId: null },
        },
        errorSummary: null,
        receivedAt: new Date(`2026-10-0${index + 1}T00:00:00.000Z`),
      });
    }

    const first = await loadFacebookSourceResolutionReview({ pageId, limit: 1, offset: 0 }, db);
    const second = await loadFacebookSourceResolutionReview({ pageId, limit: 1, offset: 1 }, db);
    assert.equal(first.groups.total, 3);
    assert.equal(first.groups.items.length, 1);
    assert.equal(second.groups.items.length, 1);
    assert.equal(first.summary.unresolvedWithPageFormAndCampaign, 0);
    assert.equal(first.groups.items[0]?.classification, "unknown_ownership");
    assert.notEqual(first.groups.items[0]?.formId, second.groups.items[0]?.formId);
    assert.equal(JSON.stringify(first).includes(`page-${stamp}@example.test`), false);
    assert.equal(JSON.stringify(first).includes("normalizedPayload"), false);
  });

  it("a form-only filter narrows SourceFunnel owners with the unresolved groups", async () => {
    const stamp = uniqueStamp();
    const pageA = facebookId("95", stamp);
    const pageB = facebookId("96", stamp);
    const sharedForm = facebookId("85", stamp);
    const otherForm = facebookId("86", stamp);
    const clientAccountId = await client(stamp);
    const pairs = [
      [pageA, sharedForm],
      [pageA, otherForm],
      [pageB, sharedForm],
    ] as const;

    for (const [pageId, formId] of pairs) {
      const confirmed = await confirmFacebookFormAssociation({ pageId, formId, clientAccountId });
      funnelIds.push(confirmed.item.id);
      const leadgenId = `lead-form-filter-${stamp}-${pageId}-${formId}`;
      leadgenIds.push(leadgenId);
      await claimSourceLeadEventByCanonicalIdentity({
        sourceProvider: "facebook",
        sourceSystem: "meta_lead_ads",
        sourceType: "lead_form",
        sourceRouteKey: formId,
        sourceLeadId: leadgenId,
        sourceLeadUid: buildFacebookLeadUid(leadgenId),
        status: "normalized",
        rawPayloadJson: { email: `form-filter-${stamp}@example.test` },
        normalizedPayloadJson: { source: { page_id: pageId, form_id: formId } },
        enrichmentMetadataJson: {
          captureOnly: true,
          captureSettled: true,
          association: { outcome: "unassociated", pageId, formId, clientAccountId: null },
        },
        errorSummary: null,
        receivedAt: new Date("2026-10-03T00:00:00.000Z"),
      });
    }

    const funnelCountBefore = await db.sourceFunnel.count();
    const eventCountBefore = await db.sourceLeadEvent.count();
    const keys = (items: Array<{ pageId: string | null; formId: string | null }>) =>
      items.map((item) => `${item.pageId}:${item.formId}`).sort();

    const formOnly = await loadFacebookSourceResolutionReview(
      { formId: sharedForm, limit: 100, associationLimit: 100 },
      db
    );
    assert.equal(formOnly.readOnly, true);
    assert.equal(formOnly.writesPerformed, false);
    assert.deepEqual(keys(formOnly.associations.items), [`${pageA}:${sharedForm}`, `${pageB}:${sharedForm}`].sort());
    assert.deepEqual(keys(formOnly.groups.items), keys(formOnly.associations.items));
    assert.equal(formOnly.associations.items.every((item) => item.ownership === "confirmed"), true);

    const pageOnly = await loadFacebookSourceResolutionReview(
      { pageId: pageA, limit: 100, associationLimit: 100 },
      db
    );
    assert.deepEqual(keys(pageOnly.associations.items), [`${pageA}:${otherForm}`, `${pageA}:${sharedForm}`].sort());
    assert.deepEqual(keys(pageOnly.groups.items), keys(pageOnly.associations.items));

    const both = await loadFacebookSourceResolutionReview(
      { pageId: pageA, formId: sharedForm, limit: 100, associationLimit: 100 },
      db
    );
    assert.deepEqual(both.associations.items.map((item) => item.providerFunnelId), [
      `fbpage:${pageA}:fbform:${sharedForm}`,
    ]);
    assert.deepEqual(keys(both.groups.items), [`${pageA}:${sharedForm}`]);

    const unfiltered = await loadFacebookSourceResolutionReview(
      { limit: 100, associationLimit: 100 },
      db
    );
    const unfilteredKeys = new Set(keys(unfiltered.associations.items));
    for (const [pageId, formId] of pairs) {
      assert.equal(unfilteredKeys.has(`${pageId}:${formId}`), true);
    }
    assert.equal(unfiltered.readOnly, true);

    const firstPage = await loadFacebookSourceResolutionReview(
      { formId: sharedForm, associationLimit: 1, associationOffset: 0, limit: 1, offset: 0 },
      db
    );
    const secondPage = await loadFacebookSourceResolutionReview(
      { formId: sharedForm, associationLimit: 1, associationOffset: 1, limit: 1, offset: 1 },
      db
    );
    assert.equal(firstPage.associations.total, 2);
    assert.equal(firstPage.associations.items.length, 1);
    assert.equal(firstPage.associations.items[0]?.formId, sharedForm);
    assert.equal(firstPage.associations.truncated, true);
    assert.equal(secondPage.associations.items.length, 1);
    assert.equal(secondPage.associations.items[0]?.formId, sharedForm);
    assert.notEqual(firstPage.associations.items[0]?.pageId, secondPage.associations.items[0]?.pageId);
    assert.equal(firstPage.groups.total, 2);
    assert.equal(firstPage.groups.items.length, 1);
    assert.equal(firstPage.groups.items[0]?.formId, sharedForm);

    assert.equal(await db.sourceFunnel.count(), funnelCountBefore);
    assert.equal(await db.sourceLeadEvent.count(), eventCountBefore);
    assert.equal(JSON.stringify(formOnly).includes(`form-filter-${stamp}@example.test`), false);
  });
});
