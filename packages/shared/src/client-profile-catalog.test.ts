import assert from "node:assert/strict";
import test from "node:test";

import {
  CLIENT_PROFILE_NICHE_OPTIONS,
  CLIENT_PROFILE_PRODUCT_OPTIONS,
} from "./client-profile-catalog.js";

test("client profile catalog keeps the requested products and niches", () => {
  assert.deepEqual(
    CLIENT_PROFILE_PRODUCT_OPTIONS.map((option) => [option.value, option.label]),
    [
      ["life_insurance", "Life Insurance"],
      ["health_insurance", "Health Insurance"],
      ["other", "Other"],
    ]
  );
  assert.deepEqual(
    CLIENT_PROFILE_NICHE_OPTIONS.map((option) => [option.value, option.label]),
    [
      ["VET", "VETERAN"],
      ["NURSE", "NURSE"],
      ["MTG", "MORTGAGE"],
      ["TRUCKER", "TRUCKER"],
      ["HEALTH", "HEALTH"],
      ["IUL", "IUL"],
      ["FEX", "FEX"],
    ]
  );
  assert.equal(
    CLIENT_PROFILE_NICHE_OPTIONS.find((option) => option.label === "MORTGAGE")?.value,
    "MTG"
  );
});
