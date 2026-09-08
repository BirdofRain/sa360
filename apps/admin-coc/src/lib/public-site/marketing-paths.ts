/** Unauthenticated public marketing routes (Aged Vet Leads landing). */

export const PUBLIC_MARKETING_LANDING_PATH = "/get-started";

export function isPublicMarketingPath(pathname: string): boolean {
  return (
    pathname === PUBLIC_MARKETING_LANDING_PATH ||
    pathname.startsWith(`${PUBLIC_MARKETING_LANDING_PATH}/`)
  );
}
