import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, describe, it } from "node:test";

import {
  BUYER_CSV_COLUMNS,
  SPREADSHEET_DELIVERY_CONFIRM_PHRASE,
  SPREADSHEET_DELIVERY_EVIDENCE_NOTE,
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
  // Boundary:
  // - preview: no package, no BuyerDeliveredIdentity
  // - commit: immutable LeadDeliveryExportPackage only
  // - download: does not claim delivery
  // - markSpreadsheetDelivered + MARK SPREADSHEET DELIVERED: only path that
  //   writes BuyerDeliveredIdentity + MANUAL SPREADSHEET DELIVERY RECORDED evidence

  it("sends customer notification only after markSpreadsheetDelivered, never from preview/commit/download", () => {
    const src = readFileSync(new URL("./buyer-csv-export.service.ts", import.meta.url), "utf8");
    const previewAt = src.indexOf("export async function previewBuyerCsvExport");
    const commitAt = src.indexOf("export async function commitBuyerCsvExport");
    const downloadAt = src.indexOf("export async function getBuyerCsvExportDownload");
    const markAt = src.indexOf("export async function markSpreadsheetDelivered");
    const notifyCallAt = src.lastIndexOf("notifyCustomerDeliveryReleased(");
    assert.ok(previewAt >= 0 && commitAt > previewAt);
    assert.ok(downloadAt > commitAt);
    assert.ok(markAt > downloadAt);
    assert.ok(notifyCallAt > markAt);
    assert.doesNotMatch(src.slice(previewAt, markAt), /notifyCustomerDeliveryReleased/);
    assert.match(src.slice(markAt), /attachCustomerReleaseNotification/);
    assert.match(src.slice(downloadAt, markAt), /spreadsheetDeliveredAt/);
    assert.match(
      src.slice(markAt),
      /customerReleaseNotifyStatus:\s*CUSTOMER_RELEASE_NOTIFY_STATUS\.pending/
    );
  });

  it("requires exact spreadsheet delivery confirmation phrase", () => {
    assert.equal(SPREADSHEET_DELIVERY_CONFIRM_PHRASE, "MARK SPREADSHEET DELIVERED");
    assert.equal(SPREADSHEET_DELIVERY_EVIDENCE_NOTE, "MANUAL SPREADSHEET DELIVERY RECORDED");
  });

  it("keeps buyer_csv_v1 seven-column contract unchanged", () => {
    assert.deepEqual(BUYER_CSV_COLUMNS, [
      "first_name",
      "last_name",
      "phone",
      "email",
      "state",
      "lead_date",
      "niche",
    ]);
    assert.equal(BUYER_CSV_COLUMNS.length, 7);
  });

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
