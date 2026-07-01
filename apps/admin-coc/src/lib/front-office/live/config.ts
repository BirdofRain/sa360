import "server-only";

import { isAdminApiConfigured } from "@/lib/admin-api/server";

import type { FrontOfficeRole } from "../types";

/** Live bridge uses admin read endpoints (server-side key). Client sessions are scoped by clientAccountId. */
export function isFrontOfficeLiveBridgeEnabled(role: FrontOfficeRole): boolean {
  if (role === "agent") return false;
  return isAdminApiConfigured();
}

export type LiveBridgeScope = {
  role: FrontOfficeRole;
  clientAccountId?: string;
};
