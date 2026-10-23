import assert from "node:assert/strict";
import test from "node:test";

import {
  ageDaysInCommerceBucket,
  LEGACY_COMMERCE_6_12_MO,
  resolveCommerceAgeBucketKey,
} from "./commerce-age-buckets.js";
import {
  isPortalCustomerAgeChoice,
  PORTAL_6_12_CONSTITUENT_KEYS,
  PORTAL_CUSTOMER_AGE_CHOICES,
  portalCustomerAgeChoiceLabel,
  portalCustomerAgeDayRange,
  portalCustomerAgeFulfillmentKeys,
} from "./portal-customer-age.js";

test("new orders offer the five priced commerce ranges and not a 6–12 choice", () => {
  const ranges = PORTAL_CUSTOMER_AGE_CHOICES.map((choice) => ({
    key: choice.key,
    ...portalCustomerAgeDayRange(choice.key),
  }));

  assert.deepEqual(
    ranges.map((range) => [range.key, range.minDaysInclusive, range.maxDaysExclusive]),
    [
      ["COMMERCE_1_3_MO", 30, 90],
      ["COMMERCE_3_6_MO", 90, 180],
      ["COMMERCE_6_9_MO", 180, 270],
      ["COMMERCE_9_12_MO", 270, 365],
      ["COMMERCE_12_MO_PLUS", 365, null],
    ]
  );
  assert.equal(isPortalCustomerAgeChoice("COMMERCE_6_12_MO"), false);
  assert.equal(portalCustomerAgeChoiceLabel("COMMERCE_6_12_MO"), "6–12 months");

  for (let index = 0; index < ranges.length - 1; index += 1) {
    const current = ranges[index]!;
    const next = ranges[index + 1]!;
    assert.equal(current.maxDaysExclusive, next.minDaysInclusive);
    assert.deepEqual(portalCustomerAgeFulfillmentKeys(current.key), [current.key]);
  }
  assert.deepEqual(portalCustomerAgeFulfillmentKeys("COMMERCE_12_MO_PLUS"), [
    "COMMERCE_12_MO_PLUS",
  ]);
});

test("commerce day boundaries stay on the approved ranges", () => {
  const expected: Array<[number, string | null]> = [
    [29, null],
    [30, "COMMERCE_1_3_MO"],
    [89, "COMMERCE_1_3_MO"],
    [90, "COMMERCE_3_6_MO"],
    [179, "COMMERCE_3_6_MO"],
    [180, "COMMERCE_6_9_MO"],
    [269, "COMMERCE_6_9_MO"],
    [270, "COMMERCE_9_12_MO"],
    [364, "COMMERCE_9_12_MO"],
    [365, "COMMERCE_12_MO_PLUS"],
  ];
  for (const [day, key] of expected) {
    assert.equal(resolveCommerceAgeBucketKey(day), key, `day ${day}`);
  }
  assert.equal(ageDaysInCommerceBucket(179, "COMMERCE_6_9_MO"), false);
  assert.equal(ageDaysInCommerceBucket(180, "COMMERCE_6_9_MO"), true);
  assert.equal(ageDaysInCommerceBucket(269, "COMMERCE_6_9_MO"), true);
  assert.equal(ageDaysInCommerceBucket(270, "COMMERCE_6_9_MO"), false);
  assert.equal(ageDaysInCommerceBucket(270, "COMMERCE_9_12_MO"), true);
  assert.equal(ageDaysInCommerceBucket(364, "COMMERCE_9_12_MO"), true);
  assert.equal(ageDaysInCommerceBucket(365, "COMMERCE_9_12_MO"), false);
});

test("legacy 6–12 still describes the stored union without becoming a new choice", () => {
  assert.deepEqual(PORTAL_6_12_CONSTITUENT_KEYS, ["COMMERCE_6_9_MO", "COMMERCE_9_12_MO"]);
  assert.equal(LEGACY_COMMERCE_6_12_MO.minDaysInclusive, 180);
  assert.equal(LEGACY_COMMERCE_6_12_MO.maxDaysExclusive, 365);
  for (let day = 180; day < 365; day += 1) {
    const inSixToNine = ageDaysInCommerceBucket(day, "COMMERCE_6_9_MO");
    const inNineToTwelve = ageDaysInCommerceBucket(day, "COMMERCE_9_12_MO");
    assert.equal(inSixToNine || inNineToTwelve, true);
    assert.equal(inSixToNine && inNineToTwelve, false);
    assert.equal(ageDaysInCommerceBucket(day, "COMMERCE_6_12_MO"), true);
  }
  assert.equal(ageDaysInCommerceBucket(179, "COMMERCE_6_12_MO"), false);
  assert.equal(ageDaysInCommerceBucket(365, "COMMERCE_6_12_MO"), false);
});
