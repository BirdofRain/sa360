import assert from "node:assert/strict";
import test from "node:test";

import { adaptMasterRow, assertMasterHeaders } from "./aged-inventory-bulk-adapters.js";
import { extractUsZipCode } from "./aged-inventory-bulk-state.js";

const VET_HEADERS = [
  "Date",
  "Lead Type",
  "Client Name",
  "Phone",
  "Email",
  "State / Zip",
  "DOB/ AGE",
  "Branch of Service",
  "Disability Rating",
  "Primary Concern",
  "Beneficiary",
  "Date Used Last",
  "Used By:",
  "",
  "STATUS",
];

const TRUCKER_HEADERS = [
  "Date",
  "LEAD TYPE",
  "CLIENT NAME",
  "PHONE",
  "EMAIL",
  "STATE/ZIP",
  "AGE",
  "COMPANY OR INDY?",
  "RIG TYPE?",
  "Beneficiary",
  "Synced",
  "Date Used Last",
  "Used By:",
  "STATUS",
];

test("Master Vet adapter reads every named source column and ignores the blank column", () => {
  const asserted = assertMasterHeaders(VET_HEADERS, "vet_master_v1");
  assert.equal(asserted.ok, true);
  if (!asserted.ok) return;
  const raw = adaptMasterRow({
    rowNumber: 4,
    cols: [
      "7/15/2025 3:45:00 PM",
      "Vet FEX Agent Label",
      "Jane Doe",
      "5551234567",
      "jane.doe@example.com",
      "NC 27513",
      "05/13/1979",
      "Army",
      "70%",
      "Income",
      "Spouse",
      "8/1/2025",
      "Agent Q",
      "ignore-me",
      "PULLED",
    ],
    index: asserted.index,
    sourceFormat: "vet_master_v1",
  });
  assert.equal(raw.dateRaw, "7/15/2025 3:45:00 PM");
  assert.equal(raw.leadTypeRaw, "Vet FEX Agent Label");
  assert.equal(raw.clientNameRaw, "Jane Doe");
  assert.equal(raw.phoneRaw, "5551234567");
  assert.equal(raw.emailRaw, "jane.doe@example.com");
  assert.equal(raw.stateZipRaw, "NC 27513");
  assert.equal(raw.dobAgeRaw, "05/13/1979");
  assert.equal(raw.ageRaw, "05/13/1979");
  assert.equal(raw.branchOfServiceRaw, "Army");
  assert.equal(raw.disabilityRatingRaw, "70%");
  assert.equal(raw.primaryConcernRaw, "Income");
  assert.equal(raw.beneficiaryRaw, "Spouse");
  assert.equal(raw.dateUsedLastRaw, "8/1/2025");
  assert.equal(raw.usedByRaw, "Agent Q");
  assert.equal(raw.statusRaw, "PULLED");
  assert.equal(raw.campaignName, "Vet FEX Agent Label");
  assert.equal(raw.syncedRaw, "");
  assert.equal(raw.companyOrIndependentRaw, "");
  assert.equal(raw.rigTypeRaw, "");
});

test("Master Trucker adapter maps COMPANY OR INDY? to company_or_independent source", () => {
  const asserted = assertMasterHeaders(TRUCKER_HEADERS, "trucker_master_v1");
  assert.equal(asserted.ok, true);
  if (!asserted.ok) return;
  const raw = adaptMasterRow({
    rowNumber: 2,
    cols: [
      "7/15/2025",
      "Some Agent - Trucker Campaign",
      "John Smith",
      "5559876543",
      "john.smith@example.com",
      "TX, 75001",
      "70",
      "Owner Op",
      "Sleeper",
      "Child",
      "Yes",
      "6/1/2025",
      "Desk 2",
      "AVAILABLE",
    ],
    index: asserted.index,
    sourceFormat: "trucker_master_v1",
  });
  assert.equal(raw.dateRaw, "7/15/2025");
  assert.equal(raw.leadTypeRaw, "Some Agent - Trucker Campaign");
  assert.equal(raw.clientNameRaw, "John Smith");
  assert.equal(raw.phoneRaw, "5559876543");
  assert.equal(raw.emailRaw, "john.smith@example.com");
  assert.equal(raw.stateZipRaw, "TX, 75001");
  assert.equal(raw.dobAgeRaw, "70");
  assert.equal(raw.ageRaw, "70");
  assert.equal(raw.companyOrIndependentRaw, "Owner Op");
  assert.equal(raw.rigTypeRaw, "Sleeper");
  assert.equal(raw.beneficiaryRaw, "Child");
  assert.equal(raw.syncedRaw, "Yes");
  assert.equal(raw.dateUsedLastRaw, "6/1/2025");
  assert.equal(raw.usedByRaw, "Desk 2");
  assert.equal(raw.statusRaw, "AVAILABLE");
  assert.equal(raw.branchOfServiceRaw, "");
});

test("ZIP parsing supports typical historical State/Zip forms and stays optional", () => {
  assert.equal(extractUsZipCode("NC 27513"), "27513");
  assert.equal(extractUsZipCode("NC, 27513"), "27513");
  assert.equal(extractUsZipCode("NC / 27513"), "27513");
  assert.equal(extractUsZipCode("TX 75001-1234"), "75001-1234");
  assert.equal(extractUsZipCode("NC"), null);
  assert.equal(extractUsZipCode(""), null);
});
