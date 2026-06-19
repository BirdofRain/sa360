import assert from "node:assert/strict";
import test from "node:test";
import { buildClientRekeyConfirmationPhrase } from "@sa360/shared";
import { ClientRekeyConflictError } from "./client-rekey.service.js";

test("rekey confirmation phrase format", () => {
  assert.equal(
    buildClientRekeyConfirmationPhrase("smart_agent_360_demo_2", "smart_agent_360_demo"),
    "REKEY CLIENT smart_agent_360_demo_2 TO smart_agent_360_demo"
  );
});

test("target-existing conflict error exposes conflicts", () => {
  const err = new ClientRekeyConflictError([
    "Target client already has destination location other_loc, which differs from source location VPuMIhN6JpxdoXvvlekZ.",
  ]);
  assert.equal(err.code, "client_rekey_conflict");
  assert.equal(err.conflicts.length, 1);
});
