import assert from "node:assert/strict";
import test from "node:test";

import { normalizeProfileValues } from "./client-profile-multi-select";

test("profile selection removes blanks and case/whitespace duplicates", () => {
  assert.deepEqual(
    normalizeProfileValues([" VET ", "vet", "", "Health", " health "]),
    ["VET", "Health"]
  );
});

test("legacy catalog values remain visible and editable", () => {
  assert.deepEqual(normalizeProfileValues(["legacy_custom_product"]), [
    "legacy_custom_product",
  ]);
});
