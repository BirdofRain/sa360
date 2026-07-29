import assert from "node:assert/strict";
import test from "node:test";

import {
  createIdentityConflictIndex,
  isAcceptDisposition,
  normalizeMasterRow,
} from "./aged-inventory-bulk-normalize.js";
import { buildAgedBulkSourceLeadId } from "./aged-inventory-bulk-source-id.js";
import { parseMasterGeneratedAt } from "./aged-inventory-bulk-date.js";
import { extractUsStateCode } from "./aged-inventory-bulk-state.js";
import { BUYER_CSV_COLUMNS } from "../ppl-fulfillment/buyer-csv-export.service.js";

function raw(overrides: Partial<Parameters<typeof normalizeMasterRow>[0]["raw"]> = {}) {
  return {
    rowNumber: 1,
    dateRaw: "7/15/2025 3:45:00 PM",
    leadTypeRaw: "Some Agent - Trucker Campaign",
    clientNameRaw: "Jane Doe",
    phoneRaw: "5551234567",
    emailRaw: "jane.doe@example.com",
    stateZipRaw: "TX 75001",
    ageRaw: "45",
    statusRaw: "",
    usedByRaw: "",
    campaignName: "Some Agent - Trucker Campaign",
    ...overrides,
  };
}

test("PULLED status rows are accepted (not excluded)", () => {
  const row = normalizeMasterRow({
    raw: raw({ statusRaw: "PULLED", usedByRaw: "Agent X" }),
    nicheKey: "trucker",
    identityIndex: createIdentityConflictIndex(),
  });
  assert.equal(isAcceptDisposition(row.disposition), true);
  assert.equal(row.statusRaw, "PULLED");
  assert.equal(row.usedByPresent, true);
});

test("Used By populated rows are accepted and not treated as ownership", () => {
  const row = normalizeMasterRow({
    raw: raw({ usedByRaw: "historical pull label" }),
    nicheKey: "vet",
    identityIndex: createIdentityConflictIndex(),
  });
  assert.equal(isAcceptDisposition(row.disposition), true);
  assert.equal(row.usedByPresent, true);
});

test("Lead Type never controls niche", () => {
  const row = normalizeMasterRow({
    raw: raw({ leadTypeRaw: "vet fex campaign label", campaignName: "vet fex campaign label" }),
    nicheKey: "trucker",
    identityIndex: createIdentityConflictIndex(),
  });
  assert.equal(row.nicheKey, "trucker");
  assert.equal(row.campaignName, "vet fex campaign label");
});

test("buyer CSV allowlist excludes campaign and STATUS", () => {
  assert.deepEqual([...BUYER_CSV_COLUMNS], [
    "first_name",
    "last_name",
    "phone",
    "email",
    "state",
    "lead_date",
    "niche",
  ]);
  assert.equal(BUYER_CSV_COLUMNS.includes("campaign" as never), false);
  assert.equal(BUYER_CSV_COLUMNS.includes("STATUS" as never), false);
  assert.equal(BUYER_CSV_COLUMNS.includes("used_by" as never), false);
});

test("deterministic source IDs are stable across chunks (no row number)", () => {
  const a = buildAgedBulkSourceLeadId({
    nicheKey: "trucker",
    phoneE164: "+15551234567",
    email: "jane.doe@example.com",
    generatedDateIso: "2025-07-15",
    firstName: "Jane",
    lastName: "Doe",
  });
  const b = buildAgedBulkSourceLeadId({
    nicheKey: "trucker",
    phoneE164: "+15551234567",
    email: "jane.doe@example.com",
    generatedDateIso: "2025-07-15",
    firstName: "Jane",
    lastName: "Doe",
  });
  assert.equal(a, b);
  assert.match(a, /^aged-v1-trucker-[a-f0-9]{24}$/);
});

test("repeat submissions at different dates remain separate IDs", () => {
  const d1 = buildAgedBulkSourceLeadId({
    nicheKey: "trucker",
    phoneE164: "+15551234567",
    email: "jane.doe@example.com",
    generatedDateIso: "2025-07-15",
    firstName: "Jane",
    lastName: "Doe",
  });
  const d2 = buildAgedBulkSourceLeadId({
    nicheKey: "trucker",
    phoneE164: "+15551234567",
    email: "jane.doe@example.com",
    generatedDateIso: "2025-08-01",
    firstName: "Jane",
    lastName: "Doe",
  });
  assert.notEqual(d1, d2);
});

test("exact source duplicate collapses within file index", () => {
  const index = createIdentityConflictIndex();
  const first = normalizeMasterRow({ raw: raw(), nicheKey: "trucker", identityIndex: index });
  const second = normalizeMasterRow({
    raw: raw({ rowNumber: 2 }),
    nicheKey: "trucker",
    identityIndex: index,
  });
  assert.equal(isAcceptDisposition(first.disposition), true);
  assert.equal(second.disposition, "exact_source_duplicate");
});

test("phone/email identity conflicts are quarantined", () => {
  const index = createIdentityConflictIndex();
  normalizeMasterRow({
    raw: raw({ phoneRaw: "5551112222", emailRaw: "a@example.com" }),
    nicheKey: "trucker",
    identityIndex: index,
  });
  const conflict = normalizeMasterRow({
    raw: raw({
      rowNumber: 2,
      clientNameRaw: "John Smith",
      phoneRaw: "5551112222",
      emailRaw: "b@example.com",
      dateRaw: "8/1/2025 1:00:00 PM",
    }),
    nicheKey: "trucker",
    identityIndex: index,
  });
  assert.equal(conflict.disposition, "quarantine_identity_conflict");
});

test("no usable phone or email is rejected", () => {
  const row = normalizeMasterRow({
    raw: raw({ phoneRaw: "12", emailRaw: "not-an-email" }),
    nicheKey: "trucker",
    identityIndex: createIdentityConflictIndex(),
  });
  assert.equal(row.disposition, "reject_no_identity");
});

test("valid phone with invalid optional email is retained", () => {
  const row = normalizeMasterRow({
    raw: raw({ phoneRaw: "5559876543", emailRaw: "bad-email" }),
    nicheKey: "trucker",
    identityIndex: createIdentityConflictIndex(),
  });
  assert.equal(row.disposition, "email_issue_retained");
  assert.ok(row.phoneE164);
  assert.equal(row.email, null);
  assert.equal(row.emailIssue, "invalid_email_format");
});

test("locale datetime and state/ZIP extraction", () => {
  const d = parseMasterGeneratedAt("7/15/2025 3:45:00 PM");
  assert.equal(d.ok, true);
  if (d.ok) assert.equal(d.isoDate, "2025-07-15");
  assert.equal(extractUsStateCode("North Carolina"), "NC");
  assert.equal(extractUsStateCode("TX 75001"), "TX");
  assert.equal(extractUsStateCode("CA"), "CA");
});
