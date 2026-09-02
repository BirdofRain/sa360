import test from "node:test";
import assert from "node:assert/strict";
import {
  generatePortalInviteToken,
  hashPortalInviteToken,
  isWellFormedPortalInviteToken,
  PORTAL_INVITE_TOKEN_BYTES,
  PORTAL_INVITE_TTL_MS,
  PORTAL_PASSWORD_RESET_TTL_MS,
  portalInvitePath,
} from "./portal-invite-token.js";

test("generatePortalInviteToken returns a high-entropy raw token and SHA-256 hash", () => {
  const a = generatePortalInviteToken();
  const b = generatePortalInviteToken();
  assert.equal(isWellFormedPortalInviteToken(a.rawToken), true);
  assert.equal(a.rawToken.includes("="), false);
  assert.notEqual(a.rawToken, b.rawToken);
  assert.notEqual(a.tokenHash, a.rawToken);
  assert.match(a.tokenHash, /^[0-9a-f]{64}$/);
  assert.equal(a.tokenHash, hashPortalInviteToken(a.rawToken));
  assert.equal(Buffer.from(a.rawToken, "base64url").length, PORTAL_INVITE_TOKEN_BYTES);
});

test("hashPortalInviteToken never equals the raw token and is lookup-stable", () => {
  const { rawToken, tokenHash } = generatePortalInviteToken();
  assert.equal(hashPortalInviteToken(rawToken), tokenHash);
  assert.equal(tokenHash.includes(rawToken), false);
});

test("isWellFormedPortalInviteToken rejects empty and non-base64url values", () => {
  assert.equal(isWellFormedPortalInviteToken(""), false);
  assert.equal(isWellFormedPortalInviteToken("short"), false);
  assert.equal(isWellFormedPortalInviteToken("a".repeat(31)), false);
  assert.equal(isWellFormedPortalInviteToken("+++not-valid-base64url-chars+++"), false);
  const { rawToken } = generatePortalInviteToken();
  assert.equal(isWellFormedPortalInviteToken(rawToken), true);
});

test("self-service reset TTL is 60 minutes and operator invite TTL stays 48 hours", () => {
  assert.equal(PORTAL_PASSWORD_RESET_TTL_MS, 60 * 60 * 1000);
  assert.equal(PORTAL_INVITE_TTL_MS, 48 * 60 * 60 * 1000);
});

test("portalInvitePath does not invent a hostname", () => {
  const { rawToken } = generatePortalInviteToken();
  const path = portalInvitePath(rawToken);
  assert.equal(path.startsWith("/portal/invite/"), true);
  assert.equal(path.includes("http"), false);
  assert.equal(path.endsWith(rawToken), true);
});
