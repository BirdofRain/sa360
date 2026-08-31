/** Portal routes that must be reachable without a signed session. */

export function isUnauthenticatedPortalPath(pathname: string): boolean {
  return (
    pathname === "/portal/login" ||
    pathname.startsWith("/portal/login/") ||
    pathname === "/portal/invite" ||
    pathname.startsWith("/portal/invite/")
  );
}
