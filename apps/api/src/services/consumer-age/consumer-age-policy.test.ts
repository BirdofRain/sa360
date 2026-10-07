import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CONSUMER_AGE_OVER_MAXIMUM_CATEGORY,
  CONSUMER_AGE_REQUIRED_CATEGORY,
  MAX_SELLABLE_CONSUMER_AGE,
  consumerAgePolicyCategory,
  normalizeConsumerAgeCell,
  readNormalizedConsumerAgeCell,
  readNormalizedDateOfBirthCell,
  resolveConsumerAgeForFulfillment,
} from "./consumer-age-policy.js";

const EVALUATED_AT = new Date("2026-10-06T00:00:00.000Z");

function resolve(input: Parameters<typeof resolveConsumerAgeForFulfillment>[0]) {
  return resolveConsumerAgeForFulfillment({ evaluatedAt: EVALUATED_AT, ...input });
}

describe("canonical consumer-age resolver", () => {
  it("1: reads a normalized consumer_age", () => {
    const resolved = resolve({
      normalizedPayloadJson: { lead_details: { consumer_age: "62" } },
    });
    assert.deepEqual(resolved, {
      age: 62,
      dateOfBirth: null,
      source: "normalized_consumer_age",
      exactFromDob: false,
      status: "eligible",
    });
  });

  it("2: a normalized DOB yields the completed whole-year age at evaluation time", () => {
    const before = resolve({
      normalizedPayloadJson: { lead_details: { date_of_birth: "1964-10-07" } },
    });
    assert.equal(before.age, 61);
    assert.equal(before.exactFromDob, true);
    assert.equal(before.source, "normalized_dob");

    const onBirthday = resolve({
      normalizedPayloadJson: { lead_details: { date_of_birth: "1964-10-06" } },
    });
    assert.equal(onBirthday.age, 62);
  });

  it("3: recovers an explicit consumer age from rawPayloadJson", () => {
    const resolved = resolve({
      normalizedPayloadJson: { contact: { first_name: "Ada" } },
      rawPayloadJson: { consumer_age: "84" },
    });
    assert.equal(resolved.age, 84);
    assert.equal(resolved.source, "raw_consumer_age");
    assert.equal(resolved.status, "eligible");
  });

  it("4: recovers a DOB from rawPayloadJson", () => {
    const resolved = resolve({
      normalizedPayloadJson: {},
      rawPayloadJson: { dob: "05/13/1979" },
    });
    assert.equal(resolved.age, 47);
    assert.equal(resolved.dateOfBirth, "1979-05-13");
    assert.equal(resolved.source, "raw_dob");
  });

  it("5: recovers an age from LeadInventoryItem.metadataJson", () => {
    const resolved = resolve({ metadataJson: { consumer_age: 71 } });
    assert.equal(resolved.age, 71);
    assert.equal(resolved.source, "metadata");
  });

  it("6: recovers an age from SourceLeadEvent.enrichmentMetadataJson", () => {
    const resolved = resolve({ enrichmentMetadataJson: { consumer_age: "69" } });
    assert.equal(resolved.age, 69);
    assert.equal(resolved.source, "enrichment");
  });

  it("7: no age anywhere is missing, not invalid", () => {
    const resolved = resolve({
      normalizedPayloadJson: { contact: { first_name: "Ada", last_name: "Lee" } },
      rawPayloadJson: { importRequestId: "req-1", rowNumber: 3 },
    });
    assert.deepEqual(resolved, {
      age: null,
      dateOfBirth: null,
      source: null,
      exactFromDob: false,
      status: "missing",
    });
    assert.equal(consumerAgePolicyCategory(resolved), CONSUMER_AGE_REQUIRED_CATEGORY);
  });

  it("8: a malformed or implausible age is invalid", () => {
    for (const cell of ["not-an-age", "N/A", "0", "12"]) {
      const resolved = resolve({ normalizedPayloadJson: { consumer_age: cell } });
      assert.equal(resolved.status, "invalid", cell);
      assert.equal(resolved.age, null, cell);
      assert.equal(consumerAgePolicyCategory(resolved), CONSUMER_AGE_REQUIRED_CATEGORY);
    }
  });

  it("9/10/11: 85 and 86 are sellable, 87 is commercially dead", () => {
    assert.equal(MAX_SELLABLE_CONSUMER_AGE, 86);
    assert.equal(resolve({ normalizedPayloadJson: { consumer_age: "85" } }).status, "eligible");
    assert.equal(resolve({ normalizedPayloadJson: { consumer_age: "86" } }).status, "eligible");

    const over = resolve({ normalizedPayloadJson: { consumer_age: "87" } });
    assert.equal(over.status, "over_maximum_age");
    assert.equal(over.age, 87);
    assert.equal(consumerAgePolicyCategory(over), CONSUMER_AGE_OVER_MAXIMUM_CATEGORY);
  });

  it("12: a DOB that crosses a birthday flips 86 to over-maximum", () => {
    const payload = { lead_details: { date_of_birth: "1939-06-15" } };
    assert.equal(
      resolveConsumerAgeForFulfillment({
        normalizedPayloadJson: payload,
        evaluatedAt: new Date("2026-06-14T00:00:00.000Z"),
      }).status,
      "eligible"
    );
    assert.equal(
      resolveConsumerAgeForFulfillment({
        normalizedPayloadJson: payload,
        evaluatedAt: new Date("2026-06-15T00:00:00.000Z"),
      }).status,
      "over_maximum_age"
    );
  });

  it("13: generatedAt, lead age, and commerce buckets never become consumer age", () => {
    const resolved = resolve({
      normalizedPayloadJson: {
        generated_at: "1979-05-13T00:00:00.000Z",
        generatedAt: "1979-05-13T00:00:00.000Z",
        lead_date: "1979-05-13",
        ageDays: 45,
        commerce_age_bucket_key: "COMMERCE_1_3_MO",
      },
      metadataJson: { generatedAt: "1950-01-01T00:00:00.000Z", ageDays: 400 },
      enrichmentMetadataJson: { generatedAt: "1950-01-01T00:00:00.000Z" },
    });
    assert.equal(resolved.status, "missing");
    assert.equal(resolved.age, null);
  });

  it("prefers an explicit DOB over a stale stored age", () => {
    const resolved = resolve({
      normalizedPayloadJson: { lead_details: { consumer_age: "80" } },
      rawPayloadJson: { date_of_birth: "1939-01-01" },
    });
    assert.equal(resolved.source, "raw_dob");
    assert.equal(resolved.age, 87);
    assert.equal(resolved.status, "over_maximum_age");
  });

  it("uses an explicit integer age exactly as stored when no DOB exists", () => {
    const resolved = resolve({ normalizedPayloadJson: { lead_details: { consumer_age: "84" } } });
    assert.equal(resolved.age, 84);
    assert.equal(resolved.exactFromDob, false);
    assert.equal(resolved.dateOfBirth, null);
  });

  it("reads survey answers parked under routing.source_intake and custom_fields", () => {
    const fromSourceAttributes = resolve({
      normalizedPayloadJson: {
        routing: { source_intake: { sourceAttributes: { age: "73" } } },
      },
    });
    assert.equal(fromSourceAttributes.age, 73);

    const fromCustomFields = resolve({
      normalizedPayloadJson: { custom_fields: { "Date of Birth": "1961-02-29" } },
    });
    assert.equal(fromCustomFields.status, "invalid");

    const validCustomField = resolve({
      normalizedPayloadJson: { custom_fields: { dob: "1960-03-01" } },
    });
    assert.equal(validCustomField.age, 66);
  });

  it("normalizeConsumerAgeCell never fabricates a DOB from an age", () => {
    assert.deepEqual(normalizeConsumerAgeCell("72", EVALUATED_AT), {
      consumerAge: "72",
      dateOfBirth: null,
    });
    assert.deepEqual(normalizeConsumerAgeCell("1979-05-13", EVALUATED_AT), {
      consumerAge: "47",
      dateOfBirth: "1979-05-13",
    });
    assert.deepEqual(normalizeConsumerAgeCell("", EVALUATED_AT), {
      consumerAge: null,
      dateOfBirth: null,
    });
  });

  it("canonical cell readers prefer lead_details then the flat key", () => {
    assert.equal(
      readNormalizedConsumerAgeCell({ lead_details: { consumer_age: "64" }, consumer_age: "99" }),
      "64"
    );
    assert.equal(readNormalizedConsumerAgeCell({ consumer_age: 41 }), "41");
    assert.equal(readNormalizedConsumerAgeCell(null), "");
    assert.equal(
      readNormalizedDateOfBirthCell({ lead_details: { date_of_birth: "1960-01-01" } }),
      "1960-01-01"
    );
    assert.equal(readNormalizedDateOfBirthCell({}), "");
  });
});
