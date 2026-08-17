import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createHash } from "node:crypto";

import { buildOperatorBuyerCsvFilename, sanitizeFilenamePart } from "./buyer-csv-filename.js";

describe("buildOperatorBuyerCsvFilename", () => {
  it("includes client, order, niche, state, bucket, and count", () => {
    const filename = buildOperatorBuyerCsvFilename({
      clientDisplayName: "Smart Agent 360 Demo",
      orderNumber: "LO-1048",
      nicheKey: "vet",
      states: ["NC"],
      commerceAgeBucketKey: "COMMERCE_9_12_MO",
      rowCount: 1,
    });
    assert.equal(filename, "Smart-Agent-360-Demo_LO-1048_VET_NC_9-12mo_1-lead.csv");
  });

  it("sanitizes unsafe filesystem characters and stays bounded", () => {
    const filename = buildOperatorBuyerCsvFilename({
      clientDisplayName: 'Acme / Client: "West"*<>|?',
      orderNumber: "LO-1",
      nicheKey: "trucker",
      states: ["TX", "FL", "GA", "NC"],
      commerceAgeBucketKey: "COMMERCE_1_3_MO",
      rowCount: 12,
    });
    assert.match(filename, /^[A-Za-z0-9._-]+\.csv$/);
    assert.ok(filename.length < 180);
    assert.match(filename, /TX-FL-plus2/);
    assert.match(filename, /12-leads\.csv$/);
    assert.doesNotMatch(filename, /[/\s:*?"<>|]/);
  });

  it("does not include PII and does not change CSV SHA", () => {
    const filename = buildOperatorBuyerCsvFilename({
      clientDisplayName: "Buyer Co",
      orderNumber: "LO-9",
      nicheKey: "vet",
      states: ["NC"],
      commerceAgeBucketKey: "COMMERCE_3_6_MO",
      rowCount: 2,
    });
    assert.equal(filename, "Buyer-Co_LO-9_VET_NC_3-6mo_2-leads.csv");
    assert.doesNotMatch(filename, /@|phone|\+1/i);
    const csv = "first_name,last_name\nAda,Lovelace\n";
    const shaBefore = createHash("sha256").update(csv, "utf8").digest("hex");
    const shaAfter = createHash("sha256").update(csv, "utf8").digest("hex");
    assert.equal(shaBefore, shaAfter);
    assert.ok(filename.endsWith(".csv"));
  });

  it("falls back safely when a part is empty", () => {
    assert.equal(sanitizeFilenamePart("   "), "unknown");
    const filename = buildOperatorBuyerCsvFilename({
      clientDisplayName: "",
      clientAccountId: "acct_1",
      orderNumber: "LO-2",
      nicheKey: "nurse",
      states: [],
      rowCount: 0,
    });
    assert.match(filename, /acct_1_LO-2_NURSE_NA_bucket_0-leads\.csv/);
  });
});
