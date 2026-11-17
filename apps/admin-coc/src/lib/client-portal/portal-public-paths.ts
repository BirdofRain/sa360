/** Portal routes that must be reachable without a signed session. */

/** Private confirmation pages. Matches the API opt-in response headers. */
export function smsOptInPrivacyHeaders(): Record<string, string> {
  return {
    "Cache-Control": "private, no-store",
    "Referrer-Policy": "no-referrer",
    "X-Robots-Tag": "noindex, nofollow",
  };
}

export function isSmsOptInPrivacyPath(pathname: string): boolean {
  return pathname === "/portal/sms-opt-in" || pathname.startsWith("/portal/sms-opt-in/");
}

export function isUnauthenticatedPortalPath(pathname: string): boolean {
  return (
    pathname === "/portal/login" ||
    pathname.startsWith("/portal/login/") ||
    pathname === "/portal/forgot-password" ||
    pathname.startsWith("/portal/forgot-password/") ||
    pathname === "/portal/invite" ||
    pathname.startsWith("/portal/invite/") ||
    pathname === "/portal/sms-opt-in" ||
    pathname.startsWith("/portal/sms-opt-in/")
  );
}
