import assert from "node:assert/strict";
import { test } from "node:test";

import { formatFulfillmentOpsAdminError } from "./fulfillment-ops-error.ts";

test("Fulfillment Ops errors do not render raw upstream HTML", () => {
  const msg = formatFulfillmentOpsAdminError(
    504,
    "<!DOCTYPE html> <html><title>504</title></html>"
  );
  assert.match(msg, /temporarily unavailable/i);
  assert.doesNotMatch(msg, /<!DOCTYPE/i);
  assert.doesNotMatch(msg, /<html/i);
});
