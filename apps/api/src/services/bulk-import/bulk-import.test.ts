import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { BULK_IMPORT_APPROVE_DELIVERY_CONFIRMATION } from "@sa360/shared";
import { detectCsvDelimiter, parseCsvText } from "./csv-import-parser.service.js";
import {
  applyFieldMapping,
  listMissingRequiredMappings,
  suggestFieldMappings,
} from "./csv-import-mapping.service.js";
import {
  resolveBulkImportLeadId,
  normalizeBulkImportRowToLifecycle,
} from "./bulk-import-normalizer.service.js";
import {
  buildWithinBatchDuplicateIndex,
  detectWithinBatchDuplicates,
} from "./bulk-import-duplicate.service.js";
import { evaluateRowEligibility } from "./bulk-import-eligibility.service.js";
import { lifecycleEventSchema } from "../../schemas/lifecycle-event.schema.js";

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "../../fixtures/bulk-import");

function loadFixture(name: string) {
  return readFileSync(join(fixtureDir, name), "utf8");
}

test("detectCsvDelimiter supports comma semicolon and tab", () => {
  assert.equal(detectCsvDelimiter("a,b,c"), ",");
  assert.equal(detectCsvDelimiter("a;b;c"), ";");
  assert.equal(detectCsvDelimiter("a\tb\tc"), "\t");
});

test("parseCsvText handles quoted commas and preserves leading zeros", () => {
  const parsed = parseCsvText(loadFixture("quoted-commas.csv"));
  assert.equal(parsed.rows[0]?.fields.name, "Comma, Inside");
  const leadingZero = parseCsvText(loadFixture("leading-zero-phone.csv"));
  assert.equal(leadingZero.rows[0]?.fields.phone, "01234567890");
});

test("suggestFieldMappings maps common vendor aliases", () => {
  const parsed = parseCsvText(loadFixture("alternate-header-aliases.csv"));
  const suggestions = suggestFieldMappings(parsed.headers);
  const byCol = Object.fromEntries(suggestions.map((s) => [s.csvColumn, s.suggestedCanonical]));
  assert.equal(byCol["FName"], "first_name");
  assert.equal(byCol["Phone Number"], "phone");
  assert.equal(byCol["Lead ID"], "source_lead_id");
});

test("stable generated lead ID when source_lead_id absent", () => {
  const a = resolveBulkImportLeadId({ phone: "+15550101001", email: "a@example.test" }, "batch_1", "GOAT");
  const b = resolveBulkImportLeadId({ phone: "+15550101001", email: "a@example.test" }, "batch_1", "GOAT");
  assert.equal(a.sourceLeadIdGenerated, true);
  assert.equal(a.sourceLeadId, b.sourceLeadId);
  assert.match(a.sourceLeadId, /^gen-[a-f0-9]{16}$/);
});

test("explicit source_lead_id is not generated", () => {
  const { sourceLeadId, sourceLeadIdGenerated } = resolveBulkImportLeadId(
    { source_lead_id: "GOAT-1001" },
    "batch_1"
  );
  assert.equal(sourceLeadId, "GOAT-1001");
  assert.equal(sourceLeadIdGenerated, false);
});

test("unknown columns preserved as unmapped", () => {
  const parsed = parseCsvText(loadFixture("unknown-columns.csv"));
  const mapping = {
    first_name: "first_name",
    last_name: "last_name",
    phone: "phone",
    email: "email",
    source_lead_id: "source_lead_id",
    custom_vendor_field: "__unmapped__",
    notes: "__unmapped__",
  };
  const { unmapped } = applyFieldMapping(parsed.rows[0]!.fields, mapping);
  assert.ok(unmapped.some((u) => u.key === "custom_vendor_field"));
});

test("identity eligibility requires name and phone", () => {
  const parsed = parseCsvText(loadFixture("missing-phone.csv"));
  const row = parsed.rows[0]!;
  const { canonical, unmapped } = applyFieldMapping(row.fields, {
    first_name: "first_name",
    last_name: "last_name",
    email: "email",
    source_lead_id: "source_lead_id",
  });
  const normalized = normalizeBulkImportRowToLifecycle({
    batchId: "batch_test",
    row,
    canonical,
    unmapped,
  });
  const result = evaluateRowEligibility({
    normalized,
    mappingComplete: true,
    mapping: {
      first_name: "first_name",
      last_name: "last_name",
      email: "email",
      phone: "phone",
      source_lead_id: "source_lead_id",
    },
    destinationSelected: true,
    destinationReadyForSimulation: true,
    duplicateCandidates: [],
  });
  assert.equal(result.validationStatus, "identity_blocked");
  assert.ok(result.blockerReasons.some((b) => b.includes("phone")));
});

test("within-batch duplicate phone detection", () => {
  const parsed = parseCsvText(loadFixture("duplicate-phone.csv"));
  const index = buildWithinBatchDuplicateIndex(
    parsed.rows.map((r) => ({
      rowNumber: r.rowNumber,
      phone: r.fields.phone?.replace(/\D/g, ""),
      sourceLeadId: r.fields.source_lead_id,
    }))
  );
  const dupes = detectWithinBatchDuplicates(
    2,
    parsed.rows[1]!.fields.phone?.replace(/\D/g, ""),
    undefined,
    parsed.rows[1]!.fields.source_lead_id,
    index
  );
  assert.ok(dupes.length > 0);
});

test("normalized lifecycle payload validates against MASTER 2.0 schema", () => {
  const parsed = parseCsvText(loadFixture("purchased-leads-complete.csv"));
  const row = parsed.rows[0]!;
  const mapping = {
    first_name: "first_name",
    last_name: "last_name",
    phone: "phone",
    email: "email",
    state: "state",
    source_lead_id: "source_lead_id",
    branch_of_service: "branch_of_service",
    desired_coverage: "desired_coverage",
  };
  const { canonical, unmapped } = applyFieldMapping(row.fields, mapping);
  const normalized = normalizeBulkImportRowToLifecycle({
    batchId: "batch_schema",
    row,
    canonical,
    unmapped,
    options: {
      destinationClientAccountId: "vet_life_james_torrey",
      destinationLocationIdGhl: "9xSNvQCbGaPE9YNxgl4B",
    } as never,
  });
  normalized.client_account_id = "vet_life_james_torrey";
  normalized.subaccount_id_ghl = "9xSNvQCbGaPE9YNxgl4B";
  const parsedSchema = lifecycleEventSchema.safeParse(normalized);
  assert.equal(parsedSchema.success, true, parsedSchema.success ? "" : JSON.stringify(parsedSchema.error.flatten()));
  assert.equal(normalized.contact.contact_id_ghl, undefined);
});

test("bulk import approval phrase constant", () => {
  assert.equal(BULK_IMPORT_APPROVE_DELIVERY_CONFIRMATION, "APPROVE BULK LEAD DELIVERY");
});

test("parseCsvText handles 1000+ rows for performance", () => {
  const header = "first_name,last_name,phone,email,source_lead_id\n";
  const lines = Array.from(
    { length: 1000 },
    (_, i) => `Lead${i},Test${i},+1555011${String(i).padStart(4, "0")},lead${i}@example.test,PERF-${i}`
  );
  const parsed = parseCsvText(header + lines.join("\n"));
  assert.equal(parsed.rows.length, 1000);
});

test("upload does not imply delivery eligibility without destination", () => {
  const result = evaluateRowEligibility({
    normalized: null,
    mappingComplete: true,
    destinationSelected: false,
    destinationReadyForSimulation: false,
    duplicateCandidates: [],
  });
  assert.equal(result.deliveryEligible, false);
  assert.equal(result.validationStatus, "destination_blocked");
});
