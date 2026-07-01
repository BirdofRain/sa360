import "server-only";

import type { DialDeskResponse, FrontOfficeRole } from "../types";
import { getMockDialDesk } from "../mock/dial-desk";

export async function getDialDesk(
  role: FrontOfficeRole
): Promise<DialDeskResponse | null> {
  if (role === "client") return null;
  return getMockDialDesk();
}
