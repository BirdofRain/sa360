import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { normalizeSourceFieldKey } from "./source-field-alias.registry.js";
import {
  applyLeadCaptureEndpointDefaults,
  coerceLeadCaptureLeadIdValue,
  materializeLeadCapturePayload,
  resolveLeadCaptureField,
  resolveLeadCaptureLeadId,
  resolveLeadCaptureRouteKey,
  resolveLegacySubmittedAt,
  splitLeadCaptureFullName,
} from "./leadcapture-payload-resolver.js";
import { normalizeLeadCaptureIoWebhookToLifecyclePayload } from "./leadcapture-io-normalizer.js";
import { extractSourceAttributesFromPayload } from "./source-attribute-extractor.service.js";
import { validateLeadCaptureWebhookAuth } from "../../lib/leadcapture-webhook-auth.js";
import { deriveIntakeStatus, resolvePreviewRouteMatched } from "./source-enrichment.service.js";
import { extractRoutingAttributionFromPayload } from "../../lib/routing-attribution-extract.js";
import { matchCampaignRoutingRule } from "../routing-matcher.service.js";
import type { CampaignRoutingRule } from "@prisma/client";

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "../../fixtures/leadcaptureio");

function loadFixture(name: string) {
  return JSON.parse(readFileSync(join(fixtureDir, name), "utf8")) as Record<string, unknown>;
}

function basicAuthHeader(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`;
}

test("nested answers.lead_id is extracted", () => {
  const raw = loadFixture("leadcaptureio-webhook-sample-legacy-nested.json");
  const { leadId, sourceLeadIdGenerated } = resolveLeadCaptureLeadId(
    raw,
    "LCIO_LEGACY_VET_LIFE_JAMES_TORREY_VET_FEX"
  );
  assert.equal(leadId, "jt-legacy-dryrun-002");
  assert.equal(sourceLeadIdGenerated, false);
});

test("nested name/phone/email are normalized into contact", () => {
  const raw = loadFixture("leadcaptureio-webhook-sample-legacy-nested.json");
  const normalized = normalizeLeadCaptureIoWebhookToLifecyclePayload(raw);
  assert.equal(normalized.contact.first_name, "JamesDryRun");
  assert.equal(normalized.contact.last_name, "LeadTest002");
  assert.equal(normalized.contact.email, "sa360test+jt-legacy-dryrun-002@lifeagentlaunch.com");
  assert.equal(normalized.contact.phone_e164, "+15550103902");
  assert.equal(normalized.contact.state, "NC");
  assert.equal(
    normalized.contact.lead_uid,
    "leadcaptureio-leadcapture_io_legacy-jt-legacy-dryrun-002"
  );
});

test("nested survey fields become canonical sourceAttributes", () => {
  const raw = loadFixture("leadcaptureio-webhook-sample-legacy-nested.json");
  const normalized = normalizeLeadCaptureIoWebhookToLifecyclePayload(raw);
  const routing = normalized.routing as Record<string, unknown>;
  const intake = routing.source_intake as Record<string, unknown>;
  const attrs = intake.sourceAttributes as Record<string, unknown>;
  assert.equal(attrs.branch_of_service, "Army");
  assert.equal(attrs.desired_coverage, "$100,000+");
  assert.equal(attrs.best_time_to_call, "Afternoon");
  assert.equal(attrs.beneficiary, "Spouse");
  assert.equal(attrs.marital_status, "Married");
});

test("generated fallback identity is stable when lead_id is absent", () => {
  const raw = {
    provider: "leadcapture_io",
    sa360_source_platform: "leadcapture_io",
    sa360_route_key: "LC_TEST",
    answers: {
      email: "stable@example.test",
      phone: "+15550101001",
      submitted_at: "2026-06-16T12:00:00.000Z",
    },
  };
  const a = resolveLeadCaptureLeadId(raw, "LC_TEST");
  const b = resolveLeadCaptureLeadId(raw, "LC_TEST");
  assert.equal(a.sourceLeadIdGenerated, true);
  assert.equal(a.leadId, b.leadId);
  assert.match(a.leadId, /^gen-[a-f0-9]{16}$/);
  assert.notEqual(a.leadId, "unknown_lead");
});

test("no literal unknown_lead collision for nested payload", () => {
  const raw = loadFixture("leadcaptureio-webhook-sample-legacy-nested.json");
  const normalized = normalizeLeadCaptureIoWebhookToLifecyclePayload(raw);
  assert.notEqual(normalized.contact.lead_uid, "leadcaptureio-leadcapture_io_legacy-unknown_lead");
  const intake = (normalized.routing as Record<string, unknown>).source_intake as Record<string, unknown>;
  assert.notEqual(intake.lead_id, "unknown_lead");
});

test("route key from path overrides body sa360_route_key", () => {
  const raw = {
    provider: "leadcapture_io",
    sa360_route_key: "BODY_ROUTE",
    answers: { lead_id: "path-route-001", first_name: "Path", phone: "+15550101002" },
  };
  const effective = materializeLeadCapturePayload(raw, {
    routeKeyFromPath: "LCIO_LEGACY_VET_LIFE_JAMES_TORREY_VET_FEX",
  });
  assert.equal(effective.sa360_route_key, "LCIO_LEGACY_VET_LIFE_JAMES_TORREY_VET_FEX");
  assert.equal(
    resolveLeadCaptureRouteKey(raw, "LCIO_LEGACY_VET_LIFE_JAMES_TORREY_VET_FEX"),
    "LCIO_LEGACY_VET_LIFE_JAMES_TORREY_VET_FEX"
  );
  assert.equal(resolveLeadCaptureField(raw, "lead_id"), "path-route-001");
});

test("numeric lead_id coerces to string without fallback generation", () => {
  const raw = { ref_id: 4654378, name: "Test User", phone: "+15550101001" };
  assert.equal(coerceLeadCaptureLeadIdValue(4654378), "4654378");
  const { leadId, sourceLeadIdGenerated } = resolveLeadCaptureLeadId(
    raw,
    "LCIO_LEGACY_VET_LIFE_JAMES_TORREY_VET_FEX"
  );
  assert.equal(leadId, "4654378");
  assert.equal(sourceLeadIdGenerated, false);
});

test("native legacy form payload normalizes identity, survey, and route defaults", () => {
  const routeKey = "LCIO_LEGACY_VET_LIFE_JAMES_TORREY_VET_FEX";
  const raw = applyLeadCaptureEndpointDefaults(
    loadFixture("leadcaptureio-webhook-sample-legacy-native-form.json"),
    routeKey
  );
  assert.equal(raw.provider, "leadcapture_io");
  assert.equal(raw.sa360_source_system, "leadcapture_io_legacy");
  assert.equal(raw.sa360_source_type, "leadcapture_form");
  assert.equal(raw.sa360_route_key, routeKey);

  const { leadId, sourceLeadIdGenerated } = resolveLeadCaptureLeadId(raw, routeKey);
  assert.equal(leadId, "4652453");
  assert.equal(sourceLeadIdGenerated, false);

  const normalized = normalizeLeadCaptureIoWebhookToLifecyclePayload(raw, { routeKeyFromPath: routeKey });
  assert.equal(normalized.contact.first_name, "Reece");
  assert.equal(normalized.contact.last_name, "Gilmore");
  assert.equal(normalized.contact.phone_e164, "+19416617578");
  assert.equal(normalized.contact.email, "reece.gilmore@example.test");
  assert.equal(normalized.contact.state, "Florida");
  assert.equal(normalized.contact.lead_uid, "leadcaptureio-leadcapture_io_legacy-4652453");
  assert.equal(normalized.contact.contact_id_ghl, undefined);

  const intake = (normalized.routing as Record<string, unknown>).source_intake as Record<string, unknown>;
  const attrs = intake.sourceAttributes as Record<string, unknown>;
  assert.equal(attrs.branch_of_service, "Army");
  assert.equal(attrs.best_time_to_call, "Evening");
  assert.equal(attrs.military_status, "Disabled Veteran");
  assert.equal(attrs.age, 80);
  assert.equal(attrs.desired_coverage, "$25001 - $50000");
});

test("native form route key matches James Torrey campaign rule", () => {
  const routeKey = "LCIO_LEGACY_VET_LIFE_JAMES_TORREY_VET_FEX";
  const raw = applyLeadCaptureEndpointDefaults(
    loadFixture("leadcaptureio-webhook-sample-legacy-native-form.json"),
    routeKey
  );
  const normalized = normalizeLeadCaptureIoWebhookToLifecyclePayload(raw, { routeKeyFromPath: routeKey });
  const attribution = extractRoutingAttributionFromPayload(normalized);
  const now = new Date("2026-06-16T12:00:00.000Z");
  const jamesRule = {
    id: "cmqfuqy9t004an30uyq6li19k",
    matchType: "campaign_id",
    clientAccountId: "vet_life_james_torrey",
    campaignId: routeKey,
    destinationSubaccountIdGhl: "9xSNvQCbGaPE9YNxgl4B",
    priority: 100,
    active: true,
    masterClientAccountId: "leadcapture_io",
  } as CampaignRoutingRule;
  const result = matchCampaignRoutingRule([jamesRule], attribution, now);
  assert.equal(result.matched, true);
  assert.equal(result.matchedRuleId, "cmqfuqy9t004an30uyq6li19k");
  assert.equal(result.destinationClientAccountId, "vet_life_james_torrey");
  assert.equal(result.destinationSubaccountIdGhl, "9xSNvQCbGaPE9YNxgl4B");
});

test("preview route matched uses persisted routing result when identity blocks intake status", () => {
  const intakeStatus = deriveIntakeStatus("needs_review", false, true);
  assert.equal(intakeStatus, "invalid_identity");
  assert.equal(resolvePreviewRouteMatched(true, intakeStatus), true);
  assert.equal(resolvePreviewRouteMatched(false, "routing_unmatched"), false);
});

test("normalizeSourceFieldKey converts spaced attribution keys", () => {
  assert.equal(normalizeSourceFieldKey("ad id"), "ad_id");
  assert.equal(normalizeSourceFieldKey("adset name"), "adset_name");
  assert.equal(normalizeSourceFieldKey("utm_campaign"), "utm_campaign");
});

test("splitLeadCaptureFullName splits first and last safely", () => {
  assert.deepEqual(splitLeadCaptureFullName("James LegacyTest"), {
    first_name: "James",
    last_name: "LegacyTest",
  });
});

test("legacy real-format aliases resolve identity and enrichment", () => {
  const raw = loadFixture("leadcaptureio-webhook-sample-legacy-real-aliases.json");
  const { leadId, sourceLeadIdGenerated } = resolveLeadCaptureLeadId(
    raw,
    "LCIO_LEGACY_VET_LIFE_JAMES_TORREY_VET_FEX"
  );
  assert.equal(leadId, "jt-legacy-e2e-20260616-112541");
  assert.equal(sourceLeadIdGenerated, false);

  const normalized = normalizeLeadCaptureIoWebhookToLifecyclePayload(raw);
  assert.equal(normalized.contact.first_name, "James");
  assert.equal(normalized.contact.last_name, "LegacyTest");
  assert.equal(normalized.contact.phone_e164, "+15550103903");
  assert.equal(
    normalized.contact.email,
    "sa360test+jt-legacy-e2e-20260616-112541@lifeagentlaunch.com"
  );
  assert.equal(normalized.contact.state, "North Carolina");
  assert.equal(
    normalized.contact.lead_uid,
    "leadcaptureio-leadcapture_io_legacy-jt-legacy-e2e-20260616-112541"
  );

  const intake = (normalized.routing as Record<string, unknown>).source_intake as Record<string, unknown>;
  const attrs = intake.sourceAttributes as Record<string, unknown>;
  assert.equal(attrs.branch_of_service, "Army");
  assert.equal(attrs.best_time_to_call, "Afternoon");
  assert.equal(attrs.military_status, "Disabled Veteran");
  assert.equal(attrs.marital_status, "Married");
  assert.equal(attrs.desired_coverage, "$25,001 - $50,000");
  assert.equal(attrs.applied_for_other_insurance, "No");
  assert.equal(attrs.age, 62);
  assert.equal(attrs.placement, "Facebook_Mobile_Feed");
  assert.equal(attrs.ad_id, "120235027296790436");
  assert.equal(attrs.ad_name, "SA360 Legacy E2E Test");
  assert.equal(attrs.adset_id, "120235026513870436");
  assert.equal(attrs.adset_name, "Veteran Final Expense Test");
  assert.equal(attrs.date_of_birth, undefined);

  assert.equal(normalized.attribution?.utm_campaign, "James Torrey - VET FEX Web Leads - SA360 Test");
  assert.equal(normalized.attribution?.ad_id, "120235027296790436");
});

test("legacy date and time become submitted_at but not date_of_birth", () => {
  const raw = loadFixture("leadcaptureio-webhook-sample-legacy-real-aliases.json");
  const submittedAt = resolveLegacySubmittedAt(raw);
  assert.equal(submittedAt, "2026-06-16T11:25:41.000Z");

  const extraction = extractSourceAttributesFromPayload(raw, {
    sourceSystem: "leadcapture_io_legacy",
    receivedAt: submittedAt ?? new Date().toISOString(),
  });
  assert.equal(extraction.sourceAttributes.date_of_birth, undefined);
  assert.equal(extraction.unmappedSourceFieldKeys.includes("preferred_language"), true);
});

test("enrichment extractor auto-materializes leadcapture answers without explicit materialized input", () => {
  const raw = loadFixture("leadcaptureio-webhook-sample-legacy-real-aliases.json");
  const extraction = extractSourceAttributesFromPayload(raw, {
    sourceSystem: "leadcapture_io_legacy",
    receivedAt: new Date().toISOString(),
  });
  assert.equal(extraction.sourceAttributes.branch_of_service, "Army");
  assert.equal(extraction.sourceAttributes.ad_id, "120235027296790436");
  assert.ok(extraction.unmappedSourceFieldKeys.includes("preferred_language"));
});

test("Basic Auth still passes after alias resolver changes", () => {
  const prevSecret = process.env.SA360_LEADCAPTURE_WEBHOOK_SECRET;
  process.env.SA360_LEADCAPTURE_WEBHOOK_SECRET = "alias-test-secret";
  const result = validateLeadCaptureWebhookAuth({
    authorizationHeader: basicAuthHeader("sa360-leadcapture", "alias-test-secret"),
  });
  assert.equal(result.ok, true);
  if (prevSecret !== undefined) process.env.SA360_LEADCAPTURE_WEBHOOK_SECRET = prevSecret;
  else delete process.env.SA360_LEADCAPTURE_WEBHOOK_SECRET;
});
