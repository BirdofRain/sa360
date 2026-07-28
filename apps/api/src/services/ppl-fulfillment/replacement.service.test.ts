import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import {
  DUPLICATE_REASON_CODE,
  isDuplicateReasonCode,
  isPplReplacementEnabled,
  REPLACEMENT_CONFIRM_APPROVE_PHRASE,
  UNSUPPORTED_REPLACEMENT_REASON_CODES,
} from "./replacement.service.js";

const originalFlag = process.env.SA360_PPL_REPLACEMENT_ENABLED;

afterEach(() => {
  if (originalFlag === undefined) delete process.env.SA360_PPL_REPLACEMENT_ENABLED;
  else process.env.SA360_PPL_REPLACEMENT_ENABLED = originalFlag;
});

describe("replacement service flags", () => {
  it("defaults replacement feature off", () => {
    delete process.env.SA360_PPL_REPLACEMENT_ENABLED;
    assert.equal(isPplReplacementEnabled(), false);
  });

  it("enables only when SA360_PPL_REPLACEMENT_ENABLED=true", () => {
    process.env.SA360_PPL_REPLACEMENT_ENABLED = "true";
    assert.equal(isPplReplacementEnabled(), true);
    process.env.SA360_PPL_REPLACEMENT_ENABLED = "1";
    assert.equal(isPplReplacementEnabled(), false);
    process.env.SA360_PPL_REPLACEMENT_ENABLED = "false";
    assert.equal(isPplReplacementEnabled(), false);
  });

  it("uses explicit approve confirmation phrase", () => {
    assert.equal(REPLACEMENT_CONFIRM_APPROVE_PHRASE, "APPROVE REPLACEMENT");
  });

  it("accepts only duplicate reasonCode and rejects deferred reasons", () => {
    assert.equal(DUPLICATE_REASON_CODE, "duplicate");
    assert.equal(isDuplicateReasonCode("duplicate"), true);
    assert.equal(isDuplicateReasonCode("DUPLICATE"), true);
    assert.equal(isDuplicateReasonCode(" duplicate "), true);
    assert.equal(isDuplicateReasonCode("quality"), false);
    assert.equal(isDuplicateReasonCode("bad_lead"), false);
    assert.equal(isDuplicateReasonCode(""), false);
    for (const code of UNSUPPORTED_REPLACEMENT_REASON_CODES) {
      assert.equal(isDuplicateReasonCode(code), false, code);
    }
  });
});
