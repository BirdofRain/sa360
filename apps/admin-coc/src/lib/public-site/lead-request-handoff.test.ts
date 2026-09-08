import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";

import { buildPortalOrderRequestCatalogs } from "@/lib/client-portal/portal-order-request";

import {
  applyPublicLeadPrefillToDraft,
  isGenericPortalDashboardNext,
  parsePublicLeadPrefillFromFormData,
  parsePublicLeadPrefillInput,
  publicLeadPrefillHasValues,
  publicLeadPrefillNextPath,
  publicPreviewRegisterHref,
  publicRegisterPathFromPrefill,
  publicSetupPathFromPrefill,
  readPublicLeadPrefill,
  serializePublicLeadPrefillQuery,
  writePublicLeadPrefill,
  clearPublicLeadPrefill,
} from "./lead-request-handoff.ts";
import { createEmptyPublicLeadPreviewDraft, publicPreviewContinueHref } from "./lead-request-preview.ts";

beforeEach(() => {
  sessionStorage.clear();
});

function catalogs(overrides?: Parameters<typeof buildPortalOrderRequestCatalogs>[0]) {
  return buildPortalOrderRequestCatalogs({
    primaryNicheKeys: ["vet"],
    primaryProductTypes: ["exclusive"],
    displayName: "Valley Vet",
    ...overrides,
  });
}

test("continue href encodes allowlisted preview values only", () => {
  const href = publicPreviewContinueHref({
    states: ["TX", "FL"],
    quantity: 250,
    freshnessId: "aged-30-90",
  });
  const next = new URL(href, "https://example.test").searchParams.get("next");
  assert.ok(next);
  const orderUrl = new URL(next, "https://example.test");
  assert.equal(orderUrl.pathname, "/portal/orders/new");
  assert.equal(orderUrl.searchParams.get("states"), "TX,FL");
  assert.equal(orderUrl.searchParams.get("qty"), "250");
  assert.equal(orderUrl.searchParams.get("freshness"), "aged-30-90");
  assert.equal(orderUrl.searchParams.get("niche"), "vet");
  assert.equal(orderUrl.searchParams.get("crmPackage"), null);
  assert.equal(href.includes("GHL"), false);
});

test("parser keeps customer-facing values and drops SKUs and unsupported fields", () => {
  const parsed = parsePublicLeadPrefillInput({
    states: "TX,ZZ,FL,not-a-state",
    qty: "250",
    freshness: "aged-90-plus",
    niche: "Veteran",
    crmPackage: "GHL Starter",
    sku: "GHL Pro",
    campaignType: "Live transfer",
    status: "active",
    clientAccountId: "acct_other",
  });
  assert.deepEqual(parsed.states, ["TX", "FL"]);
  assert.equal(parsed.quantity, 250);
  assert.equal(parsed.freshnessId, "aged-90-plus");
  assert.equal(parsed.nicheKey, "vet");
  assert.ok(parsed.dropped.includes("crmPackage"));
  assert.ok(parsed.dropped.includes("sku"));
  assert.ok(parsed.dropped.includes("campaignType"));
  assert.ok(parsed.dropped.includes("status"));
  assert.ok(parsed.dropped.includes("clientAccountId"));
  const qs = publicLeadPrefillNextPath(parsed);
  assert.equal(qs.includes("crmPackage"), false);
  assert.equal(qs.includes("GHL"), false);
  assert.match(qs, /freshness=aged-90-plus/);
});

test("parser rejects unknown freshness, non-Veteran niche, and bad quantity", () => {
  const parsed = parsePublicLeadPrefillInput({
    states: "TX",
    qty: "nope",
    freshness: "live-transfer",
    niche: "trucker",
  });
  assert.deepEqual(parsed.states, ["TX"]);
  assert.equal(parsed.quantity, null);
  assert.equal(parsed.freshnessId, null);
  assert.equal(parsed.nicheKey, null);
  assert.ok(parsed.dropped.includes("qty"));
  assert.ok(parsed.dropped.includes("freshness"));
  assert.ok(parsed.dropped.includes("niche"));
});

test("apply maps freshness onto campaignType and age-bucket notes without a CRM SKU", () => {
  const catalog = catalogs();
  const applied = applyPublicLeadPrefillToDraft(
    catalog,
    parsePublicLeadPrefillInput({
      states: "OH,PA",
      qty: "50",
      freshness: "aged-30-90",
      niche: "vet",
    })
  );
  assert.equal(applied.applied, true);
  assert.deepEqual(applied.draft.states, ["OH", "PA"]);
  assert.equal(applied.draft.leadVolume, 50);
  assert.equal(applied.draft.nicheKey, "vet");
  assert.equal(applied.draft.campaignType, "Aged leads");
  assert.match(applied.draft.notes, /30–90 days/);
  assert.equal(applied.draft.crmPackage, "lead_delivery");
  assert.equal(applied.draft.crmPackage.includes("GHL"), false);
});

test("Veteran niche is dropped when the account catalog does not include it", () => {
  const catalog = catalogs({ primaryNicheKeys: ["hvac"] });
  const applied = applyPublicLeadPrefillToDraft(
    catalog,
    parsePublicLeadPrefillInput({
      states: "TX",
      qty: "100",
      freshness: "fresh",
      niche: "vet",
    })
  );
  assert.equal(applied.draft.nicheKey, "hvac");
  assert.ok(applied.dropped.includes("niche"));
  assert.equal(applied.draft.campaignType, "Fresh leads");
});

test("sessionStorage round-trip ignores a planted CRM SKU", () => {
  writePublicLeadPrefill({
    states: ["CA"],
    quantity: 500,
    freshnessId: "fresh",
  });
  const stored = readPublicLeadPrefill();
  assert.equal(publicLeadPrefillHasValues(stored), true);
  assert.deepEqual(stored.states, ["CA"]);
  assert.equal(stored.quantity, 500);
  assert.equal(stored.freshnessId, "fresh");
  assert.equal(stored.nicheKey, "vet");
  globalThis.sessionStorage.setItem(
    "sa360.agedvet.lead-prefill.v1",
    JSON.stringify({
      v: 1,
      states: ["TX"],
      quantity: 10,
      freshnessId: "fresh",
      crmPackage: "GHL Pro",
    })
  );
  const rejected = readPublicLeadPrefill();
  assert.equal(publicLeadPrefillHasValues(rejected), false);
  clearPublicLeadPrefill();
});

test("generic dashboard next is the only login upgrade candidate", () => {
  assert.equal(isGenericPortalDashboardNext("/portal"), true);
  assert.equal(isGenericPortalDashboardNext("/portal/orders/new"), false);
  assert.equal(isGenericPortalDashboardNext("/portal?range=7d"), false);
});

test("serialize never emits unsupported keys", () => {
  const qs = serializePublicLeadPrefillQuery(createEmptyPublicLeadPreviewDraft());
  assert.equal(qs.includes("crmPackage"), false);
  assert.equal(qs.includes("campaignType"), false);
  assert.match(qs, /niche=vet/);
});

test("register and setup paths keep allowlisted query and drop planted CRM", () => {
  const href = publicPreviewRegisterHref({
    states: ["TX", "FL"],
    quantity: 100,
    freshnessId: "aged-30-90",
  });
  assert.match(href, /^\/get-started\/register\?/);
  const form = new FormData();
  form.set("states", "TX,ZZ");
  form.set("qty", "100");
  form.set("freshness", "aged-30-90");
  form.set("niche", "vet");
  form.set("crmPackage", "GHL Starter");
  const parsed = parsePublicLeadPrefillFromFormData(form);
  assert.deepEqual(parsed.states, ["TX"]);
  assert.ok(parsed.dropped.includes("crmPackage"));
  const setup = publicSetupPathFromPrefill(parsed);
  assert.equal(new URL(setup, "https://example.test").pathname, "/get-started/setup");
  assert.equal(setup.includes("crmPackage"), false);
  assert.equal(publicRegisterPathFromPrefill(parsed).includes("sku"), false);
});
