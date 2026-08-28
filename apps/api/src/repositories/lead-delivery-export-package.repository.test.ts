import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "lead-delivery-export-package.repository.ts"), "utf8");

describe("lead-delivery-export-package.repository", () => {
  it("customer reads require tenant + order + spreadsheetDeliveredAt", () => {
    assert.match(src, /spreadsheetDeliveredAt:\s*\{\s*not:\s*null\s*\}/);
    assert.match(src, /leadOrderId:\s*input\.leadOrderId/);
    assert.match(src, /clientAccountId:\s*input\.clientAccountId/);
    assert.doesNotMatch(src, /spreadsheetDeliveredAt:\s*null/);
  });
});
