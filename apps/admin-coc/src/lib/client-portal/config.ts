/**
 * Client portal display config — env-driven only (no hardcoded tenant ids).
 */

export function getClientPortalDisplayName(): string {
  const fromEnv = process.env.NEXT_PUBLIC_CLIENT_PORTAL_DISPLAY_NAME?.trim();
  if (fromEnv) return fromEnv;
  return "Your business";
}

export function getClientPortalLocationLabel(): string | null {
  const label = process.env.NEXT_PUBLIC_CLIENT_PORTAL_LOCATION_LABEL?.trim();
  return label || null;
}
