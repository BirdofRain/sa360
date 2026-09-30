import assert from "node:assert/strict";
import test from "node:test";

import {
  accountIdAfterDisplayNameChange,
  CLIENT_ACCOUNT_ID_MAX_LENGTH,
  manuallyEditedAccountId,
  resetToSuggestedAccountId,
  suggestClientAccountId,
} from "./client-account-id-suggestion";

test("suggests a lowercase underscore account ID", () => {
  assert.deepEqual(suggestClientAccountId("Sam Hebda"), {
    value: "sam_hebda",
    valid: true,
    message: null,
  });
});

test("normalizes punctuation, accents, and repeated separators", () => {
  assert.equal(suggestClientAccountId("  Éva---O'Neil & Team  ").value, "eva_o_neil_team");
});

test("reports blank and numeric-leading names for manual entry", () => {
  assert.equal(suggestClientAccountId(" --- ").valid, false);
  assert.equal(suggestClientAccountId("360 Advisors").valid, false);
});

test("marks one-character suggestions invalid to match the API minimum", () => {
  assert.deepEqual(suggestClientAccountId("A"), {
    value: "a",
    valid: false,
    message: "Enter an account ID with at least 2 characters.",
  });
});

test("respects the backend maximum length", () => {
  const result = suggestClientAccountId(`A ${"very ".repeat(30)}long name`);
  assert.equal(result.valid, true);
  assert.ok(result.value.length <= CLIENT_ACCOUNT_ID_MAX_LENGTH);
  assert.equal(result.value.endsWith("_"), false);
});

test("name changes update before override and preserve a manual override", () => {
  const automatic = accountIdAfterDisplayNameChange(
    { value: "", manuallyEdited: false },
    "Sam Hebda"
  );
  assert.equal(automatic.value, "sam_hebda");
  const manual = manuallyEditedAccountId("Samuel_Hebda");
  assert.deepEqual(accountIdAfterDisplayNameChange(manual, "Different Name"), {
    value: "samuel_hebda",
    manuallyEdited: true,
  });
});

test("reset restores automatic suggestion behavior", () => {
  const reset = resetToSuggestedAccountId("Sam Hebda");
  assert.deepEqual(reset, { value: "sam_hebda", manuallyEdited: false });
  assert.equal(accountIdAfterDisplayNameChange(reset, "Sam H").value, "sam_h");
});
