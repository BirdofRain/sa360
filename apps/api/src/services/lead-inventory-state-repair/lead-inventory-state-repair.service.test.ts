import assert from "node:assert/strict";
import { test } from "node:test";

import { INVENTORY_STATE_REPAIR_COMMIT_CONFIRMATION } from "@sa360/shared";

import { commitInventoryStateRepair } from "./lead-inventory-state-repair.service.js";

test("commit refuses without explicit mode, host, operator, and confirmation", async () => {
  const missingMode = await commitInventoryStateRepair(
    {
      mode: "state-repair-preview",
      expectedDbHost: "127.0.0.1",
      operator: "agent-o",
      confirmation: INVENTORY_STATE_REPAIR_COMMIT_CONFIRMATION,
    },
    {} as never
  );
  assert.equal(missingMode.ok, false);
  if (!missingMode.ok) assert.equal(missingMode.error, "explicit_commit_mode_required");

  const missingConfirm = await commitInventoryStateRepair(
    {
      mode: "state-repair-commit",
      expectedDbHost: "127.0.0.1",
      operator: "agent-o",
      confirmation: "NOPE",
    },
    {} as never
  );
  assert.equal(missingConfirm.ok, false);
  if (!missingConfirm.ok) assert.equal(missingConfirm.error, "confirmation_required");
});
