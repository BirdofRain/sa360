import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

import { getSa360PublicApiBaseUrl } from "./sa360-public-api-base-url";

/**
 * Forwards browser OAuth callbacks to the Fastify API when GHL redirects to the
 * admin-coc public host (common staging misconfiguration). Canonical handler:
 * GET {API_ORIGIN}/integrations/oauth/callback
 */
export async function proxyGhlOAuthCallbackToApi(
  request: NextRequest
): Promise<NextResponse> {
  const apiBase = getSa360PublicApiBaseUrl();
  if (!apiBase) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "NEXT_PUBLIC_SA360_API_BASE_URL is not configured; cannot forward OAuth callback to API.",
      },
      { status: 400 }
    );
  }

  const target = `${apiBase}/integrations/oauth/callback${request.nextUrl.search}`;
  const res = await fetch(target, {
    method: "GET",
    redirect: "manual",
    cache: "no-store",
    headers: {
      "x-request-id": request.headers.get("x-request-id") ?? randomUUID(),
      Accept: "text/html,application/json",
    },
  });

  const location = res.headers.get("location");
  if (location && res.status >= 300 && res.status < 400) {
    return NextResponse.redirect(location, res.status);
  }

  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = await res.text();
    return new NextResponse(body, {
      status: res.status,
      headers: { "content-type": contentType },
    });
  }

  return NextResponse.json(
    {
      ok: false,
      error: "Unexpected OAuth callback response from API.",
      status: res.status,
    },
    { status: res.status >= 400 ? res.status : 502 }
  );
}
