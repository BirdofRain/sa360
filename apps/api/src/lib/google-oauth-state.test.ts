import assert from "node:assert/strict";
import test from "node:test";

import {
  generateGoogleOAuthState,
  generatePkceVerifier,
  hashGoogleOAuthState,
  isValidPkceVerifier,
} from "./google-oauth-state.js";

test("generatePkceVerifier is RFC 7636 length and charset (S256-ready)", () => {
  const verifier = generatePkceVerifier();
  assert.equal(verifier.length, 43);
  assert.equal(isValidPkceVerifier(verifier), true);
  assert.match(verifier, /^[A-Za-z0-9\-._~]+$/);
  assert.notEqual(generatePkceVerifier(), verifier);
});

test("isValidPkceVerifier rejects short, long, and illegal characters", () => {
  assert.equal(isValidPkceVerifier("a".repeat(42)), false);
  assert.equal(isValidPkceVerifier("a".repeat(129)), false);
  assert.equal(isValidPkceVerifier(`${"a".repeat(42)}+`), false);
  assert.equal(isValidPkceVerifier(`${"a".repeat(42)}/`), false);
  assert.equal(isValidPkceVerifier("a".repeat(43)), true);
});

test("raw OAuth state is hashed; hash is hex SHA-256", () => {
  const { rawState, stateHash } = generateGoogleOAuthState();
  assert.equal(stateHash, hashGoogleOAuthState(rawState));
  assert.match(stateHash, /^[0-9a-f]{64}$/);
  assert.notEqual(stateHash, rawState);
});
