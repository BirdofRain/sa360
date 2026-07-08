import test from "node:test";
import assert from "node:assert/strict";
import {
  buildLeadConduitSourceLeadUid,
  extractLeadConduitFacebookFields,
  normalizeLeadConduitFacebookToLifecyclePayload,
  resolveLeadConduitReplayIdentity,
} from "./leadconduit-facebook-normalizer.js";

const MASTER = "smart_agent_360_demo_2";

test("LeadConduit normalizer maps Facebook attribution, classification, and tracking fields", () => {
  const payload = normalizeLeadConduitFacebookToLifecyclePayload(
    {
      delivery_id: "delivery_123",
      leadgen_id: "leadgen_001",
      first_name: "Alex",
      last_name: "Rivera",
      phone_number: "+1 (415) 555-0100",
      email: "alex@example.test",
      state: "TX",
      postal_code: "78701",
      submitted_at: "2026-07-08T13:00:00.000Z",
      page_id: "page_99",
      form_id: "form_123",
      form_name: "Veteran Final Expense",
      campaign_id: "cmp_1",
      campaign_name: "Campaign 1",
      adset_id: "adset_1",
      adset_name: "Adset 1",
      ad_id: "ad_1",
      ad_name: "Ad 1",
      niche_key: "VET",
      sub_niche_key: "FINAL_EXPENSE",
      angle_key: "PATRIOT",
      product_type: "Final Expense",
      fbclid: "fbclid_1",
      fbc: "fbc_1",
      fbp: "fbp_1",
      utm_source: "facebook",
      utm_medium: "lead_ad",
      utm_campaign: "summer",
      utm_content: "ad_a",
      utm_term: "vet",
      ip_address: "203.0.113.10",
      user_agent: "Mozilla/5.0",
      referrer_url: "https://example.test/landing",
      trustedform_cert_url: "https://cert.trustedform.com/abc123",
      consent_disclosure_id: "disc_1",
      consent_version: "2026-07-v1",
      consent_text: "I agree to be contacted.",
    },
    { masterClientAccountId: MASTER }
  );

  assert.equal(payload.client_account_id, MASTER);
  assert.equal(payload.contact.lead_uid, "leadconduit-facebook-leadgen_001");
  assert.equal(payload.attribution?.source_platform, "facebook");
  assert.equal(payload.attribution?.source_type, "leadconduit_facebook_lead_form");
  assert.equal(payload.attribution?.campaign_id, "cmp_1");
  assert.equal(payload.attribution?.ad_id, "ad_1");
  assert.equal((payload.routing as Record<string, unknown>).niche_key, "VET");
  const sourceIntake = (payload.routing as Record<string, unknown>).source_intake as Record<
    string,
    unknown
  >;
  const sourceAttributes = sourceIntake.sourceAttributes as Record<string, unknown>;
  assert.equal(sourceAttributes.form_id, "form_123");
  assert.equal(sourceAttributes.trustedform_cert_url, "https://cert.trustedform.com/abc123");
  assert.equal(sourceAttributes.consent_disclosure_id, "disc_1");
});

test("LeadConduit normalizer supports defensive TrustedForm alias xxTrustedFormCertUrl", () => {
  const fields = extractLeadConduitFacebookFields({
    leadgen_id: "leadgen_abc",
    xxTrustedFormCertUrl: "https://cert.trustedform.com/alias-cert",
  });
  assert.equal(fields.trustedFormCertUrl, "https://cert.trustedform.com/alias-cert");
});

test("replay identity selection prefers delivery id, then leadgen id, then source lead id", () => {
  const byDelivery = resolveLeadConduitReplayIdentity({
    delivery_id: "delivery_1",
    leadgen_id: "leadgen_1",
  });
  assert.equal(byDelivery.replayBasis, "delivery_id");

  const byLeadgen = resolveLeadConduitReplayIdentity({
    leadgen_id: "leadgen_1",
  });
  assert.equal(byLeadgen.replayBasis, "facebook_leadgen_id");

  const bySourceLead = resolveLeadConduitReplayIdentity({
    source_lead_id: "source_lead_1",
  });
  assert.equal(bySourceLead.replayBasis, "source_lead_id");

  const sourceLeadUid = buildLeadConduitSourceLeadUid(byDelivery);
  assert.match(sourceLeadUid, /^leadconduit-facebook-/);
});
