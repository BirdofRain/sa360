import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseExternalReceiptCsv } from "./external-receipt-csv.ts";

describe("FOWB external receipt CSV", () => {
  it("skips the header so 3261 occupied-looking rows become 3260 data rows", () => {
    const header = "Phone,Email,Rejected Before Delivery";
    const data = Array.from(
      { length: 3260 },
      (_, index) => `202555${String(index).padStart(4, "0")},lead${index}@example.test,false`
    );
    const rows = parseExternalReceiptCsv([header, ...data].join("\n"));
    assert.equal(rows.length, 3260);
    assert.equal(rows[0]?.phone, "2025550000");
  });

  it("keeps quoted commas inside email cells", () => {
    const rows = parseExternalReceiptCsv(
      '"Phone Number","Email Address"\n"+1-202-555-0100","ada,lead@example.test"\n'
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.email, "ada,lead@example.test");
  });
});
