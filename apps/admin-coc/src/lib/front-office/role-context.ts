import { cookies } from "next/headers";

import {
  ADMIN_COC_SESSION_COOKIE,
  ADMIN_COC_SESSION_VALUE,
} from "@/lib/admin-coc-auth";
import { readPortalSessionCookie } from "@/lib/client-portal/portal-session";
import { CLIENT_PORTAL_SESSION_COOKIE } from "@/lib/client-portal/portal-session-cookie";

import { isFrontOfficeDevPreviewEnabled } from "./auth-edge";
import type { FrontOfficeRole, FrontOfficeSession } from "./types";

const DEV_ROLES: FrontOfficeRole[] = ["admin", "client", "agent"];

export function parseDevRole(roleParam: string | null | undefined): FrontOfficeRole | null {
  if (!roleParam) return null;
  return DEV_ROLES.includes(roleParam as FrontOfficeRole)
    ? (roleParam as FrontOfficeRole)
    : null;
}

export async function resolveFrontOfficeSession(
  devRoleParam?: string | null
): Promise<FrontOfficeSession | null> {
  const cookieStore = await cookies();

  const adminCookie = cookieStore.get(ADMIN_COC_SESSION_COOKIE);
  if (adminCookie?.value === ADMIN_COC_SESSION_VALUE) {
    return {
      role: "admin",
      displayName: "Operator",
      isDevPreview: false,
    };
  }

  const portalToken = cookieStore.get(CLIENT_PORTAL_SESSION_COOKIE)?.value;
  const portalPayload = readPortalSessionCookie(portalToken);
  if (portalPayload) {
    return {
      role: "client",
      displayName:
        portalPayload.portalDisplayName ?? portalPayload.clientDisplayName,
      clientAccountId: portalPayload.clientAccountId,
      isDevPreview: false,
    };
  }

  if (isFrontOfficeDevPreviewEnabled()) {
    const devRole = parseDevRole(devRoleParam);
    if (devRole) {
      return {
        role: devRole,
        displayName:
          devRole === "admin"
            ? "Dev Operator"
            : devRole === "client"
              ? "Dev Client"
              : "Dev Agent",
        clientAccountId: devRole === "client" ? "dev-client-001" : undefined,
        isDevPreview: true,
      };
    }
  }

  return null;
}
