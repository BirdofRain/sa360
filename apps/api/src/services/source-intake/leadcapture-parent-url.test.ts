import test from "node:test";
import assert from "node:assert/strict";

import {
  LEADCAPTURE_HOSTED_PAGE_HOST,
  normalizeLeadCapturePageUrlOrSlug,
  normalizeLeadCaptureParentUrl,
} from "./leadcapture-parent-url.js";

test("parent_url values that differ only by ?v produce the same parentUrlKey", () => {
  const a = normalizeLeadCaptureParentUrl("https://my.leadcapture.io/p/dn_omzoj?v=1789074011990");
  const b = normalizeLeadCaptureParentUrl("https://my.leadcapture.io/p/dn_omzoj?v=123");
  const c = normalizeLeadCaptureParentUrl("https://my.leadcapture.io/p/dn_omzoj?v=999");
  assert.equal(a?.parentUrlKey, "my.leadcapture.io/p/dn_omzoj");
  assert.equal(b?.parentUrlKey, a?.parentUrlKey);
  assert.equal(c?.parentUrlKey, a?.parentUrlKey);
  assert.equal(a?.pageSlug, "dn_omzoj");
  assert.equal(a?.hostname, "my.leadcapture.io");
  assert.equal(a?.pathname, "/p/dn_omzoj");
});

test("strips fragment, trailing slash, and lowercases hostname", () => {
  const normalized = normalizeLeadCaptureParentUrl(
    "https://My.LeadCapture.io/p/dn_omzoj/?v=1#section"
  );
  assert.equal(normalized?.parentUrlKey, "my.leadcapture.io/p/dn_omzoj");
  assert.equal(normalized?.pageSlug, "dn_omzoj");
});

test("duplicated funnel page slugs remain distinct parentUrlKeys", () => {
  const original = normalizeLeadCaptureParentUrl("https://my.leadcapture.io/p/dn_omzoj?v=1");
  const duplicate = normalizeLeadCaptureParentUrl("https://my.leadcapture.io/p/6rci-usi?v=1");
  assert.equal(original?.parentUrlKey, "my.leadcapture.io/p/dn_omzoj");
  assert.equal(duplicate?.parentUrlKey, "my.leadcapture.io/p/6rci-usi");
  assert.notEqual(original?.parentUrlKey, duplicate?.parentUrlKey);
  assert.equal(original?.pageSlug, "dn_omzoj");
  assert.equal(duplicate?.pageSlug, "6rci-usi");
});

test("custom hosted domains use hostname + pathname, not pageSlug alone", () => {
  const normalized = normalizeLeadCaptureParentUrl(
    "https://funnels.agency.example/p/dn_omzoj?v=1"
  );
  assert.equal(normalized?.parentUrlKey, "funnels.agency.example/p/dn_omzoj");
  assert.equal(normalized?.pageSlug, "dn_omzoj");
  assert.notEqual(normalized?.parentUrlKey, normalized?.pageSlug);
});

test("rejects malformed, relative, and non-http parent_url values", () => {
  assert.equal(normalizeLeadCaptureParentUrl(null), null);
  assert.equal(normalizeLeadCaptureParentUrl(""), null);
  assert.equal(normalizeLeadCaptureParentUrl("dn_omzoj"), null);
  assert.equal(normalizeLeadCaptureParentUrl("/p/dn_omzoj"), null);
  assert.equal(normalizeLeadCaptureParentUrl("javascript:alert(1)"), null);
  assert.equal(normalizeLeadCaptureParentUrl("ftp://my.leadcapture.io/p/dn_omzoj"), null);
  assert.equal(normalizeLeadCaptureParentUrl("https://my.leadcapture.io/"), null);
  assert.equal(normalizeLeadCaptureParentUrl("https://my.leadcapture.io"), null);
  assert.equal(normalizeLeadCaptureParentUrl("not a url"), null);
});

test("slug-only operator input becomes the standard hosted page", () => {
  const fromSlug = normalizeLeadCapturePageUrlOrSlug("dn_omzoj");
  assert.equal(fromSlug?.parentUrlKey, `${LEADCAPTURE_HOSTED_PAGE_HOST}/p/dn_omzoj`);
  assert.equal(fromSlug?.pageSlug, "dn_omzoj");

  const fromFull = normalizeLeadCapturePageUrlOrSlug(
    "https://my.leadcapture.io/p/dn_omzoj?v=anything"
  );
  assert.equal(fromFull?.parentUrlKey, fromSlug?.parentUrlKey);
});

test("slug-only helper still rejects malformed strings", () => {
  assert.equal(normalizeLeadCapturePageUrlOrSlug(""), null);
  assert.equal(normalizeLeadCapturePageUrlOrSlug("p/dn_omzoj"), null);
  assert.equal(normalizeLeadCapturePageUrlOrSlug("my.leadcapture.io/p/dn_omzoj"), null);
  assert.equal(normalizeLeadCapturePageUrlOrSlug("../etc"), null);
});
