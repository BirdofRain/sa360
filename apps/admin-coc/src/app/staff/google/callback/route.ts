import { NextResponse, type NextRequest } from "next/server";

import { readStaffGoogleServiceSecret } from "@sa360/shared/staff-google-service";
import { STAFF_GOOGLE_STATE_COOKIE } from "@sa360/shared/staff-google-state";

import {
  fetchStaffCapabilities,
  readStaffAdminCocOrigin,
  staffCapabilitiesLandingPath,
} from "@/lib/staff-admin-coc-decision";
import { completeStaffGoogleCallback, staffSessionBrowserCookie, staffStateClearCookie } from "@/lib/staff-google-browser";

export const dynamic = "force-dynamic";

function finish(env: NodeJS.ProcessEnv, location: string, sessionToken?: string): NextResponse {
  const response = new NextResponse(null, {
    status: 303,
    headers: { Location: location, "cache-control": "no-store" },
  });
  response.cookies.set(staffStateClearCookie(env));
  if (sessionToken) response.cookies.set(staffSessionBrowserCookie(sessionToken, env));
  return response;
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const outcome = await completeStaffGoogleCallback({
    env: process.env,
    code: url.searchParams.get("code") ?? undefined,
    queryState: url.searchParams.get("state") ?? undefined,
    stateCookie: request.cookies.get(STAFF_GOOGLE_STATE_COOKIE)?.value,
  });
  if (outcome.kind === "unavailable") {
    const response = new NextResponse("Not Found", { status: 404, headers: { "cache-control": "no-store" } });
    response.cookies.set(staffStateClearCookie(process.env));
    return response;
  }
  if (outcome.kind === "denied") return finish(process.env, "/staff?error=denied");
  const landing = await landingForNewSession(outcome.sessionToken);
  return finish(process.env, landing, outcome.sessionToken);
}

async function landingForNewSession(sessionToken: string): Promise<"/" | "/team-workspace" | "/staff"> {
  const origin = readStaffAdminCocOrigin(
    process.env.SA360_API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_SA360_API_BASE_URL
  );
  const serviceSecret = readStaffGoogleServiceSecret(process.env);
  if (!origin || !serviceSecret) return "/staff";
  const capabilities = await fetchStaffCapabilities({ origin, serviceSecret, sessionToken });
  return staffCapabilitiesLandingPath(capabilities.access);
}

export function POST() {
  return new NextResponse("Method Not Allowed", { status: 405, headers: { Allow: "GET" } });
}
