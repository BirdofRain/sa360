import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPortalPasswordResetEmail,
  PORTAL_PASSWORD_RESET_EMAIL_SUBJECT,
  PORTAL_PASSWORD_RESET_EXPIRES_MINUTES,
} from "./portal-password-reset-email.js";

test("reset email contains one link, expiry, and ignore copy without secrets", () => {
  const resetUrl = "https://portal.example.test/portal/invite/raw-token-value-here";
  const email = buildPortalPasswordResetEmail({ resetUrl });
  assert.equal(email.subject, PORTAL_PASSWORD_RESET_EMAIL_SUBJECT);
  assert.equal(PORTAL_PASSWORD_RESET_EXPIRES_MINUTES, 60);
  assert.equal(email.text.includes(resetUrl), true);
  assert.equal(email.text.includes("60 minutes"), true);
  assert.equal(email.text.toLowerCase().includes("if you did not request this"), true);
  assert.equal(email.html.includes(resetUrl), true);
  assert.equal(email.text.includes("passwordhash"), false);
  assert.equal(email.text.includes("API"), false);
  assert.equal(email.subject.toLowerCase().includes("tenant"), false);
  const urlMatches = email.text.match(/https:\/\/[^\s]+/g) ?? [];
  assert.equal(urlMatches.length, 1);
  assert.equal(urlMatches[0], resetUrl);
});
