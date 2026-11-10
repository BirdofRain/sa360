import { NextResponse, type NextRequest } from "next/server";

import { staffEnrollmentConfigured } from "@/lib/staff-google-enrollment-browser";

export const dynamic = "force-dynamic";

export function GET(request: NextRequest) {
  if (!staffEnrollmentConfigured(process.env)) {
    return new NextResponse("Not Found", { status: 404, headers: { "cache-control": "no-store" } });
  }
  const denied = request.nextUrl.searchParams.get("error") === "denied";
  const body = denied
    ? "Enrollment was not completed. Sign-in was not started."
    : "Enrollment finished. Sign in separately when staff sign-in is turned on. This page does not start a session.";
  return new NextResponse(body, {
    status: 200,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" },
  });
}

export function POST() {
  return new NextResponse("Method Not Allowed", { status: 405, headers: { Allow: "GET" } });
}
