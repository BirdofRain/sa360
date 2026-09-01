import assert from "node:assert/strict";
import test from "node:test";

import {
  PORTAL_DISABLED_INVITE_COPY,
  PORTAL_INVITE_GENERIC_ERROR,
  PORTAL_INVITE_REISSUE_CONFIRM,
  PORTAL_MISSING_EMAIL_INVITE_COPY,
  PORTAL_PASSWORD_STATUS_NOT_SET,
  PORTAL_PASSWORD_STATUS_SET,
  formatPortalInviteExpiresAt,
  isUsablePortalInviteUrl,
  isValidPortalLoginEmail,
  operatorPortalInviteErrorFromBody,
  parsePortalInviteIssueSuccess,
  portalInviteBlockedCopy,
  portalInviteEligibility,
  portalPasswordStatusLabel,
  shouldConfirmInviteReissue,
} from "./portal-invite-operator.ts";

test("portal disabled and missing email block issuance with operator copy", () => {
  const disabled = portalInviteEligibility({
    portalEnabled: false,
    portalLoginEmail: "alex@example.com",
  });
  assert.equal(disabled.canIssue, false);
  assert.equal(portalInviteBlockedCopy(disabled), PORTAL_DISABLED_INVITE_COPY);

  const missing = portalInviteEligibility({
    portalEnabled: true,
    portalLoginEmail: null,
  });
  assert.equal(missing.canIssue, false);
  assert.equal(portalInviteBlockedCopy(missing), PORTAL_MISSING_EMAIL_INVITE_COPY);

  const invalid = portalInviteEligibility({
    portalEnabled: true,
    portalLoginEmail: "not-an-email",
  });
  assert.equal(invalid.canIssue, false);
  assert.equal(portalInviteBlockedCopy(invalid), PORTAL_MISSING_EMAIL_INVITE_COPY);

  const ok = portalInviteEligibility({
    portalEnabled: true,
    portalLoginEmail: "alex@example.com",
  });
  assert.equal(ok.canIssue, true);
  assert.equal(portalInviteBlockedCopy(ok), null);
});

test("password status labels are Not set / Set", () => {
  assert.equal(portalPasswordStatusLabel(false), PORTAL_PASSWORD_STATUS_NOT_SET);
  assert.equal(portalPasswordStatusLabel(undefined), PORTAL_PASSWORD_STATUS_NOT_SET);
  assert.equal(portalPasswordStatusLabel(true), PORTAL_PASSWORD_STATUS_SET);
});

test("reissue confirmation is required when an invite already exists", () => {
  assert.equal(
    shouldConfirmInviteReissue({ hasOutstandingPortalInvite: false, issuedThisSession: false }),
    false
  );
  assert.equal(
    shouldConfirmInviteReissue({ hasOutstandingPortalInvite: true, issuedThisSession: false }),
    true
  );
  assert.equal(
    shouldConfirmInviteReissue({ hasOutstandingPortalInvite: false, issuedThisSession: true }),
    true
  );
  assert.equal(PORTAL_INVITE_REISSUE_CONFIRM.includes("invalidates the previous invite"), true);
});

test("success parser keeps inviteUrl/expiresAt and drops secret fields", () => {
  const parsed = parsePortalInviteIssueSuccess({
    ok: true,
    inviteUrl: "https://portal.example/portal/invite/abcTokenValue0123456789abcdef",
    expiresAt: "2026-09-03T12:00:00.000Z",
    portalPasswordHash: "scrypt$steal-me",
    portalInviteTokenHash: "deadbeefinvitehash",
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.inviteUrl, "https://portal.example/portal/invite/abcTokenValue0123456789abcdef");
  assert.equal(parsed.expiresAt, "2026-09-03T12:00:00.000Z");
  assert.equal("portalPasswordHash" in parsed, false);
  assert.equal("portalInviteTokenHash" in parsed, false);
});

test("success parser rejects unusable invite URLs and does not reconstruct hostnames", () => {
  assert.equal(isUsablePortalInviteUrl("/portal/invite/rawTokenValueHere0123456789"), true);
  assert.equal(isUsablePortalInviteUrl("/portal/login"), false);
  assert.equal(isUsablePortalInviteUrl("not-a-url"), false);
  const bad = parsePortalInviteIssueSuccess({
    ok: true,
    inviteUrl: "https://evil.example/steal",
    expiresAt: "2026-09-03T12:00:00.000Z",
  });
  assert.equal(bad.ok, false);
});

test("operator errors stay safe and never echo hashes", () => {
  assert.equal(
    operatorPortalInviteErrorFromBody(
      409,
      JSON.stringify({ ok: false, error: "Client portal is not enabled", code: "PORTAL_DISABLED" })
    ),
    PORTAL_DISABLED_INVITE_COPY
  );
  assert.equal(
    operatorPortalInviteErrorFromBody(
      400,
      JSON.stringify({
        ok: false,
        error: "Portal login email is required before issuing an invite",
        code: "MISSING_PORTAL_LOGIN_EMAIL",
      })
    ),
    PORTAL_MISSING_EMAIL_INVITE_COPY
  );
  const hashed = operatorPortalInviteErrorFromBody(
    500,
    JSON.stringify({ error: "portalPasswordHash=scrypt$steal-me", code: "BOOM" })
  );
  assert.equal(hashed, PORTAL_INVITE_GENERIC_ERROR);
  assert.equal(hashed.includes("scrypt$"), false);
  assert.equal(hashed.includes("portalPasswordHash"), false);
  const html = operatorPortalInviteErrorFromBody(502, "<html>upstream</html>");
  assert.equal(html, PORTAL_INVITE_GENERIC_ERROR);
  assert.equal(html.includes("<html>"), false);
});

test("email validation matches operator requirements", () => {
  assert.equal(isValidPortalLoginEmail("alex@example.com"), true);
  assert.equal(isValidPortalLoginEmail("  alex@example.com  "), true);
  assert.equal(isValidPortalLoginEmail(""), false);
  assert.equal(isValidPortalLoginEmail(null), false);
});

test("expiry formatting does not throw on valid ISO", () => {
  const label = formatPortalInviteExpiresAt("2026-09-03T15:30:00.000Z");
  assert.equal(label.includes("2026") || label.includes("Sep") || label.includes("9"), true);
});
