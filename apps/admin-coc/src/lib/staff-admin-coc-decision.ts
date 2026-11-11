/**
 * Pure Admin C.O.C. staff-grant decision. No secrets and no Node crypto, so
 * middleware and server code can share it. A 200 response is admin only when
 * the body is the authorize shape. A 403 is a live staff session without the
 * grant. Every other result is anonymous.
 */

export const STAFF_ADMIN_COC_AUTHORIZE_PATH = "/internal/staff/admin-coc/authorize";
export const STAFF_ADMIN_COC_SERVICE_HEADER = "x-sa360-staff-google-service";
export const STAFF_ADMIN_COC_SESSION_HEADER = "x-sa360-staff-session";
export const STAFF_ADMIN_COC_SESSION_COOKIE = "sa360_staff_session";

export type StaffAdminCocDecision = "admin" | "limited" | "anonymous";

const PRINCIPAL_ID_PATTERN = /^c[a-z0-9]{24}$/;

export function classifyStaffAdminCocResponse(status: number, body: unknown): StaffAdminCocDecision {
  if (status === 403) return "limited";
  if (status !== 200 || !body || typeof body !== "object" || Array.isArray(body)) return "anonymous";
  const record = body as Record<string, unknown>;
  if (record.ok !== true || typeof record.staffPrincipalId !== "string") return "anonymous";
  if (!PRINCIPAL_ID_PATTERN.test(record.staffPrincipalId)) return "anonymous";
  return "admin";
}

export function staffAdminCocLandingPath(decision: StaffAdminCocDecision): "/" | "/staff" {
  return decision === "admin" ? "/" : "/staff";
}

export function readStaffAdminCocOrigin(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 300 || value.trim() !== value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.username || url.password || url.search || url.hash) return null;
  if (url.pathname !== "/" && url.pathname !== "") return null;
  const localhost = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol === "http:" && !localhost) return null;
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  return url.origin;
}

export async function fetchStaffAdminCocDecision(input: {
  origin: string;
  serviceSecret: string;
  sessionToken: string;
  fetchImpl?: typeof fetch;
}): Promise<StaffAdminCocDecision> {
  if (!input.origin || !input.serviceSecret || !input.sessionToken) return "anonymous";
  try {
    const response = await (input.fetchImpl ?? fetch)(`${input.origin}${STAFF_ADMIN_COC_AUTHORIZE_PATH}`, {
      method: "POST",
      headers: {
        accept: "application/json",
        [STAFF_ADMIN_COC_SERVICE_HEADER]: input.serviceSecret,
        [STAFF_ADMIN_COC_SESSION_HEADER]: input.sessionToken,
      },
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(1_500),
    });
    const body = response.status === 200 || response.status === 403 ? await response.json().catch(() => null) : null;
    return classifyStaffAdminCocResponse(response.status, body);
  } catch {
    return "anonymous";
  }
}
