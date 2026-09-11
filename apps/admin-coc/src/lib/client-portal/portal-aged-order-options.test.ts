import assert from "node:assert/strict";
import test from "node:test";

import { listActivePplAgedPrices, resolvePplAgedUnitPriceCents } from "@sa360/shared";

import {
  estimatePortalAgedOrder,
  formatPortalUsdFromCents,
  mergePortalAgedOptionsIntoNotes,
  parsePortalAgedOrderOptionsFromNotes,
  tryNormalizeToVerifiedE164,
} from "./portal-aged-order-options.ts";

test("portal estimate uses the shared PPL aged pricing registry", () => {
  const catalog = Object.fromEntries(
    listActivePplAgedPrices().map((row) => [row.key, row.unitPriceCents])
  );
  assert.equal(catalog.COMMERCE_1_3_MO, 600);
  assert.equal(catalog.COMMERCE_3_6_MO, 400);
  assert.equal(catalog.COMMERCE_6_9_MO, 300);
  assert.equal(catalog.COMMERCE_9_12_MO, 200);
  assert.equal(catalog.COMMERCE_12_MO_PLUS, 100);

  const resolved = resolvePplAgedUnitPriceCents({ commerceAgeBucketKey: "COMMERCE_3_6_MO" });
  assert.equal(resolved.ok, true);
  if (resolved.ok) {
    const estimate = estimatePortalAgedOrder({
      campaignType: "Aged leads",
      requestedAgeBucket: "COMMERCE_3_6_MO",
      leadVolume: 87,
    });
    assert.equal(estimate.resolved, true);
    if (estimate.resolved) {
      assert.equal(estimate.unitPriceCents, resolved.unitPriceCents);
      assert.equal(estimate.lineTotalCents, 87 * resolved.unitPriceCents);
    }
  }
});

test("unresolved pricing never falls back to $0", () => {
  assert.equal(
    estimatePortalAgedOrder({
      campaignType: "Fresh leads",
      requestedAgeBucket: "COMMERCE_3_6_MO",
      leadVolume: 10,
    }).resolved,
    false
  );
  assert.equal(
    estimatePortalAgedOrder({
      campaignType: "Aged leads",
      requestedAgeBucket: "FRESH",
      leadVolume: 10,
    }).resolved,
    false
  );
  assert.equal(formatPortalUsdFromCents(0), "Price confirmed during review");
  assert.equal(formatPortalUsdFromCents(Number.NaN), "Price confirmed during review");
});

test("notes round-trip stays backward compatible", () => {
  const empty = parsePortalAgedOrderOptionsFromNotes("Need a Monday start");
  assert.equal(empty.requestedAgeBucket, null);
  assert.equal(empty.shortfallPolicy, null);
  assert.equal(empty.readySmsOptIn, false);
  assert.equal(empty.readySmsPhoneE164, null);

  const merged = mergePortalAgedOptionsIntoNotes("Need a Monday start", {
    requestedAgeBucket: "COMMERCE_9_12_MO",
    shortfallPolicy: "REFUND_UNFILLED",
    readySmsOptIn: true,
    readySmsPhoneE164: "+15550001111",
  });
  assert.ok(merged);
  assert.match(merged!, /Need a Monday start/);
  const parsed = parsePortalAgedOrderOptionsFromNotes(merged);
  assert.equal(parsed.requestedAgeBucket, "COMMERCE_9_12_MO");
  assert.equal(parsed.shortfallPolicy, "REFUND_UNFILLED");
  assert.equal(parsed.readySmsOptIn, true);
  assert.equal(parsed.readySmsPhoneE164, "+15550001111");
});

test("phone normalize matches the preferred E.164 pattern", () => {
  assert.deepEqual(tryNormalizeToVerifiedE164("5551234567"), {
    ok: true,
    e164: "+15551234567",
  });
  assert.equal(tryNormalizeToVerifiedE164("not-a-phone").ok, false);
  assert.equal(tryNormalizeToVerifiedE164("").ok, false);
});
