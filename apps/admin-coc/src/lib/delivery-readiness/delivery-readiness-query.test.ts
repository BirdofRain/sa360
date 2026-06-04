import test from "node:test";
import assert from "node:assert/strict";
import {
  applyDeliveryReadinessDefaultMaster,
  parseDeliveryReadinessSearchParams,
} from "./delivery-readiness-query.ts";

test("applyDeliveryReadinessDefaultMaster fills master from env when query empty", () => {
  const prev = process.env.NEXT_PUBLIC_SA360_DEFAULT_MASTER_CLIENT_ACCOUNT_ID;
  process.env.NEXT_PUBLIC_SA360_DEFAULT_MASTER_CLIENT_ACCOUNT_ID = "lal_master_vet";
  const applied = applyDeliveryReadinessDefaultMaster(parseDeliveryReadinessSearchParams({}));
  assert.equal(applied.masterClientAccountId, "lal_master_vet");
  if (prev !== undefined) {
    process.env.NEXT_PUBLIC_SA360_DEFAULT_MASTER_CLIENT_ACCOUNT_ID = prev;
  } else {
    delete process.env.NEXT_PUBLIC_SA360_DEFAULT_MASTER_CLIENT_ACCOUNT_ID;
  }
});
