import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { lifecycleEventSchema } from "../../schemas/lifecycle-event.schema.js";
import { evaluateRowEligibility } from "./bulk-import-eligibility.service.js";
import {
  detectWithinBatchDuplicates,
  indexParsedRowsForDuplicates,
} from "./bulk-import-duplicate.service.js";
import {
  normalizeBulkImportRowToLifecycle,
  resolveBulkImportLeadId,
} from "./bulk-import-normalizer.service.js";
import { sanitizeZodIssues } from "./bulk-import-row-normalize.service.js";
import {
  isMissingSourceEventRow,
  isSimulationReadyRow,
  summarizeBulkImportRowEligibility,
} from "./bulk-import-simulation-eligibility.service.js";
import { applyFieldMapping, buildCustomAttributeTarget } from "./csv-import-mapping.service.js";
import { parseCsvText } from "./csv-import-parser.service.js";
import type { BulkImportNormalizationOptions } from "./bulk-import.types.js";

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "../../fixtures/bulk-import");

function loadFixture(name: string) {
  return readFileSync(join(fixtureDir, name), "utf8");
}

const ACCEPTANCE_MAPPING = {
  first_name: "first_name",
  last_name: "last_name",
  phone: "phone",
  email: "email",
  state: "state",
  source_lead_id: "source_lead_id",
  branch_of_service: "branch_of_service",
  desired_coverage: "desired_coverage",
  custom_notes: buildCustomAttributeTarget("custom_notes"),
};

const DESTINATION: BulkImportNormalizationOptions = {
  destinationClientAccountId: "vet_life_james_torrey",
  destinationLocationIdGhl: "9xSNvQCbGaPE9YNxgl4B",
};

function normalizeAcceptanceRow(
  row: { rowNumber: number; fields: Record<string, string> },
  batchId: string
) {
  const { canonical, unmapped } = applyFieldMapping(row.fields, ACCEPTANCE_MAPPING);
  const normalized = normalizeBulkImportRowToLifecycle({
    batchId,
    row,
    canonical,
    unmapped,
    options: DESTINATION,
  });
  normalized.client_account_id = DESTINATION.destinationClientAccountId;
  normalized.subaccount_id_ghl = DESTINATION.destinationLocationIdGhl;
  return { canonical, unmapped, normalized };
}

test("acceptance five-row CSV validates lifecycle schema for identity-complete rows", () => {
  const parsed = parseCsvText(loadFixture("acceptance-five-rows.csv"));
  assert.equal(parsed.rows.length, 5);

  for (const row of parsed.rows) {
    const { normalized } = normalizeAcceptanceRow(row, "batch_acceptance");
    const result = lifecycleEventSchema.safeParse(normalized);
    assert.equal(
      result.success,
      true,
      `row ${row.rowNumber} failed schema: ${result.success ? "" : JSON.stringify(sanitizeZodIssues(result.error.issues))}`
    );
  }
});

test("acceptance CSV eligibility expectations without database", () => {
  const parsed = parseCsvText(loadFixture("acceptance-five-rows.csv"));
  const batchId = "batch_acceptance";
  const index = indexParsedRowsForDuplicates(parsed.rows);

  const expectations: Record<number, string> = {
    1: "eligible",
    2: "eligible",
    3: "identity_blocked",
    4: "duplicate_review",
    5: "eligible",
  };

  for (const row of parsed.rows) {
    const { canonical, normalized } = normalizeAcceptanceRow(row, batchId);
    const parsedSchema = lifecycleEventSchema.safeParse(normalized);
    assert.equal(parsedSchema.success, true);

    const lead = resolveBulkImportLeadId(canonical, batchId);
    const withinDupes = detectWithinBatchDuplicates(
      row.rowNumber,
      canonical.phone?.replace(/\D/g, ""),
      canonical.email?.trim().toLowerCase(),
      lead.sourceLeadId,
      index,
      batchId
    );

    const eligibility = evaluateRowEligibility({
      normalized: parsedSchema.data,
      mappingComplete: true,
      mapping: ACCEPTANCE_MAPPING,
      destinationSelected: true,
      destinationReadyForSimulation: true,
      duplicateCandidates: withinDupes,
    });

    assert.equal(
      eligibility.validationStatus,
      expectations[row.rowNumber],
      `row ${row.rowNumber} (${canonical.first_name})`
    );
  }
});

test("simulation summary requires sourceLeadEventId", () => {
  const summary = summarizeBulkImportRowEligibility([
    {
      validationStatus: "eligible",
      sourceLeadEventId: null,
      excluded: false,
      deliveryStatus: "pending",
    },
    {
      validationStatus: "eligible",
      sourceLeadEventId: "sle_1",
      excluded: false,
      deliveryStatus: "pending",
    },
    {
      validationStatus: "eligible",
      sourceLeadEventId: "sle_2",
      excluded: false,
      deliveryStatus: "pending",
    },
  ]);

  assert.equal(summary.identityEligible, 3);
  assert.equal(summary.missingSourceEvent, 1);
  assert.equal(summary.eligibleForSimulation, 2);
  assert.equal(summary.normalizedSourceEvents, 2);
});

test("schema-invalid row must not be simulation-ready", () => {
  const row = {
    validationStatus: "failed" as const,
    sourceLeadEventId: null,
    excluded: false,
    deliveryStatus: "pending" as const,
  };
  assert.equal(isSimulationReadyRow(row), false);
  assert.equal(isMissingSourceEventRow(row), false);
});

test("eligible without source event is normalization incomplete", () => {
  const row = {
    validationStatus: "eligible" as const,
    sourceLeadEventId: null,
    excluded: false,
    deliveryStatus: "pending" as const,
  };
  assert.equal(isSimulationReadyRow(row), false);
  assert.equal(isMissingSourceEventRow(row), true);
});

test("eligible row with source event is simulation-ready", () => {
  const row = {
    validationStatus: "eligible" as const,
    sourceLeadEventId: "sle_123",
    excluded: false,
    deliveryStatus: "pending" as const,
  };
  assert.equal(isSimulationReadyRow(row), true);
});
