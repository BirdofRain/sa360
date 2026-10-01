import assert from "node:assert/strict";
import test from "node:test";

import {
  adaptNextGenExportRow,
  assertNextGenExportHeaders,
  canonicalizeNextGenLeadNumber,
} from "./aged-inventory-bulk-nextgen-adapter.js";
import { resolveDefaultNiche } from "./aged-inventory-bulk-adapters.js";

import {
  NEXTGEN_EXPORT_HEADERS,
  nextGenCols,
} from "./aged-inventory-bulk-nextgen-fixtures.js";

test("NextGen adapter requires Lead # / Created / identity / funnel / state headers", () => {
  const asserted = assertNextGenExportHeaders(NEXTGEN_EXPORT_HEADERS);
  assert.equal(asserted.ok, true);
  const missingLead = assertNextGenExportHeaders(
    NEXTGEN_EXPORT_HEADERS.filter((h) => h !== "Lead #")
  );
  assert.equal(missingLead.ok, false);
  if (!missingLead.ok) assert.equal(missingLead.error, "missing_header:lead_#");
});

test("NextGen adapter reads every expected column and preserves unmapped extras", () => {
  const asserted = assertNextGenExportHeaders(NEXTGEN_EXPORT_HEADERS);
  assert.equal(asserted.ok, true);
  if (!asserted.ok) return;
  const raw = adaptNextGenExportRow({
    rowNumber: 2,
    cols: nextGenCols(),
    index: asserted.index,
    headers: NEXTGEN_EXPORT_HEADERS,
  });
  assert.equal(raw.kind, "leadcapture_nextgen_export_v1");
  assert.equal(raw.leadNumberRaw, "9f3a2c10-4b21-4d88-8a77-6c1e0b2d9e11");
  assert.equal(raw.createdRaw, "1/15/2025 3:45:00 PM");
  assert.equal(raw.firstNameRaw, "Jordan");
  assert.equal(raw.lastNameRaw, "Rivers");
  assert.equal(raw.emailRaw, "jordan.rivers@example.test");
  assert.equal(raw.phoneRaw, "5553219876");
  assert.equal(raw.funnelNameRaw, "Vet FEX NextGen");
  assert.equal(raw.ipAddressRaw, "203.0.113.42");
  assert.equal(raw.militaryStatusRaw, "Veteran");
  assert.equal(raw.stateRaw, "NC");
  assert.equal(raw.branchOfServiceRaw, "Army");
  assert.equal(raw.maritalStatusRaw, "Married");
  assert.equal(raw.desiredCoverageRaw, "250000");
  assert.equal(raw.beneficiaryRaw, "Spouse");
  assert.equal(raw.dateOfBirthRaw, "05/13/1979");
  assert.equal(raw.bestTimeToCallRaw, "Evenings");
  assert.equal(raw.primaryReasonRaw, "Income replacement");
  assert.equal(raw.sexRaw, "Male");
  assert.equal(raw.sourceColumns["Custom Extra Field"], "keep-me");
  assert.equal(raw.sourceColumns["Lead #"], "9f3a2c10-4b21-4d88-8a77-6c1e0b2d9e11");
});

test("canonicalizeNextGenLeadNumber preserves vendor IDs and strips Excel .0", () => {
  assert.equal(canonicalizeNextGenLeadNumber("1848293"), "1848293");
  assert.equal(canonicalizeNextGenLeadNumber("1848293.0"), "1848293");
  assert.equal(
    canonicalizeNextGenLeadNumber("9f3a2c10-4b21-4d88-8a77-6c1e0b2d9e11"),
    "9f3a2c10-4b21-4d88-8a77-6c1e0b2d9e11"
  );
  assert.equal(canonicalizeNextGenLeadNumber("  "), null);
  assert.equal(canonicalizeNextGenLeadNumber(""), null);
});

test("leadcapture_nextgen_export_v1 requires --default-niche vet", () => {
  assert.equal(resolveDefaultNiche("leadcapture_nextgen_export_v1", "vet"), "vet");
  assert.throws(
    () => resolveDefaultNiche("leadcapture_nextgen_export_v1", "trucker"),
    /niche_mismatch:leadcapture_nextgen_export_v1_requires_vet/
  );
});
