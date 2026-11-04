import assert from "node:assert/strict";
import test from "node:test";

import {
  duplicateTargets,
  enrollmentBlockers,
  fieldSuggestions,
  intakeSummaryNotesEnabled,
  mergeIntakeSummaryNotes,
  presentSeparatedOperations,
  readVetWritePlan,
  reviewSavedMappings,
  savedMappingEntries,
  unsafeBlindRetry,
} from "./ghl-vet-setup-display.ts";

const fields = [
  { id: "field_branch", name: "Branch of Service", dataType: "TEXT" },
  { id: "field_reason", name: "Primary Reason", dataType: "TEXT" },
  { id: "field_other", name: "Other Insurance", dataType: "TEXT" },
  { id: "field_coverage_a", name: "Desired Coverage Range", dataType: "TEXT" },
  { id: "field_coverage_b", name: "Desired Coverage", dataType: "TEXT" },
];

test("review shows the discovered name with the saved id and keeps a stale id", () => {
  const entries = savedMappingEntries({
    desired_coverage: { ghlFieldKey: "field_coverage_a", requirement: "optional" },
    branch_of_service: { ghlFieldKey: "missing_field", requirement: "delivery_required" },
    primary_reason: { ghlFieldKey: "field_reason", requirement: "optional" },
    beneficiary: "field_beneficiary_manual",
  });
  assert.equal(entries.beneficiary?.ghlFieldKey, "field_beneficiary_manual");
  assert.equal(entries.branch_of_service?.requirement, "delivery_required");
  const rows = reviewSavedMappings({
    entries,
    keys: ["desired_coverage", "branch_of_service", "primary_reason", "applied_for_other_insurance"],
    fields,
    discoveryLoaded: true,
  });
  assert.equal(rows.find((row) => row.key === "desired_coverage")?.fieldName, "Desired Coverage Range");
  assert.equal(rows.find((row) => row.key === "desired_coverage")?.savedId, "field_coverage_a");
  assert.equal(rows.find((row) => row.key === "branch_of_service")?.status, "stale");
  assert.equal(rows.find((row) => row.key === "branch_of_service")?.savedId, "missing_field");
  assert.equal(rows.find((row) => row.key === "applied_for_other_insurance")?.status, "missing");
  assert.equal(rows.find((row) => row.key === "applied_for_other_insurance")?.savedId, null);
});

test("duplicate targets and a required stale field are enrollment blockers", () => {
  const entries = savedMappingEntries({
    desired_coverage: { ghlFieldKey: "field_branch", requirement: "optional" },
    branch_of_service: { ghlFieldKey: "field_branch", requirement: "optional" },
    primary_reason: { ghlFieldKey: "gone", requirement: "delivery_required" },
  });
  const duplicates = duplicateTargets({ entries, fields });
  assert.equal(duplicates.length, 1);
  assert.deepEqual(duplicates[0]?.keys.sort(), ["branch_of_service", "desired_coverage"]);
  const blockers = enrollmentBlockers({
    entries,
    duplicates,
    sourceValues: { desired_coverage: "25000", branch_of_service: "Army", primary_reason: "Family" },
    discoveryLoaded: true,
    fields,
  });
  assert.match(blockers.join(" "), /Duplicate custom field target/);
  assert.match(blockers.join(" "), /primary_reason/);
});

test("suggestions stay unlabeled as verified and ambiguous names are not chosen", () => {
  const one = fieldSuggestions({ key: "branch_of_service", fields });
  assert.equal(one.status, "one");
  assert.equal(one.fields[0]?.id, "field_branch");
  const ambiguous = fieldSuggestions({ key: "desired_coverage", fields });
  assert.equal(ambiguous.status, "ambiguous");
  assert.equal(ambiguous.fields.length, 2);
  const missing = fieldSuggestions({ key: "applied_for_other_insurance", fields });
  assert.equal(missing.status, "none");
});

test("notes merge keeps unrelated policy keys and ignores a string true", () => {
  assert.equal(intakeSummaryNotesEnabled({ intakeSummaryNotesEnabled: "true", aiContextRequired: ["branch"] }), false);
  const merged = mergeIntakeSummaryNotes(
    { aiContextRequired: ["branch_of_service"], limitedAutomationBehavior: "queue_for_review" },
    true
  );
  assert.equal(merged.intakeSummaryNotesEnabled, true);
  assert.deepEqual(merged.aiContextRequired, ["branch_of_service"]);
  assert.equal(merged.limitedAutomationBehavior, "queue_for_review");
  const disabled = mergeIntakeSummaryNotes(merged, false);
  assert.equal(disabled.intakeSummaryNotesEnabled, false);
  assert.deepEqual(disabled.aiContextRequired, ["branch_of_service"]);
});

test("the backend write plan is displayed without normalizing a date", () => {
  const plan = readVetWritePlan({
    vetWritePlan: {
      native: {
        timezoneWritten: false,
        fields: [
          { key: "dateOfBirth", disposition: "send", value: "1955-03-13" },
          { key: "email", disposition: "omitted_missing", value: null },
        ],
      },
      customFields: [
        { key: "date_of_birth", disposition: "send", fieldId: "custom_dob", fieldName: "DOB", value: "1955-03-13" },
        { key: "age", disposition: "omitted_missing", fieldId: "custom_age", fieldName: "Age", value: null },
        { key: "primary_reason", disposition: "blocked", fieldId: "field_reason", fieldName: "Primary Reason", value: null },
      ],
      enrollment: { allowed: false, reason: "Duplicate custom field targets block workflow enrollment." },
      automationEntry: {
        tag: "SA360::EVENT::LEAD_CREATED",
        disposition: "withheld",
        includedInThisPreviewPost: false,
        detail: "SA360::EVENT::LEAD_CREATED is withheld because the write plan blocks enrollment. This preview does not send it.",
      },
      note: { enabled: false, contractVersion: "sa360_lead_note_v2", preview: null, posted: false },
      sendsLead: false,
    },
  });
  assert.ok(plan);
  assert.equal(plan?.timezoneWritten, false);
  assert.equal(plan?.native.find((row) => row.key === "dateOfBirth")?.disposition, "send");
  assert.equal(plan?.native.find((row) => row.key === "dateOfBirth")?.value, "1955-03-13");
  assert.equal(plan?.native.find((row) => row.key === "phone")?.disposition, "not_in_plan");
  assert.equal(plan?.customFields.find((row) => row.key === "age")?.disposition, "omitted_missing");
  assert.equal(plan?.customFields.find((row) => row.key === "primary_reason")?.disposition, "blocked");
  assert.equal(plan?.enrollmentAllowed, false);
  assert.equal(plan?.automationEntryDisposition, "withheld");
  assert.match(plan?.automationEntryDetail ?? "", /does not send it/);
  assert.equal(plan?.sendsLead, false);
});

test("ambiguous and rejected outcomes are shown apart and are not a blind retry", () => {
  const copy = presentSeparatedOperations({
    contactResult: "upserted",
    noteResult: "ambiguous",
    workflowResult: "enrolled",
  });
  assert.match(copy.note ?? "", /ambiguous/);
  assert.match(copy.workflow ?? "", /does not verify/);
  assert.match(copy.contact ?? "", /accepted/);
  assert.equal(copy.blindRetry, false);
  assert.equal(unsafeBlindRetry({ noteResult: "ambiguous" }), true);
  assert.equal(unsafeBlindRetry({ contactResult: "rejected" }), true);
  assert.equal(unsafeBlindRetry({ workflowResult: "blocked" }), false);
  const missing = presentSeparatedOperations({});
  assert.match(missing.lines[0] ?? "", /did not include separate/);
});
