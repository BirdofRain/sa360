import type { NextRequest } from "next/server";

import {
  ADMIN_COC_SESSION_COOKIE,
  ADMIN_COC_SESSION_VALUE,
} from "@/lib/admin-coc-auth";
import { CLIENT_PORTAL_SESSION_COOKIE } from "@/lib/client-portal/portal-session-cookie";
import { verifyPortalSessionTokenEdge } from "@/lib/client-portal/portal-session-edge";

import type { FrontOfficeRole } from "./types";

const DEV_ROLES: FrontOfficeRole[] = ["admin", "client", "agent"];

export function isFrontOfficeDevPreviewEnabled(): boolean {
  return (
    process.env.NODE_ENV === "development" ||
    process.env.FRONT_OFFICE_DEV_PREVIEW === "1"
  );
}

export function isFrontOfficeDevPreview(request: NextRequest): boolean {
  if (!isFrontOfficeDevPreviewEnabled()) return false;
  const role = request.nextUrl.searchParams.get("role");
  return DEV_ROLES.includes(role as FrontOfficeRole);
}

export async function isFrontOfficeAuthenticated(
  request: NextRequest
): Promise<boolean> {
  const adminCookie = request.cookies.get(ADMIN_COC_SESSION_COOKIE);
  if (adminCookie?.value === ADMIN_COC_SESSION_VALUE) return true;

  const portalSession = request.cookies.get(CLIENT_PORTAL_SESSION_COOKIE)?.value;
  if (await verifyPortalSessionTokenEdge(portalSession)) return true;

  if (isFrontOfficeDevPreview(request)) return true;

  return false;
}

export function isFrontOfficePath(pathname: string): boolean {
  return (
    pathname === "/front-office" ||
    pathname.startsWith("/front-office/") ||
    pathname.startsWith("/api/front-office")
  );
}
