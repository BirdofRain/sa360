import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { DEFAULT_AGE_BANDS_V1 } from "../lead-inventory/lead-inventory.constants.js";
import { calculateInventoryAgeDays, resolveAgeBandKey } from "../lead-inventory/lead-inventory-age.js";
import {
  NEXTGEN_EXPORT_HEADERS,
  nextGenCols,
} from "./aged-inventory-bulk-nextgen-fixtures.js";
import {
  adaptNextGenExportRow,
  assertNextGenExportHeaders,
} from "./aged-inventory-bulk-nextgen-adapter.js";
import {
  assertAgedBulkHeaders,
  buildAgedBulkNormalizedPayload,
  createIdentityConflictIndex,
  isAcceptDisposition,
  mergeAgedBulkRawPayload,
  normalizeNextGenExportRow,
  parseAgedBulkNormalizedRow,
} from "./aged-inventory-bulk-normalize.js";
import {
  accumulateAgedBulkRow,
  buildAgedBulkPreviewReport,
  emptyAgedBulkCounts,
} from "./aged-inventory-bulk-preview-stats.js";
import { streamCsvFile } from "./aged-inventory-bulk-stream.js";
import { assertMasterOnlyAgedBulkFormat } from "./aged-inventory-bulk.types.js";

const EVALUATED_AT = new Date("2026-09-10T12:00:00.000Z");

function normalizeFixture(
  overrides: Partial<Record<string, string>> = {},
  identityIndex = createIdentityConflictIndex()
) {
  const asserted = assertNextGenExportHeaders(NEXTGEN_EXPORT_HEADERS);
  if (!asserted.ok) throw new Error(asserted.error);
  const raw = adaptNextGenExportRow({
    rowNumber: 2,
    cols: nextGenCols(overrides),
    index: asserted.index,
    headers: NEXTGEN_EXPORT_HEADERS,
  });
  return normalizeNextGenExportRow({
    raw,
    nicheKey: "vet",
    identityIndex,
    evaluatedAt: EVALUATED_AT,
  });
}

test("NextGen Lead # is preserved as sourceLeadId (not aged-v1 hashed)", () => {
  const row = normalizeFixture();
  assert.equal(isAcceptDisposition(row.disposition), true);
  assert.equal(row.sourceLeadId, "9f3a2c10-4b21-4d88-8a77-6c1e0b2d9e11");
  assert.equal(row.sourceLeadId.startsWith("aged-v1-"), false);
  assert.equal(row.internalSource.originalSourceLeadId, "9f3a2c10-4b21-4d88-8a77-6c1e0b2d9e11");
  assert.equal(row.internalSource.sourceFormat, "leadcapture_nextgen_export_v1");
});

test("historical age derives from Created, not import/evaluation day", () => {
  const row = normalizeFixture();
  assert.equal(row.generatedAt.toISOString(), "2025-01-15T12:00:00.000Z");
  const ageDays = calculateInventoryAgeDays(row.generatedAt, EVALUATED_AT);
  assert.ok(ageDays > 500);
  assert.notEqual(row.generatedAt.toISOString().slice(0, 10), "2026-09-10");
  assert.equal(resolveAgeBandKey(ageDays, DEFAULT_AGE_BANDS_V1), "AGED_366_PLUS");
});

test("NextGen field mapping lands on canonical contact / niche / source attributes", () => {
  const row = normalizeFixture();
  assert.equal(row.firstName, "Jordan");
  assert.equal(row.lastName, "Rivers");
  assert.equal(row.email, "jordan.rivers@example.test");
  assert.equal(row.phoneE164, "+15553219876");
  assert.equal(row.state, "NC");
  assert.equal(row.campaignName, "Vet FEX NextGen");
  assert.equal(row.sourceFunnelName, "Vet FEX NextGen");
  assert.equal(row.beneficiary, "Spouse");
  assert.equal(row.dateOfBirth, "1979-05-13");
  assert.equal(row.leadDetails.niche.branch_of_service, "Army");
  assert.equal(row.leadDetails.niche.primary_concern, "Income replacement");
  assert.equal(row.leadDetails.niche.military_status, "Veteran");
  assert.equal(row.leadDetails.niche.marital_status, "Married");
  assert.equal(row.leadDetails.niche.sex, "Male");
  assert.equal(row.leadDetails.niche.desired_coverage, "250000");
  assert.equal(row.sourceAttributes.ip_address, "203.0.113.42");
  assert.equal(row.sourceAttributes.best_time_to_call, "Evenings");
  assert.equal(row.sourceAttributes.funnel_name, "Vet FEX NextGen");
  assert.equal(row.sourceAttributes.primary_reason, "Income replacement");

  const payload = buildAgedBulkNormalizedPayload(row);
  assert.equal(payload.source_lead_id, "9f3a2c10-4b21-4d88-8a77-6c1e0b2d9e11");
  assert.equal(payload.source_funnel_name, "Vet FEX NextGen");
  const attrs = payload.source_attributes as Record<string, string>;
  assert.equal(attrs.military_status, "Veteran");
  assert.equal(attrs.sex, "Male");
});

test("unsupported extra CSV columns are retained in raw nextgen.source_row", () => {
  const row = normalizeFixture();
  const rawPayload = mergeAgedBulkRawPayload(null, {
    importRequestId: "req-test",
    rowNumber: row.rowNumber,
    internalSource: row.internalSource,
  });
  const nextgen = rawPayload.nextgen as {
    lead_number: string;
    source_row: Record<string, string>;
    source_format: string;
  };
  assert.equal(nextgen.source_format, "leadcapture_nextgen_export_v1");
  assert.equal(nextgen.lead_number, "9f3a2c10-4b21-4d88-8a77-6c1e0b2d9e11");
  assert.equal(nextgen.source_row["Custom Extra Field"], "keep-me");
  assert.equal(nextgen.source_row["IP Address"], "203.0.113.42");
  assert.equal(nextgen.source_row["Best Time to Call"], "Evenings");
  assert.equal("master" in rawPayload, false);
});

test("missing Lead # is rejected without inventing an identifier", () => {
  const row = normalizeFixture({ "Lead #": "" });
  assert.equal(row.disposition, "reject_missing_source_lead_id");
  assert.equal(row.sourceLeadId, "");
});

test("repeated Lead # in the same file is an exact source duplicate", () => {
  const index = createIdentityConflictIndex();
  const first = normalizeFixture({}, index);
  const second = normalizeFixture({ "First Name": "Other", "Last Name": "Person" }, index);
  assert.equal(isAcceptDisposition(first.disposition), true);
  assert.equal(second.disposition, "exact_source_duplicate");
  assert.equal(second.sourceLeadId, first.sourceLeadId);
});

test("Excel-style numeric Lead # 1848293.0 canonicalizes to 1848293", () => {
  const row = normalizeFixture({ "Lead #": "1848293.0" });
  assert.equal(row.sourceLeadId, "1848293");
});

test("phone/email identity conflict is still quarantined for NextGen rows", () => {
  const index = createIdentityConflictIndex();
  normalizeFixture({}, index);
  const conflict = normalizeFixture(
    {
      "Lead #": "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      "First Name": "Other",
      "Last Name": "Person",
      Email: "other.person@example.test",
    },
    index
  );
  assert.equal(conflict.disposition, "quarantine_identity_conflict");
});

test("preview report covers totals, rejects, duplicates, state, age bucket, Created range", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "nextgen-export-"));
  const filePath = path.join(dir, "nextgen.csv");
  const lines = [
    NEXTGEN_EXPORT_HEADERS.join(","),
    nextGenCols().join(","),
    nextGenCols({
      "Lead #": "lead-tx-1",
      Created: "3/01/2025",
      State: "TX",
      Email: "tx.lead@example.test",
      Phone: "5551000002",
    }).join(","),
    nextGenCols().join(","), // duplicate of first Lead #
    nextGenCols({
      "Lead #": "",
      Created: "6/01/2025",
      Email: "missing.id@example.test",
      Phone: "5551000003",
    }).join(","),
    nextGenCols({
      "Lead #": "lead-bad-state",
      Created: "2/01/2025",
      State: "ZZ",
      Email: "bad.state@example.test",
      Phone: "5551000004",
    }).join(","),
  ];
  await writeFile(filePath, lines.join("\n"), "utf8");

  const identityIndex = createIdentityConflictIndex();
  const counts = emptyAgedBulkCounts();
  let headerIndex: Map<string, number> | null = null;
  let headers: string[] = [];

  await streamCsvFile(filePath, {
    onHeader: (h) => {
      const asserted = assertAgedBulkHeaders(h, "leadcapture_nextgen_export_v1");
      assert.equal(asserted.ok, true);
      if (!asserted.ok) return;
      headerIndex = asserted.index;
      headers = h;
    },
    onRow: (rowNumber, cols) => {
      counts.sourceRows = Math.max(counts.sourceRows, rowNumber);
      const normalized = parseAgedBulkNormalizedRow({
        rowNumber,
        cols,
        headers,
        index: headerIndex!,
        sourceFormat: "leadcapture_nextgen_export_v1",
        nicheKey: "vet",
        identityIndex,
        evaluatedAt: EVALUATED_AT,
      });
      const ageDays = isAcceptDisposition(normalized.disposition)
        ? calculateInventoryAgeDays(normalized.generatedAt, EVALUATED_AT)
        : null;
      const ageBandKey =
        ageDays != null ? resolveAgeBandKey(ageDays, DEFAULT_AGE_BANDS_V1) : null;
      accumulateAgedBulkRow(counts, normalized, ageBandKey);
    },
  });

  const preview = buildAgedBulkPreviewReport(counts);
  assert.equal(preview.totalCsvRows, 5);
  assert.equal(preview.parseableRows, 3); // 2 accepted + 1 duplicate
  assert.equal(preview.rejectedRows, 2); // missing lead # + invalid state
  assert.equal(preview.duplicateCandidates, 1);
  assert.equal(preview.byState.NC, 1);
  assert.equal(preview.byState.TX, 1);
  assert.equal(preview.byAgeBand.AGED_366_PLUS, 2);
  assert.equal(preview.earliestCreated, "2025-01-15T12:00:00.000Z");
  assert.equal(preview.latestCreated, "2025-06-01T12:00:00.000Z");
  assert.ok(preview.rejectionReasons.reject_missing_source_lead_id);
  assert.ok(preview.rejectionReasons.reject_invalid_state);

  await rm(dir, { recursive: true, force: true });
});

test("Master enrich/recovery workflows refuse the NextGen source format", () => {
  assert.throws(
    () => assertMasterOnlyAgedBulkFormat("leadcapture_nextgen_export_v1", "enrich"),
    /leadcapture_nextgen_export_v1_not_supported_for_master_enrich/
  );
  assert.throws(
    () => assertMasterOnlyAgedBulkFormat("leadcapture_nextgen_export_v1", "recovery"),
    /leadcapture_nextgen_export_v1_not_supported_for_master_recovery/
  );
  assert.doesNotThrow(() => assertMasterOnlyAgedBulkFormat("vet_master_v1", "enrich"));
});
