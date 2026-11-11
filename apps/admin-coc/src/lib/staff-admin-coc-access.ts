import { cookies } from "next/headers";

import { STAFF_SESSION_COOKIE } from "@sa360/shared/staff-google-session";
import { readStaffGoogleServiceSecret } from "@sa360/shared/staff-google-service";

import {
  fetchStaffAdminCocDecision,
  readStaffAdminCocOrigin,
  staffAdminCocLandingPath,
  type StaffAdminCocDecision,
} from "./staff-admin-coc-decision.ts";

export { staffAdminCocLandingPath };
export type { StaffAdminCocDecision };

/**
 * Server-side Admin C.O.C. decision for the current staff cookie.
 * This does not read a role from the cookie and does not mint an admin session.
 */
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
