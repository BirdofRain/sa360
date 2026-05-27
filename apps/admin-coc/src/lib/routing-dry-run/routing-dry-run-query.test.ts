import test from "node:test";
import assert from "node:assert/strict";
import {
  buildRoutingDryRunHref,
  parseRoutingDryRunSearchParams,
  routingDryRunQueryToApiParams,
} from "./routing-dry-run-query.ts";

test("parseRoutingDryRunSearchParams reads master matched limit", () => {
  const q = parseRoutingDryRunSearchParams({
    masterClientAccountId: "master_abc",
    matched: "unmatched",
    limit: "25",
  });
  assert.equal(q.masterClientAccountId, "master_abc");
  assert.equal(q.matched, "unmatched");
  assert.equal(q.limit, 25);
});

test("routingDryRunQueryToApiParams maps matched filter to boolean", () => {
  assert.deepEqual(
    routingDryRunQueryToApiParams({
      masterClientAccountId: "m1",
      matched: "matched",
      limit: 50,
    }),
    { masterClientAccountId: "m1", limit: 50, matched: true }
  );
  assert.deepEqual(
    routingDryRunQueryToApiParams({
      masterClientAccountId: "m1",
      matched: "all",
      limit: 50,
    }),
    { masterClientAccountId: "m1", limit: 50, matched: undefined }
  );
  assert.equal(
    routingDryRunQueryToApiParams({
      masterClientAccountId: "",
      matched: "all",
      limit: 50,
    }),
    null
  );
});

test("buildRoutingDryRunHref encodes query", () => {
  const href = buildRoutingDryRunHref({
    masterClientAccountId: "m1",
    matched: "unmatched",
    limit: 100,
  });
  assert.ok(href.includes("masterClientAccountId=m1"));
  assert.ok(href.includes("matched=unmatched"));
  assert.ok(href.includes("limit=100"));
});
