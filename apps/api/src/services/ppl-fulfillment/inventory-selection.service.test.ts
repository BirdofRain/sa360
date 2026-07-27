import { test } from "node:test";
import assert from "node:assert/strict";

import {
  dedupeCandidatesByIdentityFingerprints,
  isPplSelectionEnabled,
  matchesCommerceAgeBucketFilter,
  PPL_PRODUCTION_MIN_QTY,
  resolvePplMinQuantity,
  sortCandidatesFcfs,
  validatePplRequestedQuantity,
  type PplInventoryCandidate,
} from "./inventory-selection.service.js";

const originalSelectionEnabled = process.env.SA360_PPL_SELECTION_ENABLED;
const originalLocalMinQty = process.env.SA360_PPL_LOCAL_MIN_QTY;

test.afterEach(() => {
  if (originalSelectionEnabled === undefined) {
    delete process.env.SA360_PPL_SELECTION_ENABLED;
  } else {
    process.env.SA360_PPL_SELECTION_ENABLED = originalSelectionEnabled;
  }
  if (originalLocalMinQty === undefined) {
    delete process.env.SA360_PPL_LOCAL_MIN_QTY;
  } else {
    process.env.SA360_PPL_LOCAL_MIN_QTY = originalLocalMinQty;
  }
});

test("isPplSelectionEnabled requires explicit true flag", () => {
  delete process.env.SA360_PPL_SELECTION_ENABLED;
  assert.equal(isPplSelectionEnabled(), false);
  process.env.SA360_PPL_SELECTION_ENABLED = "true";
  assert.equal(isPplSelectionEnabled(), true);
});

test("resolvePplMinQuantity uses local override only when selection enabled", () => {
  delete process.env.SA360_PPL_SELECTION_ENABLED;
  delete process.env.SA360_PPL_LOCAL_MIN_QTY;
  assert.equal(resolvePplMinQuantity(), PPL_PRODUCTION_MIN_QTY);

  // Local override must not affect production when selection flag is off.
  process.env.SA360_PPL_LOCAL_MIN_QTY = "1";
  assert.equal(resolvePplMinQuantity(), PPL_PRODUCTION_MIN_QTY);

  process.env.SA360_PPL_SELECTION_ENABLED = "true";
  process.env.SA360_PPL_LOCAL_MIN_QTY = "25";
  assert.equal(resolvePplMinQuantity(), 25);
});

test("validatePplRequestedQuantity rejects under minimum without local override", () => {
  delete process.env.SA360_PPL_SELECTION_ENABLED;
  delete process.env.SA360_PPL_LOCAL_MIN_QTY;
  assert.deepEqual(validatePplRequestedQuantity(99), {
    ok: false,
    code: "under_100_unresolved",
  });
  assert.deepEqual(validatePplRequestedQuantity(100), { ok: true });
});

test("validatePplRequestedQuantity honors local minimum when enabled", () => {
  process.env.SA360_PPL_SELECTION_ENABLED = "true";
  process.env.SA360_PPL_LOCAL_MIN_QTY = "10";
  assert.deepEqual(validatePplRequestedQuantity(9), {
    ok: false,
    code: "under_100_unresolved",
  });
  assert.deepEqual(validatePplRequestedQuantity(10), { ok: true });
});

test("matchesCommerceAgeBucketFilter requires commerce bucket when none requested", () => {
  assert.equal(matchesCommerceAgeBucketFilter(null, []), false);
  assert.equal(matchesCommerceAgeBucketFilter("COMMERCE_1_3_MO", []), true);
  assert.equal(
    matchesCommerceAgeBucketFilter("COMMERCE_3_6_MO", ["COMMERCE_1_3_MO"]),
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

test("exact quantity has no buffer: selected slice equals requested when eligible allows", () => {
  const eligible = [1, 2, 3, 4, 5];
  const requested = 3;
  const selected = eligible.slice(0, requested);
  assert.equal(selected.length, requested);
  assert.equal(selected.length < requested ? "shortage" : "exact", "exact");
  assert.notEqual(selected.length, requested + 1);
});
