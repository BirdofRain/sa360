import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { formatGenerationTimestamp } from "../company-sheets-delivery/company-sheets-campaign-row.js";
import {
  applyOperatorAssignments,
  customRowValues,
  type ColumnTransform,
} from "../company-sheets-delivery/company-sheets-custom-row.js";
import { buildStoredLeadColumnPreview, maskEmail, maskPhone } from "./column-map-stored-lead-preview.js";

const ALEX_HEADER = [
  "Date",
  "Client Name",
  "Phone",
  "Email",
  "State",
  "Age/ DOB",
  "Primary Reason",
  "Primary Concern",
  "Beneficiary",
  "Military Status",
  "Notes",
  "Lead Type",
  "Running Total",
  "Campaign",
  "Owner",
];

const MAPPED: Record<string, { header: string; sourceField: string; transform: ColumnTransform }> = {
  Date: { header: "Date", sourceField: "submitted_at", transform: "passthrough" },
  "Client Name": { header: "Client Name", sourceField: "full_name", transform: "passthrough" },
  Phone: { header: "Phone", sourceField: "phone", transform: "passthrough" },
  Email: { header: "Email", sourceField: "email", transform: "passthrough" },
  State: { header: "State", sourceField: "state", transform: "passthrough" },
  "Age/ DOB": { header: "DOB", sourceField: "date_of_birth", transform: "date_america_new_york" },
  "Primary Reason": { header: "Primary Reason", sourceField: "primary_reason", transform: "passthrough" },
  "Primary Concern": { header: "Primary Concern", sourceField: "primary_concern", transform: "passthrough" },
  Beneficiary: { header: "Beneficiary", sourceField: "beneficiary", transform: "passthrough" },
  "Military Status": { header: "Military Status", sourceField: "military_status", transform: "passthrough" },
  Notes: { header: "Notes", sourceField: "notes", transform: "passthrough" },
  "Lead Type": { header: "Lead Type", sourceField: "lead_type", transform: "passthrough" },
};

const LEAD = {
  stableRowId: "preview:client_alex:evt_new",
  clientAccountId: "client_alex",
  sourceLeadEventId: "evt_new",
  receivedAt: "2026-10-26T15:04:00.000Z",
  sourceLeadId: "src_vet_1",
  normalizedPayload: {
    contact: {
      first_name: "Ada",
      last_name: "Lovelace",
      email: "ada.preview.distinct@example.invalid",
      phone_e164: "+15555550100",
      state: "TX",
    },
    state: { lead_type: "VET" },
    routing: {
      source_intake: {
        submitted_at: "2026-10-26T15:04:00.000Z",
        sourceAttributes: {
          primary_reason: "Family",
          age: "47",
          military_status: "Veteran",
          beneficiary: "Spouse",
        },
        unmappedSourceFieldsJson: [{ key: "notes", value: "Call after 5" }],
      },
    },
  },
};

function operatorInput(header: readonly string[]) {
  return header.map((sheetHeader) => {
    const mapped = MAPPED[sheetHeader];
    if (!mapped) {
      return { sheetHeader, decision: "unmapped", transform: "blank", explicit: true, formula: sheetHeader === "Running Total", target: null };
    }
    return {
      sheetHeader,
      decision: "mapped",
      transform: mapped.transform,
      explicit: true,
      formula: false,
      target: { kind: "v3_column", header: mapped.header, sourceField: mapped.sourceField },
    };
  });
}

function sample(header: readonly string[]): string[] {
  return header.map((cell) => (cell === "Running Total" ? "=" : ""));
}

function preview(header: readonly string[], freshnessReasons: string[] = ["google_header_not_reread"]) {
  const applied = applyOperatorAssignments(header, sample(header), operatorInput(header));
  assert.equal(applied.ok, true);
  if (!applied.ok) throw new Error("assignments");
  const built = buildStoredLeadColumnPreview({
    assignments: applied.assignments,
    lead: LEAD,
    freshness: { matchesBinding: freshnessReasons.length === 1, staleIndexes: new Set(), reasons: freshnessReasons },
    basis: "published",
  });
  assert.equal(built.ok, true);
  if (!built.ok) throw new Error("preview");
  return { built, assignments: applied.assignments };
}

test("an Alex-style 15-column map previews blanks for DOB and primary concern", () => {
  const { built, assignments } = preview(ALEX_HEADER);
  const produced = customRowValues(assignments, LEAD);
  assert.deepEqual(built.columns.map((column) => column.formattedValue), produced);
  assert.equal(built.columns.length, 15);
  assert.deepEqual(
    built.columns.map((column) => column.columnLetter),
    ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O"]
  );
  const byHeader = new Map(built.columns.map((column) => [column.sheetHeader, column]));
  const date = byHeader.get("Date");
  assert.equal(date?.formattedValue, formatGenerationTimestamp("2026-10-26T15:04:00.000Z"));
  assert.match(date?.formattedValue ?? "", /10\/26\/2026/);
  assert.match(date?.formattedValue ?? "", /America\/New_York/);
  assert.equal(byHeader.get("Client Name")?.formattedValue, "Ada Lovelace");
  assert.equal(byHeader.get("Phone")?.formattedValue, "+15555550100");
  assert.equal(byHeader.get("Email")?.formattedValue, "ada.preview.distinct@example.invalid");
  assert.equal(byHeader.get("State")?.formattedValue, "TX");
  assert.equal(byHeader.get("Lead Type")?.formattedValue, "VET");
  assert.equal(byHeader.get("Primary Reason")?.formattedValue, "Family");
  assert.equal(byHeader.get("Beneficiary")?.formattedValue, "Spouse");
  assert.equal(byHeader.get("Military Status")?.formattedValue, "Veteran");
  assert.equal(byHeader.get("Notes")?.formattedValue, "Call after 5");
  const dob = byHeader.get("Age/ DOB");
  assert.equal(dob?.sourceField, "date_of_birth");
  assert.equal(dob?.formattedValue, "");
  assert.equal(dob?.warnings.some((warning) => warning.code === "missing_source_value"), true);
  const concern = byHeader.get("Primary Concern");
  assert.equal(concern?.sourceField, "primary_concern");
  assert.equal(concern?.formattedValue, "");
  assert.equal(concern?.warnings.some((warning) => warning.code === "missing_source_value"), true);
  assert.equal(built.operatorDecisions.some((decision) => decision.code === "primary_concern_not_replaced"), true);
  assert.notEqual(concern?.formattedValue, "Family");
  const formula = byHeader.get("Running Total");
  assert.equal(formula?.formattedValue, "");
  assert.equal(formula?.appended, false);
  assert.equal(formula?.warnings.some((warning) => warning.code === "formula_protected"), true);
  assert.equal(formula?.warnings.some((warning) => warning.code === "explicitly_unmapped"), true);
  assert.equal(byHeader.get("Campaign")?.warnings.some((warning) => warning.code === "explicitly_unmapped"), true);
  assert.equal(byHeader.get("Owner")?.warnings.some((warning) => warning.code === "explicitly_unmapped"), true);
  assert.equal(built.deliveryReady, false);
  assert.equal(built.presentAsDeliveryReady, false);
  assert.equal(built.googleHeaderIndependentlyReread, false);
  assert.equal(built.externalCalls.sheets, false);
  assert.equal(built.externalCalls.ghl, false);
  assert.equal(built.publishedMapUnchanged, true);
  assert.equal(built.reasons.includes("google_header_not_reread"), true);
});

test("reordered columns keep worksheet order", () => {
  const header = [...ALEX_HEADER];
  const phone = header.indexOf("Phone");
  const email = header.indexOf("Email");
  [header[phone], header[email]] = [header[email]!, header[phone]!];
  const { built } = preview(header);
  assert.equal(built.columns[2]?.columnLetter, "C");
  assert.equal(built.columns[2]?.sheetHeader, "Email");
  assert.equal(built.columns[2]?.formattedValue, "ada.preview.distinct@example.invalid");
  assert.equal(built.columns[3]?.columnLetter, "D");
  assert.equal(built.columns[3]?.sheetHeader, "Phone");
  assert.equal(built.columns[3]?.formattedValue, "+15555550100");
});

test("a draft assignment and a stale header stay not delivery-ready", () => {
  const applied = applyOperatorAssignments(ALEX_HEADER, sample(ALEX_HEADER), operatorInput(ALEX_HEADER));
  assert.equal(applied.ok, true);
  if (!applied.ok) return;
  const draftAssignments = applied.assignments.map((column) =>
    column.sheetHeader === "Notes"
      ? { ...column, decision: "unmapped" as const, transform: "blank" as const, target: null, explicit: true }
      : column
  );
  const draft = buildStoredLeadColumnPreview({
    assignments: draftAssignments,
    lead: LEAD,
    freshness: { matchesBinding: true, staleIndexes: new Set(), reasons: ["google_header_not_reread"] },
    basis: "draft",
  });
  assert.equal(draft.ok, true);
  if (!draft.ok) return;
  assert.equal(draft.columns.find((column) => column.sheetHeader === "Notes")?.formattedValue, "");
  assert.equal(draft.reasons.includes("draft_not_published"), true);
  assert.equal(draft.deliveryReady, false);
  const notesIndex = ALEX_HEADER.indexOf("Notes");
  const stale = buildStoredLeadColumnPreview({
    assignments: applied.assignments,
    lead: LEAD,
    freshness: {
      matchesBinding: false,
      staleIndexes: new Set([notesIndex]),
      reasons: ["header_fingerprint_mismatch", "google_header_not_reread"],
    },
    basis: "published",
  });
  assert.equal(stale.ok, true);
  if (!stale.ok) return;
  assert.equal(stale.deliveryReady, false);
  assert.equal(stale.columns[notesIndex]?.warnings.some((warning) => warning.code === "stale_mapping"), true);
  assert.equal(stale.columns[0]?.formattedValue.includes("10/26/2026"), true);
});

test("an ambiguous Age/DOB column is warned and not treated as delivery-ready", () => {
  const input = operatorInput(ALEX_HEADER).map((column) =>
    column.sheetHeader === "Age/ DOB"
      ? { ...column, decision: "ambiguous", transform: "blank", explicit: false, target: null }
      : column
  );
  const applied = applyOperatorAssignments(ALEX_HEADER, sample(ALEX_HEADER), input);
  assert.equal(applied.ok, true);
  if (!applied.ok) return;
  const built = buildStoredLeadColumnPreview({
    assignments: applied.assignments,
    lead: LEAD,
    freshness: { matchesBinding: false, staleIndexes: new Set(), reasons: ["binding_absent", "google_header_not_reread"] },
    basis: "draft",
  });
  assert.equal(built.ok, true);
  if (!built.ok) return;
  const age = built.columns.find((column) => column.sheetHeader === "Age/ DOB");
  assert.equal(age?.warnings.some((warning) => warning.code === "ambiguous_mapping"), true);
  assert.equal(built.reasons.includes("mapping_not_explicit"), true);
  assert.equal(built.reasons.includes("binding_absent"), true);
  assert.equal(built.deliveryReady, false);
});

test("selector masks and the preview module does not write or call Google", () => {
  assert.equal(maskEmail("ada.preview.distinct@example.invalid"), "a***@example.invalid");
  assert.equal(maskPhone("+15555550100"), "***0100");
  const source = readFileSync(new URL("./column-map-stored-lead-preview.ts", import.meta.url), "utf8");
  assert.equal(source.includes(".create("), false);
  assert.equal(source.includes(".update("), false);
  assert.equal(source.includes(".delete("), false);
  assert.equal(source.includes("googleapis"), false);
  assert.equal(source.includes("gohighlevel"), false);
  assert.equal(source.includes("console."), false);
});
