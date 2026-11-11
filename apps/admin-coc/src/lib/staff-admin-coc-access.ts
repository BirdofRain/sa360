import { cookies } from "next/headers";

import { STAFF_SESSION_COOKIE } from "@sa360/shared/staff-google-session";
import { readStaffGoogleServiceSecret } from "@sa360/shared/staff-google-service";

import {
  fetchStaffAdminCocDecision,
  fetchStaffCapabilities,
  readStaffAdminCocOrigin,
  staffAdminCocLandingPath,
  type StaffAdminCocDecision,
  type StaffCapabilities,
  type StaffCapability,
} from "./staff-admin-coc-decision.ts";

export { staffAdminCocLandingPath };
export type { StaffAdminCocDecision, StaffCapabilities, StaffCapability };

const TEST_PRINCIPAL_ID = "c123456789012345678901234";
let testCapabilities: StaffCapabilities | undefined;

/** Test-only capabilities. Production requests leave this unset and call the API. */
export function useStaffCapabilitiesTestResult(value: StaffCapabilities | undefined): void {
  testCapabilities = value;
}

export function staffCapabilitiesFromTestDecision(
  decision: StaffAdminCocDecision | "workspace"
): StaffCapabilities {
  if (decision === "admin") {
    return { access: "admin", permissions: ["admin_coc"], staffPrincipalId: TEST_PRINCIPAL_ID };
  }
  if (decision === "workspace") {
    return {
      access: "workspace",
      permissions: ["team_workspace", "team_manager"],
      staffPrincipalId: TEST_PRINCIPAL_ID,
    };
  }
  if (decision === "limited") {
    return { access: "limited", permissions: [], staffPrincipalId: TEST_PRINCIPAL_ID };
  }
  return { access: "anonymous", permissions: [], staffPrincipalId: null };
}

/**
 * Server-side Admin C.O.C. decision for the current staff cookie.
 * This does not read a role from the cookie and does not mint an admin session.
 */
export async function readStaffCapabilities(input?: {
  sessionToken?: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}): Promise<StaffCapabilities> {
  if (testCapabilities) return testCapabilities;
  const env = input?.env ?? process.env;
  const token = input?.sessionToken ?? (await readStaffSessionCookie());
  if (!token) return { access: "anonymous", permissions: [], staffPrincipalId: null };
  const origin = readStaffAdminCocOrigin(env.SA360_API_INTERNAL_URL ?? env.NEXT_PUBLIC_SA360_API_BASE_URL);
  const serviceSecret = readStaffGoogleServiceSecret(env);
  if (!origin || !serviceSecret) return { access: "anonymous", permissions: [], staffPrincipalId: null };
  return fetchStaffCapabilities({ origin, serviceSecret, sessionToken: token, fetchImpl: input?.fetchImpl });
}

export async function readStaffAdminCocDecision(input?: {
  sessionToken?: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}): Promise<StaffAdminCocDecision> {
  const env = input?.env ?? process.env;
  const token = input?.sessionToken ?? (await readStaffSessionCookie());
  if (!token) return "anonymous";
  const origin = readStaffAdminCocOrigin(env.SA360_API_INTERNAL_URL ?? env.NEXT_PUBLIC_SA360_API_BASE_URL);
  const serviceSecret = readStaffGoogleServiceSecret(env);
  if (!origin || !serviceSecret) return "anonymous";
  return fetchStaffAdminCocDecision({
    origin,
    serviceSecret,
    sessionToken: token,
    fetchImpl: input?.fetchImpl,
  });
}

async function readStaffSessionCookie(): Promise<string | undefined> {
  try {
    const store = await cookies();
    return store.get(STAFF_SESSION_COOKIE)?.value;
  } catch {
    return undefined;
  }
}
