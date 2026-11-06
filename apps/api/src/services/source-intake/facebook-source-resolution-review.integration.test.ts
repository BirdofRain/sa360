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
});
