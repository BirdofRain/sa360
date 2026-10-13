import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  fingerprintIdentityValue,
  fingerprintPhoneIdentity,
  phoneFingerprintLookupSet,
  phoneFingerprintMatchesSeen,
} from "./identity-fingerprint.js";

const NATIONAL = "2025550100";
const ELEVEN = "12025550100";
const E164 = "+12025550100";
const FORMATTED = "(202) 555-0100";

describe("phone fingerprint canonicalization", () => {
  it("writes the same hash for 10-digit, 11-digit, and +1 E.164 forms", () => {
    const expected = fingerprintIdentityValue("phone", E164);
    assert.equal(fingerprintPhoneIdentity(NATIONAL), expected);
    assert.equal(fingerprintPhoneIdentity(ELEVEN), expected);
    assert.equal(fingerprintPhoneIdentity(E164), expected);
    assert.equal(fingerprintPhoneIdentity(FORMATTED), expected);
  });

  it("looks up historical raw-trim hashes of every stored form", () => {
    const historicalTen = fingerprintIdentityValue("phone", NATIONAL);
    const historicalEleven = fingerprintIdentityValue("phone", ELEVEN);
    const historicalE164 = fingerprintIdentityValue("phone", E164);
    const seen = new Set([historicalTen]);

    assert.equal(phoneFingerprintMatchesSeen(E164, seen), true);
    assert.equal(phoneFingerprintMatchesSeen(ELEVEN, seen), true);
    assert.equal(phoneFingerprintMatchesSeen(NATIONAL, seen), true);

    assert.ok(phoneFingerprintLookupSet(E164).includes(historicalTen));
    assert.ok(phoneFingerprintLookupSet(E164).includes(historicalEleven));
    assert.ok(phoneFingerprintLookupSet(E164).includes(historicalE164));
  });

  it("does not treat a different national number as the same identity", () => {
    const seen = new Set([fingerprintIdentityValue("phone", E164)]);
    assert.equal(phoneFingerprintMatchesSeen("+12025550101", seen), false);
    assert.equal(fingerprintPhoneIdentity("+12025550101"), fingerprintIdentityValue("phone", "+12025550101"));
    assert.notEqual(fingerprintPhoneIdentity(E164), fingerprintPhoneIdentity("+12025550101"));
  });
});
