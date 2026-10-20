import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "lead-delivery-export-package.repository.ts"), "utf8");

describe("lead-delivery-export-package.repository", () => {
  it("customer reads require tenant + order and a release or verified Sheets delivery", () => {
    assert.match(src, /spreadsheetDeliveredAt:\s*\{\s*not:\s*null\s*\}/);
    assert.match(src, /leadOrderId:\s*input\.leadOrderId/);
    assert.match(src, /clientAccountId:\s*input\.clientAccountId/);
    assert.match(src, /status:\s*"succeeded"/);
    assert.match(src, /job:\s*\{\s*status:\s*"succeeded"\s*\}/);
    assert.doesNotMatch(src, /spreadsheetDeliveredAt:\s*null/);
    assert.doesNotMatch(src, /status:\s*"queued"/);
  });
});
