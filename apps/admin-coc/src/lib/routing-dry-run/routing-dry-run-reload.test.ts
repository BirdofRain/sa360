import test from "node:test";
import assert from "node:assert/strict";
import { routingDryRunReloadHref } from "./routing-dry-run-reload.ts";

test("routingDryRunReloadHref uses safe mode without master filter", () => {
  const href = routingDryRunReloadHref();
  assert.ok(href.includes("safe=1"));
  assert.ok(href.includes("limit=5"));
  assert.ok(!href.includes("masterClientAccountId="));
});
