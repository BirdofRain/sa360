import "server-only";

import { signStaffAssertion, STAFF_ASSERTION_HEADER, StaffAssertionError } from "@sa360/shared/staff-assertion";

import type { AdminCocAccess } from "../admin-coc-session-guard.ts";

const CLIENT_ID = "[A-Za-z0-9][A-Za-z0-9_-]{0,127}";

const ONBOARDING_WRITES: Array<{ method: string; pattern: RegExp }> = [
  { method: "PATCH", pattern: new RegExp(`^/admin/v1/clients/${CLIENT_ID}/setup$`) },
  { method: "POST", pattern: new RegExp(`^/admin/v1/clients/${CLIENT_ID}/source-campaign-requests$`) },
  { method: "POST", pattern: new RegExp(`^/admin/v1/clients/${CLIENT_ID}/ghl-destination-configuration$`) },
  { method: "POST", pattern: new RegExp(`^/admin/v1/clients/${CLIENT_ID}/company-sheets-destination-configuration$`) },
];

export function onboardingWriteAttributesStaff(method: string, path: string): boolean {
  const pathname = path.split("?")[0] ?? "";
  const upper = method.toUpperCase();
  return ONBOARDING_WRITES.some((entry) => entry.method === upper && entry.pattern.test(pathname));
}

/**
 * Principal id already taken from the verified staff session.
 * Shared-password admin and observer sessions have no individual id.
 */
export function namedStaffPrincipalId(access: AdminCocAccess): string | null {
  if (access.kind === "admin" && access.source === "staff") return access.staffPrincipalId;
  if (access.kind === "staff_workspace") return access.staffPrincipalId;
  return null;
}

/**
 * The server-minted assertion replaces any same-name header, in any letter case.
 * A browser-supplied token cannot remain beside it or take its place.
 */
export function applyNamedStaffAssertionHeader(
  headers: Record<string, string> | undefined,
  minted: { name: string; value: string }
): Record<string, string> {
  const next: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers ?? {})) {
    if (name.toLowerCase() === minted.name.toLowerCase()) continue;
    next[name] = value;
  }
  next[minted.name] = minted.value;
  return next;
}

export function mintNamedStaffOnboardingHeader(
  staffPrincipalId: string,
  env: NodeJS.ProcessEnv = process.env
): { ok: true; name: string; value: string } | { ok: false } {
  try {
    const minted = signStaffAssertion({ staffPrincipalId, env });
    return { ok: true, name: STAFF_ASSERTION_HEADER, value: minted.token };
  } catch (error) {
    if (error instanceof StaffAssertionError) return { ok: false };
    return { ok: false };
  }
}
