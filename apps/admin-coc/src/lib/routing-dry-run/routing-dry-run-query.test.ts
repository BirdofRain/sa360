import test from "node:test";
import assert from "node:assert/strict";
import {
  applyRoutingDryRunDefaultMaster,
  buildRoutingDryRunHref,
  hasRoutingDryRunMasterFilter,
  parseRoutingDryRunSearchParams,
  routingDryRunCleanHref,
  routingDryRunQueryToApiParams,
  routingDryRunSafeHref,
} from "./routing-dry-run-query.ts";

test("parseRoutingDryRunSearchParams defaults master to empty (all clients)", () => {
  const q = parseRoutingDryRunSearchParams({});
  assert.equal(q.masterClientAccountId, "");
  assert.equal(q.matched, "all");
  assert.equal(q.limit, 50);
});

test("parseRoutingDryRunSearchParams reads master matched limit", () => {
  const q = parseRoutingDryRunSearchParams({
    masterClientAccountId: "master_abc",
    matched: "unmatched",
    validationStatus: "mismatch",
    limit: "25",
  });
  assert.equal(q.masterClientAccountId, "master_abc");
  assert.equal(q.matched, "unmatched");
  assert.equal(q.validationStatus, "mismatch");
  assert.equal(q.reviewQueue, "all");
  assert.equal(q.limit, 25);
});

test("routingDryRunQueryToApiParams omits master when all clients selected", () => {
  assert.deepEqual(
    routingDryRunQueryToApiParams({
      masterClientAccountId: "",
      matched: "all",
      validationStatus: "all",
      reviewQueue: "all",
      limit: 50,
      safeMode: false,
    }),
    { limit: 50, matched: undefined, validationStatus: undefined }
  );
});

test("routingDryRunQueryToApiParams maps matched filter to boolean", () => {
  assert.deepEqual(
    routingDryRunQueryToApiParams({
      masterClientAccountId: "m1",
      matched: "matched",
      validationStatus: "matched_legacy",
      reviewQueue: "all",
      limit: 50,
      safeMode: false,
    }),
    { masterClientAccountId: "m1", limit: 50, matched: true, validationStatus: "matched_legacy" }
  );
  assert.deepEqual(
    routingDryRunQueryToApiParams({
      masterClientAccountId: "m1",
      matched: "all",
      validationStatus: "all",
      reviewQueue: "matched_no_plan",
      limit: 50,
      safeMode: false,
    }),
    {
      masterClientAccountId: "m1",
      limit: 50,
      matched: undefined,
      validationStatus: undefined,
      reviewQueue: "matched_no_plan",
    }
  );
});

test("hasRoutingDryRunMasterFilter is false when master empty", () => {
  const q = parseRoutingDryRunSearchParams({});
  assert.equal(hasRoutingDryRunMasterFilter(q), false);
});

test("applyRoutingDryRunDefaultMaster fills master from env when query empty", () => {
  const prev = process.env.NEXT_PUBLIC_SA360_DEFAULT_MASTER_CLIENT_ACCOUNT_ID;
  process.env.NEXT_PUBLIC_SA360_DEFAULT_MASTER_CLIENT_ACCOUNT_ID = "lal_master_vet";
  const base = parseRoutingDryRunSearchParams({});
  const applied = applyRoutingDryRunDefaultMaster(base);
  assert.equal(applied.masterClientAccountId, "lal_master_vet");
  if (prev !== undefined) {
    process.env.NEXT_PUBLIC_SA360_DEFAULT_MASTER_CLIENT_ACCOUNT_ID = prev;
  } else {
    delete process.env.NEXT_PUBLIC_SA360_DEFAULT_MASTER_CLIENT_ACCOUNT_ID;
  }
});

test("routingDryRunSafeHref uses safe mode without master filter", () => {
  const href = routingDryRunSafeHref();
  assert.ok(href.includes("safe=1"));
  assert.ok(href.includes("limit=5"));
  assert.ok(!href.includes("masterClientAccountId="));
});

test("routingDryRunCleanHref clears all filters", () => {
  assert.equal(routingDryRunCleanHref(), "/routing-dry-run");
});

test("buildRoutingDryRunHref encodes query", () => {
  const href = buildRoutingDryRunHref({
    masterClientAccountId: "m1",
    matched: "unmatched",
    validationStatus: "needs_mapping",
    reviewQueue: "mismatches",
    limit: 100,
    safeMode: false,
  });
  assert.ok(href.includes("masterClientAccountId=m1"));
  assert.ok(href.includes("matched=unmatched"));
  assert.ok(href.includes("validationStatus=needs_mapping"));
  assert.ok(href.includes("limit=100"));
  assert.ok(href.includes("reviewQueue=mismatches"));
});
