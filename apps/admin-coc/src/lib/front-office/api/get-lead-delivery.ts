import "server-only";

import {
  getLeadDeliveryDetail as getLeadDeliveryDetailLive,
  getLeadDeliveryListWithFallback,
} from "../live/lead-delivery-adapter";
import type { FrontOfficeRole, LeadDeliveryDetail, LeadDeliveryListResponse } from "../types";

export async function getLeadDeliveryList(
  role: FrontOfficeRole,
  clientAccountId?: string
): Promise<LeadDeliveryListResponse> {
  return getLeadDeliveryListWithFallback({ role, clientAccountId });
}

export async function getLeadDeliveryDetail(
  leadUid: string,
  role: FrontOfficeRole,
  clientAccountId?: string
): Promise<LeadDeliveryDetail | null> {
  return getLeadDeliveryDetailLive(leadUid, { role, clientAccountId });
}
