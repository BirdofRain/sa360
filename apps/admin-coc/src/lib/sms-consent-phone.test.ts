import assert from "node:assert/strict";
import test from "node:test";

import { tryNormalizeSmsConsentPhone } from "./sms-consent-phone.ts";

const CANONICAL = "+19193096948";

test("US confirmation numbers normalize to one E.164 value", () => {
  for (const raw of ["9193096948", "(919) 309-6948", "919-309-6948", "919.309.6948", "1-919-309-6948", "19193096948", "+19193096948", "+1 (919) 309-6948", "  +1 919 309 6948  "]) {
    assert.deepEqual(tryNormalizeSmsConsentPhone(raw), { ok: true, e164: CANONICAL }, raw);
  }
});

test("an explicit international E.164 number is preserved", () => {
  assert.deepEqual(tryNormalizeSmsConsentPhone("+44 7911 123456"), { ok: true, e164: "+447911123456" });
  assert.deepEqual(tryNormalizeSmsConsentPhone("+33612345678"), { ok: true, e164: "+33612345678" });
});

test("ambiguous, extended, and malformed numbers are rejected", () => {
  const cases: Array<[string, string]> = [
    ["", "blank"],
    ["   ", "blank"],
    ["---", "blank"],
    ["919309694", "invalid"],
    ["919309694812", "ambiguous"],
    ["447911123456", "ambiguous"],
    ["91930969481", "ambiguous"],
    ["011 44 7911 123456", "ambiguous"],
    ["(919) 309-6948 x12", "malformed"],
    ["919-309-6948 ext. 9", "malformed"],
    ["9193096948#12", "malformed"],
    ["919-309-HELP", "malformed"],
    ["++19193096948", "malformed"],
    ["+0123456789", "invalid"],
    ["+1 919 309 694", "invalid"],
    ["+1 919 309 69481", "invalid"],
    ["1234567890", "invalid"],
    ["9191116948", "invalid"],
    ["9113096948", "invalid"],
    ["+999", "invalid"],
  ];
  for (const [raw, reason] of cases) {
    assert.deepEqual(tryNormalizeSmsConsentPhone(raw), { ok: false, reason }, raw);
  }
});
