import {
  PORTAL_PASSWORD_POLICY_COPY,
  evaluatePortalPasswordPolicy,
} from "@sa360/shared";

export const PORTAL_INVITE_TITLE = "Set your portal password";
export const PORTAL_INVITE_INVALID =
  "This invite link is invalid or has expired. Request a new invite from your SA360 team.";
export const PORTAL_INVITE_POLICY_COPY = PORTAL_PASSWORD_POLICY_COPY;
export const PORTAL_INVITE_SUCCESS_LOGIN_PATH = "/portal/login?passwordSet=1";

const TOKEN_RE = /^[A-Za-z0-9_-]{32,64}$/;

export function isWellFormedPortalInviteToken(token: string): boolean {
  return TOKEN_RE.test(token);
}

export function evaluateInvitePassword(password: string): { ok: true } | { ok: false; error: string } {
  return evaluatePortalPasswordPolicy(password);
}

export function portalInvitePageState(token: string | undefined): "form" | "invalid" {
  if (!token || !isWellFormedPortalInviteToken(token)) return "invalid";
  return "form";
}
