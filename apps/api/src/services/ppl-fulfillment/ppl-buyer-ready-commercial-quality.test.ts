import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  csvEscapePhoneAsText,
  formatBuyerPhoneSpreadsheetText,
} from "../phone-e164.service.js";
import {
  evaluatePplBuyerReadyEligibility,
  type PplBuyerReadyRejectionReason,
} from "./ppl-buyer-ready-eligibility.js";
import { serializeBuyerCsvCustomerPresentation } from "./buyer-csv-customer-presentation.js";

/**
 * Synthetic commercial-quality cases modeled on the Vanessa Powell delivery
 * audit (blank / short / long / digit-name / invalid NANP). No real PII.
 */
function commercialPayload(input: {
  first?: string;
  last?: string;
  phone?: string | number | null;
  age?: number;
}) {
  return {
    contact: {
      first_name: input.first ?? "Ada",
      last_name: input.last ?? "Lee",
      phone_e164: input.phone ?? "+12025550100",
      email: "synthetic.ready@example.test",
      state: "NC",
    },
    lead_details: { consumer_age: input.age ?? 58 },
  };
}

function reasonsOf(
  result: ReturnType<typeof evaluatePplBuyerReadyEligibility>
): PplBuyerReadyRejectionReason[] {
  return result.ok ? [] : [...result.reasons];
}

describe("commercial aged Trucker/Veteran buyer-ready quality", () => {
  it("counts the preventable audit categories against synthetic records", () => {
    const records = [
      { tag: "blank", payload: commercialPayload({ phone: "" }) },
      { tag: "truncated", payload: commercialPayload({ phone: "20255501" }) },
      { tag: "overlong", payload: commercialPayload({ phone: "1202555010012" }) },
      { tag: "digits_in_first", payload: commercialPayload({ first: "Ada4" }) },
      { tag: "invalid_npa", payload: commercialPayload({ phone: "1025550100" }) },
      { tag: "invalid_nxx", payload: commercialPayload({ phone: "2021550100" }) },
      { tag: "n11", payload: commercialPayload({ phone: "2115550100" }) },
      { tag: "ready_trucker", payload: commercialPayload({ phone: "(202) 555-0100" }) },
      { tag: "ready_vet", payload: commercialPayload({ first: "Al", last: "Ng" }) },
    ];

    const rejected: Record<string, number> = {};
    let accepted = 0;
    for (const record of records) {
      const result = evaluatePplBuyerReadyEligibility(record.payload);
      if (result.ok) {
        accepted += 1;
        continue;
      }
      for (const reason of result.reasons) {
        rejected[reason] = (rejected[reason] ?? 0) + 1;
      }
    }

    assert.equal(accepted, 2);
    assert.equal(rejected.phone_missing, 1);
    assert.equal(rejected.phone_truncated, 1);
    assert.equal(rejected.phone_overlong, 1);
    assert.equal(rejected.first_name_has_digits, 1);
    assert.equal(rejected.phone_structurally_invalid, 3);
  });

  it("keeps customer package phones as quoted text E.164", () => {
    assert.equal(formatBuyerPhoneSpreadsheetText("(202) 555-0199"), "+12025550199");
    assert.equal(csvEscapePhoneAsText("2025550199"), '"+12025550199"');
    const csv = serializeBuyerCsvCustomerPresentation(
      [
        {
          lead_date: "2026-10-12",
          niche: "trucker",
          first_name: "Ada",
          last_name: "Lee",
          phone: "2025550199",
          email: "synthetic.package@example.test",
          state: "TX",
          age: "61",
        },
      ],
      "trucker"
    );
    assert.match(csv, /"\+12025550199"/);
    assert.doesNotMatch(csv, /(?<!")\+12025550199(?!")/);
  });

  it("reports all rejection reasons together for operator review", () => {
    const result = evaluatePplBuyerReadyEligibility(
      commercialPayload({ first: "A4", last: "Lee", phone: "202555", age: undefined })
    );
    assert.deepEqual(reasonsOf(result).sort(), [
      "first_name_has_digits",
      "phone_truncated",
    ]);
  });
});
