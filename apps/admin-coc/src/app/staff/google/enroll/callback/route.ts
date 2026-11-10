import { NextResponse, type NextRequest } from "next/server";

import { STAFF_ENROLLMENT_STATE_COOKIE } from "@sa360/shared/staff-google-enrollment-state";

import { completeStaffGoogleEnrollment, staffEnrollmentStateClearCookie } from "@/lib/staff-google-enrollment-browser";

export const dynamic = "force-dynamic";

function finish(env: NodeJS.ProcessEnv, location: string, status = 303): NextResponse {
  const response = new NextResponse(null, {
    status,
    headers: { Location: location, "cache-control": "no-store", "referrer-policy": "no-referrer" },
  });
  response.cookies.set(staffEnrollmentStateClearCookie(env));
  return response;
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const outcome = await completeStaffGoogleEnrollment({
    env: process.env,
    code: url.searchParams.get("code") ?? undefined,
    queryState: url.searchParams.get("state") ?? undefined,
    stateCookie: request.cookies.get(STAFF_ENROLLMENT_STATE_COOKIE)?.value,
  });
  if (outcome.kind === "unconfigured") {
    const response = new NextResponse("Not Found", { status: 404, headers: { "cache-control": "no-store", "referrer-policy": "no-referrer" } });
    response.cookies.set(staffEnrollmentStateClearCookie(process.env));
    return response;
  }
  if (outcome.kind === "unavailable") {
    const response = new NextResponse("Service Unavailable", {
      status: 503,
      headers: { "cache-control": "no-store", "referrer-policy": "no-referrer" },
    });
    response.cookies.set(staffEnrollmentStateClearCookie(process.env));
    return response;
  }
  if (outcome.kind === "denied") return finish(process.env, "/staff/google/enroll/complete?error=denied");
  return finish(process.env, "/staff/google/enroll/complete");
}

export function POST() {
  return new NextResponse("Method Not Allowed", { status: 405, headers: { Allow: "GET" } });
}
