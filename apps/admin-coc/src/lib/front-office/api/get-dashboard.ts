import "server-only";

import type { FrontOfficeRole } from "../types";
import { getDashboardLive } from "../live/dashboard-adapter";

export async function getDashboard(role: FrontOfficeRole, clientAccountId?: string) {
  return getDashboardLive(role, clientAccountId);
}

export { mergeDashboard } from "./merge-dashboard";
