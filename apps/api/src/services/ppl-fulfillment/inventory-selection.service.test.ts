import { test } from "node:test";
import assert from "node:assert/strict";

import {
  computeShortfallQuantity,
  dedupeCandidatesByIdentityFingerprints,
  isPplSelectionEnabled,
  matchesCommerceAgeBucketFilter,
  PPL_PRODUCTION_MIN_QTY,
  PPL_SELECTION_MAX_SCANNED_ROWS,
  PPL_SELECTION_PAGE_SIZE,
  resolvePplMinQuantity,
  sortCandidatesFcfs,
  validatePplRequestedQuantity,
  type PplInventoryCandidate,
} from "./inventory-selection.service.js";

const originalSelectionEnabled = process.env.SA360_PPL_SELECTION_ENABLED;

test.afterEach(() => {
  if (originalSelectionEnabled === undefined) {
    delete process.env.SA360_PPL_SELECTION_ENABLED;
  } else {
    process.env.SA360_PPL_SELECTION_ENABLED = originalSelectionEnabled;
  }
});

test("isPplSelectionEnabled requires explicit true flag", () => {
  delete process.env.SA360_PPL_SELECTION_ENABLED;
  assert.equal(isPplSelectionEnabled(), false);
  process.env.SA360_PPL_SELECTION_ENABLED = "true";
  assert.equal(isPplSelectionEnabled(), true);
});

test("production min quantity is 1 — no under-100 floor", () => {
  assert.equal(PPL_PRODUCTION_MIN_QTY, 1);
  assert.equal(resolvePplMinQuantity(), 1);
  assert.deepEqual(validatePplRequestedQuantity(1), { ok: true });
  assert.deepEqual(validatePplRequestedQuantity(99), { ok: true });
  assert.deepEqual(validatePplRequestedQuantity(100), { ok: true });
  assert.deepEqual(validatePplRequestedQuantity(0), {
    ok: false,
    code: "invalid_requested_quantity",
  });
  assert.deepEqual(validatePplRequestedQuantity(-5), {
    ok: false,
    code: "invalid_requested_quantity",
  });
});

test("SA360_PPL_LOCAL_MIN_QTY is not used as a production min override", () => {
  process.env.SA360_PPL_SELECTION_ENABLED = "true";
  process.env.SA360_PPL_LOCAL_MIN_QTY = "100";
  assert.equal(resolvePplMinQuantity(), 1);
  assert.deepEqual(validatePplRequestedQuantity(1), { ok: true });
  delete process.env.SA360_PPL_LOCAL_MIN_QTY;
});

test("computeShortfallQuantity preserves requested and never goes negative", () => {
  assert.equal(computeShortfallQuantity(210, 200), 10);
  assert.equal(computeShortfallQuantity(210, 210), 0);
  assert.equal(computeShortfallQuantity(10, 0), 10);
});

test("partial fulfillment selection math keeps requested and reports shortfall", () => {
  const requested = 210;
  const eligible = Array.from({ length: 200 }, (_, i) => i + 1);
  const selected = eligible.slice(0, requested);
  assert.equal(selected.length, 200);
  assert.equal(computeShortfallQuantity(requested, selected.length), 10);
  // Commercial requested quantity is not lowered by shortfall.
  assert.equal(requested, 210);
});

test("zero inventory yields full shortfall with no selection", () => {
  const requested = 50;
  const eligible: number[] = [];
  const selected = eligible.slice(0, requested);
  assert.equal(selected.length, 0);
  assert.equal(computeShortfallQuantity(requested, selected.length), requested);
});

test("bounded scan constants are explicit hard ceilings", () => {
  assert.equal(PPL_SELECTION_PAGE_SIZE, 250);
  assert.equal(PPL_SELECTION_MAX_SCANNED_ROWS, 5_000);
  assert.ok(PPL_SELECTION_PAGE_SIZE < PPL_SELECTION_MAX_SCANNED_ROWS);
});

test("matchesCommerceAgeBucketFilter requires commerce bucket when none requested", () => {
  assert.equal(matchesCommerceAgeBucketFilter(null, []), false);
  assert.equal(matchesCommerceAgeBucketFilter("COMMERCE_1_3_MO", []), true);
  assert.equal(
    matchesCommerceAgeBucketFilter("COMMERCE_3_6_MO", ["COMMERCE_1_3_MO"]),
    false
  );
});

test("legacy COMMERCE_6_12_MO request matches new 6-9 and 9-12 candidate keys", () => {
  assert.equal(
    matchesCommerceAgeBucketFilter("COMMERCE_6_9_MO", ["COMMERCE_6_12_MO"]),
    true
  );
  assert.equal(
    matchesCommerceAgeBucketFilter("COMMERCE_9_12_MO", ["COMMERCE_6_12_MO"]),
    true
  );
  assert.equal(
    matchesCommerceAgeBucketFilter("COMMERCE_3_6_MO", ["COMMERCE_6_12_MO"]),
    false
  );
});

test("sortCandidatesFcfs orders by generatedAt then id", () => {
  const sorted = sortCandidatesFcfs([
    { id: "b", generatedAt: new Date("2026-01-02T00:00:00.000Z") },
    { id: "a", generatedAt: new Date("2026-01-01T00:00:00.000Z") },
    { id: "c", generatedAt: new Date("2026-01-02T00:00:00.000Z") },
  ]);
  assert.deepEqual(
    sorted.map((entry) => entry.id),
    ["a", "b", "c"]
  );
});

function candidate(partial: {
  id: string;
  phoneFingerprint?: string | null;
  emailFingerprint?: string | null;
}): PplInventoryCandidate {
  return {
    item: { id: partial.id } as PplInventoryCandidate["item"],
    inventoryLot: { supplierAccountId: null, status: "active" },
    sourceLeadEvent: {
      id: `evt-${partial.id}`,
      normalizedPayloadJson: {},
      enrichmentMetadataJson: {},
    },
    ageDays: 45,
    commerceAgeBucketKey: "COMMERCE_1_3_MO",
    phoneFingerprint: partial.phoneFingerprint ?? null,
    emailFingerprint: partial.emailFingerprint ?? null,
  };
}

test("dedupeCandidatesByIdentityFingerprints excludes prior-buyer and in-batch duplicates", () => {
  const seenPhones = new Set(["phone-a"]);
  const seenEmails = new Set(["email-b"]);
  const selected = dedupeCandidatesByIdentityFingerprints(
    [
      candidate({ id: "1", phoneFingerprint: "phone-a", emailFingerprint: "email-x" }), // prior phone
      candidate({ id: "2", phoneFingerprint: "phone-z", emailFingerprint: "email-b" }), // prior email
      candidate({ id: "3", phoneFingerprint: "phone-new", emailFingerprint: "email-y" }), // keep
      candidate({ id: "4", phoneFingerprint: "phone-new", emailFingerprint: "email-z" }), // in-batch phone dupe
      candidate({ id: "5", phoneFingerprint: "phone-other", emailFingerprint: "email-y" }), // in-batch email dupe
      candidate({ id: "6", phoneFingerprint: "phone-ok", emailFingerprint: "email-ok" }), // keep
    ],
    seenPhones,
    seenEmails
  );
  assert.deepEqual(
    selected.map((row) => row.item.id),
    ["3", "6"]
  );
});

test("FCFS slice preserves earliest candidates for partial fill", () => {
  const eligible = sortCandidatesFcfs([
    { id: "late", generatedAt: new Date("2026-03-01T00:00:00.000Z") },
    { id: "early", generatedAt: new Date("2026-01-01T00:00:00.000Z") },
    { id: "mid", generatedAt: new Date("2026-02-01T00:00:00.000Z") },
  ]);
  const selected = eligible.slice(0, 2);
  assert.deepEqual(
    selected.map((row) => row.id),
    ["early", "mid"]
  );
});
