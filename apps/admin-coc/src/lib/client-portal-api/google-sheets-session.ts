import { cookies } from "next/headers";

import { readTrustedPortalSession } from "@/lib/client-portal/portal-auth";
import { CLIENT_PORTAL_SESSION_COOKIE } from "@/lib/client-portal/portal-session";

export async function readPortalSheetsSession() {
  const store = await cookies();
  return readTrustedPortalSession(store.get(CLIENT_PORTAL_SESSION_COOKIE)?.value);
}
