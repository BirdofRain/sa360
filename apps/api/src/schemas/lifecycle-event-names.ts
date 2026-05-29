/**
 * Internal lifecycle event names accepted by POST /webhooks/ghl/lifecycle-event.
 * Used for Zod validation and GHL workflow documentation.
 */

/** Daily Action Dashboard + automation checkpoints (preferred explicit names). */
export const DAILY_ACTION_LIFECYCLE_EVENT_NAMES = [
  "appointment_set",
  "appointment_confirmed",
  "appointment_showed",
  "appointment_no_show",
  "appointment_cancelled",
  "appointment_rescheduled",
  "contact_replied",
  "ai_responded",
  "ai_booked",
  "ai_booking_failed",
  "call_attempt_logged",
  "call_connected",
  "call_no_answer",
  "disposition_logged",
  "follow_up_needed",
  "quote_given",
  "sold",
  "bad_number",
  "dnc",
  "dead_lead",
  "policy_issued",
] as const;

/** Routing registry dry-run checkpoints (Phase 4A — no delivery). */
export const ROUTING_LIFECYCLE_EVENT_NAMES = [
  "lead_matched",
  "routing_review_required",
  "lead_routed_dry_run",
] as const;

/** Guarded live delivery checkpoints (Phase 4I — internal only, no Meta auto-dispatch). */
export const DELIVERY_LIFECYCLE_EVENT_NAMES = [
  "lead_delivery_started",
  "lead_delivered",
  "client_contact_created",
  "client_contact_updated",
  "delivery_failed",
] as const;

/** Existing SA360 checkpoints (keep lead_created and related behavior). */
export const LEGACY_LIFECYCLE_EVENT_NAMES = [
  "lead_created",
  "lead_normalized",
  "contact_updated",
  "first_response",
  "ai_engaged",
  "appointment_reminder_sent",
  "human_activation_needed",
  "no_show",
  "sale_logged",
  "outcome_logged",
  "signal_sent",
] as const;

export const LIFECYCLE_EVENT_NAME_INTERNAL_VALUES = [
  ...DAILY_ACTION_LIFECYCLE_EVENT_NAMES,
  ...ROUTING_LIFECYCLE_EVENT_NAMES,
  ...DELIVERY_LIFECYCLE_EVENT_NAMES,
  ...LEGACY_LIFECYCLE_EVENT_NAMES,
] as const;

export type LifecycleEventNameInternal = (typeof LIFECYCLE_EVENT_NAME_INTERNAL_VALUES)[number];
