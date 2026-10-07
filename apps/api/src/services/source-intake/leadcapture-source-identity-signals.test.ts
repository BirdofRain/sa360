import test from "node:test";
import assert from "node:assert/strict";

import nicholasFixture from "../../fixtures/leadcaptureio/leadcaptureio-webhook-sample-legacy-custom-domain-nicholas.json" with { type: "json" };
import { materializeLeadCapturePayload } from "./leadcapture-payload-resolver.js";
import { normalizeLeadCaptureIoWebhookToLifecyclePayload } from "./leadcapture-io-normalizer.js";
import {
  hasLeadCaptureSourceIdentitySignals,
  leadCaptureSourceIdentitySignalsFromLifecyclePayload,
  leadCaptureSourceIdentitySignalsFromPayload,
  withLeadCaptureSourceCampaignIdFallback,
} from "./leadcapture-source-identity-signals.js";

const NICHOLAS_ROUTE_KEY = "LCIO_LEGACY_VET_LIFE_NICHOLAS_DAMBRUOSO_VET_FEX";
const NICHOLAS_PARENT_URL_KEY = "go.lifeinsuranceforvets.com/learn-nicholas-dambruoso";

function nicholasRaw(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(nicholasFixture)) as Record<string, unknown>;
}

test("legacy custom-domain payload keeps hostname in the page identity", () => {
  const signals = leadCaptureSourceIdentitySignalsFromPayload(
    nicholasRaw(),
    NICHOLAS_ROUTE_KEY
  );
  assert.equal(signals.parentUrlKey, NICHOLAS_PARENT_URL_KEY);
  assert.equal(signals.parentUrlHostname, "go.lifeinsuranceforvets.com");
  assert.equal(signals.parentUrlPathname, "/learn-nicholas-dambruoso");
  assert.equal(signals.routeKey, NICHOLAS_ROUTE_KEY);
});

test("query string and fragment never change the page identity", () => {
  const base = leadCaptureSourceIdentitySignalsFromPayload({
    provider: "leadcapture_io",
    parent_url: "https://go.lifeinsuranceforvets.com/learn-nicholas-dambruoso",
  });
  const withQuery = leadCaptureSourceIdentitySignalsFromPayload({
    provider: "leadcapture_io",
    parent_url:
      "https://go.lifeinsuranceforvets.com/learn-nicholas-dambruoso?utm_source=Facebook_Mobile_Reels&utm_id=120251523590960287",
  });
  const withFragment = leadCaptureSourceIdentitySignalsFromPayload({
    provider: "leadcapture_io",
    parent_url: "https://go.lifeinsuranceforvets.com/learn-nicholas-dambruoso#form",
  });
  assert.equal(base.parentUrlKey, NICHOLAS_PARENT_URL_KEY);
  assert.equal(withQuery.parentUrlKey, NICHOLAS_PARENT_URL_KEY);
  assert.equal(withFragment.parentUrlKey, NICHOLAS_PARENT_URL_KEY);
});

test("trailing slash and host casing normalize to the same page identity", () => {
  const signals = leadCaptureSourceIdentitySignalsFromPayload({
    provider: "leadcapture_io",
    parent_url: "https://GO.LifeInsuranceForVets.com/learn-nicholas-dambruoso/?v=9",
  });
  assert.equal(signals.parentUrlKey, NICHOLAS_PARENT_URL_KEY);
});

test("a custom domain never exposes a hosted page slug", () => {
  const custom = leadCaptureSourceIdentitySignalsFromPayload({
    provider: "leadcapture_io",
    parent_url: "https://go.lifeinsuranceforvets.com/learn-nicholas-dambruoso",
  });
  assert.equal(custom.hostedPageSlug, null);

  const hosted = leadCaptureSourceIdentitySignalsFromPayload({
    provider: "leadcapture_io",
    parent_url: "https://my.leadcapture.io/p/dn_omzoj?v=1789074011990",
  });
  assert.equal(hosted.parentUrlKey, "my.leadcapture.io/p/dn_omzoj");
  assert.equal(hosted.hostedPageSlug, "dn_omzoj");
});

test("legacy lead_form is collected as a provider form id even when numeric", () => {
  const signals = leadCaptureSourceIdentitySignalsFromPayload(nicholasRaw());
  assert.deepEqual(signals.providerFormIds, ["24133"]);
});

test("provider form ids keep funnel_id → form_id → sa360_form_id → lead_form precedence", () => {
  const signals = leadCaptureSourceIdentitySignalsFromPayload({
    provider: "leadcapture_io",
    funnel_id: "f-1",
    form_id: "f-2",
    sa360_form_id: "f-3",
    lead_form: "24133",
  });
  assert.deepEqual(signals.providerFormIds, ["f-1", "f-2", "f-3", "24133"]);
});

test("nested answers supply parent_url and lead_form", () => {
  const signals = leadCaptureSourceIdentitySignalsFromPayload({
    provider: "leadcapture_io",
    answers: {
      parent_url: "https://go.lifeinsuranceforvets.com/learn-nicholas-dambruoso?utm_source=x",
      lead_form: "24133",
    },
  });
  assert.equal(signals.parentUrlKey, NICHOLAS_PARENT_URL_KEY);
  assert.deepEqual(signals.providerFormIds, ["24133"]);
});

test("Legacy native form envelope supplies exact provider and custom-domain page identity", () => {
  const signals = leadCaptureSourceIdentitySignalsFromPayload({
    form: {
      lead_form: 24133,
      parent_url:
        "https://GO.LifeInsuranceForVets.com/learn-nicholas-dambruoso/?utm_source=x#form",
    },
  });
  assert.deepEqual(signals.providerFormIds, ["24133"]);
  assert.equal(signals.parentUrlKey, NICHOLAS_PARENT_URL_KEY);
  assert.equal(signals.parentUrlHostname, "go.lifeinsuranceforvets.com");
  assert.equal(signals.parentUrlPathname, "/learn-nicholas-dambruoso");
  assert.equal(signals.hostedPageSlug, null);
});

test("payloads without a page or form identity report no usable signals", () => {
  const signals = leadCaptureSourceIdentitySignalsFromPayload({
    provider: "leadcapture_io",
    sa360_route_key: NICHOLAS_ROUTE_KEY,
  });
  assert.equal(signals.parentUrlKey, null);
  assert.deepEqual(signals.providerFormIds, []);
  assert.equal(hasLeadCaptureSourceIdentitySignals(signals), false);
});

test("the legacy normalizer materializes the page identity into source_intake", () => {
  const normalized = normalizeLeadCaptureIoWebhookToLifecyclePayload(
    materializeLeadCapturePayload(nicholasRaw()),
    { routeKeyFromPath: NICHOLAS_ROUTE_KEY }
  );
  const sourceIntake = (normalized.routing as Record<string, unknown>).source_intake as Record<
    string,
    unknown
  >;
  assert.equal(sourceIntake.parent_url_key, NICHOLAS_PARENT_URL_KEY);
  assert.equal(sourceIntake.parent_url_hostname, "go.lifeinsuranceforvets.com");
  assert.equal(sourceIntake.parent_url_pathname, "/learn-nicholas-dambruoso");
  assert.equal(sourceIntake.hosted_page_slug, undefined);
  assert.equal(sourceIntake.lead_form, "24133");
});

test("signals round-trip out of a persisted normalized payload", () => {
  const normalized = normalizeLeadCaptureIoWebhookToLifecyclePayload(nicholasRaw(), {
    routeKeyFromPath: NICHOLAS_ROUTE_KEY,
  });
  const signals = leadCaptureSourceIdentitySignalsFromLifecyclePayload(normalized);
  assert.equal(signals.parentUrlKey, NICHOLAS_PARENT_URL_KEY);
  assert.equal(signals.routeKey, NICHOLAS_ROUTE_KEY);
  assert.deepEqual(signals.providerFormIds, ["24133"]);
});

test("a payload normalized before parent_url_key existed still resolves from sourceAttributes", () => {
  const signals = leadCaptureSourceIdentitySignalsFromLifecyclePayload({
    schema_version: "MASTER 2.0",
    client_account_id: "leadcapture_io",
    contact: { lead_uid: "legacy-1" },
    state: { lifecycle_stage: "NEW" },
    event: {
      event_uuid: "evt-1",
      event_name_internal: "lead_created",
      event_name_meta: "Lead",
    },
    routing: {
      source_intake: {
        source_route_key: NICHOLAS_ROUTE_KEY,
        sourceAttributes: {
          parent_url:
            "https://go.lifeinsuranceforvets.com/learn-nicholas-dambruoso?utm_source=Facebook_Mobile_Reels",
        },
      },
    },
  });
  assert.equal(signals.parentUrlKey, NICHOLAS_PARENT_URL_KEY);
});

test("sourceCampaignId fallback adds a form id candidate and a page identity", () => {
  const fromUuid = withLeadCaptureSourceCampaignIdFallback(
    leadCaptureSourceIdentitySignalsFromPayload({ provider: "leadcapture_io" }),
    "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeee0311"
  );
  assert.deepEqual(fromUuid.providerFormIds, ["aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeee0311"]);
  assert.equal(fromUuid.parentUrlKey, null);

  const fromParentUrlKey = withLeadCaptureSourceCampaignIdFallback(
    leadCaptureSourceIdentitySignalsFromPayload({ provider: "leadcapture_io" }),
    "my.leadcapture.io/p/dn_omzoj"
  );
  assert.equal(fromParentUrlKey.parentUrlKey, "my.leadcapture.io/p/dn_omzoj");
  assert.equal(fromParentUrlKey.hostedPageSlug, "dn_omzoj");

  const fromRouteKey = withLeadCaptureSourceCampaignIdFallback(
    leadCaptureSourceIdentitySignalsFromPayload({ provider: "leadcapture_io" }),
    NICHOLAS_ROUTE_KEY
  );
  assert.equal(fromRouteKey.parentUrlKey, null);
  assert.deepEqual(fromRouteKey.providerFormIds, [NICHOLAS_ROUTE_KEY]);
});

test("an explicit page identity is never replaced by the sourceCampaignId fallback", () => {
  const signals = withLeadCaptureSourceCampaignIdFallback(
    leadCaptureSourceIdentitySignalsFromPayload(nicholasRaw()),
    "my.leadcapture.io/p/dn_omzoj"
  );
  assert.equal(signals.parentUrlKey, NICHOLAS_PARENT_URL_KEY);
  assert.equal(signals.hostedPageSlug, null);
});
