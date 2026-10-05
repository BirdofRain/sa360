import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAgedInventoryNormalizedPayload,
  mergeRecoveredConsumerAge,
  readExplicitStoredConsumerAge,
  recoverStoredConsumerAge,
  resolveAgedImportConsumerAge,
} from "./aged-inventory-import-consumer-age.js";
import {
  extractAgedInventoryCanonicalFields,
  suggestAgedInventoryMappings,
} from "./aged-inventory-import-mapping.service.js";
import { AGED_INVENTORY_HISTORICAL_NORMALIZED_KEYS } from "./aged-inventory-import.types.js";
import { isPplBuyerReadyLead } from "../ppl-fulfillment/ppl-buyer-ready-eligibility.js";

const evaluatedAt = new Date("2026-10-05T00:00:00.000Z");

test("aged CSV canonical mapping now captures consumer age and still ignores lead date", () => {
  const suggestions = suggestAgedInventoryMappings([
    "first_name",
    "Age",
    "DOB/AGE",
    "generated_at",
  ]);
  const byColumn = Object.fromEntries(
    suggestions.map((row) => [row.csvColumn, row.suggestedCanonical])
  );
  assert.equal(byColumn.Age, "consumer_age");
  assert.equal(byColumn["DOB/AGE"], "consumer_age");
  assert.equal(byColumn.generated_at, "generated_at");

  const fields = extractAgedInventoryCanonicalFields(
    { age: "62", generated_at: "2026-03-01", first_name: "Ada", last_name: "Stone" },
    { age: "consumer_age", generated_at: "generated_at", first_name: "first_name", last_name: "last_name" }
  );
  assert.equal(fields.consumerAgeRaw, "62");
  const resolved = resolveAgedImportConsumerAge(fields.consumerAgeRaw, evaluatedAt);
  assert.equal(resolved.consumerAge, "62");

  const generatedOnly = resolveAgedImportConsumerAge(null, evaluatedAt);
  assert.equal(generatedOnly.consumerAge, null);
});

test("normalized payload persists parsed consumer age and does not invent it from generatedAt", () => {
  const generatedAt = new Date("2026-08-01T00:00:00.000Z");
  const withAge = buildAgedInventoryNormalizedPayload({
    firstName: "Ada",
    lastName: "Stone",
    email: "ada@example.test",
    phoneE164: "+15550105501",
    state: "IN",
    generatedAt,
    nicheKey: "vet",
    productType: null,
    consumerAge: "62",
  });
  assert.equal(withAge.consumer_age, "62");
  assert.equal(
    (withAge.lead_details as { consumer_age: string }).consumer_age,
    "62"
  );
  assert.equal(isPplBuyerReadyLead(withAge), true);

  const historical = buildAgedInventoryNormalizedPayload({
    firstName: "Ada",
    lastName: "Stone",
    email: "ada@example.test",
    phoneE164: "+15550105501",
    state: "IN",
    generatedAt,
    nicheKey: "vet",
    productType: null,
    consumerAge: null,
  });
  assert.equal("consumer_age" in historical, false);
  assert.equal("lead_details" in historical, false);
  assert.deepEqual(Object.keys(historical).sort(), [...AGED_INVENTORY_HISTORICAL_NORMALIZED_KEYS].sort());
  assert.equal(isPplBuyerReadyLead(historical), false);
  assert.equal(
    recoverStoredConsumerAge(
      {
        normalizedPayloadJson: historical,
        rawPayloadJson: { importRequestId: "req", rowNumber: 1 },
        metadataJson: { importRequestId: "req", rowNumber: 1, classification: "ready" },
        enrichmentMetadataJson: {
          sourceLane: "aged_inventory_csv",
          generatedAt: generatedAt.toISOString(),
          importClass: "aged_inventory_csv",
        },
      },
      evaluatedAt
    ).age,
    null
  );
});

test("recovery reads stored consumer age and ignores generatedAt", () => {
  assert.equal(
    readExplicitStoredConsumerAge(
      { generatedAt: "1979-05-13T00:00:00.000Z", generated_at: "1979-05-13", ageDays: 45 },
      evaluatedAt
    ),
    null
  );
  assert.deepEqual(
    recoverStoredConsumerAge(
      {
        normalizedPayloadJson: { firstName: "Ada", lastName: "Stone", generated_at: "2026-03-01" },
        rawPayloadJson: { master: { dob_age_raw: "70" } },
        metadataJson: {},
        enrichmentMetadataJson: { generatedAt: "2026-03-01T00:00:00.000Z" },
      },
      evaluatedAt
    ),
    { age: "70", location: "raw_payload" }
  );

  const merged = mergeRecoveredConsumerAge(
    { firstName: "Ada", lastName: "Stone", phone_e164: "+15550105501" },
    "70"
  );
  assert.equal(merged.consumer_age, "70");
  assert.equal((merged.lead_details as { consumer_age: string }).consumer_age, "70");
  assert.equal(merged.firstName, "Ada");
  assert.equal(isPplBuyerReadyLead(merged), true);
});
