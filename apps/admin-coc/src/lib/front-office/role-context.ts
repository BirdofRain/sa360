import { cookies } from "next/headers";

import { ADMIN_COC_SESSION_COOKIE } from "@/lib/admin-coc-auth";
import { verifyAdminCocSessionToken } from "@/lib/admin-coc-session";
import { readStaffAdminCocDecision } from "@/lib/staff-admin-coc-access";
import {
  STAFF_ADMIN_COC_SESSION_COOKIE,
  type StaffAdminCocDecision,
} from "@/lib/staff-admin-coc-decision";
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
  devRoleParam?: string | null,
  overrides?: {
    adminToken?: string;
    portalToken?: string;
    staffToken?: string;
    staffDecision?: (token: string) => Promise<StaffAdminCocDecision>;
  }
): Promise<FrontOfficeSession | null> {
  let adminToken = overrides?.adminToken;
  let portalToken = overrides?.portalToken;
  let staffToken = overrides?.staffToken;
  if (!overrides) {
    const cookieStore = await cookies();
    adminToken = cookieStore.get(ADMIN_COC_SESSION_COOKIE)?.value;
    portalToken = cookieStore.get(CLIENT_PORTAL_SESSION_COOKIE)?.value;
    staffToken = cookieStore.get(STAFF_ADMIN_COC_SESSION_COOKIE)?.value;
  }

  if (verifyAdminCocSessionToken(adminToken)) {
    return {
      role: "admin",
      displayName: "Operator",
      isDevPreview: false,
    };
  }

  if (staffToken) {
    const decision = overrides?.staffDecision
      ? await overrides.staffDecision(staffToken)
      : await readStaffAdminCocDecision({ sessionToken: staffToken });
    if (decision === "admin") {
      return {
        role: "admin",
        displayName: "Operator",
        isDevPreview: false,
      };
    }
  }

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
