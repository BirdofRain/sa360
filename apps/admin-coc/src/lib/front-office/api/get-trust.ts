import "server-only";

import type { FrontOfficeRole, TrustCenterResponse } from "../types";
import { getTrustCenterLive } from "../live/trust-adapter";

export async function getTrustCenter(
  role: FrontOfficeRole,
  clientAccountId?: string
): Promise<TrustCenterResponse> {
  return getTrustCenterLive({ role, clientAccountId });
}
