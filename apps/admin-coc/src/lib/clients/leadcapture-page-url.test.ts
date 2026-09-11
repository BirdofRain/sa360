import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  LEADCAPTURE_CUSTOM_DOMAIN_SLUG_MULTIPLE_HOSTS,
  LEADCAPTURE_CUSTOM_DOMAIN_SLUG_USE_FULL_URL,
  LEADCAPTURE_HOSTED_PAGE_HOST,
  LEADCAPTURE_SOURCES_CUSTOM_DOMAIN_REQUIRED,
  LEADCAPTURE_SOURCES_CUSTOM_EXAMPLE_URL,
  LEADCAPTURE_SOURCES_HELPER_PRIMARY,
  customDomainHostsForPageSlug,
  normalizeLeadCapturePageUrlOrSlug,
  previewLeadCaptureAssociateInput,
} from "./leadcapture-page-url.ts";

test("helper copy requires the full URL for custom-domain pages", () => {
  assert.match(LEADCAPTURE_SOURCES_HELPER_PRIMARY, /full LeadCapture page URL/);
  assert.match(LEADCAPTURE_SOURCES_HELPER_PRIMARY, /my\.leadcapture\.io pages/);
  assert.match(LEADCAPTURE_SOURCES_HELPER_PRIMARY, /page slug/);
  assert.equal(LEADCAPTURE_SOURCES_CUSTOM_DOMAIN_REQUIRED, "Custom-domain pages must use the full URL.");
  assert.doesNotMatch(LEADCAPTURE_SOURCES_HELPER_PRIMARY, /custom-domain pages, you may also enter only/i);
  assert.match(LEADCAPTURE_SOURCES_CUSTOM_EXAMPLE_URL, /^https:\/\//);
});

test("bare slug previews the standard hosted identity", () => {
  const madison = previewLeadCaptureAssociateInput("dn_omzoj");
  assert.equal(madison.kind, "slug");
  if (madison.kind === "slug") {
    assert.equal(madison.parentUrlKey, "my.leadcapture.io/p/dn_omzoj");
    assert.equal(madison.pageSlug, "dn_omzoj");
  }

  const copy = previewLeadCaptureAssociateInput("  6rci-usi  ");
  assert.equal(copy.kind, "slug");
  if (copy.kind === "slug") {
    assert.equal(copy.parentUrlKey, `${LEADCAPTURE_HOSTED_PAGE_HOST}/p/6rci-usi`);
  }

  const customSlug = previewLeadCaptureAssociateInput("learn-andru-duranso");
  assert.equal(customSlug.kind, "slug");
  if (customSlug.kind === "slug") {
    assert.equal(customSlug.parentUrlKey, "my.leadcapture.io/p/learn-andru-duranso");
  }
});

test("custom-domain full URL previews hostname + path identity", () => {
  const preview = previewLeadCaptureAssociateInput(
    "https://healthcareworker.familylegacyprotection.com/learn-andru-duranso"
  );
  assert.equal(preview.kind, "url");
  if (preview.kind === "url") {
    assert.equal(
      preview.parentUrlKey,
      "healthcareworker.familylegacyprotection.com/learn-andru-duranso"
    );
    assert.equal(preview.hostname, "healthcareworker.familylegacyprotection.com");
    assert.equal(preview.pageSlug, "learn-andru-duranso");
  }
});

test("query string is stripped from the preview identity", () => {
  const preview = previewLeadCaptureAssociateInput(
    "https://healthcareworker.familylegacyprotection.com/learn-andru-duranso?v=123"
  );
  assert.equal(preview.kind, "url");
  if (preview.kind === "url") {
    assert.equal(
      preview.parentUrlKey,
      "healthcareworker.familylegacyprotection.com/learn-andru-duranso"
    );
    assert.doesNotMatch(preview.parentUrlKey, /\?/);
    assert.doesNotMatch(preview.parentUrlKey, /v=123/);
  }

  const hosted = previewLeadCaptureAssociateInput(
    "https://my.leadcapture.io/p/dn_omzoj?v=1789074011990"
  );
  assert.equal(hosted.kind, "url");
  if (hosted.kind === "url") {
    assert.equal(hosted.parentUrlKey, "my.leadcapture.io/p/dn_omzoj");
  }
});

test("preview reuses the same slug-to-hosted-page rule as the API normalizer", () => {
  const fromSlug = normalizeLeadCapturePageUrlOrSlug("dn_omzoj");
  const fromUrl = normalizeLeadCapturePageUrlOrSlug(
    "https://my.leadcapture.io/p/dn_omzoj?v=anything"
  );
  assert.equal(fromSlug?.parentUrlKey, "my.leadcapture.io/p/dn_omzoj");
  assert.equal(fromUrl?.parentUrlKey, fromSlug?.parentUrlKey);
  assert.equal(normalizeLeadCapturePageUrlOrSlug("learn-andru-duranso")?.parentUrlKey, "my.leadcapture.io/p/learn-andru-duranso");
  assert.equal(
    normalizeLeadCapturePageUrlOrSlug(
      "https://healthcareworker.familylegacyprotection.com/learn-andru-duranso?v=123"
    )?.parentUrlKey,
    "healthcareworker.familylegacyprotection.com/learn-andru-duranso"
  );
});

test("observed custom-domain same slug warns and does not substitute identity", () => {
  const hosts = customDomainHostsForPageSlug("learn-andru-duranso", [
    {
      pageSlug: "learn-andru-duranso",
      parentUrlKey: "healthcareworker.familylegacyprotection.com/learn-andru-duranso",
    },
    {
      pageSlug: "learn-andru-duranso",
      parentUrlKey: "my.leadcapture.io/p/learn-andru-duranso",
    },
  ]);
  assert.deepEqual(hosts, ["healthcareworker.familylegacyprotection.com"]);
  assert.equal(
    LEADCAPTURE_CUSTOM_DOMAIN_SLUG_USE_FULL_URL,
    "Use the full page URL to associate that source."
  );

  const preview = previewLeadCaptureAssociateInput("learn-andru-duranso");
  assert.equal(preview.kind, "slug");
  if (preview.kind === "slug") {
    assert.equal(preview.parentUrlKey, "my.leadcapture.io/p/learn-andru-duranso");
    assert.notEqual(preview.parentUrlKey, "healthcareworker.familylegacyprotection.com/learn-andru-duranso");
  }
});

test("multiple observed custom-domain hosts for the same slug require a full URL", () => {
  const hosts = customDomainHostsForPageSlug("shared-slug", [
    { pageSlug: "shared-slug", parentUrlKey: "alpha.example.com/shared-slug" },
    { pageSlug: "shared-slug", parentUrlKey: "beta.example.com/p/shared-slug" },
  ]);
  assert.deepEqual(hosts, ["alpha.example.com", "beta.example.com"]);
  assert.match(LEADCAPTURE_CUSTOM_DOMAIN_SLUG_MULTIPLE_HOSTS, /more than one host/);
  assert.match(LEADCAPTURE_CUSTOM_DOMAIN_SLUG_MULTIPLE_HOSTS, /full page URL/);
});

test("admin preview helper stays aligned with the API #135 normalizer comments", () => {
  const apiPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../../api/src/services/source-intake/leadcapture-parent-url.ts"
  );
  const api = fs.readFileSync(apiPath, "utf8");
  assert.match(api, /export const LEADCAPTURE_HOSTED_PAGE_HOST = "my\.leadcapture\.io"/);
  assert.match(api, /Slug-only values become my\.leadcapture\.io\/p\/\{slug\}/);
  assert.doesNotMatch(api, /infer a ClientAccount from the URL/);
});
