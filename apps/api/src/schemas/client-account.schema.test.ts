import assert from "node:assert/strict";
import test from "node:test";

import {
  clientAccountCreateBodySchema,
  clientAccountPatchBodySchema,
} from "./client-account.schema.js";

test("saved-account patch cannot rename the client account ID", () => {
  const parsed = clientAccountPatchBodySchema.safeParse({
    clientDisplayName: "Renamed Business",
    clientAccountId: "renamed_business",
  });
  assert.equal(parsed.success, false);
});

test("client account contract enforces ID length and allowed characters", () => {
  assert.equal(
    clientAccountCreateBodySchema.safeParse({
      clientDisplayName: "Valid Name",
      clientAccountId: "valid_name",
    }).success,
    true
  );
  for (const clientAccountId of ["1_invalid", "Invalid", "has-dash", `a${"b".repeat(80)}`]) {
    assert.equal(
      clientAccountCreateBodySchema.safeParse({
        clientDisplayName: "Invalid ID",
        clientAccountId,
      }).success,
      false
    );
  }
});
