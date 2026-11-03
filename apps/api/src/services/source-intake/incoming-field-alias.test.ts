import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { COMPANY_SHEETS_V3_HEADER } from "@sa360/shared";

import {
  COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V2,
  COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V3,
  COMPANY_SHEETS_LEAD_HEADER_V2,
} from "../../lib/company-google-sheets-env.js";
import { projectCampaignDobAge } from "../consumer-age/campaign-dob-age.js";
import { companySheetsCampaignRowValues } from "../company-sheets-delivery/company-sheets-campaign-row.js";
import { buildSourceAttributeStampPlan } from "./source-attribute-stamp.service.js";
import { readBuyerCsvV3ZipAndAge } from "../ppl-fulfillment/buyer-lead-fields.js";
import { normalizeLeadCaptureIoWebhookToLifecyclePayload } from "./leadcapture-io-normalizer.js";
import {
  CONFIRMED_JULIA_DODGE_PARENT_URL_KEY,
  CONFIRMED_JULIA_DODGE_SOURCE_FUNNEL_ID,
  CONFIRMED_LEGACY_JAMES_TORREY_ROUTE_KEY,
  isAmbiguousIncomingFieldKey,
  normalizeSourceFieldKey,
  resolveCanonicalAttributeKey,
} from "./source-field-alias.registry.js";

const SUBMITTED_AT = "2026-11-02T18:00:00.000Z";
const JULIA_URL = `https://${CONFIRMED_JULIA_DODGE_PARENT_URL_KEY}?src=ad`;

function juliaPayload(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    provider: "leadcapture_io",
    sa360_source_system: "leadcapture_io_nextgen",
    sa360_route_key: "LCIO_NEXTGEN_VET_SYNTHETIC",
    lead_id: "11111111-2222-4333-8444-555555555555",
    submitted_at: SUBMITTED_AT,
    parent_url: JULIA_URL,
    first_name: "Pat",
    last_name: "Sample",
    email: "pat.sample@example.test",
    phone: "+15550101955",
    state: "OH",
    zip: "02139",
    ...extra,
  };
}

function intakeOf(payload: ReturnType<typeof normalizeLeadCaptureIoWebhookToLifecyclePayload>) {
  return (payload.routing as { source_intake?: Record<string, unknown> }).source_intake ?? {};
}

function attributesOf(payload: ReturnType<typeof normalizeLeadCaptureIoWebhookToLifecyclePayload>) {
  return (intakeOf(payload).sourceAttributes ?? {}) as Record<string, unknown>;
}

function detailsOf(payload: ReturnType<typeof normalizeLeadCaptureIoWebhookToLifecyclePayload>) {
  return (payload.lead_details ?? {}) as Record<string, unknown>;
}

function unmappedKeys(payload: ReturnType<typeof normalizeLeadCaptureIoWebhookToLifecyclePayload>): string[] {
  const rows = intakeOf(payload).unmappedSourceFieldsJson as Array<{ key: string }> | undefined;
  return (rows ?? []).map((row) => row.key);
}

test("scoped veteran date becomes 1955-03-13 and age 71 on 2026-11-02", () => {
  const raw = juliaPayload({ date: "03/13/1955", branch: "Navy", married: false });
  const before = structuredClone(raw);
  const normalized = normalizeLeadCaptureIoWebhookToLifecyclePayload(raw, { receivedAt: SUBMITTED_AT });
  assert.deepEqual(raw, before);
  const details = detailsOf(normalized);
  const attributes = attributesOf(normalized);
  assert.equal(details.date_of_birth, "1955-03-13");
  assert.equal(details.consumer_age, "71");
  assert.equal(details.consumer_age_provenance, "derived_from_date_of_birth");
  assert.equal(details.consumer_age_reference_date, "2026-11-02");
  assert.equal(details.consumer_age_conflict, undefined);
  assert.equal(attributes.date_of_birth, "03/13/1955");
  assert.equal(attributes.branch_of_service, "Navy");
  assert.equal(attributes.marital_status, "Not married");
  assert.equal(attributes.date, undefined);
  assert.equal(attributes.submitted_at, undefined);
  assert.equal(normalized.contact.zip, "02139");
  assert.equal(normalized.state.routing_status, "RECEIVED");
  assert.equal(normalized.event.send_to_meta, false);
  assert.equal(intakeOf(normalized).scopedFieldBindingId, "leadcapture_io_nextgen_vet_julia_dodge");

  const projected = projectCampaignDobAge({ normalizedPayload: normalized, receivedAt: SUBMITTED_AT });
  assert.equal(projected.age, "71");
  assert.equal(projected.dateOfBirth, "1955-03-13");
  assert.equal(projected.conflict, false);

  const v2 = companySheetsCampaignRowValues({
    schemaVersion: COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V2,
    stableRowId: "lead:synthetic:evt",
    clientAccountId: "client_synthetic",
    sourceLeadEventId: "evt_synthetic",
    receivedAt: SUBMITTED_AT,
    sourceLeadId: "11111111-2222-4333-8444-555555555555",
    normalizedPayload: normalized,
  });
  assert.ok(v2);
  const v2Row = Object.fromEntries(COMPANY_SHEETS_LEAD_HEADER_V2.map((key, index) => [key, v2?.[index] ?? ""]));
  assert.equal(v2Row.consumer_age, "71");
  assert.equal(v2Row.branch_of_service, "Navy");
  assert.equal(v2Row.marital_status, "Not married");

  const v3 = companySheetsCampaignRowValues({
    schemaVersion: COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V3,
    stableRowId: "lead:synthetic:evt",
    clientAccountId: "client_synthetic",
    sourceLeadEventId: "evt_synthetic",
    receivedAt: SUBMITTED_AT,
    sourceLeadId: "11111111-2222-4333-8444-555555555555",
    normalizedPayload: normalized,
  });
  assert.ok(v3);
  const v3Row = Object.fromEntries(COMPANY_SHEETS_V3_HEADER.map((key, index) => [key, v3?.[index] ?? ""]));
  assert.equal(v3Row.Age, "71");
  assert.equal(v3Row.DOB, "1955-03-13");

  assert.deepEqual(readBuyerCsvV3ZipAndAge(normalized), { zip: "02139", age: "71" });

  const stamp = buildSourceAttributeStampPlan({
    sourceAttributes: attributes as Record<string, string>,
    fieldMap: {
      date_of_birth: { ghlFieldKey: "contact.dob", requirement: "optional" },
      age: { ghlFieldKey: "contact.age", requirement: "optional" },
    },
    discoveredFields: [
      { id: "field_dob", name: "DOB", key: "contact.dob", fieldKey: "contact.dob", dataType: "DATE" },
      { id: "field_age", name: "Age", key: "contact.age", fieldKey: "contact.age", dataType: "TEXT" },
    ],
  });
  assert.equal(stamp.valuesByLogicalKey.date_of_birth, "03/13/1955");
  assert.equal(stamp.missingSourceKeys.includes("age"), true);
  assert.equal(Object.keys(stamp.valuesByLogicalKey).includes("date"), false);
});

test("confirmed funnel id maps date without falling through from a different funnel", () => {
  const byFunnel = normalizeLeadCaptureIoWebhookToLifecyclePayload(
    juliaPayload({
      parent_url: "https://example.test/some-other-page",
      date: "03/13/1955",
    }),
    { sourceFunnelId: CONFIRMED_JULIA_DODGE_SOURCE_FUNNEL_ID, receivedAt: SUBMITTED_AT }
  );
  assert.equal(detailsOf(byFunnel).date_of_birth, "1955-03-13");

  const wrongFunnel = normalizeLeadCaptureIoWebhookToLifecyclePayload(
    juliaPayload({ date: "03/13/1955" }),
    { sourceFunnelId: "cmotherfunnel000000000000", receivedAt: SUBMITTED_AT }
  );
  assert.equal(detailsOf(wrongFunnel).date_of_birth, undefined);
  assert.equal(attributesOf(wrongFunnel).date_of_birth, undefined);
});

test("an unrelated nextgen date and Julia's healthcare page stay submission fields", () => {
  const other = normalizeLeadCaptureIoWebhookToLifecyclePayload(
    juliaPayload({
      parent_url: "https://go.example.test/another-veteran-form",
      date: "11/02/2026",
      branch: "Army",
      married: false,
    }),
    { receivedAt: SUBMITTED_AT }
  );
  assert.equal(detailsOf(other).date_of_birth, undefined);
  assert.equal(attributesOf(other).branch_of_service, undefined);
  assert.equal(attributesOf(other).marital_status, undefined);
  assert.equal(unmappedKeys(other).includes("branch"), true);
  assert.equal(unmappedKeys(other).includes("married"), true);
  assert.equal(intakeOf(other).submitted_at, SUBMITTED_AT);

  for (const page of [
    "https://go.lifeinsuranceforvets.com/learn-julia-healthcare-worker",
    "https://go.lifeinsuranceforvets.com/learn-julia-dodge-extra",
    "https://go.lifeinsuranceforvets.com/learn-julia-dodge/extra",
  ]) {
    const healthcare = normalizeLeadCaptureIoWebhookToLifecyclePayload(
      juliaPayload({ parent_url: page, date: "03/13/1955" }),
      { receivedAt: SUBMITTED_AT }
    );
    assert.equal(detailsOf(healthcare).date_of_birth, undefined, page);
    assert.equal(attributesOf(healthcare).date_of_birth, undefined, page);
  }

  const slashed = normalizeLeadCaptureIoWebhookToLifecyclePayload(
    juliaPayload({
      parent_url: `https://${CONFIRMED_JULIA_DODGE_PARENT_URL_KEY}/?v=2`,
      date: "03/13/1955",
    }),
    { receivedAt: SUBMITTED_AT }
  );
  assert.equal(detailsOf(slashed).date_of_birth, "1955-03-13");
});

test("legacy date plus time remains the submission calendar", () => {
  const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "../../fixtures/leadcaptureio");
  const raw = JSON.parse(
    readFileSync(join(fixtureDir, "leadcaptureio-webhook-sample-legacy-real-aliases.json"), "utf8")
  ) as Record<string, unknown>;
  const normalized = normalizeLeadCaptureIoWebhookToLifecyclePayload(raw);
  assert.equal(intakeOf(normalized).submitted_at, "2026-06-16T11:25:41.000Z");
  assert.equal(attributesOf(normalized).date_of_birth, undefined);
  assert.equal(detailsOf(normalized).date_of_birth, undefined);
  assert.equal(attributesOf(normalized).branch_of_service, "Army");
  assert.equal(normalized.contact.first_name, "James");
  assert.equal(normalized.contact.last_name, "LegacyTest");
});

test("a nonempty canonical DOB wins and conflicts stay visible", () => {
  const invalid = normalizeLeadCaptureIoWebhookToLifecyclePayload(
    juliaPayload({ date_of_birth: "02/31/1979", date: "03/13/1955" }),
    { receivedAt: SUBMITTED_AT }
  );
  assert.equal(attributesOf(invalid).date_of_birth, "02/31/1979");
  assert.equal(detailsOf(invalid).date_of_birth, undefined);
  const invalidConflicts = intakeOf(invalid).fieldAliasConflicts as Array<{ reason: string }>;
  assert.equal(invalidConflicts.some((conflict) => conflict.reason === "invalid_canonical_preserved"), true);

  const disagree = normalizeLeadCaptureIoWebhookToLifecyclePayload(
    juliaPayload({ date_of_birth: "04/12/1979", date: "03/13/1955" }),
    { receivedAt: SUBMITTED_AT }
  );
  assert.equal(detailsOf(disagree).date_of_birth, "1979-04-12");
  assert.notEqual(detailsOf(disagree).consumer_age, "71");
  const disagreeConflicts = intakeOf(disagree).fieldAliasConflicts as Array<{ reason: string; selectedValue: string }>;
  assert.equal(disagreeConflicts.some((conflict) => conflict.reason === "disagreeing_aliases"), true);
  assert.equal(disagreeConflicts.some((conflict) => conflict.selectedValue === "04/12/1979"), true);

  const aliases = normalizeLeadCaptureIoWebhookToLifecyclePayload(
    juliaPayload({
      parent_url: "https://go.example.test/other",
      dob: "03/13/1955",
      birth_date: "04/12/1979",
    }),
    { receivedAt: SUBMITTED_AT }
  );
  assert.equal(attributesOf(aliases).date_of_birth, undefined);
  assert.equal(detailsOf(aliases).date_of_birth, undefined);
  const aliasConflicts = intakeOf(aliases).fieldAliasConflicts as Array<{ reason: string; selectedKey: string | null }>;
  assert.equal(aliasConflicts.some((conflict) => conflict.reason === "disagreeing_aliases" && conflict.selectedKey == null), true);

  const same = normalizeLeadCaptureIoWebhookToLifecyclePayload(
    juliaPayload({
      parent_url: "https://go.example.test/other",
      dob: "03/13/1955",
      birthDate: "1955-03-13",
    }),
    { receivedAt: SUBMITTED_AT }
  );
  assert.equal(detailsOf(same).date_of_birth, "1955-03-13");
  assert.equal(intakeOf(same).fieldAliasConflicts, undefined);
});

test("invalid, future, ambiguous, and leap-day dates follow the existing parser", () => {
  const future = normalizeLeadCaptureIoWebhookToLifecyclePayload(
    juliaPayload({ date: "01/15/2030" }),
    { receivedAt: SUBMITTED_AT }
  );
  assert.equal(detailsOf(future).date_of_birth, "2030-01-15");
  assert.equal(detailsOf(future).consumer_age, undefined);
  assert.equal(detailsOf(future).consumer_age_unavailable_reason, "future_date_of_birth");

  const ambiguous = normalizeLeadCaptureIoWebhookToLifecyclePayload(
    juliaPayload({ date: "13/03/1955" }),
    { receivedAt: SUBMITTED_AT }
  );
  assert.equal(detailsOf(ambiguous).date_of_birth, undefined);
  assert.equal(attributesOf(ambiguous).date_of_birth, "13/03/1955");

  const beforeBirthday = normalizeLeadCaptureIoWebhookToLifecyclePayload(
    juliaPayload({ date: "03/13/1955", submitted_at: "2026-03-12T23:00:00.000Z" }),
    { receivedAt: "2026-03-12T23:00:00.000Z" }
  );
  assert.equal(detailsOf(beforeBirthday).consumer_age, "70");
  const onBirthday = normalizeLeadCaptureIoWebhookToLifecyclePayload(
    juliaPayload({ date: "03/13/1955", submitted_at: "2026-03-13T00:30:00.000Z" }),
    { receivedAt: "2026-03-13T00:30:00.000Z" }
  );
  assert.equal(detailsOf(onBirthday).consumer_age, "71");

  const leapBefore = normalizeLeadCaptureIoWebhookToLifecyclePayload(
    juliaPayload({ date: "02/29/1956", submitted_at: "2026-02-28T15:00:00.000Z" }),
    { receivedAt: "2026-02-28T15:00:00.000Z" }
  );
  assert.equal(detailsOf(leapBefore).date_of_birth, "1956-02-29");
  assert.equal(detailsOf(leapBefore).consumer_age, "69");
  const leapAfter = normalizeLeadCaptureIoWebhookToLifecyclePayload(
    juliaPayload({ date: "02/29/1956", submitted_at: "2026-03-01T15:00:00.000Z" }),
    { receivedAt: "2026-03-01T15:00:00.000Z" }
  );
  assert.equal(detailsOf(leapAfter).consumer_age, "70");

  const supplied = normalizeLeadCaptureIoWebhookToLifecyclePayload(
    juliaPayload({ date: "03/13/1955", age: 80 }),
    { receivedAt: SUBMITTED_AT }
  );
  assert.equal(detailsOf(supplied).date_of_birth, "1955-03-13");
  assert.equal(detailsOf(supplied).consumer_age, "80");
  assert.equal(detailsOf(supplied).consumer_age_derived, "71");
  assert.equal(detailsOf(supplied).consumer_age_conflict, true);
  assert.equal(attributesOf(supplied).age, 80);
});

test("key normalization detects collisions and keeps distinct fields apart", () => {
  assert.equal(normalizeSourceFieldKey("dateOfBirth"), "date_of_birth");
  assert.equal(normalizeSourceFieldKey("zipcode"), "zipcode");
  assert.equal(resolveCanonicalAttributeKey("date"), null);
  assert.equal(resolveCanonicalAttributeKey("date", { date_of_birth: ["date"] }), null);
  assert.equal(isAmbiguousIncomingFieldKey("is_married"), true);
  assert.equal(resolveCanonicalAttributeKey("branch"), null);
  assert.equal(resolveCanonicalAttributeKey("UNKNOWN_ROUTE"), null);

  const collision = normalizeLeadCaptureIoWebhookToLifecyclePayload(
    juliaPayload({
      parent_url: "https://go.example.test/other",
      dateOfBirth: "03/13/1955",
      date_of_birth: "04/12/1979",
      birthday: "01/02/1940",
    }),
    { receivedAt: SUBMITTED_AT }
  );
  assert.equal(attributesOf(collision).date_of_birth, undefined);
  const conflicts = intakeOf(collision).fieldAliasConflicts as Array<{ reason: string }>;
  assert.equal(conflicts.some((conflict) => conflict.reason === "key_normalization_collision"), true);

  const zip = normalizeLeadCaptureIoWebhookToLifecyclePayload(
    juliaPayload({ zip: undefined, zipCode: "02139", zip_code: "10001" })
  );
  assert.equal(zip.contact.zip, undefined);
  assert.equal(
    (intakeOf(zip).fieldAliasConflicts as Array<{ canonical: string }>).some((conflict) => conflict.canonical === "zip"),
    true
  );

  const objectDob = normalizeLeadCaptureIoWebhookToLifecyclePayload(
    juliaPayload({ date_of_birth: { month: 3, day: 13, year: 1955 }, date: "03/13/1955" }),
    { receivedAt: SUBMITTED_AT }
  );
  assert.equal(JSON.stringify(objectDob).includes("[object Object]"), false);
  assert.equal(attributesOf(objectDob).date_of_birth, undefined);
  assert.equal(detailsOf(objectDob).date_of_birth, undefined);
});

test("married false is Not married, and ambiguous keys stay on their confirmed form", () => {
  const married = normalizeLeadCaptureIoWebhookToLifecyclePayload(
    juliaPayload({ is_married: "no", branch: "Air Force" }),
    { receivedAt: SUBMITTED_AT }
  );
  assert.equal(attributesOf(married).marital_status, "Not married");
  assert.equal(attributesOf(married).branch_of_service, "Air Force");

  const legacy = normalizeLeadCaptureIoWebhookToLifecyclePayload({
    provider: "leadcapture_io",
    sa360_source_system: "leadcapture_io_legacy",
    sa360_route_key: CONFIRMED_LEGACY_JAMES_TORREY_ROUTE_KEY,
    lead_id: "jt-synthetic-001",
    answers: {
      branch: "Army",
      date: "2026-06-16",
      time: "11:25:41",
      married: false,
    },
  });
  assert.equal(attributesOf(legacy).branch_of_service, "Army");
  assert.equal(attributesOf(legacy).date_of_birth, undefined);
  assert.equal(attributesOf(legacy).marital_status, undefined);
  assert.equal(intakeOf(legacy).submitted_at, "2026-06-16T11:25:41.000Z");

  const unknown = normalizeLeadCaptureIoWebhookToLifecyclePayload({
    provider: "leadcapture_io",
    sa360_source_system: "leadcapture_io_legacy",
    sa360_route_key: "UNKNOWN_ROUTE",
    lead_id: "unknown-synthetic-001",
    branch: "Army",
    date: "03/13/1955",
  });
  assert.equal(attributesOf(unknown).branch_of_service, undefined);
  assert.equal(detailsOf(unknown).date_of_birth, undefined);
});

test("identity aliases, ranges, and unmapped ambiguous answers stay intact", () => {
  const named = normalizeLeadCaptureIoWebhookToLifecyclePayload(
    juliaPayload({
      first_name: undefined,
      last_name: undefined,
      email: undefined,
      phone: undefined,
      state: undefined,
      zip: undefined,
      given_name: "Mary Ann",
      surname: "Van Der Beek",
      emailAddress: "mary.ann@example.test",
      phoneNumber: "+15550101956",
      state_of_residence: "MA",
      postal_code: "02139",
      desired_coverage: "$10,000 - $25,000",
      gender: "Female",
      job_title: "Teacher",
      coverage_type: "Term",
      beneficiary_relationship: "Spouse",
      consent_text: "I agree to be contacted",
      timestamp: "2026-11-02T18:00:00.000Z",
      created_at: "2026-11-02T18:00:01.000Z",
    })
  );
  assert.equal(named.contact.first_name, "Mary Ann");
  assert.equal(named.contact.last_name, "Van Der Beek");
  assert.equal(named.contact.email, "mary.ann@example.test");
  assert.equal(named.contact.state, "MA");
  assert.equal(named.contact.zip, "02139");
  assert.equal(attributesOf(named).desired_coverage, "$10,000 - $25,000");
  assert.equal(attributesOf(named).sex, undefined);
  assert.equal(attributesOf(named).healthcare_profession, undefined);
  assert.equal(unmappedKeys(named).includes("gender"), true);
  assert.equal(unmappedKeys(named).includes("job_title"), true);
  assert.equal(unmappedKeys(named).includes("coverage_type"), true);
  assert.equal(unmappedKeys(named).includes("beneficiary_relationship"), true);
  assert.equal(unmappedKeys(named).includes("consent_text"), true);
  assert.equal(unmappedKeys(named).includes("timestamp"), false);
  assert.equal(unmappedKeys(named).includes("created_at"), false);
  assert.equal(attributesOf(named).timestamp, undefined);

  const blocked = normalizeLeadCaptureIoWebhookToLifecyclePayload(
    juliaPayload({
      first_name: undefined,
      firstname: "Ann",
      given_name: "Mary Ann",
    })
  );
  assert.equal(blocked.contact.first_name, undefined);
  assert.equal(
    (intakeOf(blocked).fieldAliasConflicts as Array<{ canonical: string; selectedKey: string | null }>).some(
      (conflict) => conflict.canonical === "first_name" && conflict.selectedKey == null
    ),
    true
  );
});
