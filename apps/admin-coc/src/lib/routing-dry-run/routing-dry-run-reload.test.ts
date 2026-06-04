import test from "node:test";
import assert from "node:assert/strict";
import { routingDryRunReloadHref } from "./routing-dry-run-reload.ts";

test("routingDryRunReloadHref uses safe mode with default master when env set", () => {
  const prev = process.env.NEXT_PUBLIC_SA360_DEFAULT_MASTER_CLIENT_ACCOUNT_ID;
  process.env.NEXT_PUBLIC_SA360_DEFAULT_MASTER_CLIENT_ACCOUNT_ID = "lal_master_vet";
  const href = routingDryRunReloadHref();
  assert.ok(href.includes("safe=1"));
  assert.ok(href.includes("limit=5"));
  assert.ok(href.includes("masterClientAccountId=lal_master_vet"));
  if (prev !== undefined) {
    process.env.NEXT_PUBLIC_SA360_DEFAULT_MASTER_CLIENT_ACCOUNT_ID = prev;
  } else {
    delete process.env.NEXT_PUBLIC_SA360_DEFAULT_MASTER_CLIENT_ACCOUNT_ID;
  }
});
