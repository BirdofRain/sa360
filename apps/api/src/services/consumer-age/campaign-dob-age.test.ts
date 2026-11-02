import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { COMPANY_SHEETS_V3_HEADER } from "@sa360/shared";

import { COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V3 } from "../../lib/company-google-sheets-env.js";
import { companySheetsCampaignRowValues } from "../company-sheets-delivery/company-sheets-campaign-row.js";
import {
  CAMPAIGN_DOB_AGE_CONFLICT_WARNING,
  customRowProjection,
} from "../company-sheets-delivery/company-sheets-custom-row.js";
import { normalizeLeadCaptureIoWebhookToLifecyclePayload } from "../source-intake/leadcapture-io-normalizer.js";
import { parseHistoricalConsumerAge } from "../aged-inventory-bulk/aged-inventory-bulk-consumer-age.js";
import { planCustomCampaignSheet } from "../client-onboarding-v2/custom-captured-sheet.js";
import {
  assessCampaignDobAgeRecovery,
  CAMPAIGN_AGE_REFERENCE_RULE,
  CAMPAIGN_DOB_AGE_FUTURE_WARNING,
  CAMPAIGN_DOB_AGE_REFERENCE_UNAVAILABLE_WARNING,
  deriveCampaignAge,
  parseCampaignDateOfBirth,
  parseCampaignSuppliedAge,
  projectCampaignDobAge,
  selectCampaignAgeReference,
} from "./campaign-dob-age.js";

const REFERENCE = "2026-10-26T15:04:00.000Z";
const RECEIVED_AT = "2026-10-26T16:00:00.000Z";

const fixture = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../../fixtures/campaign-dob-age/redacted-alex-gross-shaped-nextgen.json"),
    "utf8"
  )
) as Record<string, unknown>;

function leadDetails(payload: { lead_details?: Record<string, unknown> }): Record<string, unknown> {
  return payload.lead_details ?? {};
}

function sheetCells(payload: unknown, receivedAt = RECEIVED_AT): Record<string, string> {
  const values = companySheetsCampaignRowValues({
    schemaVersion: COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V3,
    stableRowId: "row",
    clientAccountId: "alex_gross",
    sourceLeadEventId: "evt_redacted",
    receivedAt,
    sourceLeadId: "redacted",
    normalizedPayload: payload,
  });
  assert.ok(values);
  return Object.fromEntries(COMPANY_SHEETS_V3_HEADER.map((key, index) => [key, values[index] ?? ""]));
}

test("campaign date-only parser preserves the written calendar date", () => {
  assert.equal(parseCampaignDateOfBirth("1979-04-12"), "1979-04-12");
  assert.equal(parseCampaignDateOfBirth("1979-04-12T00:00:00.000Z"), "1979-04-12");
  assert.equal(parseCampaignDateOfBirth("1979-04-12T03:30:00.000Z"), "1979-04-12");
  assert.equal(parseCampaignDateOfBirth("1979-04-12T23:30:00-04:00"), "1979-04-12");
  assert.equal(parseCampaignDateOfBirth("1979-04-12T00:00Z"), "1979-04-12");
  assert.equal(parseCampaignDateOfBirth("1979-04-12T"), null);
  assert.equal(parseCampaignDateOfBirth("1979-04-12Tanything"), null);
  assert.equal(parseCampaignDateOfBirth("1979-04-12T25:00:00Z"), null);
  assert.equal(parseCampaignDateOfBirth("1979-04-12T00:00:00.000Zjunk"), null);
  assert.equal(parseCampaignDateOfBirth("4/12/1979"), "1979-04-12");
  assert.equal(parseCampaignDateOfBirth("04/12/1979"), "1979-04-12");
  assert.equal(parseCampaignDateOfBirth("April 12, 1979"), "1979-04-12");
  assert.equal(parseCampaignDateOfBirth("Apr 12 1979"), "1979-04-12");
  assert.equal(parseCampaignDateOfBirth("12 April 1979"), "1979-04-12");
  assert.equal(parseCampaignDateOfBirth("2000-02-29"), "2000-02-29");
  assert.equal(parseCampaignDateOfBirth("2024-02-29"), "2024-02-29");
  assert.equal(parseCampaignDateOfBirth("1900-02-29"), null);
  assert.equal(parseCampaignDateOfBirth("1979-02-31"), null);
  assert.equal(parseCampaignDateOfBirth("02/31/1979"), null);
  assert.equal(parseCampaignDateOfBirth("13/40/1979"), null);
  assert.equal(parseCampaignDateOfBirth("not a date"), null);
  assert.equal(parseCampaignDateOfBirth(""), null);
  assert.equal(parseCampaignDateOfBirth("28988"), null);
});

test("supplied age never fabricates a birthday and ignores the sellable window", () => {
  assert.equal(parseCampaignSuppliedAge("47"), "47");
  assert.equal(parseCampaignSuppliedAge("47.0"), "47");
  assert.equal(parseCampaignSuppliedAge("0"), "0");
  assert.equal(parseCampaignSuppliedAge("15"), "15");
  assert.equal(parseCampaignSuppliedAge("92"), "92");
  assert.equal(parseCampaignSuppliedAge("130"), "130");
  assert.equal(parseCampaignSuppliedAge("131"), null);
  assert.equal(parseCampaignSuppliedAge("28988"), null);
  assert.equal(parseCampaignSuppliedAge("47 years"), null);
  assert.equal(parseCampaignDateOfBirth("47"), null);
  const excel = parseHistoricalConsumerAge("28988", new Date(REFERENCE));
  assert.equal(excel.status, "excel_serial");
  assert.equal(excel.dateOfBirth, "1979-05-13");
});

test("derived age uses the UTC reference date and birthday boundaries", () => {
  assert.equal(deriveCampaignAge("1964-10-07", "2026-10-06"), "61");
  assert.equal(deriveCampaignAge("1964-10-07", "2026-10-07"), "62");
  assert.equal(deriveCampaignAge("2024-02-29", "2025-02-28"), "0");
  assert.equal(deriveCampaignAge("2024-02-29", "2025-03-01"), "1");
  assert.equal(deriveCampaignAge("2024-02-29", "2024-02-29"), "0");
  assert.equal(deriveCampaignAge("1979-04-12", null), null);
  assert.equal(CAMPAIGN_AGE_REFERENCE_RULE, "submitted_at_utc_date_else_received_at_utc_date");
});

test("redacted Alex-shaped nextgen payload keeps DOB and derived age through sheets", () => {
  const answers = fixture.answers as Record<string, unknown>;
  assert.equal(typeof answers.dateOfBirth, "string");
  assert.equal(answers.dateOfBirth, "04/12/1979");
  const raw = structuredClone(fixture);

  const normalized = normalizeLeadCaptureIoWebhookToLifecyclePayload(raw);
  assert.equal(answers.dateOfBirth, "04/12/1979");

  const intake = (normalized.routing as { source_intake?: Record<string, unknown> }).source_intake;
  const attributes = intake?.sourceAttributes as Record<string, unknown>;
  const unmapped = intake?.unmappedSourceFieldsJson as Array<{ key: string }>;
  const details = leadDetails(normalized as { lead_details?: Record<string, unknown> });

  assert.equal(attributes.date_of_birth, "04/12/1979");
  assert.equal(unmapped.some((field) => field.key === "dateOfBirth"), false);
  assert.equal(details.date_of_birth, "1979-04-12");
  assert.equal(details.date_of_birth_provenance, "supplied");
  assert.equal(details.consumer_age, "47");
  assert.equal(details.consumer_age_provenance, "derived_from_date_of_birth");
  assert.equal(details.consumer_age_reference_date, "2026-10-26");
  assert.equal(details.consumer_age_reference_rule, CAMPAIGN_AGE_REFERENCE_RULE);
  assert.equal(details.consumer_age_conflict, undefined);

  const again = normalizeLeadCaptureIoWebhookToLifecyclePayload(structuredClone(fixture));
  assert.equal(
    leadDetails(again as { lead_details?: Record<string, unknown> }).consumer_age,
    details.consumer_age
  );

  const cells = sheetCells(normalized, RECEIVED_AT);
  assert.equal(cells.Age, "47");
  assert.equal(cells.DOB, "1979-04-12");
  assert.equal(cells["Lead Type"], "Vet Web Form");

  const projected = customRowProjection(
    [
      {
        sheetHeader: "Age",
        columnIndex: 0,
        formula: false,
        target: { kind: "v3_column", header: "Age", sourceField: "consumer_age" },
        transform: "passthrough",
        decision: "mapped",
        explicit: true,
        code: null,
      },
      {
        sheetHeader: "DOB",
        columnIndex: 1,
        formula: false,
        target: { kind: "v3_column", header: "DOB", sourceField: "date_of_birth" },
        transform: "date_america_new_york",
        decision: "mapped",
        explicit: true,
        code: null,
      },
    ],
    {
      stableRowId: "row",
      clientAccountId: "alex_gross",
      sourceLeadEventId: "evt_redacted",
      receivedAt: RECEIVED_AT,
      sourceLeadId: "redacted",
      normalizedPayload: normalized,
    }
  );
  assert.deepEqual(projected?.values, ["47", "04/12/1979"]);
  assert.equal(projected?.dobAge.conflict, false);
  assert.equal(projected?.dobAge.ageProvenance, "derived_from_date_of_birth");
  assert.equal(projected?.dobAge.dateOfBirthSheet, "04/12/1979");
  assert.equal(projected?.warnings.includes(CAMPAIGN_DOB_AGE_CONFLICT_WARNING), false);
});

test("source-scoped custom questions are not global aliases", () => {
  const question = "What is your date of birth?";
  const base = {
    provider: "leadcapture_io",
    sa360_source_system: "leadcapture_io_nextgen",
    lead_id: "11111111-2222-4333-8444-555555555556",
    submitted_at: REFERENCE,
    parent_url: "https://go.lifeinsuranceforvets.com/learn-alex-gross",
    first_name: "Redacted",
    last_name: "Example",
    email: "redacted.example@example.test",
    phone: "5550100199",
    state: "TX",
    answers: { [question]: "April 12, 1979" },
  };
  const untouched = normalizeLeadCaptureIoWebhookToLifecyclePayload(base);
  const untouchedDetails = leadDetails(untouched as { lead_details?: Record<string, unknown> });
  assert.equal(untouchedDetails.date_of_birth, undefined);
  assert.equal(untouchedDetails.consumer_age, undefined);
  const untouchedIntake = (untouched.routing as { source_intake?: { unmappedSourceFieldsJson?: Array<{ key: string; value: unknown }> } }).source_intake;
  assert.equal(untouchedIntake?.unmappedSourceFieldsJson?.some((field) => field.key === question && field.value === "April 12, 1979"), true);

  const scoped = normalizeLeadCaptureIoWebhookToLifecyclePayload(base, {
    routeAliasOverrides: { date_of_birth: [question] },
  });
  const scopedDetails = leadDetails(scoped as { lead_details?: Record<string, unknown> });
  assert.equal(scopedDetails.date_of_birth, "1979-04-12");
  assert.equal(scopedDetails.consumer_age, "47");
  const attributes = (scoped.routing as { source_intake?: { sourceAttributes?: Record<string, unknown> } }).source_intake?.sourceAttributes;
  assert.equal(attributes?.date_of_birth, "April 12, 1979");
});

test("age-only input, conflicts, invalid DOB, and over-maximum age stay explicit", () => {
  const ageOnly = normalizeLeadCaptureIoWebhookToLifecyclePayload({
    provider: "leadcapture_io",
    sa360_source_system: "leadcapture_io_nextgen",
    lead_id: "11111111-2222-4333-8444-555555555557",
    submitted_at: REFERENCE,
    first_name: "Redacted",
    last_name: "Example",
    email: "redacted.example@example.test",
    phone: "5550100199",
    state: "TX",
    answers: { age: 64 },
  });
  const ageDetails = leadDetails(ageOnly as { lead_details?: Record<string, unknown> });
  assert.equal(ageDetails.consumer_age, "64");
  assert.equal(ageDetails.consumer_age_provenance, "supplied");
  assert.equal("date_of_birth" in ageDetails, false);

  const conflict = normalizeLeadCaptureIoWebhookToLifecyclePayload({
    provider: "leadcapture_io",
    sa360_source_system: "leadcapture_io_nextgen",
    lead_id: "11111111-2222-4333-8444-555555555558",
    submitted_at: REFERENCE,
    first_name: "Redacted",
    last_name: "Example",
    email: "redacted.example@example.test",
    phone: "5550100199",
    state: "TX",
    answers: { age: "55", dob: "04/12/1979" },
  });
  const conflictDetails = leadDetails(conflict as { lead_details?: Record<string, unknown> });
  assert.equal(conflictDetails.consumer_age, "55");
  assert.equal(conflictDetails.consumer_age_derived, "47");
  assert.equal(conflictDetails.date_of_birth, "1979-04-12");
  assert.equal(conflictDetails.consumer_age_conflict, true);
  const conflictCells = sheetCells(conflict);
  assert.equal(conflictCells.Age, "55");
  assert.equal(conflictCells.DOB, "1979-04-12");
  const conflictPreview = projectCampaignDobAge({ normalizedPayload: conflict, receivedAt: RECEIVED_AT });
  assert.equal(conflictPreview.conflict, true);
  assert.equal(conflictPreview.derivedAge, "47");

  const invalid = normalizeLeadCaptureIoWebhookToLifecyclePayload({
    provider: "leadcapture_io",
    sa360_source_system: "leadcapture_io_nextgen",
    lead_id: "11111111-2222-4333-8444-555555555559",
    submitted_at: REFERENCE,
    first_name: "Redacted",
    last_name: "Example",
    email: "redacted.example@example.test",
    phone: "5550100199",
    state: "TX",
    answers: { dob: "02/31/1979" },
  });
  const invalidDetails = leadDetails(invalid as { lead_details?: Record<string, unknown> });
  assert.equal(invalidDetails.date_of_birth, undefined);
  assert.equal(invalidDetails.consumer_age, undefined);
  const invalidAttributes = (invalid.routing as { source_intake?: { sourceAttributes?: Record<string, unknown> } }).source_intake?.sourceAttributes;
  assert.equal(invalidAttributes?.date_of_birth, "02/31/1979");

  const older = {
    contact: { first_name: "Redacted", email: "redacted.example@example.test" },
    lead_details: { date_of_birth: "1936-01-01" },
    routing: { source_intake: { submitted_at: REFERENCE } },
  };
  assert.equal(sheetCells(older).Age, "90");
  assert.equal(sheetCells(older).DOB, "1936-01-01");
  assert.equal(sheetCells({ lead_details: { consumer_age: "15" }, routing: { source_intake: {} } }).Age, "15");
  assert.equal(sheetCells({ lead_details: { consumer_age: "15" }, routing: { source_intake: {} } }).DOB, "");
});

test("stored blanks are classified without writing or replaying", () => {
  const derived = assessCampaignDobAgeRecovery({
    receivedAt: RECEIVED_AT,
    normalizedPayload: {
      routing: {
        source_intake: {
          submitted_at: REFERENCE,
          sourceAttributes: { date_of_birth: "April 12, 1979" },
        },
      },
    },
  });
  assert.equal(derived.storedAgeBlank, true);
  assert.equal(derived.storedDobBlank, true);
  assert.equal(derived.recovery, "derived_at_delivery");
  assert.equal(derived.recoverableWithoutBackfill, true);
  assert.equal(derived.projectedAge, "47");
  assert.equal(derived.projectedDateOfBirth, "1979-04-12");
  assert.equal(derived.evidence.key, "date_of_birth");
  assert.equal(derived.evidence.valueType, "string");
  assert.equal(derived.evidence.format, "month_name");
  assert.equal(derived.evidence.year, "1979");
  assert.equal(JSON.stringify(derived).includes("April"), false);

  const datetime = assessCampaignDobAgeRecovery({
    receivedAt: RECEIVED_AT,
    normalizedPayload: {
      lead_details: { date_of_birth: "1979-04-12T00:00:00.000Z" },
      routing: { source_intake: { submitted_at: REFERENCE } },
    },
  });
  assert.equal(datetime.projectedDateOfBirth, "1979-04-12");
  assert.equal(datetime.evidence.format, "iso_datetime_date_prefix");
  assert.equal(datetime.recovery, "derived_at_delivery");

  const custom = assessCampaignDobAgeRecovery({
    receivedAt: RECEIVED_AT,
    normalizedPayload: {
      routing: {
        source_intake: {
          submitted_at: REFERENCE,
          unmappedSourceFieldsJson: [{ key: "What is your date of birth?", value: "04/12/1979" }],
        },
      },
    },
  });
  assert.equal(custom.recovery, "needs_source_alias");
  assert.equal(custom.recoverableWithoutBackfill, false);
  assert.equal(custom.projectedAge, "");
  assert.equal(custom.unmappedNotAliased[0]?.parsesAsDate, true);
  assert.equal(custom.unmappedNotAliased[0]?.year, "1979");
  assert.equal(JSON.stringify(custom).includes("04/12/1979"), false);

  const scoped = assessCampaignDobAgeRecovery({
    receivedAt: RECEIVED_AT,
    routeAliasOverrides: { date_of_birth: ["What is your date of birth?"] },
    normalizedPayload: {
      routing: {
        source_intake: {
          submitted_at: REFERENCE,
          unmappedSourceFieldsJson: [{ key: "What is your date of birth?", value: "04/12/1979" }],
        },
      },
    },
  });
  assert.equal(scoped.recovery, "derived_at_delivery");
  assert.equal(scoped.projectedAge, "47");

  const ageOnly = assessCampaignDobAgeRecovery({
    normalizedPayload: { lead_details: { consumer_age: "64" } },
  });
  assert.equal(ageOnly.recovery, "age_only");
  assert.equal(ageOnly.projectedDateOfBirth, "");

  const invalid = assessCampaignDobAgeRecovery({
    normalizedPayload: {
      routing: { source_intake: { sourceAttributes: { dob: "not a date" } } },
    },
  });
  assert.equal(invalid.recovery, "invalid_evidence");
  assert.equal(invalid.recoverableWithoutBackfill, false);

  const objectDob = normalizeLeadCaptureIoWebhookToLifecyclePayload({
    provider: "leadcapture_io",
    sa360_source_system: "leadcapture_io_nextgen",
    lead_id: "11111111-2222-4333-8444-555555555560",
    submitted_at: REFERENCE,
    first_name: "Redacted",
    last_name: "Example",
    email: "redacted.example@example.test",
    phone: "5550100199",
    state: "TX",
    answers: { dateOfBirth: { year: 1979, month: 4, day: 12 } },
  });
  const objectAttributes = (objectDob.routing as { source_intake?: { sourceAttributes?: Record<string, unknown> } }).source_intake?.sourceAttributes;
  assert.equal(objectAttributes?.date_of_birth, undefined);
  assert.equal(JSON.stringify(objectDob).includes("[object Object]"), false);
  assert.equal(leadDetails(objectDob as { lead_details?: Record<string, unknown> }).date_of_birth, undefined);
});

const BEFORE_BIRTHDAY = "2026-04-11T23:00:00.000Z";

function dobPayload(input: { leadId: string; submittedAt?: string; dob: unknown }): Record<string, unknown> {
  return {
    provider: "leadcapture_io",
    sa360_source_system: "leadcapture_io_nextgen",
    lead_id: input.leadId,
    ...(input.submittedAt === undefined ? {} : { submitted_at: input.submittedAt }),
    first_name: "Redacted",
    last_name: "Example",
    email: "redacted.example@example.test",
    phone: "5550100199",
    state: "TX",
    answers: { dateOfBirth: input.dob },
  };
}

function ageDobMap(clientAccountId: string) {
  const header = ["Age", "DOB"];
  const assignments = [
    {
      sheetHeader: "Age",
      columnIndex: 0,
      formula: false,
      target: { kind: "v3_column" as const, header: "Age", sourceField: "consumer_age" },
      transform: "passthrough" as const,
      decision: "mapped" as const,
      explicit: true,
      code: null,
    },
    {
      sheetHeader: "DOB",
      columnIndex: 1,
      formula: false,
      target: { kind: "v3_column" as const, header: "DOB", sourceField: "date_of_birth" },
      transform: "date_america_new_york" as const,
      decision: "mapped" as const,
      explicit: true,
      code: null,
    },
  ];
  return { header, assignments, clientAccountId };
}

test("missing, invalid, and absent reference timestamps stay on one receipt", () => {
  const missing = normalizeLeadCaptureIoWebhookToLifecyclePayload(
    dobPayload({ leadId: "11111111-2222-4333-8444-555555555561", dob: "04/12/1979" }),
    { receivedAt: BEFORE_BIRTHDAY }
  );
  const missingDetails = leadDetails(missing as { lead_details?: Record<string, unknown> });
  assert.equal((missing.routing as { source_intake?: { submitted_at?: string } }).source_intake?.submitted_at, undefined);
  assert.equal(missingDetails.date_of_birth, "1979-04-12");
  assert.equal(missingDetails.consumer_age, "46");
  assert.equal(missingDetails.consumer_age_reference_date, "2026-04-11");
  assert.equal(missingDetails.consumer_age_unavailable_reason, undefined);
  const missingCells = sheetCells(missing, BEFORE_BIRTHDAY);
  assert.equal(missingCells.Age, "46");
  assert.equal(missingCells.DOB, "1979-04-12");
  const replay = normalizeLeadCaptureIoWebhookToLifecyclePayload(
    dobPayload({ leadId: "11111111-2222-4333-8444-555555555561", dob: "04/12/1979" }),
    { receivedAt: BEFORE_BIRTHDAY }
  );
  assert.equal(leadDetails(replay as { lead_details?: Record<string, unknown> }).consumer_age, "46");

  const invalidSubmitted = "not-a-timestamp";
  assert.equal(selectCampaignAgeReference({ submittedAt: invalidSubmitted, receivedAt: BEFORE_BIRTHDAY })?.source, "received_at");
  const invalid = normalizeLeadCaptureIoWebhookToLifecyclePayload(
    dobPayload({ leadId: "11111111-2222-4333-8444-555555555562", submittedAt: invalidSubmitted, dob: "04/12/1979" }),
    { receivedAt: BEFORE_BIRTHDAY }
  );
  const invalidIntake = (invalid.routing as { source_intake?: { submitted_at?: string } }).source_intake;
  assert.equal(invalidIntake?.submitted_at, invalidSubmitted);
  assert.equal(leadDetails(invalid as { lead_details?: Record<string, unknown> }).consumer_age, "46");
  assert.equal(sheetCells(invalid, BEFORE_BIRTHDAY).Age, "46");

  const neither = normalizeLeadCaptureIoWebhookToLifecyclePayload(
    dobPayload({ leadId: "11111111-2222-4333-8444-555555555563", submittedAt: invalidSubmitted, dob: "04/12/1979" })
  );
  const neitherDetails = leadDetails(neither as { lead_details?: Record<string, unknown> });
  assert.equal(neitherDetails.date_of_birth, "1979-04-12");
  assert.equal(neitherDetails.consumer_age, undefined);
  assert.equal(neitherDetails.consumer_age_unavailable_reason, "no_valid_reference");
  const neitherPreview = projectCampaignDobAge({ normalizedPayload: neither, receivedAt: "still-not-a-timestamp" });
  assert.equal(neitherPreview.dateOfBirth, "1979-04-12");
  assert.equal(neitherPreview.age, "");
  assert.equal(neitherPreview.ageUnavailableReason, "no_valid_reference");
  assert.equal(sheetCells(neither, "still-not-a-timestamp").Age, "");
  assert.equal(sheetCells(neither, "still-not-a-timestamp").DOB, "1979-04-12");
});

test("a valid DOB timestamp keeps its written date and a malformed suffix stays raw", () => {
  const valid = normalizeLeadCaptureIoWebhookToLifecyclePayload(
    dobPayload({
      leadId: "11111111-2222-4333-8444-555555555564",
      submittedAt: REFERENCE,
      dob: "1979-04-12T00:00:00.000Z",
    }),
    { receivedAt: BEFORE_BIRTHDAY }
  );
  const validDetails = leadDetails(valid as { lead_details?: Record<string, unknown> });
  assert.equal(validDetails.date_of_birth, "1979-04-12");
  assert.equal(validDetails.consumer_age, "47");
  assert.equal(sheetCells(valid, BEFORE_BIRTHDAY).DOB, "1979-04-12");
  const offset = parseCampaignDateOfBirth("1979-04-12T23:30:00-04:00");
  assert.equal(offset, "1979-04-12");

  const malformed = normalizeLeadCaptureIoWebhookToLifecyclePayload(
    dobPayload({
      leadId: "11111111-2222-4333-8444-555555555565",
      submittedAt: REFERENCE,
      dob: "1979-04-12Tanything",
    })
  );
  const malformedDetails = leadDetails(malformed as { lead_details?: Record<string, unknown> });
  const malformedAttributes = (malformed.routing as { source_intake?: { sourceAttributes?: Record<string, unknown> } }).source_intake?.sourceAttributes;
  assert.equal(malformedDetails.date_of_birth, undefined);
  assert.equal(malformedDetails.consumer_age, undefined);
  assert.equal(malformedAttributes?.date_of_birth, "1979-04-12Tanything");
  assert.equal(sheetCells(malformed, REFERENCE).DOB, "");
  assert.equal(sheetCells(malformed, REFERENCE).Age, "");
});

test("a future DOB is kept and age is not derived", () => {
  const future = normalizeLeadCaptureIoWebhookToLifecyclePayload(
    dobPayload({ leadId: "11111111-2222-4333-8444-555555555566", submittedAt: REFERENCE, dob: "2027-01-15" })
  );
  const details = leadDetails(future as { lead_details?: Record<string, unknown> });
  assert.equal(details.date_of_birth, "2027-01-15");
  assert.equal(details.consumer_age, undefined);
  assert.equal(details.consumer_age_unavailable_reason, "future_date_of_birth");
  assert.equal(details.consumer_age_reference_date, "2026-10-26");
  const preview = projectCampaignDobAge({ normalizedPayload: future, receivedAt: BEFORE_BIRTHDAY });
  assert.equal(preview.dateOfBirth, "2027-01-15");
  assert.equal(preview.age, "");
  assert.equal(preview.ageUnavailableReason, "future_date_of_birth");
  assert.equal(preview.referenceDate, "2026-10-26");
  const projected = customRowProjection(
    ageDobMap("alex_gross").assignments,
    {
      stableRowId: "row",
      clientAccountId: "alex_gross",
      sourceLeadEventId: "evt_future",
      receivedAt: BEFORE_BIRTHDAY,
      sourceLeadId: "redacted",
      normalizedPayload: future,
    }
  );
  assert.equal(projected?.warnings.includes(CAMPAIGN_DOB_AGE_FUTURE_WARNING), true);
  assert.equal(projected?.warnings.includes(CAMPAIGN_DOB_AGE_REFERENCE_UNAVAILABLE_WARNING), false);
});

test("preview and the sheet writer do not apply a route alias to a stored unmapped answer", () => {
  const question = "What is your date of birth?";
  const stored = {
    contact: { first_name: "Redacted", last_name: "Example", email: "redacted.example@example.test" },
    routing: {
      source_intake: {
        submitted_at: REFERENCE,
        unmappedSourceFieldsJson: [{ key: question, value: "04/12/1979" }],
      },
    },
  };
  const direct = assessCampaignDobAgeRecovery({
    normalizedPayload: stored,
    receivedAt: RECEIVED_AT,
    routeAliasOverrides: { date_of_birth: [question] },
  });
  assert.equal(direct.recovery, "derived_at_delivery");
  assert.equal(direct.projectedAge, "47");

  const exact = sheetCells(stored, RECEIVED_AT);
  assert.equal(exact.Age, "");
  assert.equal(exact.DOB, "");
  const map = ageDobMap("alex_gross");
  const custom = customRowProjection(map.assignments, {
    stableRowId: "row",
    clientAccountId: "alex_gross",
    sourceLeadEventId: "evt_alias",
    receivedAt: RECEIVED_AT,
    sourceLeadId: "redacted",
    normalizedPayload: stored,
  });
  assert.deepEqual(custom?.values, ["", ""]);
  assert.equal(custom?.dobAge.dateOfBirth, "");
  assert.equal(custom?.dobAge.age, "");
  const preview = planCustomCampaignSheet({
    clientAccountId: "alex_gross",
    spreadsheetId: "copy_sheet_alex",
    campaign: {
      worksheetId: 7,
      worksheetTitle: "VET Web Form",
      schemaVersion: "company_sheets_campaign_custom_v1",
      header: map.header,
    },
    publishedMap: {
      id: "map_alias",
      mapVersion: 1,
      spreadsheetId: "copy_sheet_alex",
      worksheetId: 7,
      headerSnapshot: map.header,
      assignments: map.assignments,
    },
    event: {
      id: "evt_alias",
      sourceLeadId: "redacted",
      receivedAt: RECEIVED_AT,
      normalizedPayloadJson: stored,
      enrichmentMetadataJson: {},
    },
  });
  assert.equal(preview.applies, true);
  assert.equal(preview.ok, true);
  if (!preview.ok) return;
  assert.deepEqual(preview.plan.values, ["", ""]);
  assert.equal(preview.plan.dobAge.ageUnavailableReason, null);
  assert.equal(preview.plan.dobAge.dateOfBirth, "");
});
