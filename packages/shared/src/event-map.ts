import type { InternalEventName, MetaEventName } from "./types.js";

/** Default Meta CAPI name when `event_name_meta` is omitted in workflow design. */
export const INTERNAL_TO_META_EVENT_MAP: Record<InternalEventName, MetaEventName> = {
  lead_created: "Lead",
  lead_normalized: "Lead",
  contact_updated: "Contact",
  first_response: "Contact",
  contact_replied: "Contact",
  ai_engaged: "Contact",
  ai_responded: "Contact",
  ai_booked: "Schedule",
  ai_booking_failed: "Contact",
  appointment_set: "Schedule",
  appointment_confirmed: "Schedule",
  appointment_rescheduled: "Schedule",
  appointment_reminder_sent: "Schedule",
  appointment_showed: "QualifiedLead",
  appointment_no_show: "Contact",
  no_show: "Contact",
  call_attempt_logged: "Contact",
  call_connected: "Contact",
  call_no_answer: "Contact",
  disposition_logged: "Contact",
  follow_up_needed: "Contact",
  human_activation_needed: "Contact",
  quote_given: "QualifiedLead",
  sold: "Purchase",
  sale_logged: "Purchase",
  policy_issued: "Purchase",
  appointment_cancelled: "Contact",
  bad_number: "Contact",
  dnc: "Contact",
  dead_lead: "Contact",
  outcome_logged: "QualifiedLead",
  signal_sent: "Contact",
};

export function suggestMetaEventName(internal: string): MetaEventName {
  const key = internal as InternalEventName;
  return INTERNAL_TO_META_EVENT_MAP[key] ?? "Contact";
}
