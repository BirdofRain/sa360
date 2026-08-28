import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CSV_CONTENT_TYPE,
  csvAttachmentContentDisposition,
  safeCsvDownloadFilename,
} from "./csv-content-disposition.js";

describe("csv content disposition", () => {
  it("keeps an already-safe operator filename", () => {
    const name = "Valley-Vet_LO-1001_VET_TX_3-6mo_25-leads.csv";
    assert.equal(safeCsvDownloadFilename(name), name);
    assert.equal(csvAttachmentContentDisposition(name), `attachment; filename="${name}"`);
  });

  it("strips path, quotes, and spaces so headers cannot leak a filesystem path", () => {
    const safe = safeCsvDownloadFilename('../../etc/passwd; filename="evil.csv"');
    assert.doesNotMatch(safe, /\//);
    assert.doesNotMatch(safe, /\\/);
    assert.doesNotMatch(safe, /"/);
    assert.doesNotMatch(safe, / /);
    assert.match(safe, /\.csv$/);
    assert.equal(CSV_CONTENT_TYPE, "text/csv; charset=utf-8");
  });

  it("appends .csv when missing and falls back when empty", () => {
    assert.equal(safeCsvDownloadFilename("delivery"), "delivery.csv");
    assert.equal(safeCsvDownloadFilename("   "), "delivery.csv");
  });
});
