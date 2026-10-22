import assert from "node:assert/strict";
import test from "node:test";

import {
  ageDaysInCommerceBucket,
  LEGACY_COMMERCE_6_12_MO,
} from "./commerce-age-buckets.js";
import {
  PORTAL_6_12_CONSTITUENT_KEYS,
  PORTAL_CUSTOMER_AGE_CHOICES,
  portalCustomerAgeDayRange,
  portalCustomerAgeFulfillmentKeys,
} from "./portal-customer-age.js";

test("customer age ranges meet without overlapping and keep existing day bounds", () => {
  const ranges = PORTAL_CUSTOMER_AGE_CHOICES.map((choice) => ({
    key: choice.key,
    ...portalCustomerAgeDayRange(choice.key),
  }));

  assert.deepEqual(
    ranges.map((range) => [range.key, range.minDaysInclusive, range.maxDaysExclusive]),
    [
      ["COMMERCE_1_3_MO", 30, 90],
      ["COMMERCE_3_6_MO", 90, 180],
      ["COMMERCE_6_12_MO", 180, 365],
      ["COMMERCE_12_MO_PLUS", 365, null],
    ]
  );

  for (let index = 0; index < ranges.length - 1; index += 1) {
    const current = ranges[index]!;
    const next = ranges[index + 1]!;
    assert.equal(current.maxDaysExclusive, next.minDaysInclusive);
  }

  assert.equal(portalCustomerAgeDayRange("COMMERCE_6_12_MO").minDaysInclusive, 180);
  assert.equal(
    portalCustomerAgeDayRange("COMMERCE_6_12_MO").maxDaysExclusive,
    LEGACY_COMMERCE_6_12_MO.maxDaysExclusive
  );
});

test("6–12 months is the union of the stored 6–9 and 9–12 buckets", () => {
  assert.deepEqual(portalCustomerAgeFulfillmentKeys("COMMERCE_6_12_MO"), ["COMMERCE_6_12_MO"]);
  assert.deepEqual(PORTAL_6_12_CONSTITUENT_KEYS, ["COMMERCE_6_9_MO", "COMMERCE_9_12_MO"]);

  for (let day = 180; day < 365; day += 1) {
    const inSixToNine = ageDaysInCommerceBucket(day, "COMMERCE_6_9_MO");
    const inNineToTwelve = ageDaysInCommerceBucket(day, "COMMERCE_9_12_MO");
    assert.equal(inSixToNine || inNineToTwelve, true);
    assert.equal(inSixToNine && inNineToTwelve, false);
    assert.equal(ageDaysInCommerceBucket(day, "COMMERCE_6_12_MO"), true);
  }
  assert.equal(ageDaysInCommerceBucket(179, "COMMERCE_6_12_MO"), false);
  assert.equal(ageDaysInCommerceBucket(365, "COMMERCE_6_12_MO"), false);
  assert.equal(ageDaysInCommerceBucket(90, "COMMERCE_1_3_MO"), false);
  assert.equal(ageDaysInCommerceBucket(90, "COMMERCE_3_6_MO"), true);
});
