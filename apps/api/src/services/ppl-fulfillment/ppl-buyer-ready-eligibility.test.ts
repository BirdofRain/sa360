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
  phone?: unknown;
}) {
  return {
    contact: {
      first_name: input.first,
      last_name: input.last,
      phone_e164: input.phone ?? "+12025550100",
      email: "ready@example.test",
      state: "NC",
    },
    lead_details: input.age === undefined ? undefined : { consumer_age: input.age },
    consumer_age: input.flatAge,
  };
}

function reasonsOf(result: ReturnType<typeof evaluatePplBuyerReadyEligibility>): string[] {
  return result.ok ? [] : [...result.reasons];
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
    assert.equal(result.resolvedAge.source, "normalized_consumer_age");
    assert.equal(isPplBuyerReadyLead(payload({ first: "Ada", last: "Lovelace", age: "62" })), true);
  });

  it("missing consumer age is a hard fulfillment blocker", () => {
    const missing = evaluatePplBuyerReadyEligibility(payload({ first: "Ada", last: "Lee" }));
    assert.deepEqual(reasonsOf(missing), ["consumer_age_missing"]);
    assert.equal(missing.resolvedAge.status, "missing");
    assert.equal(isPplBuyerReadyLead(payload({ first: "Ada", last: "Lee" })), false);

    const blank = evaluatePplBuyerReadyEligibility(
      payload({ first: "Ada", last: "Lee", age: "   " })
    );
    assert.deepEqual(reasonsOf(blank), ["consumer_age_missing"]);
  });

  it("an unusable consumer age is invalid, not merely missing", () => {
    const malformed = evaluatePplBuyerReadyEligibility(
      payload({ first: "Ada", last: "Lee", age: "not-an-age" })
    );
    assert.deepEqual(reasonsOf(malformed), ["consumer_age_invalid"]);
    assert.equal(malformed.resolvedAge.status, "invalid");
  });

  it("never derives consumer age from generatedAt or lead age", () => {
    const leadDateOnly = evaluatePplBuyerReadyEligibility({
      contact: { first_name: "Ada", last_name: "Lee", phone_e164: "+12025550100" },
      generated_at: "1979-05-13T00:00:00.000Z",
      generatedAt: "1979-05-13T00:00:00.000Z",
      lead_date: "1979-05-13",
    });
    assert.deepEqual(reasonsOf(leadDateOnly), ["consumer_age_missing"]);
    assert.equal(leadDateOnly.resolvedAge.age, null);
  });

  it("prefers an explicit DOB over a stored age and recomputes at evaluation time", () => {
    const result = evaluatePplBuyerReadyEligibility(
      {
        contact: { first_name: "Ada", last_name: "Lee", phone_e164: "+12025550100" },
        lead_details: { consumer_age: "55", date_of_birth: "1963-05-01" },
      },
      { evaluatedAt: new Date("2026-04-30T00:00:00.000Z") }
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    // Birthday not yet reached on 2026-04-30.
    assert.equal(result.consumerAge, "62");
    assert.equal(result.resolvedAge.exactFromDob, true);
    assert.equal(result.resolvedAge.source, "normalized_dob");
  });

  it("recovers an explicit age that still only lives in raw / metadata / enrichment", () => {
    const base = { contact: { first_name: "Ada", last_name: "Lee", phone_e164: "+12025550100" } };

    const fromRaw = evaluatePplBuyerReadyEligibility(base, {
      rawPayloadJson: { consumer_age: "84" },
    });
    assert.equal(fromRaw.ok, true);
    assert.equal(fromRaw.resolvedAge.source, "raw_consumer_age");

    const fromMetadata = evaluatePplBuyerReadyEligibility(base, {
      metadataJson: { consumer_age: "71" },
    });
    assert.equal(fromMetadata.ok, true);
    assert.equal(fromMetadata.resolvedAge.source, "metadata");

    const fromEnrichment = evaluatePplBuyerReadyEligibility(base, {
      enrichmentMetadataJson: { consumer_age: "69" },
    });
    assert.equal(fromEnrichment.ok, true);
    assert.equal(fromEnrichment.resolvedAge.source, "enrichment");
  });

  it("accepts age 85 and 86 and rejects 87 as over the maximum sellable age", () => {
    assert.equal(isPplBuyerReadyLead(payload({ first: "Ada", last: "Lee", age: 85 })), true);
    assert.equal(isPplBuyerReadyLead(payload({ first: "Ada", last: "Lee", age: 86 })), true);

    const over = evaluatePplBuyerReadyEligibility(payload({ first: "Ada", last: "Lee", age: 87 }));
    assert.deepEqual(reasonsOf(over), ["consumer_age_over_maximum"]);
    assert.equal(over.resolvedAge.status, "over_maximum_age");
    assert.equal(over.resolvedAge.age, 87);
  });

  it("rejects a DOB that turns the person 87 before reservation", () => {
    const beforeBirthday = evaluatePplBuyerReadyEligibility(
      {
        contact: { first_name: "Ada", last_name: "Lee", phone_e164: "+12025550100" },
        lead_details: { date_of_birth: "1939-06-15" },
      },
      { evaluatedAt: new Date("2026-06-14T00:00:00.000Z") }
    );
    assert.equal(beforeBirthday.ok, true);
    assert.equal(beforeBirthday.resolvedAge.age, 86);

    const afterBirthday = evaluatePplBuyerReadyEligibility(
      {
        contact: { first_name: "Ada", last_name: "Lee", phone_e164: "+12025550100" },
        lead_details: { date_of_birth: "1939-06-15" },
      },
      { evaluatedAt: new Date("2026-06-15T00:00:00.000Z") }
    );
    assert.deepEqual(reasonsOf(afterBirthday), ["consumer_age_over_maximum"]);
    assert.equal(afterBirthday.resolvedAge.age, 87);
  });

  it("B/C: one-character first or last name is ineligible after trim", () => {
    assert.deepEqual(
      reasonsOf(evaluatePplBuyerReadyEligibility(payload({ first: "A", last: "Lee", age: 50 }))),
      ["first_name_too_short"]
    );
    assert.deepEqual(
      reasonsOf(
        evaluatePplBuyerReadyEligibility(payload({ first: "  J  ", last: "Lee", age: 50 }))
      ),
      ["first_name_too_short"]
    );
    assert.deepEqual(
      reasonsOf(evaluatePplBuyerReadyEligibility(payload({ first: "Ada", last: "L", age: 50 }))),
      ["last_name_too_short"]
    );
    assert.deepEqual(
      reasonsOf(
        evaluatePplBuyerReadyEligibility(payload({ first: "Ada", last: "  X  ", age: 50 }))
      ),
      ["last_name_too_short"]
    );
  });

  it("D/E: whitespace / multi-part first or last name is ineligible", () => {
    assert.deepEqual(
      reasonsOf(
        evaluatePplBuyerReadyEligibility(payload({ first: "Mary Ann", last: "Lee", age: 50 }))
      ),
      ["first_name_multipart"]
    );
    assert.deepEqual(
      reasonsOf(
        evaluatePplBuyerReadyEligibility(payload({ first: "Ada", last: "Van Dyke", age: 50 }))
      ),
      ["last_name_multipart"]
    );
    assert.deepEqual(
      reasonsOf(
        evaluatePplBuyerReadyEligibility(payload({ first: "Ada\tMarie", last: "Lee", age: 50 }))
      ),
      ["first_name_multipart"]
    );
  });

  it("reports name and age rejections together", () => {
    assert.deepEqual(
      reasonsOf(evaluatePplBuyerReadyEligibility(payload({ first: "A", last: "Lee" }))),
      ["first_name_too_short", "consumer_age_missing"]
    );
  });

  it("does not invent extra name rules for hyphen or apostrophe tokens", () => {
    assert.equal(
      isPplBuyerReadyLead(payload({ first: "Mary-Jane", last: "O'Brien", age: 48 })),
      true
    );
  });

  it("accepts short legitimate names and does not reject them as unfamiliar", () => {
    assert.equal(isPplBuyerReadyLead(payload({ first: "Al", last: "Ng", age: 48 })), true);
    assert.equal(isPplBuyerReadyLead(payload({ first: "Jo", last: "Li", age: 48 })), true);
    const flagged = evaluatePplBuyerReadyEligibility(
      payload({ first: "Al", last: "Ng", age: 48 })
    );
    assert.equal(flagged.ok, true);
    if (!flagged.ok) return;
    assert.deepEqual(flagged.reviewFlags, []);
  });

  it("rejects blank, truncated, overlong, and structurally invalid phones", () => {
    const missing = evaluatePplBuyerReadyEligibility({
      contact: { first_name: "Ada", last_name: "Lee", email: "ready@example.test", state: "NC" },
      lead_details: { consumer_age: 50 },
    });
    assert.deepEqual(reasonsOf(missing), ["phone_missing"]);

    const truncated = evaluatePplBuyerReadyEligibility(
      payload({ first: "Ada", last: "Lee", age: 50, phone: "202555010" })
    );
    assert.deepEqual(reasonsOf(truncated), ["phone_truncated"]);

    const overlong = evaluatePplBuyerReadyEligibility(
      payload({ first: "Ada", last: "Lee", age: 50, phone: "120255501001" })
    );
    assert.deepEqual(reasonsOf(overlong), ["phone_overlong"]);

    const structural = evaluatePplBuyerReadyEligibility(
      payload({ first: "Ada", last: "Lee", age: 50, phone: "1025550100" })
    );
    assert.deepEqual(reasonsOf(structural), ["phone_structurally_invalid"]);
  });

  it("does not pad truncated phones or clip overlong phones to force a match", () => {
    const truncated = evaluatePplBuyerReadyEligibility(
      payload({ first: "Ada", last: "Lee", age: 50, phone: "20255501" })
    );
    assert.equal(truncated.ok, false);
    assert.equal(truncated.phoneE164, null);

    const overlong = evaluatePplBuyerReadyEligibility(
      payload({ first: "Ada", last: "Lee", age: 50, phone: "+1202555010012" })
    );
    assert.equal(overlong.ok, false);
    assert.equal(overlong.phoneE164, null);
  });

  it("normalizes valid formatted US numbers to canonical E.164", () => {
    const result = evaluatePplBuyerReadyEligibility(
      payload({ first: "Ada", last: "Lee", age: 50, phone: "(202) 555-0100" })
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.phoneE164, "+12025550100");
  });

  it("rejects names that contain digits", () => {
    assert.deepEqual(
      reasonsOf(evaluatePplBuyerReadyEligibility(payload({ first: "Ada9", last: "Lee", age: 50 }))),
      ["first_name_has_digits"]
    );
    assert.deepEqual(
      reasonsOf(evaluatePplBuyerReadyEligibility(payload({ first: "Ada", last: "L33", age: 50 }))),
      ["last_name_has_digits"]
    );
  });

  it("flags placeholder and suspicious names for review without auto-rejecting them", () => {
    const placeholder = evaluatePplBuyerReadyEligibility(
      payload({ first: "Test", last: "Unknown", age: 50 })
    );
    assert.equal(placeholder.ok, true);
    assert.deepEqual(placeholder.reviewFlags, ["placeholder_first_name", "placeholder_last_name"]);

    const suspicious = evaluatePplBuyerReadyEligibility(
      payload({ first: "xxxx", last: "Lee", age: 50 })
    );
    assert.equal(suspicious.ok, true);
    assert.deepEqual(suspicious.reviewFlags, ["suspicious_first_name"]);
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

  it("does not apply commercial phone quality to phone-optional niches", () => {
    const missingPhone = {
      contact: { first_name: "Ada", last_name: "Lee", email: "ready@example.test", state: "NC" },
      lead_details: { consumer_age: 50 },
    };
    const truncated = payload({ first: "Ada", last: "Lee", age: 50, phone: "20255501" });

    assert.deepEqual(reasonsOf(evaluatePplBuyerReadyEligibility(missingPhone)), ["phone_missing"]);
    assert.equal(
      evaluatePplBuyerReadyEligibility(missingPhone, { nicheKey: "mortgage" }).ok,
      true
    );
    assert.equal(
      evaluatePplBuyerReadyEligibility(truncated, { nicheKey: "solar" }).ok,
      true
    );
    assert.deepEqual(
      reasonsOf(evaluatePplBuyerReadyEligibility(missingPhone, { nicheKey: "trucker" })),
      ["phone_missing"]
    );
    assert.deepEqual(
      reasonsOf(evaluatePplBuyerReadyEligibility(missingPhone, { nicheKey: "vet" })),
      ["phone_missing"]
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
