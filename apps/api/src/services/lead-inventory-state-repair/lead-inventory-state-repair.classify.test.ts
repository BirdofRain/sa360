import assert from "node:assert/strict";
import { test } from "node:test";

import {
  classifyInvalidInventoryState,
  readSourceEventStateFields,
} from "./lead-inventory-state-repair.classify.js";

test("repairable from current dirty value with an explicit code", () => {
  for (const [raw, expected] of [
    ["Charleston sc", "SC"],
    ["Durham nc", "NC"],
    ["Dover Pa", "PA"],
    ["CT CT CT", "CT"],
    ["Philadelphia Pennsylvania", "PA"],
    ["Tn.", "TN"],
    ["Ma.", "MA"],
    ["N.H.", "NH"],
    ["Oregon.", "OR"],
  ] as const) {
    const result = classifyInvalidInventoryState({ currentNormalizedState: raw });
    assert.equal(result.classification, "REPAIRABLE_CANONICAL_STATE", raw);
    assert.equal(result.proposedState, expected, raw);
  }
});

test("unresolved dirty values are not guessed", () => {
  for (const raw of ["South Columbia", "WXzhi gwashingto", "Oklahola", "Mass", "Fla", "Fla.", "Ark", "Tenn"]) {
    const result = classifyInvalidInventoryState({ currentNormalizedState: raw });
    assert.equal(result.classification, "UNRESOLVED_INVALID_STATE", raw);
    assert.equal(result.proposedState, null, raw);
  }
});

test("authoritative source event contact.state wins when inventory value is unresolved", () => {
  const result = classifyInvalidInventoryState({
    currentNormalizedState: "South Columbia",
    contactState: "SC",
  });
  assert.equal(result.classification, "REPAIRABLE_CANONICAL_STATE");
  assert.equal(result.proposedState, "SC");
});

test("conflicting evidence is not auto-repaired", () => {
  const result = classifyInvalidInventoryState({
    currentNormalizedState: "Ark",
    contactState: "AR",
    payloadState: "OK",
  });
  assert.equal(result.classification, "CONFLICTING_STATE_EVIDENCE");
  assert.equal(result.proposedState, null);
});

test("readSourceEventStateFields keeps contact and payload separate", () => {
  const fields = readSourceEventStateFields({
    state: "TX",
    contact: { state: "Charleston sc" },
  });
  assert.equal(fields.payloadState, "TX");
  assert.equal(fields.contactState, "Charleston sc");
});
