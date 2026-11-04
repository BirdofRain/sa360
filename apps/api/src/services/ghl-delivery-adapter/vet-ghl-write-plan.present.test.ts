import assert from "node:assert/strict";
import test from "node:test";

import { presentVetWritePlan } from "./vet-ghl-write-plan.present.js";

const branch = {
  id: "fieldBranch01",
  name: "Branch of Service",
  key: "branch_of_service",
  fieldKey: "contact.branch_of_service",
  dataType: "TEXT",
};
const reason = {
  id: "fieldReason01",
  name: "Primary Reason",
  key: "primary_reason",
  fieldKey: "contact.primary_reason",
  dataType: "TEXT",
};

test("the write plan blocks a shared destination and leaves notes off", () => {
  const plan = presentVetWritePlan({
    native: {
      firstName: "Sam",
      source: "sa360",
      sourceAttributes: { date_of_birth: "not-a-date", age: "71" },
    },
    sourceAttributes: {
      desired_coverage: "25000",
      branch_of_service: "Army",
      primary_reason: "Family",
      applied_for_other_insurance: "no",
    },
    fieldMap: {
      desired_coverage: { ghlFieldKey: branch.id, requirement: "optional" },
      branch_of_service: { ghlFieldKey: branch.id, requirement: "optional" },
      primary_reason: { ghlFieldKey: reason.id, requirement: "delivery_required" },
      applied_for_other_insurance: { ghlFieldKey: "", requirement: "optional" },
    },
    discoveredFields: [branch, reason],
    notesEnabled: false,
  });
  assert.equal(plan.sendsLead, false);
  assert.equal(plan.native.timezoneWritten, false);
  assert.equal(plan.native.fields.find((field) => field.key === "dateOfBirth")?.disposition, "invalid");
  assert.equal(plan.customFields.find((field) => field.key === "desired_coverage")?.disposition, "blocked");
  assert.equal(plan.customFields.find((field) => field.key === "branch_of_service")?.disposition, "blocked");
  assert.equal(plan.customFields.find((field) => field.key === "primary_reason")?.disposition, "send");
  assert.equal(plan.customFields.find((field) => field.key === "applied_for_other_insurance")?.disposition, "unmapped");
  assert.equal(plan.customFields.find((field) => field.key === "applied_for_other_insurance")?.fieldId, null);
  assert.equal(plan.enrollment.allowed, false);
  assert.match(plan.enrollment.reason ?? "", /Duplicate custom field targets/);
  assert.equal(plan.automationEntry.tag, "SA360::EVENT::LEAD_CREATED");
  assert.equal(plan.automationEntry.disposition, "withheld");
  assert.equal(plan.automationEntry.includedInThisPreviewPost, false);
  assert.match(plan.automationEntry.detail, /does not send it/);
  assert.equal(plan.note.enabled, false);
  assert.equal(plan.note.contractVersion, "sa360_lead_note_v2");
  assert.equal(plan.note.posted, false);
});

test("an enabled note preview uses sa360_lead_note_v2 and is not posted", () => {
  const plan = presentVetWritePlan({
    native: { firstName: "Sam", source: "sa360" },
    sourceAttributes: { primary_reason: "Family" },
    notesEnabled: true,
    noteEvent: { sourceLeadEventId: "evt_note", firstName: "Sam" },
  });
  assert.equal(plan.note.enabled, true);
  assert.equal(plan.note.contractVersion, "sa360_lead_note_v2");
  assert.equal(plan.note.posted, false);
  assert.equal(plan.automationEntry.disposition, "planned_if_required_writes_succeed");
  assert.equal(plan.automationEntry.includedInThisPreviewPost, false);
  assert.match(plan.note.preview ?? "", /Form Questions and Answers/);
  assert.match(plan.note.preview ?? "", /Primary Reason: Family/);
});
