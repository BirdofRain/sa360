import { isClientPortalLoginConfigured } from "./portal-auth.ts";
import { parsePortalSessionToken } from "./portal-session.ts";

/** Whether `/portal/login` should redirect away (mock mode or already signed in). */
export function resolvePortalLoginPageRedirect(opts: {
  apiConfigured: boolean;
  sessionCookie: string | undefined;
  nextPath: string;
}): string | null {
  if (!opts.apiConfigured) return "/portal";
  if (parsePortalSessionToken(opts.sessionCookie)) {
    const next = opts.nextPath.trim();
    if (next.startsWith("/portal") && !next.startsWith("//")) return next;
    return "/portal";
  }
  if (!isClientPortalLoginConfigured()) return null;
  return null;
}

export const PORTAL_LOGIN_TITLE = "Sign in to your dashboard";
export const PORTAL_LOGIN_INTRO = "Sign in with your portal email and password.";
export const PORTAL_LOGIN_INVALID_CREDENTIALS =
  "Email or password is incorrect. Please try again.";
export const PORTAL_LOGIN_NOT_CONFIGURED =
  "Sign-in is not available right now. Please contact your SA360 team.";
export const PORTAL_LOGIN_SETUP_BANNER =
  "Sign-in is not configured yet. Contact your SA360 team for access, or use your invite link if you received one.";

/** `/portal/login` shows the form when modern login (session + API) is ready. */
export function resolvePortalLoginPageView(
  loginConfigured = isClientPortalLoginConfigured()
): "form" | "not_configured" {
  return loginConfigured ? "form" : "not_configured";
}
