import { z } from "zod";
import { LIFECYCLE_EVENT_NAME_INTERNAL_VALUES } from "./lifecycle-event-names.js";

const optionalString = z.string().optional();
const optionalNullableString = z.string().nullable().optional();
/** GHL often sends currency amounts as strings; dashboards may send numbers. */
const optionalMoneyField = z.union([z.string(), z.coerce.number().finite()]).optional();
const optionalBooleanOrString = z.union([z.boolean(), z.string()]).optional();

export const lifecycleAttributionSchema = z
  .object({
    source_platform: optionalString,
    source_type: optionalString,
    campaign_id: optionalString,
    campaign_name: optionalString,
    adset_id: optionalString,
    adset_name: optionalString,
    ad_id: optionalString,
    ad_name: optionalString,
    fbclid: optionalString,
    /** Meta click ID cookie (_fbc). */
    fbc: optionalString,
    /** Meta browser ID cookie (_fbp). */
    fbp: optionalString,
    utm_source: optionalString,
    utm_medium: optionalString,
    utm_campaign: optionalString,
    utm_content: optionalString,
    utm_term: optionalString,
    meta_pixel_id: optionalString,
    meta_dataset_id: optionalString,
  })
  .strict();

export const lifecycleAppointmentSchema = z
  .object({
    appointment_id: optionalString,
    appointment_status: optionalString,
    appointment_start_time: optionalString,
    appointment_end_time: optionalString,
    appointment_created_at: optionalString,
    appointment_updated_at: optionalString,
    appointment_cancelled_at: optionalString,
    appointment_showed_at: optionalString,
    appointment_no_show_at: optionalString,
    appointment_rescheduled_at: optionalString,
    /** Legacy alias for appointment_start_time. */
    scheduled_at: optionalString,
    timezone: optionalString,
    /** Legacy alias for appointment_status. */
    status: optionalString,
    calendar_id: optionalString,
    calendar_name: optionalString,
    calendar_link: optionalString,
    calendar_slug: optionalString,
    booking_source: optionalString,
    booked_by: optionalString,
    booked_by_type: optionalString,
    booking_channel: optionalString,
    ai_booked: optionalBooleanOrString,
    ai_provider: optionalString,
    confirmation_status: optionalString,
    reminder_status: optionalString,
    location: optionalString,
    meeting_url: optionalString,
    notes: optionalString,
    reschedule_link: optionalString,
    cancellation_reason: optionalString,
    no_show_reason: optionalString,
    show_outcome: optionalString,
    /** Legacy alias for booking_source. */
    source: optionalString,
  })
  .strict();

export const lifecycleCallSchema = z
  .object({
    call_id: optionalString,
    direction: z.enum(["inbound", "outbound"]).optional(),
    outcome: optionalString,
    duration_seconds: z.coerce.number().finite().nonnegative().optional(),
    logged_at: optionalString,
  })
  .strict();

export const lifecyclePolicySchema = z
  .object({
    policy_status: optionalNullableString,
    carrier: optionalString,
    product_type: optionalString,
    monthly_premium: optionalMoneyField,
    annual_premium: optionalMoneyField,
    policy_effective_date: optionalString,
    application_status: optionalString,
    application_started_at: optionalString,
    application_submitted_at: optionalString,
    underwriting_status: optionalString,
    policy_number: optionalString,
    face_amount: optionalMoneyField,
    effective_date: optionalString,
    issued_at: optionalString,
    declined_at: optionalString,
    cancelled_at: optionalString,
    /** Legacy fields */
    status: optionalString,
    premium_estimate: optionalMoneyField,
  })
  .strict();

export const lifecycleAiSchema = z
  .object({
    channel: optionalString,
    outcome: optionalString,
    booked: z.boolean().optional(),
    failure_reason: optionalString,
    provider: optionalString,
  })
  .strict();

export const lifecycleDispositionSchema = z
  .object({
    code: optionalString,
    notes: optionalString,
    logged_by: optionalString,
  })
  .strict();

export const lifecycleEventSchema = z
  .object({
    schema_version: z.string(),
    client_account_id: z.string().trim().min(1, "client_account_id is required"),
    subaccount_id_ghl: z.string().optional(),
    contact: z.object({
      lead_uid: z.string(),
      contact_id_ghl: z.string().optional(),
      first_name: z.string().optional(),
      last_name: z.string().optional(),
      email: z.string().optional(),
      phone_e164: z.string().optional(),
      phone: z.string().optional(),
      phone_digits: z.string().optional(),
      city: z.string().optional(),
      state: z.string().optional(),
      zip: z.string().optional(),
      country: z.string().optional(),
      date_of_birth: z.string().optional(),
    }),
    attribution: lifecycleAttributionSchema.optional(),
    state: z.object({
      lead_type: z.string().optional(),
      lifecycle_stage: z.string().optional(),
      lead_status: z.string().optional(),
      appointment_status: z.string().optional(),
      agent_disposition: z.string().optional(),
      policy_status: optionalNullableString,
      ai_status: z.string().optional(),
      routing_status: z.string().optional(),
      dead_lead_flag: z.boolean().optional(),
    }),
    event: z.object({
      event_uuid: z.string().trim().min(1),
      event_name_internal: z.enum(LIFECYCLE_EVENT_NAME_INTERNAL_VALUES),
      event_name_meta: z.string().trim().min(1),
      event_time_unix: z.coerce.number().optional(),
      value_score: z.number().optional(),
      currency: z.string().optional(),
      send_to_meta: z.boolean().optional(),
    }),
    ownership: z
      .object({
        assigned_agent_id: z.string().optional(),
        assigned_agent_name: z.string().optional(),
        updated_by: z.string().optional(),
      })
      .optional(),
    routing: z
      .object({
        niche_key: z.string().optional(),
        source_dataset_id: z.string().optional(),
        source_dataset_name: z.string().optional(),
        master_dataset_id: z.string().optional(),
        master_dataset_name: z.string().optional(),
        calendar_id: z.string().optional(),
        calendar_link: z.string().optional(),
        sa360_calendar_id: z.string().optional(),
        sa360_calendar_link: z.string().optional(),
      })
      .passthrough()
      .optional(),
    appointment: lifecycleAppointmentSchema.optional(),
    call: lifecycleCallSchema.optional(),
    policy: lifecyclePolicySchema.optional(),
    ai: lifecycleAiSchema.optional(),
    disposition: lifecycleDispositionSchema.optional(),
  })
  .strict();

export type LifecycleEventSchema = z.infer<typeof lifecycleEventSchema>;

/** Zod-validated lifecycle webhook body (strict event_name_internal union). */
export type ParsedLifecycleEventPayload = LifecycleEventSchema;
