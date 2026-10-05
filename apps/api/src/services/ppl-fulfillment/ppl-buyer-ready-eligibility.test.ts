import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { COMMERCE_AGE_BUCKETS } from "@sa360/shared";

import {
  evaluatePplBuyerReadyEligibility,
  isPplBuyerReadyLead,
  readPplBuyerReadyNames,
} from "./ppl-buyer-ready-eligibility.js";

function payload(input: {
  first?: unknown;
  last?: unknown;
  age?: unknown;
  flatAge?: unknown;
}) {
  return {
    contact: {
      first_name: input.first,
      last_name: input.last,
      phone_e164: "+15551234001",
      email: "ready@example.test",
      state: "NC",
    },
    lead_details: input.age === undefined ? undefined : { consumer_age: input.age },
    consumer_age: input.flatAge,
  };
}

describe("PPL buyer-ready eligibility policy", () => {
  it("accepts a present age and single-token names longer than one character", () => {
    const result = evaluatePplBuyerReadyEligibility(
      payload({ first: "Ada", last: "Lovelace", age: 62 })
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.firstName, "Ada");
    assert.equal(result.lastName, "Lovelace");
    assert.equal(result.consumerAge, "62");
    assert.equal(isPplBuyerReadyLead(payload({ first: "Ada", last: "Lovelace", age: "62" })), true);
  });

  it("A: missing, blank, or unusable consumer age stays eligible and exports blank", () => {
    const missing = evaluatePplBuyerReadyEligibility(payload({ first: "Ada", last: "Lee" }));
    assert.equal(missing.ok, true);
    if (!missing.ok) return;
    assert.equal(missing.consumerAge, "");
    assert.equal(isPplBuyerReadyLead(payload({ first: "Ada", last: "Lee" })), true);

    const blank = evaluatePplBuyerReadyEligibility(payload({ first: "Ada", last: "Lee", age: "   " }));
    assert.equal(blank.ok, true);
    if (!blank.ok) return;
    assert.equal(blank.consumerAge, "");

    const malformed = evaluatePplBuyerReadyEligibility(
      payload({ first: "Ada", last: "Lee", age: "not-an-age" })
    );
    assert.equal(malformed.ok, true);
    if (!malformed.ok) return;
    assert.equal(malformed.consumerAge, "");

    const leadDate = evaluatePplBuyerReadyEligibility({
      contact: { first_name: "Ada", last_name: "Lee" },
      generated_at: "1979-05-13T00:00:00.000Z",
      generatedAt: "1979-05-13T00:00:00.000Z",
      date_of_birth: "1963-05-01",
    });
    assert.equal(leadDate.ok, true);
    if (!leadDate.ok) return;
    assert.equal(leadDate.consumerAge, "");
  });

  it("reads consumer_age from lead_details then flat payload, never date_of_birth", () => {
    const nested = evaluatePplBuyerReadyEligibility({
      contact: { first_name: "Ada", last_name: "Lee" },
      lead_details: { consumer_age: 55, date_of_birth: "1963-05-01" },
      date_of_birth: "1950-01-01",
    });
    assert.equal(nested.ok, true);
    if (!nested.ok) return;
    assert.equal(nested.consumerAge, "55");

    const flat = evaluatePplBuyerReadyEligibility({
      contact: { first_name: "Ada", last_name: "Lee" },
      consumer_age: "41",
      date_of_birth: "1950-01-01",
    });
    assert.equal(flat.ok, true);
    if (!flat.ok) return;
    assert.equal(flat.consumerAge, "41");
  });

  it("B/C: one-character first or last name is ineligible after trim", () => {
    assert.deepEqual(
      evaluatePplBuyerReadyEligibility(payload({ first: "A", last: "Lee", age: 50 })),
      { ok: false, reasons: ["first_name_too_short"] }
    );
    assert.deepEqual(
      evaluatePplBuyerReadyEligibility(payload({ first: "  J  ", last: "Lee", age: 50 })),
      { ok: false, reasons: ["first_name_too_short"] }
    );
    assert.deepEqual(
      evaluatePplBuyerReadyEligibility(payload({ first: "Ada", last: "L", age: 50 })),
      { ok: false, reasons: ["last_name_too_short"] }
    );
    assert.deepEqual(
      evaluatePplBuyerReadyEligibility(payload({ first: "Ada", last: "  X  ", age: 50 })),
      { ok: false, reasons: ["last_name_too_short"] }
    );
  });

  it("D/E: whitespace / multi-part first or last name is ineligible", () => {
    assert.deepEqual(
      evaluatePplBuyerReadyEligibility(payload({ first: "Mary Ann", last: "Lee", age: 50 })),
      { ok: false, reasons: ["first_name_multipart"] }
    );
    assert.deepEqual(
      evaluatePplBuyerReadyEligibility(payload({ first: "Ada", last: "Van Dyke", age: 50 })),
      { ok: false, reasons: ["last_name_multipart"] }
    );
    assert.deepEqual(
      evaluatePplBuyerReadyEligibility(payload({ first: "Ada\tMarie", last: "Lee", age: 50 })),
      { ok: false, reasons: ["first_name_multipart"] }
    );
  });

  it("does not invent extra name rules for hyphen or apostrophe tokens", () => {
    assert.equal(
      isPplBuyerReadyLead(payload({ first: "Mary-Jane", last: "O'Brien", age: 48 })),
      true
    );
  });

  it("keeps commercial lead-age buckets mandatory and unchanged", () => {
    assert.deepEqual(
      COMMERCE_AGE_BUCKETS.map((bucket) => ({
        key: bucket.key,
        minDaysInclusive: bucket.minDaysInclusive,
        maxDaysExclusive: bucket.maxDaysExclusive,
      })),
      [
        { key: "COMMERCE_1_3_MO", minDaysInclusive: 30, maxDaysExclusive: 90 },
        { key: "COMMERCE_3_6_MO", minDaysInclusive: 90, maxDaysExclusive: 180 },
        { key: "COMMERCE_6_9_MO", minDaysInclusive: 180, maxDaysExclusive: 270 },
        { key: "COMMERCE_9_12_MO", minDaysInclusive: 270, maxDaysExclusive: 365 },
        { key: "COMMERCE_12_MO_PLUS", minDaysInclusive: 365, maxDaysExclusive: null },
      ]
    );
  });

  it("reads the same name precedence as buyer CSV extractors", () => {
    assert.deepEqual(
      readPplBuyerReadyNames({
        first_name: "FlatFirst",
        last_name: "FlatLast",
        contact: { firstName: "NestedFirst", lastName: "NestedLast" },
      }),
      { firstName: "NestedFirst", lastName: "NestedLast" }
    );
  });
});
