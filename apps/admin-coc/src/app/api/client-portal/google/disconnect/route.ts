import { cookies } from "next/headers";

import { disconnectGoogleFromPortal } from "@/lib/client-portal-api/google-oauth";
import { readTrustedPortalSession } from "@/lib/client-portal/portal-auth";
import { CLIENT_PORTAL_SESSION_COOKIE } from "@/lib/client-portal/portal-session";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const store = await cookies();
  const session = await readTrustedPortalSession(
    store.get(CLIENT_PORTAL_SESSION_COOKIE)?.value
  );
  if (!session) {
    return Response.json({ ok: false, error: "Sign in required" }, { status: 401 });
  }
  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    // An empty POST body is valid.
  }
  if ("clientAccountId" in body) {
    return Response.json(
      { ok: false, error: "clientAccountId cannot be supplied by the browser" },
      { status: 400 }
    );
  }
  const result = await disconnectGoogleFromPortal(session);
  if (!result.ok) {
    return Response.json(
      {
        ok: false,
        error: "Unable to revoke Google connection",
        retryable: result.status === 503,
      },
      { status: result.status || 502 }
    );
  }
  return Response.json(result.data);
}
