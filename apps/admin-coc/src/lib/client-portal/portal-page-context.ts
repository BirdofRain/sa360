import "server-only";

import { cookies } from "next/headers";

import { isClientPortalApiConfigured } from "../client-portal-api/keys.ts";
import {
  getPortalSession,
  hasPortalSession,
  isClientPortalAccessGateRequired,
  resolvePortalRenderMode,
  type PortalRenderMode,
} from "./access-gate.ts";
import { getClientPortalDisplayName } from "./config.ts";
import { isClientPortalLoginConfigured } from "./portal-auth.ts";
import { safePortalNextPath } from "./portal-nav.ts";
import { CLIENT_PORTAL_SESSION_COOKIE, type PortalSessionPayload } from "./portal-session.ts";
import type { ClientPortalRangeKey } from "./types.ts";

export { safePortalNextPath };

export type PortalPageContext =
  | { mode: "login_required"; nextPath: string }
  | { mode: "access_gate"; rangeKey: ClientPortalRangeKey }
  | {
      mode: "mock";
      displayName: string;
      showSignOut: false;
    }
  | {
      mode: "live";
      displayName: string;
      showSignOut: true;
      session: PortalSessionPayload;
      clientAccountId: string;
    };

export async function loadPortalPageContext(opts: {
  nextPath: string;
  rangeKey?: ClientPortalRangeKey;
}): Promise<PortalPageContext> {
  const rangeKey = opts.rangeKey ?? "7d";
  const apiConfigured = isClientPortalApiConfigured();
  const gateRequired = isClientPortalAccessGateRequired();
  const loginConfigured = isClientPortalLoginConfigured();
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(CLIENT_PORTAL_SESSION_COOKIE)?.value;
  const hasSession = hasPortalSession(sessionCookie);

  const mode: PortalRenderMode = resolvePortalRenderMode({
    apiConfigured,
    hasSession,
    loginConfigured,
    gateRequired,
  });

  if (mode === "login_required") {
    return { mode, nextPath: safePortalNextPath(opts.nextPath) };
  }

  if (mode === "access_gate") {
    return { mode, rangeKey };
  }

  if (mode === "live") {
    const session = getPortalSession(sessionCookie);
    const clientAccountId = session?.clientAccountId;
    if (!session || !clientAccountId) {
      return { mode: "login_required", nextPath: safePortalNextPath(opts.nextPath) };
    }
    const displayName =
      session.portalDisplayName?.trim() ||
      session.clientDisplayName?.trim() ||
      getClientPortalDisplayName();
    return {
      mode: "live",
      displayName,
      showSignOut: true,
      session,
      clientAccountId,
    };
  }

  return {
    mode: "mock",
    displayName: getClientPortalDisplayName(),
    showSignOut: false,
  };
}
