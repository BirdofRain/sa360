import "server-only";

import { resolveFrontOfficeSession } from "../role-context";
import type { FrontOfficeSession } from "../types";

export async function requireFrontOfficeSession(
  devRoleParam?: string | null
): Promise<FrontOfficeSession | null> {
  return resolveFrontOfficeSession(devRoleParam);
}
