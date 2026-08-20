import assert from "node:assert/strict";
import { test } from "node:test";

import { CANONICAL_US_STATE_CODES, extractUsZipCode } from "@sa360/shared";

import {
  extractUsStateCode,
  isCanonicalUsStateCode,
  normalizeInventoryState,
  partitionCanonicalStateCounts,
} from "./lead-inventory-state.js";

test("extractUsStateCode resolves city+code and repeated codes", () => {
  assert.equal(extractUsStateCode("Charleston sc"), "SC");
  assert.equal(extractUsStateCode("Durham nc"), "NC");
  assert.equal(extractUsStateCode("Dover Pa"), "PA");
  assert.equal(extractUsStateCode("CT CT CT"), "CT");
});

test("extractUsStateCode keeps existing supported forms", () => {
  assert.equal(extractUsStateCode("NC"), "NC");
  assert.equal(extractUsStateCode("North Carolina"), "NC");
  assert.equal(extractUsStateCode("NC 27513"), "NC");
  assert.equal(extractUsStateCode("N.C."), "NC");
  assert.equal(extractUsStateCode("N C"), "NC");
  assert.equal(extractUsStateCode("S.C."), "SC");
  assert.equal(extractUsStateCode("TX"), "TX");
  assert.equal(extractUsStateCode("Tn."), "TN");
  assert.equal(extractUsStateCode("Ma."), "MA");
  assert.equal(extractUsStateCode("Oregon."), "OR");
  assert.equal(extractUsStateCode("N.H."), "NH");
  assert.equal(extractUsStateCode("Philadelphia Pennsylvania"), "PA");
});

test("historical Master ZIP and DC forms are preserved", () => {
  assert.equal(extractUsStateCode("NC27513"), "NC");
  assert.equal(extractUsZipCode("NC27513"), "27513");
  assert.equal(extractUsStateCode("North Carolina27513"), "NC");
  assert.equal(extractUsStateCode("Washington DC"), "DC");
  assert.equal(extractUsStateCode("Washington D.C."), "DC");
  assert.equal(extractUsZipCode("TX 75001"), "75001");
});

test("every official state name and code still resolves", () => {
  const names: Record<string, string> = {
    Alabama: "AL",
    Alaska: "AK",
    Arizona: "AZ",
    Arkansas: "AR",
    California: "CA",
    Colorado: "CO",
    Connecticut: "CT",
    Delaware: "DE",
    Florida: "FL",
    Georgia: "GA",
    Hawaii: "HI",
    Idaho: "ID",
    Illinois: "IL",
    Indiana: "IN",
    Iowa: "IA",
    Kansas: "KS",
    Kentucky: "KY",
    Louisiana: "LA",
    Maine: "ME",
    Maryland: "MD",
    Massachusetts: "MA",
    Michigan: "MI",
    Minnesota: "MN",
    Mississippi: "MS",
    Missouri: "MO",
    Montana: "MT",
    Nebraska: "NE",
    Nevada: "NV",
    "New Hampshire": "NH",
    "New Jersey": "NJ",
    "New Mexico": "NM",
    "New York": "NY",
    "North Carolina": "NC",
    "North Dakota": "ND",
    Ohio: "OH",
    Oklahoma: "OK",
    Oregon: "OR",
    Pennsylvania: "PA",
    "Rhode Island": "RI",
    "South Carolina": "SC",
    "South Dakota": "SD",
    Tennessee: "TN",
    Texas: "TX",
    Utah: "UT",
    Vermont: "VT",
    Virginia: "VA",
    Washington: "WA",
    "West Virginia": "WV",
    Wisconsin: "WI",
    Wyoming: "WY",
    "District of Columbia": "DC",
  };
  for (const code of CANONICAL_US_STATE_CODES) {
    assert.equal(extractUsStateCode(code), code, code);
  }
  for (const [name, code] of Object.entries(names)) {
    assert.equal(extractUsStateCode(name), code, name);
  }
});

test("extractUsStateCode does not guess unresolved dirty values", () => {
  assert.equal(extractUsStateCode("South Columbia"), null);
  assert.equal(extractUsStateCode("WXzhi gwashingto"), null);
  assert.equal(extractUsStateCode("Oklahola"), null);
  assert.equal(extractUsStateCode("Mass"), null);
  assert.equal(extractUsStateCode("Ark"), null);
});

test("normalizeInventoryState never returns a noncanonical label", () => {
  assert.equal(normalizeInventoryState("nc"), "NC");
  assert.equal(normalizeInventoryState("Charleston sc"), "SC");
  assert.equal(normalizeInventoryState("South Columbia"), null);
  assert.equal(normalizeInventoryState("ZZ"), null);
});

test("partitionCanonicalStateCounts hides dirty keys from selectable options", () => {
  const partitioned = partitionCanonicalStateCounts([
    { state: "NC", count: 10 },
    { state: "South Columbia", count: 2 },
    { state: "CT CT CT", count: 1 },
    { state: "TX", count: 4 },
  ]);
  assert.deepEqual(
    partitioned.canonical.map((row) => row.state),
    ["NC", "TX"]
  );
  assert.equal(partitioned.invalidCount, 3);
  assert.equal(partitioned.invalidByValue["South Columbia"], 2);
  assert.equal(isCanonicalUsStateCode("South Columbia"), false);
});

test("partitionCanonicalStateCounts returns every canonical code in allowlist order", () => {
  const reversed = [...CANONICAL_US_STATE_CODES].reverse().map((state, index) => ({
    state,
    count: index + 1,
  }));
  const partitioned = partitionCanonicalStateCounts([
    ...reversed,
    { state: "South Columbia", count: 4 },
  ]);
  assert.equal(CANONICAL_US_STATE_CODES.length, 51);
  assert.deepEqual(
    partitioned.canonical.map((row) => row.state),
    [...CANONICAL_US_STATE_CODES]
  );
  assert.equal(partitioned.canonical.length, 51);
  assert.equal(partitioned.invalidCount, 4);
});

test("facet/read-model selectable states drop noncanonical keys into invalid review", () => {
  const facetRows = [
    { state: "NC", count: 3 },
    { state: "South Columbia", count: 2 },
  ];
  const partitioned = partitionCanonicalStateCounts(facetRows);
  assert.equal(partitioned.canonical.some((row) => row.state === "South Columbia"), false);
  assert.equal(partitioned.canonical[0]?.state, "NC");
  assert.equal(partitioned.invalidCount, 2);
  assert.equal(partitioned.invalidByValue["South Columbia"], 2);
});
