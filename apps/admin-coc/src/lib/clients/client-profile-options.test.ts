import assert from "node:assert/strict";
import test from "node:test";

import {
  CLIENT_NICHE_OPTIONS,
  CLIENT_PRODUCT_OPTIONS,
  profileChoicesIncludingSavedValues,
} from "./client-profile-options.ts";

test("existing-client product choices keep saved legacy values and the current catalog", () => {
  const choices = profileChoicesIncludingSavedValues(CLIENT_PRODUCT_OPTIONS, [
    "final_expense",
    " life_insurance ",
    "aged",
    "final_expense",
    "",
  ]);
  assert.deepEqual(
    choices.map((option) => option.value),
    ["life_insurance", "health_insurance", "other", "final_expense", "aged"]
  );
  assert.deepEqual(
    choices.filter((option) => option.value === "life_insurance").map((option) => option.label),
    ["Life Insurance"]
  );
  assert.equal(choices.find((option) => option.value === "final_expense")?.label, "final_expense");
});

test("new-client catalog does not list retired product or niche keys", () => {
  assert.deepEqual(
    CLIENT_PRODUCT_OPTIONS.map((option) => option.value),
    ["life_insurance", "health_insurance", "other"]
  );
  assert.equal(
    CLIENT_NICHE_OPTIONS.find((option) => option.label === "MORTGAGE")?.value,
    "MTG"
  );
  assert.equal(
    CLIENT_PRODUCT_OPTIONS.some((option) =>
      ["final_expense", "term_life", "aged", "exclusive", "shared"].includes(option.value)
    ),
    false
  );
});
