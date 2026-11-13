import { NextResponse, type NextRequest } from "next/server";

import { readStaffGoogleBrowserConfig } from "@sa360/shared/staff-google-oidc";

import { startStaffGoogleSignIn } from "@/lib/staff-google-browser";
import { decideStaffGoogleStart } from "@/lib/staff-google-start-host";

export const dynamic = "force-dynamic";

export function GET(request: NextRequest) {
  const config = readStaffGoogleBrowserConfig(process.env);
  const decision = decideStaffGoogleStart({
    host: request.headers.get("host"),
    forwardedHost: request.headers.get("x-forwarded-host"),
    forwardedProto: request.headers.get("x-forwarded-proto"),
    requestUrl: request.url,
    redirectUri: config?.redirectUri ?? null,
  });
  if (decision.kind === "redirect") {
    return new NextResponse(null, {
      status: 303,
      headers: { Location: decision.location, "cache-control": "no-store" },
    });
  }
  if (decision.kind !== "start") {
    return new NextResponse("Not Found", { status: 404, headers: { "cache-control": "no-store" } });
  }
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
