/**
 * Operator-facing portal invite helpers for Admin C.O.C.
 * Token generation stays on the API (POST /admin/v1/clients/:id/portal-invite).
 */

export const PORTAL_INVITE_REISSUE_CONFIRM =
  "Generating a new invite invalidates the previous invite.";

export const PORTAL_INVITE_RESET_SESSION_COPY =
  "After the customer sets a new password, existing portal sessions for this account will be signed out.";

export const PORTAL_DISABLED_INVITE_COPY = "Portal must be enabled first.";

export const PORTAL_MISSING_EMAIL_INVITE_COPY = "Portal login email must be set first.";

export const PORTAL_INVITE_GENERIC_ERROR =
  "Could not generate a portal invite. Check that the portal is enabled and a login email is set, then try again.";

export const PORTAL_INVITE_ONBOARD_COPY =
  "Onboard this customer with a one-time invite so they can set their own portal password. Unconverted accounts can still sign in until they complete an invite.";

export const PORTAL_PASSWORD_STATUS_NOT_SET = "Not set";
export const PORTAL_PASSWORD_STATUS_SET = "Set";
export const PORTAL_PASSWORD_SET_HEADING = "Portal password set";

const PORTAL_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SECRET_LEAK_RE = /passwordhash|invitetokenhash|scrypt\$|client_portal_login_password/i;

export type PortalInviteEligibility =
  | { canIssue: true }
  | { canIssue: false; reason: "portal_disabled" | "missing_email" };

export type IssuePortalInviteSuccess = {
  ok: true;
  inviteUrl: string;
  expiresAt: string;
};

export type IssuePortalInviteFailure = {
  ok: false;
  error: string;
};

export type IssuePortalInviteResult = IssuePortalInviteSuccess | IssuePortalInviteFailure;

export function isValidPortalLoginEmail(value: string | null | undefined): boolean {
  if (!value) return false;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 320 && PORTAL_EMAIL_RE.test(trimmed);
}

export function portalInviteEligibility(input: {
  portalEnabled: boolean;
  portalLoginEmail: string | null | undefined;
}): PortalInviteEligibility {
  if (!input.portalEnabled) {
    return { canIssue: false, reason: "portal_disabled" };
  }
  if (!isValidPortalLoginEmail(input.portalLoginEmail)) {
    return { canIssue: false, reason: "missing_email" };
  }
  return { canIssue: true };
}

export function portalInviteBlockedCopy(
  eligibility: PortalInviteEligibility
): string | null {
  if (eligibility.canIssue) return null;
  if (eligibility.reason === "portal_disabled") return PORTAL_DISABLED_INVITE_COPY;
  return PORTAL_MISSING_EMAIL_INVITE_COPY;
}

export function portalPasswordStatusLabel(hasPortalPassword: boolean | undefined): string {
  return hasPortalPassword ? PORTAL_PASSWORD_STATUS_SET : PORTAL_PASSWORD_STATUS_NOT_SET;
}

export function shouldConfirmInviteReissue(input: {
  hasOutstandingPortalInvite?: boolean;
  issuedThisSession: boolean;
}): boolean {
  return Boolean(input.hasOutstandingPortalInvite) || input.issuedThisSession;
}

export function formatPortalInviteExpiresAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function looksLikeSecret(value: string): boolean {
  return SECRET_LEAK_RE.test(value);
}

export function isUsablePortalInviteUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed || trimmed.length > 2048) return false;
  if (looksLikeSecret(trimmed)) return false;
  if (trimmed.startsWith("/portal/invite/")) {
    return trimmed.length > "/portal/invite/".length;
  }
  try {
    const parsed = new URL(trimmed);
    return (
      (parsed.protocol === "https:" || parsed.protocol === "http:") &&
      parsed.pathname.startsWith("/portal/invite/") &&
      parsed.pathname.length > "/portal/invite/".length
    );
  } catch {
    return false;
  }
}

export function parsePortalInviteIssueSuccess(body: unknown): IssuePortalInviteResult {
  if (!body || typeof body !== "object") {
    return { ok: false, error: PORTAL_INVITE_GENERIC_ERROR };
  }
  const row = body as Record<string, unknown>;
  const inviteUrl = typeof row.inviteUrl === "string" ? row.inviteUrl.trim() : "";
  const expiresAt = typeof row.expiresAt === "string" ? row.expiresAt.trim() : "";
  if (!isUsablePortalInviteUrl(inviteUrl) || !expiresAt) {
    return { ok: false, error: PORTAL_INVITE_GENERIC_ERROR };
  }
  return { ok: true, inviteUrl, expiresAt };
}

export function operatorPortalInviteError(input: {
  status: number;
  body: string;
  code?: unknown;
  error?: unknown;
}): string {
  const code = typeof input.code === "string" ? input.code : undefined;
  if (code === "PORTAL_DISABLED") return PORTAL_DISABLED_INVITE_COPY;
  if (code === "MISSING_PORTAL_LOGIN_EMAIL") return PORTAL_MISSING_EMAIL_INVITE_COPY;
  if (code === "NOT_FOUND") return "Client account was not found.";

  const apiError = typeof input.error === "string" ? input.error.trim() : "";
  if (apiError && !looksLikeSecret(apiError) && apiError.length <= 280) {
    return apiError;
  }

  if (input.status === 409) return PORTAL_DISABLED_INVITE_COPY;
  if (input.status === 400) return PORTAL_MISSING_EMAIL_INVITE_COPY;
  if (input.status === 404) return "Client account was not found.";
  return PORTAL_INVITE_GENERIC_ERROR;
}

export function operatorPortalInviteErrorFromBody(status: number, body: string): string {
  const trimmed = body.trim();
  if (!trimmed) return operatorPortalInviteError({ status, body });
  try {
    const parsed = JSON.parse(trimmed) as { error?: unknown; code?: unknown };
    return operatorPortalInviteError({
      status,
      body,
      code: parsed.code,
      error: parsed.error,
    });
  } catch {
    return operatorPortalInviteError({ status, body });
  }
}
