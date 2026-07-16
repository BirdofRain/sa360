import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { buildAgedInventoryErrorReportCsv } from "./aged-inventory-import-error-report.service.js";
import { buildAgedInventoryImportPreview } from "./aged-inventory-import-preview.service.js";
import {
  buildAgedInventoryMappingFromSuggestions,
  suggestAgedInventoryMappings,
  validateAgedInventoryMapping,
} from "./aged-inventory-import-mapping.service.js";

const fixture = readFileSync(
  join(process.cwd(), "src/fixtures/aged-inventory-import/synthetic-aged-batch.csv"),
  "utf8"
);

test("aged inventory preview is read-only and classifies rows", async () => {
  const headers = fixture.trim().split("\n")[0]!.split(",");
  const suggestions = suggestAgedInventoryMappings(headers);
  const mapping = {
    ...buildAgedInventoryMappingFromSuggestions(suggestions),
    external_lead_id: "source_lead_id",
    generated_date: "generated_at",
  };
  const mappingErrors = validateAgedInventoryMapping(mapping);
  assert.equal(mappingErrors.length, 0, mappingErrors.join(","));

  const preview = await buildAgedInventoryImportPreview({
    fileName: "synthetic-aged-batch.csv",
    csvText: fixture,
    mapping,
    defaultNicheKey: "vet",
  });
  assert.equal(preview.ok, true);
  if (!preview.ok) return;
  assert.equal(preview.writesPerformed, 0);
  assert.ok(preview.summary.total >= 8);
  assert.ok(preview.summary.invalid > 0);
  assert.ok(preview.summary.duplicate > 0);
  assert.ok(preview.rowPreviews.every((r) => !JSON.stringify(r).includes("@example.test")));
});

test("error report contains no raw PII", async () => {
  const preview = await buildAgedInventoryImportPreview({
    fileName: "synthetic-aged-batch.csv",
    csvText: fixture,
    mapping: {
      external_lead_id: "source_lead_id",
      first_name: "first_name",
      last_name: "last_name",
      phone: "phone",
      email: "email",
      state: "state",
      generated_date: "generated_at",
      niche: "niche",
    },
    defaultNicheKey: "vet",
  });
  assert.equal(preview.ok, true);
  if (!preview.ok) return;
  const csv = buildAgedInventoryErrorReportCsv(
    preview.rowPreviews.map((row) => ({
      rowNumber: row.rowNumber,
      sourceLeadId: row.maskedExternalLeadId,
      maskedSourceLeadId: row.maskedExternalLeadId,
      firstName: null,
      lastName: null,
      phoneE164: null,
      email: null,
      state: row.state,
      generatedAt: null,
      generatedAtSource: null,
      nicheKey: null,
      productType: null,
      sourceProviderLabel: null,
      campaignName: null,
      ageDays: null,
      ageBandKey: row.ageBandKey,
      classification: row.classification as never,
      blockerCodes: row.blockerCodes,
      correctionHint: null,
      phoneFingerprint: null,
      emailFingerprint: null,
    }))
  );
  assert.ok(!csv.includes("@example.test"));
  assert.ok(!csv.includes("+1555"));
  assert.ok(!csv.includes("DEMO_A"));
});
