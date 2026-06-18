import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCsvText } from "./csv-import-parser.service.js";
import {
  buildMappingFromSuggestions,
  listMissingRequiredMappings,
  suggestFieldMappings,
} from "./csv-import-mapping.service.js";
import {
  asWizardStepJson,
  extractHeadersFromRawRows,
  inferMappingConfirmed,
  isRetryableSimulationFailureRow,
  mergeBulkImportWizardStepJson,
  reconstructBulkImportWizardMetadata,
  sanitizeSimulationRowResult,
} from "./bulk-import-wizard-metadata.service.js";

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "../../fixtures/bulk-import");

test("mergeBulkImportWizardStepJson preserves durable metadata", () => {
  const merged = asWizardStepJson(
    mergeBulkImportWizardStepJson(
      {
        step: "map",
        headers: ["first_name", "phone"],
        suggestions: [{ csvColumn: "first_name" }],
        previewRows: [{ rowNumber: 1, fields: { first_name: "A" } }],
        mappingConfirmed: true,
      },
      {
        step: "review",
        destinationClientDisplayName: "Demo Client",
      }
    )
  );

  assert.deepEqual(merged.headers, ["first_name", "phone"]);
  assert.equal(merged.mappingConfirmed, true);
  assert.equal(merged.step, "review");
  assert.equal(merged.destinationClientDisplayName, "Demo Client");
});

test("upload-style wizard metadata always starts at map unconfirmed", () => {
  const csv = readFileSync(join(fixtureDir, "acceptance-five-rows.csv"), "utf8");
  const parsed = parseCsvText(csv);
  const suggestions = suggestFieldMappings(parsed.headers);
  const mapping = buildMappingFromSuggestions(suggestions);
  const missingRequired = listMissingRequiredMappings(mapping);

  const wizard = asWizardStepJson(
    mergeBulkImportWizardStepJson(null, {
      step: "map",
      headers: parsed.headers,
      suggestions,
      previewRows: parsed.rows.slice(0, 2),
      missingRequired,
      mappingConfirmed: false,
    })
  );

  assert.equal(wizard.step, "map");
  assert.equal(wizard.mappingConfirmed, false);
  assert.equal(missingRequired.length, 0);
});

test("reconstructBulkImportWizardMetadata rebuilds headers from raw rows", () => {
  const csv = readFileSync(join(fixtureDir, "acceptance-five-rows.csv"), "utf8");
  const parsed = parseCsvText(csv);
  const suggestions = suggestFieldMappings(parsed.headers);
  const mapping = buildMappingFromSuggestions(suggestions);
  const rows = parsed.rows.map((row, index) => ({
    rowNumber: row.rowNumber,
    rawRowJson: row.fields,
    id: `row-${index}`,
  }));

  const result = reconstructBulkImportWizardMetadata({
    batch: {
      wizardStepJson: { step: "simulate" },
      mappingJson: mapping,
      status: "ready_for_simulation",
      destinationClientAccountId: "client-1",
      uploadedBy: "operator",
    },
    rows,
  });

  assert.equal(result.repaired, true);
  assert.deepEqual(result.wizardStepJson.headers, parsed.headers);
  assert.ok(Array.isArray(result.wizardStepJson.suggestions));
  assert.ok(Array.isArray(result.wizardStepJson.previewRows));
  assert.equal(result.wizardStepJson.mappingConfirmed, true);
});

test("inferMappingConfirmed is false for fresh upload metadata", () => {
  assert.equal(
    inferMappingConfirmed({
      wizardStepJson: { step: "map", mappingConfirmed: false },
      mappingJson: { first_name: "first_name" },
      status: "mapping_required",
      destinationClientAccountId: null,
    }),
    false
  );
});

test("isRetryableSimulationFailureRow clears simulation-only failures before renormalization", () => {
  const batch = { status: "ready_for_simulation", approvedAt: null };
  assert.equal(
    isRetryableSimulationFailureRow(
      {
        deliveryStatus: "failed",
        ghlContactId: null,
        ghlOpportunityId: null,
        deliveryAttempts: 0,
        errorCode: "simulation_failed",
        errorSummary: "destination_not_ready",
      },
      batch
    ),
    true
  );
  assert.equal(
    isRetryableSimulationFailureRow(
      {
        deliveryStatus: "failed",
        ghlContactId: "ghl-1",
        ghlOpportunityId: null,
        deliveryAttempts: 1,
        errorCode: null,
        errorSummary: "live_failed",
      },
      { status: "partial_success", approvedAt: new Date() }
    ),
    false
  );
});

test("sanitizeSimulationRowResult exposes safe per-row simulation reasons", () => {
  const failed = sanitizeSimulationRowResult({
    rowId: "row-1",
    rowNumber: 2,
    leadName: "Jane Doe",
    ok: false,
    reason: "destination_not_ready",
    error: "destination_not_ready",
  });

  assert.equal(failed.status, "failed");
  assert.equal(failed.errorCode, "simulation_failed");
  assert.equal(failed.reason, "destination_not_ready");
  assert.equal(failed.retryable, true);
});

test("extractHeadersFromRawRows preserves first-row column order", () => {
  const headers = extractHeadersFromRawRows([
    { rowNumber: 1, rawRowJson: { first_name: "A", phone: "1", email: "a@x.com" } },
    { rowNumber: 2, rawRowJson: { phone: "2", extra: "x", first_name: "B" } },
  ]);
  assert.deepEqual(headers, ["first_name", "phone", "email", "extra"]);
});
