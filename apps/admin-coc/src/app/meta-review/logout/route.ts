import { NextResponse } from "next/server";

import { metaReviewCacheControlHeaders } from "@/lib/meta-reviewer-access";
import { metaReviewerLogoutOriginAllowed } from "@/lib/meta-reviewer-logout";
import { metaReviewerSessionCookieClearOptions } from "@/lib/meta-reviewer-session";

function noStore(response: NextResponse): NextResponse {
  for (const [key, value] of Object.entries(metaReviewCacheControlHeaders())) {
    response.headers.set(key, value);
  }
  return response;
}

export function GET() {
  return noStore(
    new NextResponse("Method Not Allowed", {
      status: 405,
      headers: { Allow: "POST" },
    })
  );
}

/**
 * Clears only the reviewer cookie. The Admin C.O.C. operator cookie is left
 * in place. Location is a relative path so the host header cannot redirect
 * off-site.
 */
export function POST(request: {
  headers: { get(name: string): string | null };
  url?: string;
}) {
  if (!metaReviewerLogoutOriginAllowed(request)) {
    return noStore(new NextResponse("Forbidden", { status: 403 }));
  }

  const clear = metaReviewerSessionCookieClearOptions();
  const response = new NextResponse(null, {
    status: 303,
    headers: { Location: "/meta-review/login" },
  });
  response.cookies.set({
    name: clear.name,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: clear.secure,
    path: "/",
    maxAge: 0,
  });
  return noStore(response);
}
