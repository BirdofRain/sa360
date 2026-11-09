/**
 * Resolve a verified Google identity against a principal that already exists.
 * This function does not insert a principal, bind a subject, or grant a permission.
 */

export type VerifiedStaffGoogleIdentity = {
  sub: string;
  email: string;
  emailVerified: boolean;
};

export type ProvisionedStaffPrincipal = {
  id: string;
  email: string;
  status: "active" | "disabled";
  provider: "google";
  providerSubject: string | null;
  disabledAt: Date | string | null;
};

export type StaffIdentityResolutionCode =
  | "unverified_email"
  | "unknown"
  | "disabled"
  | "conflicting_sub"
  | "unbound";

export type StaffIdentityResolution =
  | { ok: true; staffPrincipalId: string }
  | { ok: false; code: StaffIdentityResolutionCode };

export type StaffSessionAuthorizationCode = "missing" | "disabled" | "conflicting_sub" | "unbound";

const PRINCIPAL_ID_PATTERN = /^c[a-z0-9]{24}$/;

export function resolveProvisionedStaffPrincipal(
  identity: VerifiedStaffGoogleIdentity,
  principal: ProvisionedStaffPrincipal | null
): StaffIdentityResolution {
  if (identity.emailVerified !== true) return { ok: false, code: "unverified_email" };
  if (!principal) return { ok: false, code: "unknown" };
  if (!PRINCIPAL_ID_PATTERN.test(principal.id) || principal.provider !== "google") {
    return { ok: false, code: "unknown" };
  }
  if (principal.status !== "active" || principal.disabledAt != null) {
    return { ok: false, code: "disabled" };
  }
  if (principal.providerSubject == null || principal.providerSubject === "") {
    return { ok: false, code: "unbound" };
  }
  if (principal.providerSubject !== identity.sub) return { ok: false, code: "conflicting_sub" };
  return { ok: true, staffPrincipalId: principal.id };
}

export function authorizeStaffSessionPrincipal(
  session: { staffPrincipalId: string; googleSub: string },
  principal: ProvisionedStaffPrincipal | null
): { ok: true; staffPrincipalId: string } | { ok: false; code: StaffSessionAuthorizationCode } {
  if (!principal || principal.id !== session.staffPrincipalId) return { ok: false, code: "missing" };
  if (principal.status !== "active" || principal.disabledAt != null) return { ok: false, code: "disabled" };
  if (principal.provider !== "google" || principal.providerSubject == null || principal.providerSubject === "") {
    return { ok: false, code: "unbound" };
  }
  if (principal.providerSubject !== session.googleSub) return { ok: false, code: "conflicting_sub" };
  return { ok: true, staffPrincipalId: principal.id };
}
