import assert from "node:assert/strict";
import test from "node:test";

import { resolveLeadCaptureNiche } from "./leadcapture-niche-resolver.js";

test("legacy and NextGen VET stay VET with Veteran / Final Expense defaults", () => {
  const legacy = resolveLeadCaptureNiche({ niche_key: "VET" });
  assert.equal(legacy.resolved, true);
  assert.equal(legacy.nicheKey, "VET");
  assert.equal(legacy.leadType, "VET");
  assert.equal(legacy.nicheLabel, "Veteran");
  assert.equal(legacy.productType, "Final Expense");

  const nextgen = resolveLeadCaptureNiche({ niche_key: "vet", niche: "NURSE" });
  assert.equal(nextgen.nicheKey, "VET");
  assert.equal(nextgen.leadType, "VET");
});

test("NextGen recognized niches keep business keys and do not stamp Veteran or Final Expense", () => {
  for (const key of ["NURSE", "MORTGAGE", "TRUCKER", "HEALTH"] as const) {
    const resolved = resolveLeadCaptureNiche({ niche_key: ` ${key.toLowerCase()} ` });
    assert.equal(resolved.resolved, true, key);
    assert.equal(resolved.nicheKey, key);
    assert.equal(resolved.leadType, key);
    assert.notEqual(resolved.nicheLabel, "Veteran");
    assert.notEqual(resolved.productType, "Final Expense");
    assert.equal(resolved.productType, undefined);
  }
});

test("niche field is used when niche_key is absent", () => {
  const resolved = resolveLeadCaptureNiche({ niche: "MORTGAGE" });
  assert.equal(resolved.nicheKey, "MORTGAGE");
  assert.equal(resolved.leadType, "MORTGAGE");
});

test("explicit product_type is preserved for non-VET niches", () => {
  const resolved = resolveLeadCaptureNiche({
    niche_key: "NURSE",
    product_type: "Term Life",
  });
  assert.equal(resolved.productType, "Term Life");
  assert.notEqual(resolved.nicheLabel, "Veteran");
});

test("missing niche does not become VET", () => {
  const resolved = resolveLeadCaptureNiche({ first_name: "Pat" });
  assert.equal(resolved.resolved, false);
  assert.equal(resolved.nicheKey, undefined);
  assert.equal(resolved.leadType, undefined);
  assert.notEqual(resolved.nicheKey, "VET");
  assert.notEqual(resolved.leadType, "VET");
});

test("unknown niche does not become VET", () => {
  const resolved = resolveLeadCaptureNiche({ niche_key: "WIDGET" });
  assert.equal(resolved.resolved, false);
  assert.equal(resolved.nicheKey, undefined);
  assert.notEqual(resolved.nicheKey, "VET");
  assert.notEqual(resolved.leadType, "VET");
});
