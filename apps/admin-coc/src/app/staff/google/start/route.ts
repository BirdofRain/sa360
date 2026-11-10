import { NextResponse } from "next/server";

import { startStaffGoogleSignIn } from "@/lib/staff-google-browser";

export const dynamic = "force-dynamic";

export function GET() {
  const started = startStaffGoogleSignIn({ env: process.env });
  if (started.kind === "unavailable") {
    return new NextResponse("Not Found", { status: 404 });
  }
  const response = new NextResponse(null, {
    status: 303,
    headers: { Location: started.location, "cache-control": "no-store" },
  });
  response.cookies.set(started.stateCookie);
  return response;
}

export function POST() {
  return new NextResponse("Method Not Allowed", { status: 405, headers: { Allow: "GET" } });
}
