import assert from "node:assert/strict";
import test from "node:test";

import {
  aggregateCommerceNicheDistribution,
  canonicalizeCommerceNicheKey,
  commerceNicheAliases,
  commerceNicheDisplayName,
  commerceNichesEquivalent,
  isCanonicalCommerceNicheKey,
  isSupportedAgedCommerceNiche,
  preferCanonicalCommerceNicheKey,
} from "./commerce-niches.ts";

test("canonical commerce aliases collapse to vet, nurse, and trucker", () => {
  for (const value of ["vet", "veteran", "vet_fex", "VET", "Veteran", "n_vet", "N Veteran", "vet-fex", " vet fex "]) {
    assert.equal(canonicalizeCommerceNicheKey(value), "vet", value);
    assert.equal(commerceNicheDisplayName(value), "Veteran", value);
    assert.equal(isSupportedAgedCommerceNiche(value), true, value);
  }
  for (const value of ["nurse", "nurse_life", "NURSE", "Nurse", "n_nurse", "nurse-life"]) {
    assert.equal(canonicalizeCommerceNicheKey(value), "nurse", value);
    assert.equal(commerceNicheDisplayName(value), "Nurse", value);
  }
  for (const value of ["trucker", "trucker_life", "TRUCKER", "Trucker", "trucker-life"]) {
    assert.equal(canonicalizeCommerceNicheKey(value), "trucker", value);
    assert.equal(commerceNicheDisplayName(value), "Trucker", value);
  }
});

test("only the three canonical keys are canonical, aliases are supported but not canonical", () => {
  assert.equal(isCanonicalCommerceNicheKey("vet"), true);
  assert.equal(isCanonicalCommerceNicheKey("NURSE"), true);
  assert.equal(isCanonicalCommerceNicheKey("trucker"), true);
  assert.equal(isCanonicalCommerceNicheKey("vet_fex"), false);
  assert.equal(isCanonicalCommerceNicheKey("nurse_life"), false);
  assert.deepEqual(commerceNicheAliases("vet"), ["vet", "veteran", "vet_fex", "n_vet", "n_veteran"]);
  assert.equal(preferCanonicalCommerceNicheKey("vet_fex"), "vet");
  assert.equal(preferCanonicalCommerceNicheKey("NURSE"), "nurse");
});

test("unknown niches stay unknown and are not sold as Veteran, Nurse, or Trucker", () => {
  for (const value of [
    "",
    "   ",
    "unspecified",
    "health",
    "health_insurance",
    "mortgage",
    "mortgage_protection",
    "final_expense",
    "n_fex",
    "n_health",
    "n_mtg",
    "solar",
    "hvac",
    "vet_concurrency_probe",
  ]) {
    assert.equal(canonicalizeCommerceNicheKey(value), null, value);
    assert.equal(commerceNicheDisplayName(value), undefined, value);
    assert.equal(isSupportedAgedCommerceNiche(value), false, value);
  }
  assert.equal(canonicalizeCommerceNicheKey(null), null);
  assert.equal(commerceNichesEquivalent("vet", "nurse_life"), false);
  assert.equal(commerceNichesEquivalent("vet", "unspecified"), false);
  assert.equal(commerceNichesEquivalent("vet", "vet_fex"), true);
  assert.equal(commerceNichesEquivalent("solar", "Solar"), true);
  assert.equal(commerceNichesEquivalent("solar", "vet"), false);
});

test("stage distribution merges alias counts and keeps unsupported rows", () => {
  const raw = [
    { nicheKey: "vet", count: 10 },
    { nicheKey: "vet_fex", count: 5 },
    { nicheKey: "VET", count: 2 },
    { nicheKey: "n_vet", count: 1 },
    { nicheKey: "nurse", count: 3 },
    { nicheKey: "nurse_life", count: 4 },
    { nicheKey: "trucker", count: 1 },
    { nicheKey: "trucker_life", count: 6 },
    { nicheKey: "unspecified", count: 7 },
    { nicheKey: "mortgage_protection", count: 8 },
  ];
  const aggregated = aggregateCommerceNicheDistribution(raw);
  const totalIn = raw.reduce((sum, row) => sum + row.count, 0);
  const totalOut = aggregated.reduce((sum, row) => sum + row.count, 0);
  assert.equal(totalOut, totalIn);
  assert.deepEqual(
    aggregated.filter((row) => !row.review).map((row) => [row.nicheKey, row.label, row.count]),
    [
      ["vet", "Veteran", 18],
      ["nurse", "Nurse", 7],
      ["trucker", "Trucker", 7],
    ]
  );
  assert.deepEqual(
    aggregated.filter((row) => row.review).map((row) => [row.nicheKey, row.count]),
    [
      ["mortgage_protection", 8],
      ["unspecified", 7],
    ]
  );
});
