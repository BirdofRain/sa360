import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTVerifyGetKey } from "jose";

import { GOOGLE_ISSUER } from "@sa360/shared/staff-google-oidc";
import { verifyStaffGoogleIdToken } from "./staff-google-oidc.js";

const CLIENT_ID = "staff-test-client.apps.googleusercontent.com";
const OTHER_ID = "other-test-client.apps.googleusercontent.com";
const SUB = "102938475610293847561";
const NONCE = "n".repeat(43);
const NOW = 1_800_000_000;

let getKey: JWTVerifyGetKey;
let privateKey: CryptoKey;

test.before(async () => {
  const keys = await generateKeyPair("RS256", { extractable: true });
  privateKey = keys.privateKey;
  const jwk = await exportJWK(keys.publicKey);
  jwk.kid = "test";
  jwk.alg = "RS256";
  jwk.use = "sig";
  getKey = createLocalJWKSet({ keys: [jwk] });
});

async function token(claims: Record<string, unknown>, options: { audience?: string; issuer?: string; exp?: number } = {}) {
  const exp = options.exp ?? NOW + 600;
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: "test" })
    .setIssuer(options.issuer ?? GOOGLE_ISSUER)
    .setAudience(options.audience ?? CLIENT_ID)
    .setSubject(typeof claims.sub === "string" ? claims.sub : SUB)
    .setIssuedAt(exp - 60)
    .setExpirationTime(exp)
    .sign(privateKey);
}

function verify(idToken: string, nonce = NONCE, nowSec = NOW) {
  return verifyStaffGoogleIdToken({ idToken, audience: CLIENT_ID, nonce, nowSec, getKey });
}

test("a verified google id token resolves the subject and email", async () => {
  const idToken = await token({ sub: SUB, email: "person@example.com", email_verified: true, nonce: NONCE, azp: CLIENT_ID });
  const result = await verify(idToken);
  assert.deepEqual(result, {
    ok: true,
    identity: { sub: SUB, email: "person@example.com", emailVerified: true, nonce: NONCE },
  });
});

function failureCode(result: { ok: boolean; code?: string }): string {
  assert.equal(result.ok, false);
  return result.code ?? "";
}

test("id token failures stay specific", async () => {
  const valid = { sub: SUB, email: "person@example.com", email_verified: true, nonce: NONCE, azp: CLIENT_ID };
  assert.equal(failureCode(await verify(await token({ ...valid, email_verified: "true" }))), "unverified_email");
  assert.equal(failureCode(await verify(await token({ sub: SUB, email_verified: true, nonce: NONCE }))), "missing_email");
  assert.equal(failureCode(await verify(await token(valid), "different-nonce-value-not-equal-to-token")), "incorrect_nonce");
  assert.equal(failureCode(await verify(await token(valid, { issuer: "https://evil.example" }))), "wrong_issuer");
  assert.equal(failureCode(await verify(await token(valid, { audience: OTHER_ID }))), "wrong_audience");
  assert.equal(failureCode(await verify(await token({ ...valid, azp: OTHER_ID }))), "wrong_audience");
  assert.equal(failureCode(await verify(await token(valid, { exp: NOW - 120 }))), "expired");
  assert.equal(failureCode(await verify(`${await token(valid)}x`)), "invalid_token");
  assert.equal(failureCode(await verify(await token({ ...valid, sub: "short" }))), "invalid_token");
});

test("hosted domain and name are returned and a missing hosted domain still verifies", async () => {
  const withDomain = await token({
    sub: SUB,
    email: "person@lifeagentlaunch.com",
    email_verified: true,
    nonce: NONCE,
    azp: CLIENT_ID,
    hd: "lifeagentlaunch.com",
    name: "Pat Manager",
  });
  const verified = await verify(withDomain);
  assert.equal(verified.ok, true);
  if (!verified.ok) return;
  assert.equal(verified.identity.hd, "lifeagentlaunch.com");
  assert.equal(verified.identity.name, "Pat Manager");

  const withoutDomain = await token({
    sub: SUB,
    email: "person@example.com",
    email_verified: true,
    nonce: NONCE,
    azp: CLIENT_ID,
  });
  const existing = await verify(withoutDomain);
  assert.equal(existing.ok, true);
  if (!existing.ok) return;
  assert.equal(existing.identity.hd, undefined);
});

test("staff id token verification does not use the drive oauth client", () => {
  const source = readFileSync(new URL("./staff-google-oidc.ts", import.meta.url), "utf8");
  assert.equal(source.includes("google-oauth-env"), false);
  assert.equal(source.includes("GOOGLE_OAUTH_CLIENT_ID"), false);
  assert.equal(source.includes("refresh_token"), false);
});
