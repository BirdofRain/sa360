import test from "node:test";
import assert from "node:assert/strict";
import {
  deliveryReadinessQueryToApiParams,
  parseDeliveryReadinessSearchParams,
} from "./delivery-readiness-query.ts";

test("Delivery Readiness defaults to all rows when no master/client filter is given", () => {
  const params = deliveryReadinessQueryToApiParams(parseDeliveryReadinessSearchParams({}));
  // Non-null params (page always fetches) with no master/client → API returns all rows.
  assert.equal(params.masterClientAccountId, undefined);
  assert.equal(params.clientAccountId, undefined);
});

test("Delivery Readiness can still filter by leadcapture_io master", () => {
  const params = deliveryReadinessQueryToApiParams(
    parseDeliveryReadinessSearchParams({ masterClientAccountId: "leadcapture_io" })
  );
  assert.equal(params.masterClientAccountId, "leadcapture_io");
});

test("Delivery Readiness can still filter by lal_master_vet master", () => {
  const params = deliveryReadinessQueryToApiParams(
    parseDeliveryReadinessSearchParams({ masterClientAccountId: "lal_master_vet" })
  );
  assert.equal(params.masterClientAccountId, "lal_master_vet");
});

test("Delivery Readiness can filter by destination client and status", () => {
  const params = deliveryReadinessQueryToApiParams(
    parseDeliveryReadinessSearchParams({
      clientAccountId: "vet_life_james_torrey",
      status: "ready",
    })
  );
  assert.equal(params.clientAccountId, "vet_life_james_torrey");
  assert.equal(params.status, "ready");
  assert.equal(params.masterClientAccountId, undefined);
});
