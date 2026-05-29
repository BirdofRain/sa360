import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  duplicateRiskBadgeClass,
  duplicateRiskLevelLabel,
  identityStatusLabel,
} from "./duplicate-risk-display.ts";

describe("duplicate-risk display helpers", () => {
  it("labels risk levels", () => {
    assert.equal(duplicateRiskLevelLabel("likely_duplicate"), "Likely duplicate");
    assert.equal(identityStatusLabel("orphan_appointment"), "Orphan appointment");
  });

  it("maps badge classes for high-risk levels", () => {
    assert.match(duplicateRiskBadgeClass("likely_duplicate"), /destructive/);
    assert.match(duplicateRiskBadgeClass("possible_duplicate"), /amber/);
  });
});
