import assert from "node:assert/strict";
import test from "node:test";

import { parseLeadCaptureFunnelTitle } from "./leadcapture-funnel-title-parser.js";

test("parses canonical Life Insurance For <NICHE> - <CLIENT> - V<N>", () => {
  const parsed = parseLeadCaptureFunnelTitle(
    "Life Insurance For Veterans - Madison Pimentel - V2"
  );
  assert.equal(parsed.nicheKey, "VET");
  assert.equal(parsed.inventoryNicheKey, "vet_fex");
  assert.equal(parsed.clientNameHint, "Madison Pimentel");
  assert.equal(parsed.version, 2);
});

test("parses title without version suffix", () => {
  const parsed = parseLeadCaptureFunnelTitle(
    "Life Insurance For Veterans - Madison Pimentel"
  );
  assert.equal(parsed.nicheKey, "VET");
  assert.equal(parsed.clientNameHint, "Madison Pimentel");
  assert.equal(parsed.version, undefined);
});

test("normalizes hyphen variants, spacing, and trailing version on the client segment", () => {
  const parsed = parseLeadCaptureFunnelTitle(
    "  Life  Insurance For Nurses— Alex Feuerstein  V3 "
  );
  assert.equal(parsed.nicheKey, "NURSE");
  assert.equal(parsed.inventoryNicheKey, "nurse_life");
  assert.equal(parsed.clientNameHint, "Alex Feuerstein");
  assert.equal(parsed.version, 3);
});

test("recognizes remaining LeadCapture niches and does not default unknown text to Veteran", () => {
  assert.equal(parseLeadCaptureFunnelTitle("Life Insurance For Nurses - Andru Duranso").nicheKey, "NURSE");
  assert.equal(
    parseLeadCaptureFunnelTitle("Mortgage Protection - Example Agency - V1").nicheKey,
    "MORTGAGE"
  );
  assert.equal(parseLeadCaptureFunnelTitle("Truckers - Fleet Client").nicheKey, "TRUCKER");
  assert.equal(parseLeadCaptureFunnelTitle("Self Employed Health - Health Client").nicheKey, "HEALTH");
  const unknown = parseLeadCaptureFunnelTitle("Matt Test Campaign 123");
  assert.equal(unknown.nicheKey, undefined);
  assert.equal(unknown.inventoryNicheKey, undefined);
  assert.equal(unknown.clientNameHint, undefined);
  const unknownStructured = parseLeadCaptureFunnelTitle("Life Insurance For Widgets - Mystery Client");
  assert.notEqual(unknownStructured.nicheKey, "VET");
  assert.equal(unknownStructured.nicheKey, undefined);
  assert.equal(unknownStructured.clientNameHint, "Mystery Client");
});
