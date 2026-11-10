import { NextResponse, type NextRequest } from "next/server";

import { staffEnrollmentConfigured, startStaffGoogleEnrollment } from "@/lib/staff-google-enrollment-browser";

export const dynamic = "force-dynamic";

const NO_STORE = {
  "cache-control": "no-store",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
} as const;

const FORM = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="referrer" content="no-referrer">
  <title>Staff enrollment</title>
</head>
<body>
  <form method="post" action="/staff/google/enroll/start" autocomplete="off">
    <label for="enrollment">Enrollment secret</label>
    <input id="enrollment" name="enrollment" type="password" autocomplete="off" spellcheck="false" required>
    <button type="submit">Continue</button>
  </form>
</body>
</html>
`;

export async function GET(request: NextRequest) {
  if (request.nextUrl.searchParams.has("enrollment") || !staffEnrollmentConfigured(process.env)) {
    return new NextResponse("Not Found", { status: 404, headers: NO_STORE });
  }
  return new NextResponse(FORM, {
    status: 200,
    headers: { ...NO_STORE, "content-type": "text/html; charset=utf-8" },
  });
}

export async function POST(request: NextRequest) {
  if (request.nextUrl.searchParams.has("enrollment")) {
    return new NextResponse("Not Found", { status: 404, headers: NO_STORE });
  }
  const secret = await readPostedSecret(request);
  const started = await startStaffGoogleEnrollment({ env: process.env, enrollmentSecret: secret });
  if (started.kind === "unconfigured") {
    return new NextResponse("Not Found", { status: 404, headers: NO_STORE });
  }
  if (started.kind === "unavailable") {
    return new NextResponse("Service Unavailable", { status: 503, headers: NO_STORE });
  }
  if (started.kind !== "redirect") {
    return new NextResponse("Not Found", { status: 404, headers: NO_STORE });
  }
  const response = new NextResponse(null, {
    status: 303,
    headers: { ...NO_STORE, location: started.location },
  });
  response.cookies.set(started.stateCookie);
  return response;
}

async function readPostedSecret(request: NextRequest): Promise<string | undefined> {
  const type = request.headers.get("content-type") ?? "";
  if (!type.startsWith("application/x-www-form-urlencoded") && !type.startsWith("multipart/form-data")) return undefined;
  try {
    const form = await request.formData();
    const value = form.get("enrollment");
    return typeof value === "string" ? value : undefined;
  } catch {
    return undefined;
  }
}
