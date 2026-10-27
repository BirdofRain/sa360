import assert from "node:assert/strict";
import test from "node:test";

import { auditIntakeQaEvidence } from "./onboarding-qa-evidence.js";

test("qa evidence is complete only when every later duplicate is still stored", () => {
  const evidence = auditIntakeQaEvidence({
    answers: { Beneficiary: "Child", "Beneficiary Name": "Spouse" },
    answerFields: [
      { key: "Beneficiary", name: "Beneficiary", value: "Child" },
      { key: "Beneficiary Name", name: "Beneficiary Name", value: "Spouse" },
    ],
  });
  assert.equal(evidence.status, "complete");
  assert.equal(evidence.fullQaCompletenessAsserted, true);
  assert.equal(evidence.discardedDuplicateCount, 0);
  assert.equal(JSON.stringify(evidence).includes("Spouse"), false);
});

test("qa evidence reports discarded duplicates without reconstructing the answer", () => {
  const evidence = auditIntakeQaEvidence({
    answers: { Beneficiary: "Child", "Beneficiary Name": "Spouse" },
    answerFields: [{ key: "Beneficiary", name: "Beneficiary", value: "Child" }],
  });
  assert.equal(evidence.status, "discarded_duplicates");
  assert.equal(evidence.fullQaCompletenessAsserted, false);
  assert.equal(evidence.discardedDuplicateCount >= 1, true);
  assert.equal(JSON.stringify(evidence).includes("Spouse"), false);
  assert.equal(JSON.stringify(evidence).includes("Child"), false);
});

test("stored answer fields without raw intake are not recoverable", () => {
  const evidence = auditIntakeQaEvidence({
    answerFields: [
      { key: "Beneficiary", name: "Beneficiary", value: "Child" },
      { key: "Beneficiary", name: "Beneficiary", value: "Spouse" },
    ],
    sourceAttributes: { beneficiary: "Child" },
  });
  assert.equal(evidence.status, "not_recoverable");
  assert.equal(evidence.fullQaCompletenessAsserted, false);
  assert.equal(evidence.discardedDuplicateCount, 0);
});
