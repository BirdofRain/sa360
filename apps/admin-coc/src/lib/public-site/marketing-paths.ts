/** Public Aged Vet Leads marketing + first-run setup routes. */

export const PUBLIC_MARKETING_LANDING_PATH = "/get-started";
export const PUBLIC_REGISTER_PATH = "/get-started/register";
export const PUBLIC_SETUP_PATH = "/get-started/setup";

function normalizePublicPath(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.replace(/\/+$/, "") || "/";
  }
  return pathname;
}

export function isPublicMarketingPath(pathname: string): boolean {
  const normalized = normalizePublicPath(pathname);
  return (
    normalized === PUBLIC_MARKETING_LANDING_PATH ||
    normalized.startsWith(`${PUBLIC_MARKETING_LANDING_PATH}/`)
  );
}

/** First-run onboarding after public register. Requires a portal session. */
export function isPublicOnboardingPath(pathname: string): boolean {
  return normalizePublicPath(pathname) === PUBLIC_SETUP_PATH;
}

export function isPublicUnauthenticatedMarketingPath(pathname: string): boolean {
  return isPublicMarketingPath(pathname) && !isPublicOnboardingPath(pathname);
}
