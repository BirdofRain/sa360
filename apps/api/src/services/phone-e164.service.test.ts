import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buyerPhoneSpreadsheetCell,
  csvEscapePhoneAsText,
  formatBuyerPhoneSpreadsheetText,
  normalizeToE164,
  tryNormalizeStrictUsNanpE164,
  tryNormalizeToVerifiedE164,
} from "./phone-e164.service.js";

describe("tryNormalizeStrictUsNanpE164", () => {
  it("normalizes complete 10-digit and +1 NANP numbers to canonical E.164", () => {
    assert.deepEqual(tryNormalizeStrictUsNanpE164("2025550100"), {
      ok: true,
      e164: "+12025550100",
    });
    assert.deepEqual(tryNormalizeStrictUsNanpE164("(202) 555-0100"), {
      ok: true,
      e164: "+12025550100",
    });
    assert.deepEqual(tryNormalizeStrictUsNanpE164("+1 202 555 0100"), {
      ok: true,
      e164: "+12025550100",
    });
    assert.deepEqual(tryNormalizeStrictUsNanpE164("1-202-555-0100"), {
      ok: true,
      e164: "+12025550100",
    });
  });

  it("rejects blank phones without inventing digits", () => {
    assert.deepEqual(tryNormalizeStrictUsNanpE164(null), { ok: false, reason: "phone_blank" });
    assert.deepEqual(tryNormalizeStrictUsNanpE164(""), { ok: false, reason: "phone_blank" });
    assert.deepEqual(tryNormalizeStrictUsNanpE164("   "), { ok: false, reason: "phone_blank" });
    assert.deepEqual(tryNormalizeStrictUsNanpE164("---"), { ok: false, reason: "phone_blank" });
  });

  it("rejects truncated and overlong digit runs instead of padding or clipping", () => {
    assert.deepEqual(tryNormalizeStrictUsNanpE164("202555010"), {
      ok: false,
      reason: "phone_truncated",
    });
    assert.deepEqual(tryNormalizeStrictUsNanpE164("202-555-01"), {
      ok: false,
      reason: "phone_truncated",
    });
    assert.deepEqual(tryNormalizeStrictUsNanpE164("120255501001"), {
      ok: false,
      reason: "phone_overlong",
    });
    assert.deepEqual(tryNormalizeStrictUsNanpE164("+1202555010012"), {
      ok: false,
      reason: "phone_overlong",
    });
  });

  it("rejects structurally invalid NANP NPAs and NXXs", () => {
    assert.deepEqual(tryNormalizeStrictUsNanpE164("1025550100"), {
      ok: false,
      reason: "phone_structurally_invalid",
    });
    assert.deepEqual(tryNormalizeStrictUsNanpE164("2021550100"), {
      ok: false,
      reason: "phone_structurally_invalid",
    });
    assert.deepEqual(tryNormalizeStrictUsNanpE164("2115550100"), {
      ok: false,
      reason: "phone_structurally_invalid",
    });
    assert.deepEqual(tryNormalizeStrictUsNanpE164("2025550111".replace("555", "511")), {
      ok: false,
      reason: "phone_structurally_invalid",
    });
    assert.deepEqual(tryNormalizeStrictUsNanpE164("0000000000"), {
      ok: false,
      reason: "phone_structurally_invalid",
    });
    assert.deepEqual(tryNormalizeStrictUsNanpE164("1.2025550100e10"), {
      ok: false,
      reason: "phone_structurally_invalid",
    });
  });

  it("does not accept the best-effort 8-to-15 digit fallback used by inbound normalizeToE164", () => {
    assert.equal(normalizeToE164("5551234").startsWith("+") || normalizeToE164("5551234") === "5551234", true);
    assert.deepEqual(tryNormalizeStrictUsNanpE164("5551234"), {
      ok: false,
      reason: "phone_truncated",
    });
    const loose = tryNormalizeToVerifiedE164("442079460958");
    assert.equal(loose.ok, true);
    assert.deepEqual(tryNormalizeStrictUsNanpE164("442079460958"), {
      ok: false,
      reason: "phone_overlong",
    });
  });
});

describe("buyer spreadsheet phone text cells", () => {
  it("emits quoted RFC4180 E.164; XLSX text type is a separate contract", () => {
    assert.equal(formatBuyerPhoneSpreadsheetText("(202) 555-0100"), "+12025550100");
    assert.deepEqual(buyerPhoneSpreadsheetCell("2025550100"), {
      type: "text",
      value: "+12025550100",
    });
    assert.equal(csvEscapePhoneAsText("202-555-0100"), '"+12025550100"');
    assert.equal(buyerPhoneSpreadsheetCell("2025550100").type, "text");
    // Quoting is RFC4180 field escaping only. It does not set an Excel cell
    // format; XLSX writers must keep type: "text".
    assert.notEqual(csvEscapePhoneAsText("2025550100"), buyerPhoneSpreadsheetCell("2025550100").value);
    assert.match(csvEscapePhoneAsText("2025550100"), /^"\+12025550100"$/);
  });
});
