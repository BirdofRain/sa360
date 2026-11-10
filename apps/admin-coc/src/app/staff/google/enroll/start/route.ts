import { NextResponse, type NextRequest } from "next/server";

import { startStaffGoogleEnrollment } from "@/lib/staff-google-enrollment-browser";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const started = await startStaffGoogleEnrollment({
    env: process.env,
    enrollmentSecret: request.nextUrl.searchParams.get("enrollment") ?? undefined,
  });
  if (started.kind === "unconfigured") {
    return new NextResponse("Not Found", { status: 404, headers: { "cache-control": "no-store", "referrer-policy": "no-referrer" } });
  }
  if (started.kind === "unavailable") {
    return new NextResponse("Service Unavailable", { status: 503, headers: { "cache-control": "no-store", "referrer-policy": "no-referrer" } });
  }
  if (started.kind !== "redirect") {
    return new NextResponse("Not Found", { status: 404, headers: { "cache-control": "no-store", "referrer-policy": "no-referrer" } });
  }
  const response = new NextResponse(null, {
    status: 303,
    headers: { Location: started.location, "cache-control": "no-store", "referrer-policy": "no-referrer" },
  });
  response.cookies.set(started.stateCookie);
  return response;
}

export function POST() {
  return new NextResponse("Method Not Allowed", { status: 405, headers: { Allow: "GET" } });
}
