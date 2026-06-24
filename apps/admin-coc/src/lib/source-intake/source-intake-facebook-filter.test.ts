import test from "node:test";
import assert from "node:assert/strict";
import {
  parseSourceIntakeSearchParams,
  sourceIntakeToApiParams,
} from "./source-intake-query";

test("parses Facebook provider + status filters from search params", () => {
  const query = parseSourceIntakeSearchParams({
    provider: "facebook",
    system: "meta_lead_ads",
    status: "routing_matched",
    matched: "true",
  });
  assert.equal(query.sourceProvider, "facebook");
  assert.equal(query.sourceSystem, "meta_lead_ads");
  assert.equal(query.status, "routing_matched");
  assert.equal(query.matched, "true");
});

test("maps Facebook query to API params", () => {
  const params = sourceIntakeToApiParams({
    sourceProvider: "facebook",
    sourceSystem: "meta_lead_ads",
    status: "needs_review",
  });
  assert.equal(params.sourceProvider, "facebook");
  assert.equal(params.sourceSystem, "meta_lead_ads");
  assert.equal(params.status, "needs_review");
});

test("missing/partial params parse safely without throwing", () => {
  const query = parseSourceIntakeSearchParams({});
  assert.equal(query.sourceProvider, undefined);
  assert.equal(query.status, undefined);
  assert.equal(query.matched, undefined);
  // Array-valued and junk params are ignored rather than throwing.
  const messy = parseSourceIntakeSearchParams({
    provider: ["facebook", "leadcapture_io"],
    matched: "garbage",
    limit: "not-a-number",
  });
  assert.equal(messy.sourceProvider, undefined);
  assert.equal(messy.matched, undefined);
  const params = sourceIntakeToApiParams(messy);
  assert.deepEqual(params, {});
});
