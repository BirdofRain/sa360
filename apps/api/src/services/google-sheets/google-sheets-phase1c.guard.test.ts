import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import test from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const files = [
  join(here, "google-sheets-http-client.ts"),
  join(here, "google-sheets-destination.service.ts"),
  join(here, "../../lib/google-sheets-env.ts"),
  join(here, "../../lib/google-spreadsheet-ref.ts"),
  join(here, "../../routes/integrations-google.ts"),
  join(here, "../google-oauth/google-access-token.service.ts"),
  join(here, "../google-oauth/google-oauth-http-client.ts"),
];

test("AB/AQ/Y. Phase 1C sources never call Drive, append rows, or enqueue worker jobs", () => {
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    assert.equal(/https:\/\/drive\.googleapis\.com/.test(source), false, file);
    assert.equal(source.includes("/auth/drive"), false, file);
    assert.equal(source.includes("values:append"), false, file);
    assert.equal(source.includes("spreadsheets.values"), false, file);
    assert.equal(source.includes("bullmq"), false, file);
    assert.equal(/deliverLive\s*\(/.test(source), false, file);
  }
});
