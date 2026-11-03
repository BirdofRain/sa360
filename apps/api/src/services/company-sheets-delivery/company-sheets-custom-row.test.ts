import assert from "node:assert/strict";
import test from "node:test";

import { COMPANY_SHEETS_V3_COLUMNS } from "@sa360/shared";

import { COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V3 } from "../../lib/company-google-sheets-env.js";
import { companySheetsCampaignRowValues, formatGenerationTimestamp } from "./company-sheets-campaign-row.js";
import {
  applyOperatorAssignments,
  columnLabel,
  confirmVisibleSelections,
  customAppendSegments,
  customRowProjection,
  customRowValues,
  exactHeader,
  explainDraftProjection,
  formatDateAmericaNewYork,
  formulaColumnIndexes,
  headerFingerprint,
  persistHeaderSnapshot,
  readHeaderSnapshot,
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

test("a captured test-send time fills the mapped Date cell and leaves the sample birthday", () => {
  const first = "2026-11-03T15:04:00.000Z";
  const second = "2026-11-04T16:30:00.000Z";
  const sample = syntheticCustomCampaignLead({
    stableRowId: "preview",
    clientAccountId: "preview",
    spreadsheetId: "sheet",
    worksheetTitle: "Campaign Leads",
  });
  const sampleIntake = (sample.normalizedPayload as { routing: { source_intake: { submitted_at: string } } }).routing
    .source_intake;
  assert.equal(sample.receivedAt, "2026-10-26T15:00:00.000Z");
  assert.equal(sampleIntake.submitted_at, "2026-10-26T14:00:00.000Z");

  const header = ["Date", "Client Name", "DOB"];
  const mapped = suggestColumnAssignments(header, ["10/26/2026", "Pat Example", "04/02/1990"]).map((column) => ({
    ...column,
    explicit: true,
  }));
  assert.equal(mapped[0]?.target?.sourceField, "submitted_at");
  assert.equal(mapped[2]?.target?.sourceField, "date_of_birth");

  function projected(occurredAt: string): string[] {
    const lead = syntheticCustomCampaignLead({
      stableRowId: "row",
      clientAccountId: "client",
      spreadsheetId: "sheet",
      worksheetTitle: "Campaign Leads",
      occurredAt,
    });
    const intake = (lead.normalizedPayload as { routing: { source_intake: { submitted_at: string } } }).routing
      .source_intake;
    assert.equal(lead.receivedAt, occurredAt);
    assert.equal(intake.submitted_at, occurredAt);
    const values = customRowValues(mapped, lead);
    assert.ok(values);
    return values;
  }

  const firstRow = projected(first);
  const secondRow = projected(second);
  assert.equal(firstRow[0], formatGenerationTimestamp(first));
  assert.equal(secondRow[0], formatGenerationTimestamp(second));
  assert.notEqual(firstRow[0], secondRow[0]);
  assert.equal(firstRow[0]?.includes("10/26/2026"), false);
  assert.equal(firstRow[2], "04/02/1990");
  assert.equal(secondRow[2], "04/02/1990");

  const v3 = companySheetsCampaignRowValues({
    ...syntheticCustomCampaignLead({
      stableRowId: "row",
      clientAccountId: "client",
      spreadsheetId: "sheet",
      worksheetTitle: "Campaign Leads",
      occurredAt: first,
    }),
    schemaVersion: COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V3,
  });
  const dateIndex = COMPANY_SHEETS_V3_COLUMNS.findIndex((column) => column.header === "Date");
  const dobIndex = COMPANY_SHEETS_V3_COLUMNS.findIndex((column) => column.header === "DOB");
  assert.equal(v3?.[dateIndex], formatGenerationTimestamp(first));
  assert.equal(v3?.[dobIndex], "1990-04-02");
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

test("save confirmation accepts unchanged suggestions and still requires Age/DOB, blanks, and formulas", () => {
  const header = ["Full Name", "Phone Number", "Age/DOB", "Score", "Running Total", ""];
  const sample = ["Pat", "555", "4/2/1990", "9", "=E2", ""];
  const suggested = suggestColumnAssignments(header, sample);
  assert.equal(suggested.every((column) => column.explicit === false), true);
  const confirmed = confirmVisibleSelections(suggested);
  assert.equal(confirmed[0]?.explicit, true);
  assert.equal(confirmed[0]?.target?.sourceField, "full_name");
  assert.equal(confirmed[1]?.explicit, true);
  assert.equal(confirmed[1]?.target?.sourceField, "phone");
  assert.equal(confirmed[2]?.explicit, false);
  assert.equal(confirmed[2]?.decision, "ambiguous");
  assert.equal(confirmed[2]?.code, "ambiguous_age_or_dob");
  assert.equal(confirmed[3]?.explicit, false);
  assert.equal(confirmed[3]?.decision, "unmapped");
  assert.equal(confirmed[4]?.explicit, true);
  assert.equal(confirmed[4]?.decision, "unmapped");
  assert.equal(confirmed[4]?.target, null);
  assert.equal(confirmed[4]?.code, "formula_column_omitted");
  assert.equal(confirmed[5]?.explicit, true);
  assert.equal(confirmed[5]?.target, null);
  assert.equal(confirmed[5]?.code, "blank_header");
  const blocked = publishBlocker(confirmed);
  assert.equal(blocked.ok, false);
  if (blocked.ok) return;
  assert.match(blocked.detail ?? "", /Age\/DOB/);
  assert.match(blocked.detail ?? "", /Score/);

  const chosen = confirmed.map((column) =>
    column.sheetHeader === "Age/DOB"
      ? {
          ...column,
          decision: "mapped" as const,
          explicit: true,
          transform: "date_america_new_york" as const,
          target: { kind: "v3_column" as const, header: "DOB", sourceField: "date_of_birth" },
          code: null,
        }
      : column.sheetHeader === "Score"
        ? { ...column, decision: "unmapped" as const, explicit: true, transform: "blank" as const, target: null }
        : column
  );
  assert.equal(publishBlocker(chosen).ok, true);
  const lead = {
    stableRowId: "row_received",
    clientAccountId: "client_a",
    sourceLeadEventId: "evt_received",
    receivedAt: "2026-10-29T15:00:00.000Z",
    sourceLeadId: "lead_received",
    normalizedPayload: {
      contact: { first_name: "Pat", last_name: "Example", email: "pat@example.invalid", phone: "5550001111" },
      routing: {
        source_intake: {
          submitted_at: "2026-10-29T14:00:00.000Z",
          sourceAttributes: { date_of_birth: "not-a-date", dob: "1979-04-12" },
        },
      },
    },
  };
  const explained = explainDraftProjection(chosen, lead);
  const writer = customRowValues(chosen, lead);
  assert.ok(explained);
  assert.equal(explained?.cells.find((item) => item.sheetHeader === "Full Name")?.receivedAnswer, "Pat Example");
  assert.equal(explained?.cells.find((item) => item.sheetHeader === "Full Name")?.outputValue, writer?.[0]);
  const dob = explained?.cells.find((item) => item.canonicalField === "date_of_birth");
  assert.equal(dob?.receivedAnswer, "1979-04-12");
  assert.equal(dob?.outputValue, "04/12/1979");
  assert.equal(dob?.reason, null);
  assert.equal(explained?.sheet.header.length, chosen.length);
  assert.equal(explained?.sheet.values.length, chosen.length);
  assert.equal(explained?.sheet.values[dob?.columnIndex ?? -1], "04/12/1979");
  assert.equal(explained?.sheet.values.includes("47"), false);
  assert.equal(explained?.sheet.dobAge.dateOfBirth, "1979-04-12");
  assert.equal(explained?.sheet.dobAge.dateOfBirthSheet, "04/12/1979");
  assert.equal(explained?.sheet.dobAge.derivedAge, "47");
  assert.equal(explained?.sheet.dobAge.ageProvenance, "derived_from_date_of_birth");
  assert.equal(explained?.sheet.dobAge.referenceDate, "2026-10-29");
  assert.equal(explained?.sheet.dobAge.conflict, false);
  assert.equal(explained?.warnings.includes("consumer_age_conflicts_with_date_of_birth"), false);
  assert.equal(explained?.cells.find((item) => item.sheetHeader === "Running Total")?.reason, "formula_omitted");
  assert.equal(explained?.cells.find((item) => item.sheetHeader === "Running Total")?.outputValue, "");
  assert.equal(explained?.cells.find((item) => item.sheetHeader === "")?.reason, "blank_header");
  assert.equal(explained?.cells.find((item) => item.sheetHeader === "Score")?.reason, "unmapped");
  const phone = explained?.cells.find((item) => item.canonicalField === "phone");
  assert.equal(phone?.receivedAnswer, "5550001111");
  assert.equal(phone?.reason, null);
  explained?.cells.forEach((item, index) => {
    if (item.reason === "formula_omitted") return;
    assert.equal(item.outputValue, writer?.[index]);
  });
});

test("the header fingerprint changes when cells move and ignores a prefix match", () => {
  assert.equal(headerFingerprint(["Phone", "Email"]), headerFingerprint(["Phone", "Email"]));
  assert.notEqual(headerFingerprint(["Phone", "Email"]), headerFingerprint(["Email", "Phone"]));
  assert.equal(exactHeader(["Phone", "Email", "Extra"], ["Phone", "Email"]), false);
  const stored = persistHeaderSnapshot(["Full Name", ""]);
  assert.equal(stored[1], "");
  assert.deepEqual(readHeaderSnapshot(stored), ["Full Name", ""]);
  assert.equal(headerFingerprint(stored), headerFingerprint(["Full Name", ""]));
  assert.notEqual(headerFingerprint(["Full Name", ""]), headerFingerprint(["Full Name", "\u200b"]));
  assert.equal(exactHeader(stored, ["Full Name", ""]), true);
  assert.equal(exactHeader(["Full Name", "\u200b"], ["Full Name", ""]), false);
});
