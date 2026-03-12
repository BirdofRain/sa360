import type { InternalEventName, MetaEventName } from "./types.js";

export const INTERNAL_TO_META_EVENT_MAP: Record<InternalEventName, MetaEventName> = {
  lead_created: "Lead",
  first_response: "Contact",
  appointment_set: "Schedule",
  appointment_showed: "QualifiedLead",
  sale_logged: "Purchase",
};