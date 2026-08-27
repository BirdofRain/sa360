import { mapClientLeadDeliveryRows, type PortalLeadView } from "./map-client-leads.ts";
import { PORTAL_ORDER_LINKED_LEADS_LOAD_ERROR } from "./portal-order-leads-api.ts";

export type PortalOrderLinkedLeadsState = {
  leads: PortalLeadView[];
  error: string | null;
  hasMore: boolean;
};

export function portalOrderLinkedLeadsState(input: {
  items: unknown[];
  error: string | null;
  nextCursor?: string | null;
}): PortalOrderLinkedLeadsState {
  if (input.error) {
    return {
      leads: [],
      error: PORTAL_ORDER_LINKED_LEADS_LOAD_ERROR,
      hasMore: false,
    };
  }
  return {
    leads: mapClientLeadDeliveryRows(input.items),
    error: null,
    hasMore: Boolean(input.nextCursor),
  };
}
