import assert from "node:assert/strict";
import test from "node:test";

import {
  applyOperatorAssignments,
  columnLabel,
  customAppendSegments,
  customRowProjection,
  customRowValues,
  exactHeader,
  formatDateAmericaNewYork,
  formulaColumnIndexes,
  headerFingerprint,
  publishBlocker,
  suggestColumnAssignments,
  syntheticCustomCampaignLead,
} from "./company-sheets-custom-row.js";

const HEADER = ["Full Name", "Phone", "E-mail", "Age/DOB", "Score", "Phone", ""];

test("suggestions keep blanks, duplicates, and Age/DOB unresolved", () => {
  const columns = suggestColumnAssignments(HEADER, ["Pat", "555", "pat@example.invalid", "", "9", "556", ""]);
  assert.equal(columns[0]?.decision, "mapped");
  assert.equal(columns[0]?.target?.sourceField, "full_name");
  assert.equal(columns[0]?.explicit, false);
  assert.equal(columns[1]?.decision, "ambiguous");
  assert.equal(columns[1]?.code, "duplicate_header");
  assert.equal(columns[2]?.target?.sourceField, "email");
  assert.equal(columns[3]?.decision, "ambiguous");
  assert.equal(columns[3]?.code, "ambiguous_age_or_dob");
  assert.equal(columns[4]?.decision, "unmapped");
  assert.equal(columns[5]?.decision, "ambiguous");
  assert.equal(columns[5]?.code, "duplicate_header");
  assert.equal(columns[6]?.decision, "unmapped");
  assert.equal(columns[6]?.code, "blank_header");
  assert.equal(publishBlocker(columns).ok, false);
});

test("reordered headers, extra columns, and formula columns define the append segments", () => {
  const header = ["E-mail", "Notes", "Running Total", "Full Name", "Phone Number"];
  const sample = ["old@example.invalid", "kept", "=B2", "Kept Person", "5550000000"];
  const formulas = formulaColumnIndexes(header, sample);
  assert.deepEqual(formulas, [2]);
  const suggested = suggestColumnAssignments(header, sample);
  assert.equal(suggested[0]?.target?.sourceField, "email");
  assert.equal(suggested[3]?.target?.sourceField, "full_name");
  assert.equal(suggested[2]?.formula, true);
  assert.equal(suggested[2]?.decision, "unmapped");
  const confirmed = suggested.map((column) => ({ ...column, explicit: true }));
  const blocked = publishBlocker(confirmed);
  assert.equal(blocked.ok, true);
  const lead = syntheticCustomCampaignLead({
    stableRowId: "preview",
    clientAccountId: "preview",
    spreadsheetId: "sheet_existing_tab",
    worksheetTitle: "VET Web Form",
  });
  const values = customRowValues(confirmed, lead);
  assert.ok(values);
  assert.equal(values?.length, header.length);
  assert.equal(values?.[0], "synthetic@example.invalid");
  assert.match(values?.[1] ?? "", /Controlled writer test/);
  assert.equal(values?.[2], "");
  assert.match(values?.[3] ?? "", /SYNTHETIC/);
  assert.equal(values?.[4], "SYNTHETIC");
  assert.deepEqual(customAppendSegments(values ?? [], formulas), [
    { startIndex: 0, values: [values?.[0] ?? "", values?.[1] ?? ""] },
    { startIndex: 3, values: [values?.[3] ?? "", values?.[4] ?? ""] },
  ]);
  assert.equal(columnLabel(0), "A");
  assert.equal(columnLabel(4), "E");
  assert.equal(columnLabel(26), "AA");
});

test("date-only values stay on that calendar day and offset timestamps use New York", () => {
  assert.equal(formatDateAmericaNewYork("2026-10-26"), "10/26/2026");
  assert.equal(formatDateAmericaNewYork("4/2/1990"), "04/02/1990");
  assert.equal(formatDateAmericaNewYork("2026-10-26T04:30:00.000Z"), "10/26/2026");
  assert.equal(formatDateAmericaNewYork("2026-10-26T03:30:00.000Z"), "10/25/2026");
  assert.equal(formatDateAmericaNewYork("not a date"), "");
  assert.equal(formatDateAmericaNewYork(""), "");
});

test("Age/DOB, primary reason, and blank headers reject the unsafe choice", () => {
  const header = ["Age/DOB", "Primary Reason", ""];
  const age = applyOperatorAssignments(header, [], [
    {
      sheetHeader: "Age/DOB",
      decision: "mapped",
      transform: "passthrough",
      explicit: true,
      target: { kind: "v3_column", header: "Age", sourceField: "consumer_age" },
    },
    {
      sheetHeader: "Primary Reason",
      decision: "mapped",
      transform: "passthrough",
      explicit: true,
      target: { kind: "v3_column", header: "Primary Concern", sourceField: "primary_concern" },
    },
    { sheetHeader: "", decision: "unmapped", transform: "blank", explicit: true, target: null },
  ]);
  assert.equal(age.ok, false);
  if (age.ok) return;
  assert.equal(age.error, "primary_reason_is_not_primary_concern");

  const blank = applyOperatorAssignments(header, [], [
    { sheetHeader: "Age/DOB", decision: "unmapped", transform: "blank", explicit: true, target: null },
    { sheetHeader: "Primary Reason", decision: "unmapped", transform: "blank", explicit: true, target: null },
    {
      sheetHeader: "",
      decision: "mapped",
      transform: "passthrough",
      explicit: true,
      target: { kind: "v3_column", header: "Notes", sourceField: "notes" },
    },
  ]);
  assert.equal(blank.ok, false);
  if (blank.ok) return;
  assert.equal(blank.error, "blank_header");
});

test("phone, email, and name aliases stay required after an operator clears them", () => {
  const header = ["Phone Number", "E-mail", "Full Name"];
  const cleared = suggestColumnAssignments(header).map((column) =>
    column.target?.sourceField === "phone"
      ? { ...column, decision: "unmapped" as const, explicit: true, transform: "blank" as const, target: null }
      : { ...column, explicit: true }
  );
  const blocked = publishBlocker(cleared);
  assert.equal(blocked.ok, false);
  if (blocked.ok) return;
  assert.equal(blocked.error, "required_field_unmapped");
});

test("a blank Primary Concern is filled from primary_reason and labeled", () => {
  const assignment = {
    sheetHeader: "Primary Concern",
    columnIndex: 0,
    formula: false,
    target: { kind: "v3_column" as const, header: "Primary Concern", sourceField: "primary_concern" },
    transform: "passthrough" as const,
    decision: "mapped" as const,
    explicit: true,
    code: null,
  };
  const lead = {
    stableRowId: "row_1",
    clientAccountId: "client_a",
    sourceLeadEventId: "evt_1",
    receivedAt: "2026-10-29T01:32:34.966Z",
    sourceLeadId: "lead_1",
    normalizedPayload: {
      contact: {
        first_name: "Sample",
        last_name: "Lead",
        email: "sample.lead@example.invalid",
        phone: "5550100199",
        state: "TX",
      },
      routing: {
        source_intake: {
          submitted_at: "2026-10-29T01:32:34.966Z",
          sourceAttributes: { primary_reason: "Burial" },
        },
      },
    },
  };
  const filled = customRowProjection([assignment], lead);
  assert.deepEqual(filled?.values, ["Burial"]);
  assert.deepEqual(filled?.warnings, ["primary_concern_filled_from_primary_reason"]);

  const kept = customRowProjection([assignment], {
    ...lead,
    normalizedPayload: {
      contact: lead.normalizedPayload.contact,
      routing: {
        source_intake: {
          submitted_at: "2026-10-29T01:32:34.966Z",
          sourceAttributes: { primary_reason: "Burial", primary_concern: "Income" },
        },
      },
    },
  });
  assert.deepEqual(kept?.values, ["Income"]);
  assert.deepEqual(kept?.warnings, []);

  const omitted = customRowProjection([assignment], {
    ...lead,
    normalizedPayload: {
      contact: lead.normalizedPayload.contact,
      routing: { source_intake: { submitted_at: "2026-10-29T01:32:34.966Z", sourceAttributes: {} } },
    },
  });
  assert.deepEqual(omitted?.values, [""]);
  assert.deepEqual(omitted?.warnings, ["primary_concern_omitted"]);
});

test("the header fingerprint changes when cells move and ignores a prefix match", () => {
  assert.equal(headerFingerprint(["Phone", "Email"]), headerFingerprint(["Phone", "Email"]));
  assert.notEqual(headerFingerprint(["Phone", "Email"]), headerFingerprint(["Email", "Phone"]));
  assert.equal(exactHeader(["Phone", "Email", "Extra"], ["Phone", "Email"]), false);
});
