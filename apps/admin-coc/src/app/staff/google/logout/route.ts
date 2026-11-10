import { NextResponse, type NextRequest } from "next/server";

import { metaReviewerLogoutOriginAllowed } from "@/lib/meta-reviewer-logout";
import { staffLogoutClearCookie } from "@/lib/staff-google-browser";

export const dynamic = "force-dynamic";

export function GET() {
  return new NextResponse("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
}

/** Clears only the staff session cookie. The shared-password cookie stays. */
export function POST(request: NextRequest) {
  if (!metaReviewerLogoutOriginAllowed(request)) {
    return new NextResponse("Forbidden", { status: 403, headers: { "cache-control": "no-store" } });
  }
  const response = new NextResponse(null, {
    status: 303,
    headers: { Location: "/staff", "cache-control": "no-store" },
  });
  response.cookies.set(staffLogoutClearCookie(process.env));
  return response;
}
