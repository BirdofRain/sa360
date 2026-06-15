import test from "node:test";
import assert from "node:assert/strict";
import {
  buildClientDeliveryConfigHref,
  parseClientDeliveryConfigSearchParams,
} from "./delivery-config-query.ts";

test("buildClientDeliveryConfigHref targets destination page without master account", () => {
  const href = buildClientDeliveryConfigHref({
    clientAccountId: "vet_life_james_torrey",
    locationId: "9xSNvQCbGaPE9YNxgl4B",
  });
  assert.equal(
    href,
    "/clients/vet_life_james_torrey/delivery-config?locationId=9xSNvQCbGaPE9YNxgl4B"
  );
  assert.ok(!href.includes("masterClientAccountId"));
  assert.ok(!href.includes("delivery-readiness"));
  assert.ok(!href.includes("lal_master_vet"));
});

test("parseClientDeliveryConfigSearchParams reads locationId", () => {
  const parsed = parseClientDeliveryConfigSearchParams({
    locationId: "9xSNvQCbGaPE9YNxgl4B",
  });
  assert.equal(parsed.locationId, "9xSNvQCbGaPE9YNxgl4B");
});
