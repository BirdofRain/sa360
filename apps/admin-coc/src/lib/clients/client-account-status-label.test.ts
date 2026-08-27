import assert from "node:assert/strict";
import test from "node:test";

import { formatClientAccountStatusLabel } from "./client-account-status-label.ts";

test("admin client status labels are operator-readable", () => {
  assert.equal(formatClientAccountStatusLabel("onboarding"), "Onboarding");
  assert.equal(formatClientAccountStatusLabel("active"), "Active / Ready to order");
  assert.equal(formatClientAccountStatusLabel("paused"), "Paused");
  assert.equal(formatClientAccountStatusLabel("archived"), "Archived");
});
