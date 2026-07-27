import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import {
  BUYER_CSV_COLUMNS,
  assertBuyerCsvColumns,
  extractBuyerCsvFields,
  isPplCsvExportEnabled,
  leadDateOnlyUtc,
  serializeBuyerCsv,
  sha256Hex,
} from "./buyer-csv-export.service.js";

const originalFlag = process.env.SA360_PPL_CSV_EXPORT_ENABLED;

afterEach(() => {
  if (originalFlag === undefined) delete process.env.SA360_PPL_CSV_EXPORT_ENABLED;
  else process.env.SA360_PPL_CSV_EXPORT_ENABLED = originalFlag;
});

describe("buyer-csv-export allowlist", () => {
  // Boundary: BuyerDeliveredIdentity is written only inside commitBuyerCsvExport
  // (finalize). previewBuyerCsvExport builds CSV/checksum only and must not call
  // recordBuyerDeliveredIdentities — operator Commit export = finalize. Optional
  // DB-less mock of that preview path is not required for this unit suite.

  it("rejects forbidden columns", () => {
    assert.doesNotThrow(() => assertBuyerCsvColumns([...BUYER_CSV_COLUMNS]));
    assert.throws(() => assertBuyerCsvColumns(["first_name", "source_agent"]), /forbidden_column/);
    assert.throws(() => assertBuyerCsvColumns(["supplier"]), /forbidden_column/);
    assert.throws(() => assertBuyerCsvColumns(["leadUid"]), /forbidden_column/);
    assert.throws(() => assertBuyerCsvColumns(["allocation", "cost"]), /forbidden_column/);
    assert.throws(() => assertBuyerCsvColumns(["proof"]), /forbidden_column/);
  });

  it("uses date-only lead_date with no time component", () => {
    const generatedAt = new Date("2024-06-15T22:45:11.123Z");
    const row = extractBuyerCsvFields({
      normalizedPayloadJson: {
        contact: {
          first_name: "Ada",
          last_name: "Lovelace",
          phone_e164: "+15551234567",
          email: "ada@example.com",
          state: "NC",
        },
      },
      generatedAt,
      nicheKey: "vet",
    });
    assert.equal(row.lead_date, "2024-06-15");
    assert.equal(leadDateOnlyUtc(generatedAt), "2024-06-15");
    assert.doesNotMatch(row.lead_date, /T|\d{2}:\d{2}/);

    const csv = serializeBuyerCsv([row]);
    assert.doesNotMatch(csv, /22:45/);
    assert.doesNotMatch(csv, /T22:45:11/);
  });

  it("escapes commas and quotes in CSV cells", () => {
    const row = extractBuyerCsvFields({
      normalizedPayloadJson: {
        contact: {
          first_name: 'Ada, "Countess"',
          last_name: 'O\'Brien, PhD',
          phone_e164: "+15551234567",
          email: "ada@example.com",
          state: "NC",
        },
      },
      generatedAt: new Date("2024-01-02T12:00:00.000Z"),
      nicheKey: "vet",
    });
    const csv = serializeBuyerCsv([row]);
    assert.match(csv, /"Ada, ""Countess"""/);
    assert.match(csv, /"O'Brien, PhD"/);
  });

  it("produces stable checksums for identical serialization", () => {
    const row = extractBuyerCsvFields({
      normalizedPayloadJson: {
        contact: {
          first_name: "Ada",
          last_name: "Lovelace",
          phone_e164: "+15551234567",
          email: "ada@example.com",
          state: "NC",
        },
      },
      generatedAt: new Date("2024-06-15T22:45:11.123Z"),
      nicheKey: "vet",
    });
    const csv = serializeBuyerCsv([row]);
    const again = serializeBuyerCsv([row]);
    assert.equal(csv, again);
    assert.equal(sha256Hex(csv), sha256Hex(again));
    assert.equal(
      csv.split("\n")[0],
      "first_name,last_name,phone,email,state,lead_date,niche"
    );
  });

  it("omits forbidden field names from serialized output", () => {
    const row = extractBuyerCsvFields({
      normalizedPayloadJson: {
        contact: {
          first_name: "Ada",
          last_name: "Lovelace",
          phone_e164: "+15551234567",
          email: "ada@example.com",
          state: "NC",
        },
        source_agent: "hidden-agent",
        supplier: "hidden-supplier",
        leadUid: "uid-should-not-appear",
        allocation: "alloc-should-not-appear",
        proof: "proof-should-not-appear",
        cost: "99.99",
      },
      generatedAt: new Date("2024-06-15T22:45:11.123Z"),
      nicheKey: "vet",
    });
    const csv = serializeBuyerCsv([row]);
    assert.doesNotMatch(csv, /source_agent/i);
    assert.doesNotMatch(csv, /supplier/i);
    assert.doesNotMatch(csv, /leadUid/i);
    assert.doesNotMatch(csv, /allocation/i);
    assert.doesNotMatch(csv, /proof/i);
    assert.doesNotMatch(csv, /cost/i);
    assert.doesNotMatch(csv, /hidden-agent|hidden-supplier|uid-should-not-appear|99\.99/);
  });

  it("gates on isPplCsvExportEnabled / SA360_PPL_CSV_EXPORT_ENABLED", () => {
    delete process.env.SA360_PPL_CSV_EXPORT_ENABLED;
    assert.equal(isPplCsvExportEnabled(), false);
    process.env.SA360_PPL_CSV_EXPORT_ENABLED = "false";
    assert.equal(isPplCsvExportEnabled(), false);
    process.env.SA360_PPL_CSV_EXPORT_ENABLED = "true";
    assert.equal(isPplCsvExportEnabled(), true);
  });
});
