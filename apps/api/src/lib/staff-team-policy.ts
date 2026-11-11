/**
 * Pure staff team rules. Authorization is still the live StaffPermission rows.
 * This module does not read the database and does not accept a caller-supplied role
 * as authority.
 */

export const STAFF_HOSTED_DOMAIN = "lifeagentlaunch.com";
export const STAFF_INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const STAFF_MANAGED_PERMISSIONS = [
  "admin_coc",
  "team_workspace",
  "team_manager",
  "team_operations",
] as const;

export type StaffManagedPermission = (typeof STAFF_MANAGED_PERMISSIONS)[number];
export type StaffAccessLevel = "administrator" | "manager" | "operations";
export type StaffAccountStatus =
  | "disabled"
  | "active"
  | "revoked"
  | "pending"
  | "invitation_expired"
  | "invitation_canceled";

const LOCAL_PART = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/;

export function permissionsForAccessLevel(level: StaffAccessLevel): StaffManagedPermission[] {
  if (level === "administrator") return ["admin_coc"];
  if (level === "manager") return ["team_workspace", "team_manager"];
  return ["team_workspace", "team_operations"];
}

export function accessLevelFromPermissions(granted: readonly string[]): StaffAccessLevel | "none" {
  if (granted.includes("admin_coc")) return "administrator";
  if (granted.includes("team_manager")) return "manager";
  if (granted.includes("team_operations")) return "operations";
  return "none";
}

/** Company mailbox only. Plus aliases, subdomains, and other domains are rejected. */
export function normalizeCompanyEmail(value: unknown, domain: string = STAFF_HOSTED_DOMAIN): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (email !== value.trim().toLowerCase() || email.length > 320 || email.includes(" ")) return null;
  const suffix = `@${domain}`;
  if (!email.endsWith(suffix)) return null;
  const local = email.slice(0, -suffix.length);
  if (!LOCAL_PART.test(local) || local.includes("..") || local.includes("+")) return null;
  return email;
}

export function hostedDomainMatches(value: unknown, domain: string = STAFF_HOSTED_DOMAIN): boolean {
  return typeof value === "string" && value === domain;
}

export function parseStaffSignInUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed !== value || trimmed.length === 0 || trimmed.length > 300) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.username || url.password || url.search || url.hash) return null;
  if (url.pathname !== "/staff/google/start") return null;
  const localhost = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol === "http:") {
    if (!localhost) return null;
  } else if (url.protocol !== "https:") {
    return null;
  }
  return `${url.origin}${url.pathname}`;
}

export function staffAccountStatus(input: {
  principalStatus: "active" | "disabled";
  bound: boolean;
  granted: readonly string[];
  invitationStatus: "pending" | "consumed" | "canceled" | null;
  invitationExpiresAt: Date | null;
  now: Date;
}): StaffAccountStatus {
  if (input.principalStatus !== "active") return "disabled";
  const hasAccess = input.granted.some((permission) =>
    (STAFF_MANAGED_PERMISSIONS as readonly string[]).includes(permission)
  );
  if (input.bound) return hasAccess ? "active" : "revoked";
  if (input.invitationStatus === "canceled" || input.invitationStatus == null) return "invitation_canceled";
  if (
    input.invitationStatus === "pending" &&
    input.invitationExpiresAt != null &&
    input.invitationExpiresAt.getTime() <= input.now.getTime()
  ) {
    return "invitation_expired";
  }
  return "pending";
}

export function invitationDisplayStatus(input: {
  status: "pending" | "consumed" | "canceled" | null;
  expiresAt: Date | null;
  now: Date;
}): "none" | "pending" | "expired" | "consumed" | "canceled" {
  if (input.status == null) return "none";
  if (input.status === "canceled") return "canceled";
  if (input.status === "consumed") return "consumed";
  if (input.expiresAt != null && input.expiresAt.getTime() <= input.now.getTime()) return "expired";
  return "pending";
}

export function isStaffAccessLevel(value: unknown): value is StaffAccessLevel {
  return value === "administrator" || value === "manager" || value === "operations";
}
