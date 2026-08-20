import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAgedBulkNormalizedPayload,
  createIdentityConflictIndex,
  isAcceptDisposition,
  normalizeMasterRow,
} from "./aged-inventory-bulk-normalize.js";
import { buildAgedBulkSourceLeadId } from "./aged-inventory-bulk-source-id.js";
import { parseMasterGeneratedAt } from "./aged-inventory-bulk-date.js";
import { extractUsStateCode, extractUsZipCode } from "./aged-inventory-bulk-state.js";
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
    dobAgeRaw: "45",
    branchOfServiceRaw: "",
    disabilityRatingRaw: "",
    primaryConcernRaw: "",
    companyOrIndependentRaw: "",
    rigTypeRaw: "",
    beneficiaryRaw: "",
    syncedRaw: "",
    dateUsedLastRaw: "",
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
  assert.equal(extractUsZipCode("TX 75001"), "75001");
  assert.equal(extractUsStateCode("N.C."), "NC");
  assert.equal(extractUsStateCode("Charleston sc"), "SC");
  assert.equal(extractUsStateCode("South Columbia"), null);
});

test("consumer DOB never alters generatedAt", () => {
  const withoutDob = normalizeMasterRow({
    raw: raw({ dobAgeRaw: "", ageRaw: "" }),
    nicheKey: "trucker",
    identityIndex: createIdentityConflictIndex(),
    evaluatedAt: new Date("2026-08-18T12:00:00.000Z"),
  });
  const withDob = normalizeMasterRow({
    raw: raw({ dobAgeRaw: "05/13/1979", ageRaw: "05/13/1979" }),
    nicheKey: "trucker",
    identityIndex: createIdentityConflictIndex(),
    evaluatedAt: new Date("2026-08-18T12:00:00.000Z"),
  });
  assert.equal(withDob.generatedAt.toISOString(), withoutDob.generatedAt.toISOString());
  assert.equal(withDob.dateOfBirth, "1979-05-13");
  assert.equal(withDob.leadDetails.date_of_birth, "1979-05-13");
});

test("sourceLeadId is unchanged by ZIP, consumer age, and sales-context fields", () => {
  const base = normalizeMasterRow({
    raw: raw(),
    nicheKey: "vet",
    identityIndex: createIdentityConflictIndex(),
  });
  const enriched = normalizeMasterRow({
    raw: raw({
      stateZipRaw: "TX 99999",
      dobAgeRaw: "05/13/1979",
      ageRaw: "05/13/1979",
      beneficiaryRaw: "Spouse",
      branchOfServiceRaw: "Navy",
      disabilityRatingRaw: "100%",
      primaryConcernRaw: "Health",
      companyOrIndependentRaw: "Company",
      rigTypeRaw: "Day Cab",
    }),
    nicheKey: "vet",
    identityIndex: createIdentityConflictIndex(),
  });
  assert.equal(enriched.sourceLeadId, base.sourceLeadId);
  assert.equal(enriched.zip, "99999");
  assert.equal(enriched.leadDetails.beneficiary, "Spouse");
  assert.equal(enriched.leadDetails.niche.branch_of_service, "Navy");
  assert.equal(enriched.leadDetails.niche.disability_rating, "100%");
  assert.equal(enriched.leadDetails.niche.primary_concern, "Health");
  assert.equal(enriched.leadDetails.niche.company_or_independent, undefined);
  assert.equal(enriched.leadDetails.niche.rig_type, undefined);
});

test("previously accepted Master row keeps the same generatedAt and sourceLeadId", () => {
  const row = normalizeMasterRow({
    raw: raw(),
    nicheKey: "trucker",
    identityIndex: createIdentityConflictIndex(),
    evaluatedAt: new Date("2026-08-18T12:00:00.000Z"),
  });
  assert.equal(isAcceptDisposition(row.disposition), true);
  assert.equal(row.generatedAt.toISOString(), "2025-07-15T12:00:00.000Z");
  assert.equal(row.sourceLeadId, "aged-v1-trucker-3c4dcfd24f2fce75343aa441");
});

test("Excel serial date rows obtain aged-v1 IDs without changing accepted-row identity", () => {
  const serial = normalizeMasterRow({
    raw: raw({ dateRaw: "46224", stateZipRaw: "NC27513" }),
    nicheKey: "trucker",
    identityIndex: createIdentityConflictIndex(),
    evaluatedAt: new Date("2026-08-18T12:00:00.000Z"),
  });
  assert.equal(isAcceptDisposition(serial.disposition), true);
  assert.equal(serial.generatedAt.toISOString(), "2026-07-21T12:00:00.000Z");
  assert.equal(serial.state, "NC");
  assert.equal(serial.zip, "27513");
  assert.match(serial.sourceLeadId, /^aged-v1-trucker-[a-f0-9]{24}$/);
  assert.notEqual(serial.sourceLeadId, "aged-v1-trucker-3c4dcfd24f2fce75343aa441");
});

test("COMPANY OR INDY? maps to company_or_independent and Lead Type never sets niche", () => {
  const row = normalizeMasterRow({
    raw: raw({
      leadTypeRaw: "vet fex campaign label",
      campaignName: "vet fex campaign label",
      companyOrIndependentRaw: "Independent",
      rigTypeRaw: "Sleeper",
    }),
    nicheKey: "trucker",
    identityIndex: createIdentityConflictIndex(),
  });
  assert.equal(row.nicheKey, "trucker");
  assert.equal(row.campaignName, "vet fex campaign label");
  assert.equal(row.leadDetails.niche.company_or_independent, "Independent");
  assert.equal(row.leadDetails.niche.rig_type, "Sleeper");
  assert.equal(row.leadDetails.niche.branch_of_service, undefined);
});

test("new historical imports write flat identity plus contact and lead_details", () => {
  const row = normalizeMasterRow({
    raw: raw({
      dobAgeRaw: "70",
      ageRaw: "70",
      beneficiaryRaw: "Spouse",
      companyOrIndependentRaw: "Company",
      rigTypeRaw: "Flatbed",
    }),
    nicheKey: "trucker",
    identityIndex: createIdentityConflictIndex(),
  });
  const payload = buildAgedBulkNormalizedPayload(row);
  assert.equal(payload.firstName, "Jane");
  assert.equal(payload.lastName, "Doe");
  assert.equal(payload.email, "jane.doe@example.com");
  assert.equal(payload.phone_e164, "+15551234567");
  assert.equal(payload.state, "TX");
  assert.equal(payload.niche_key, "trucker");
  assert.equal(payload.campaign_name, "Some Agent - Trucker Campaign");
  assert.equal(payload.status_raw, null);
  assert.equal(payload.used_by_present, false);
  const contact = payload.contact as { zip: string | null; state: string };
  assert.equal(contact.state, "TX");
  assert.equal(contact.zip, "75001");
  const details = payload.lead_details as {
    consumer_age: number | null;
    date_of_birth: string | null;
    beneficiary: string | null;
    niche: { company_or_independent?: string; rig_type?: string };
  };
  assert.equal(details.consumer_age, 70);
  assert.equal(details.date_of_birth, null);
  assert.equal(details.beneficiary, "Spouse");
  assert.equal(details.niche.company_or_independent, "Company");
  assert.equal(details.niche.rig_type, "Flatbed");
});
