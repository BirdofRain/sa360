import test from "node:test";
import assert from "node:assert/strict";

import { formatPortalOrderIdentity } from "./portal-order-identity.ts";

test("order display identity includes the client display name and canonical number", () => {
  assert.equal(formatPortalOrderIdentity("Valley Vet", "LO-2401"), "Valley Vet — LO-2401");
  assert.equal(formatPortalOrderIdentity("  Valley Vet  ", "LO-2401"), "Valley Vet — LO-2401");
});

test("canonical order number remains intact when the display name is missing", () => {
  assert.equal(formatPortalOrderIdentity(null, "LO-2401"), "LO-2401");
  assert.equal(formatPortalOrderIdentity("   ", "LO-2401"), "LO-2401");
  assert.equal(formatPortalOrderIdentity(undefined, "LO-1001"), "LO-1001");
});

test("does not duplicate the order number when it is the only available name", () => {
  assert.equal(formatPortalOrderIdentity("LO-2401", "LO-2401"), "LO-2401");
});
