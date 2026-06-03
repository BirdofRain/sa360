import type { NextRequest } from "next/server";

import { proxyGhlOAuthCallbackToApi } from "@/lib/ghl-oauth-callback-proxy";

/** Browser-facing path when GHL redirect URI points at admin-coc host; proxies to API. */
export async function GET(request: NextRequest) {
  return proxyGhlOAuthCallbackToApi(request);
}
