import {
  PORTAL_PASSWORD_MISMATCH,
  PORTAL_PASSWORD_POLICY_COPY,
  evaluatePortalPasswordConfirmation,
  evaluatePortalPasswordPolicy,
} from "@sa360/shared";

export const PORTAL_INVITE_TITLE = "Choose a new password for your portal";
export const PORTAL_INVITE_SUBTITLE =
  "Choose a new password for your portal. After you save it, sign in with your email and this new password.";
export const PORTAL_INVITE_INVALID =
  "This link is invalid or has expired. You can request a new password reset from the sign-in page, or ask your SA360 team for a new invite.";
export const PORTAL_INVITE_POLICY_COPY = PORTAL_PASSWORD_POLICY_COPY;
export const PORTAL_INVITE_SUCCESS_LOGIN_PATH = "/portal/login?passwordSet=1";
export const PORTAL_PASSWORD_CONFIRM_MISMATCH = PORTAL_PASSWORD_MISMATCH;

const TOKEN_RE = /^[A-Za-z0-9_-]{32,64}$/;

export function isWellFormedPortalInviteToken(token: string): boolean {
  return TOKEN_RE.test(token);
}

export function evaluateInvitePassword(password: string): { ok: true } | { ok: false; error: string } {
  return evaluatePortalPasswordPolicy(password);
}

export function evaluateInvitePasswordConfirmation(
  password: string,
  confirmPassword: string
): { ok: true } | { ok: false; error: string } {
  return evaluatePortalPasswordConfirmation(password, confirmPassword);
}

export function preparePortalInviteAccept(formData: FormData):
  | { ok: false; error: string }
  | { ok: true; token: string; password: string } {
  const token = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");
  if (!isWellFormedPortalInviteToken(token)) {
    return { ok: false, error: PORTAL_INVITE_INVALID };
  }
  const confirmed = evaluateInvitePasswordConfirmation(password, confirmPassword);
  if (!confirmed.ok) {
    return { ok: false, error: confirmed.error };
  }
  return { ok: true, token, password };
}

export function portalInvitePageState(token: string | undefined): "form" | "invalid" {
  if (!token || !isWellFormedPortalInviteToken(token)) return "invalid";
  return "form";
}
