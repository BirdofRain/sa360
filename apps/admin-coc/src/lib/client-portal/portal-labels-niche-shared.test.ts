import test from "node:test";
import assert from "node:assert/strict";

import { lookupNicheDisplayName, NICHE_DISPLAY_NAMES } from "@sa360/shared";

import { formatPortalDisplayLabel } from "./portal-labels.ts";

test("portal niche labels come from the shared display-name map", () => {
  assert.equal(formatPortalDisplayLabel("vet"), NICHE_DISPLAY_NAMES.vet);
  assert.equal(formatPortalDisplayLabel("vet"), lookupNicheDisplayName("vet"));
  assert.equal(formatPortalDisplayLabel("VET"), "Veteran");
  assert.equal(formatPortalDisplayLabel("trucker"), "Trucker");
  assert.equal(formatPortalDisplayLabel("trucker"), NICHE_DISPLAY_NAMES.trucker);
});
