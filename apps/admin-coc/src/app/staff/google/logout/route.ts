import { NextResponse, type NextRequest } from "next/server";

import { STAFF_SESSION_COOKIE } from "@sa360/shared/staff-google-session";

import { metaReviewerLogoutOriginAllowed } from "@/lib/meta-reviewer-logout";
import { revokeStaffBrowserSession, staffLogoutClearCookie } from "@/lib/staff-google-browser";

export const dynamic = "force-dynamic";

export function GET() {
  return new NextResponse("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
}

/** Revokes the presented staff session, then clears only that cookie. */
export async function POST(request: NextRequest) {
  if (!metaReviewerLogoutOriginAllowed(request)) {
    return new NextResponse("Forbidden", { status: 403, headers: { "cache-control": "no-store" } });
  }
  const revoked = await revokeStaffBrowserSession({
    env: process.env,
    sessionCookie: request.cookies.get(STAFF_SESSION_COOKIE)?.value,
  });
  if (revoked.kind === "unavailable") {
    return new NextResponse("Service Unavailable", {
      status: 503,
      headers: { "cache-control": "no-store" },
    });
  }
  const response = new NextResponse(null, {
    status: 303,
    headers: { Location: "/staff", "cache-control": "no-store" },
  });
  response.cookies.set(staffLogoutClearCookie(process.env));
  return response;
}
