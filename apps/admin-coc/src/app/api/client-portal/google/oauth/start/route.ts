import { cookies } from "next/headers";

import { startGoogleOAuthFromPortal } from "@/lib/client-portal-api/google-oauth";
import { readTrustedPortalSession } from "@/lib/client-portal/portal-auth";
import { CLIENT_PORTAL_SESSION_COOKIE } from "@/lib/client-portal/portal-session";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const store = await cookies();
  const session = await readTrustedPortalSession(
    store.get(CLIENT_PORTAL_SESSION_COOKIE)?.value
  );
  if (!session) {
    return Response.json({ ok: false, error: "Sign in required" }, { status: 401 });
  }
  const search = new URL(request.url).searchParams;
  if (search.has("clientAccountId")) {
    return Response.json(
      { ok: false, error: "clientAccountId cannot be supplied by the browser" },
      { status: 400 }
    );
  }
  const result = await startGoogleOAuthFromPortal(
    session,
    search.get("returnTo") ?? undefined
  );
  if (!result.ok) {
    return Response.json(
      { ok: false, error: "Unable to start Google connection" },
      { status: result.status || 502 }
    );
  }
  return Response.redirect(result.redirectUrl, 302);
}
