import { NextResponse, type NextRequest } from "next/server";

import { STAFF_ENROLLMENT_SECRET_PATTERN } from "@sa360/shared/staff-enrollment";

import { metaReviewerLogoutOriginAllowed } from "@/lib/meta-reviewer-logout";
import { staffEnrollmentConfigured, startStaffGoogleEnrollment } from "@/lib/staff-google-enrollment-browser";

export const dynamic = "force-dynamic";

const NO_STORE = {
  "cache-control": "no-store",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
} as const;

/**
 * `enrollment=` plus one 43-character secret. Anything larger is rejected
 * before the body is parsed.
 */
const MAX_ENROLLMENT_BODY_BYTES = 128;
const FORM_CONTENT_TYPE = /^application\/x-www-form-urlencoded(?:;\s*charset=utf-8)?$/i;

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
  if (request.nextUrl.searchParams.has("enrollment") || !staffEnrollmentConfigured(process.env)) {
    return new NextResponse("Not Found", { status: 404, headers: NO_STORE });
  }
  if (!enrollmentPostAllowed(request)) return forbidden();
  const type = request.headers.get("content-type") ?? "";
  if (!FORM_CONTENT_TYPE.test(type.trim())) return forbidden();
  const raw = await readBoundedBody(request);
  if (raw === null) return forbidden();
  const secret = readSingleEnrollmentField(raw);
  if (!secret) return new NextResponse("Not Found", { status: 404, headers: NO_STORE });
  const started = await startStaffGoogleEnrollment({ env: process.env, enrollmentSecret: secret });
  if (started.kind === "unconfigured") {
    return new NextResponse("Not Found", { status: 404, headers: NO_STORE });
  }
  if (started.kind === "unavailable") {
    return new NextResponse("Service Unavailable", { status: 503, headers: NO_STORE });
  }
  if (started.kind !== "redirect" || started.location.includes(secret) || started.stateCookie.value.includes(secret)) {
    return new NextResponse("Not Found", { status: 404, headers: NO_STORE });
  }
  const response = new NextResponse(null, {
    status: 303,
    headers: { ...NO_STORE, location: started.location },
  });
  response.cookies.set(started.stateCookie);
  return response;
}

function forbidden(): NextResponse {
  return new NextResponse("Forbidden", { status: 403, headers: NO_STORE });
}

/**
 * Same-origin form POST. Host matching reuses the logout check, which ignores
 * a forwarded-host list and uses one forwarded host only for loopback. Fetch
 * metadata, when present, must describe a browser navigation. A missing Origin
 * is rejected. `Origin: null` is accepted only with `Sec-Fetch-Site: same-origin`,
 * which is what Chrome sends under Referrer-Policy: no-referrer.
 */
function enrollmentPostAllowed(request: NextRequest): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site !== null && site !== "same-origin") return false;
  const mode = request.headers.get("sec-fetch-mode");
  if (mode !== null && mode !== "navigate") return false;
  const dest = request.headers.get("sec-fetch-dest");
  if (dest !== null && dest !== "document") return false;
  return metaReviewerLogoutOriginAllowed(request);
}

async function readBoundedBody(request: NextRequest): Promise<string | null> {
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^[0-9]+$/.test(declared) || Number(declared) > MAX_ENROLLMENT_BODY_BYTES)) return null;
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > MAX_ENROLLMENT_BODY_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(next.value);
    }
  } catch {
    return null;
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(body);
}

function readSingleEnrollmentField(raw: string): string | null {
  if (raw.length === 0 || raw.length > MAX_ENROLLMENT_BODY_BYTES || raw.includes("\0")) return null;
  const parts = raw.split("&").filter((part) => part.length > 0);
  if (parts.length !== 1 || !parts[0]?.startsWith("enrollment=")) return null;
  const encoded = parts[0].slice("enrollment=".length);
  if (encoded.length === 0 || encoded.includes("+") || encoded.includes("%")) return null;
  if (!STAFF_ENROLLMENT_SECRET_PATTERN.test(encoded)) return null;
  return encoded;
}
