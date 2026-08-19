import assert from "node:assert/strict";
import test from "node:test";

import { extractUsStateCode, extractUsZipCode } from "./aged-inventory-bulk-state.js";

test("known codes and full names still resolve", () => {
  assert.equal(extractUsStateCode("NC"), "NC");
  assert.equal(extractUsStateCode("North Carolina"), "NC");
  assert.equal(extractUsStateCode("SC"), "SC");
  assert.equal(extractUsStateCode("CA"), "CA");
});

test("dotted and spaced two-letter abbreviations resolve via allowlist", () => {
  assert.equal(extractUsStateCode("N.C."), "NC");
  assert.equal(extractUsStateCode("N C"), "NC");
  assert.equal(extractUsStateCode("S.C."), "SC");
  assert.equal(extractUsStateCode("S C"), "SC");
});

test("Washington DC variants resolve to DC", () => {
  assert.equal(extractUsStateCode("Washington DC"), "DC");
  assert.equal(extractUsStateCode("Washington D.C."), "DC");
  assert.equal(extractUsStateCode("Washington D. C."), "DC");
});

test("known state code concatenated with ZIP recovers state and zip", () => {
  assert.equal(extractUsStateCode("NC27513"), "NC");
  assert.equal(extractUsZipCode("NC27513"), "27513");
  assert.equal(extractUsStateCode("FL32801"), "FL");
  assert.equal(extractUsZipCode("FL32801"), "32801");
  assert.equal(extractUsStateCode("CA90210"), "CA");
  assert.equal(extractUsZipCode("CA90210"), "90210");
});

test("full state name concatenated with ZIP recovers state and zip", () => {
  assert.equal(extractUsStateCode("North Carolina27513"), "NC");
  assert.equal(extractUsZipCode("North Carolina27513"), "27513");
  assert.equal(extractUsStateCode("California90210"), "CA");
  assert.equal(extractUsZipCode("California90210"), "90210");
});

test("state plus separated ZIP continues to work", () => {
  assert.equal(extractUsStateCode("NC 27513"), "NC");
  assert.equal(extractUsZipCode("NC 27513"), "27513");
  assert.equal(extractUsStateCode("TX, 75001"), "TX");
  assert.equal(extractUsZipCode("TX, 75001"), "75001");
  assert.equal(extractUsZipCode("TX 75001-1234"), "75001-1234");
});

test("state-only continues to work and ZIP stays optional", () => {
  assert.equal(extractUsStateCode("NC"), "NC");
  assert.equal(extractUsZipCode("NC"), null);
  assert.equal(extractUsStateCode("Texas"), "TX");
  assert.equal(extractUsZipCode("Texas"), null);
});

test("unknown two-letter tokens, city-like strings, and non-US regions stay rejected", () => {
  assert.equal(extractUsStateCode("XX"), null);
  assert.equal(extractUsStateCode("ZZ"), null);
  assert.equal(extractUsStateCode("Dallas"), null);
  assert.equal(extractUsStateCode("Charlotte"), null);
  assert.equal(extractUsStateCode("Ontario"), null);
  assert.equal(extractUsStateCode("UK"), null);
  assert.equal(extractUsStateCode("ON"), null);
});

test("ZIP-only cells keep the existing optional-ZIP contract", () => {
  assert.equal(extractUsStateCode("27513"), null);
  assert.equal(extractUsZipCode("27513"), "27513");
  assert.equal(extractUsZipCode(""), null);
});

test("arbitrary five-digit runs in unrelated strings are not treated as ZIP", () => {
  assert.equal(extractUsZipCode("lead12345"), null);
  assert.equal(extractUsZipCode("xx12345"), null);
  assert.equal(extractUsStateCode("lead12345"), null);
});
