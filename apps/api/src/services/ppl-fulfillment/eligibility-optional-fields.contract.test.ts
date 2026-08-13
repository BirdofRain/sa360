import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { fingerprintIdentityValue } from "../../lib/identity-fingerprint.js";
import { readNormalizedLeadIdentity } from "../../lib/normalized-lead-identity.js";
import { extractBuyerCsvV2Fields } from "./buyer-csv-export.service.js";
import { OPTIONAL_BUYER_SALES_CONTEXT_FIELDS } from "./buyer-lead-fields.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function identityKey(payload: unknown): string {
  const identity = readNormalizedLeadIdentity(payload);
  return JSON.stringify({
    phone: identity?.phoneE164
      ? fingerprintIdentityValue("phone", identity.phoneE164)
      : null,
    email: identity?.email ? fingerprintIdentityValue("email", identity.email) : null,
    state: identity?.state ?? null,
  });
}

describe("optional sales-context fields never affect eligibility", () => {
  it("keeps identity fingerprints identical with blank or populated optional fields", () => {
    const base = {
      contact: {
        first_name: "Ada",
        last_name: "Lovelace",
        phone_e164: "+15551234567",
        email: "ada@example.com",
        state: "NC",
      },
    };
    const withOptional = {
      ...base,
      lead_details: {
        beneficiary: "Spouse",
        coverage_amount: "25000",
        niche: {
          branch_of_service: "Army",
          disability_rating: "70%",
          rig_type: "Sleeper",
          company_or_independent: "Company",
          healthcare_profession: "RN",
          primary_concern: "Income",
          homeowner: "yes",
          house_type: "Single Family",
        },
      },
    };
    const blankOptional = {
      ...base,
      lead_details: {
        beneficiary: "",
        coverage_amount: "",
        niche: Object.fromEntries(
          OPTIONAL_BUYER_SALES_CONTEXT_FIELDS.filter(
            (field) => field !== "beneficiary" && field !== "coverage_amount"
          ).map((field) => [field, ""])
        ),
      },
    };

    assert.equal(identityKey(base), identityKey(withOptional));
    assert.equal(identityKey(base), identityKey(blankOptional));

    for (const niche of ["vet", "trucker", "nurse", "mortgage"]) {
      const blankRow = extractBuyerCsvV2Fields({
        normalizedPayloadJson: blankOptional,
        generatedAt: new Date("2024-01-01T00:00:00.000Z"),
        nicheKey: niche,
      });
      const filledRow = extractBuyerCsvV2Fields({
        normalizedPayloadJson: withOptional,
        generatedAt: new Date("2024-01-01T00:00:00.000Z"),
        nicheKey: niche,
      });
      assert.equal(blankRow.phone, filledRow.phone);
      assert.equal(blankRow.email, filledRow.email);
      assert.equal(blankRow.state, filledRow.state);
      // Blank optional cells are allowed and do not throw.
      for (const field of OPTIONAL_BUYER_SALES_CONTEXT_FIELDS) {
        if (field in blankRow) assert.equal(typeof blankRow[field], "string");
      }
    }
  });

  it("selection service does not import optional buyer sales-context fields", () => {
    const selectionSource = readFileSync(
      join(__dirname, "inventory-selection.service.ts"),
      "utf8"
    );
    for (const field of OPTIONAL_BUYER_SALES_CONTEXT_FIELDS) {
      assert.equal(
        selectionSource.includes(field),
        false,
        `inventory-selection must not reference optional field ${field}`
      );
    }
    assert.equal(selectionSource.includes("buyer-lead-fields"), false);
  });
});
