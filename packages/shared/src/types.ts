/** Lifecycle events GHL may POST to SA360 (see `docs/ghl/daily-action-dashboard-lifecycle-events.md`). */
export type InternalEventName =
  | "lead_created"
  | "lead_normalized"
  | "contact_updated"
  | "first_response"
  | "ai_engaged"
  | "appointment_set"
  | "appointment_confirmed"
  | "appointment_showed"
  | "appointment_no_show"
  | "appointment_cancelled"
  | "appointment_rescheduled"
  | "appointment_reminder_sent"
  | "contact_replied"
  | "ai_responded"
  | "ai_booked"
  | "ai_booking_failed"
  | "call_attempt_logged"
  | "call_connected"
  | "call_no_answer"
  | "disposition_logged"
  | "follow_up_needed"
  | "quote_given"
  | "sold"
  | "sale_logged"
  | "bad_number"
  | "dnc"
  | "dead_lead"
  | "policy_issued"
  | "human_activation_needed"
  | "no_show"
  | "outcome_logged"
  | "signal_sent";

export type MetaEventName =
  | "Lead"
  | "Contact"
  | "Schedule"
  | "QualifiedLead"
  | "Purchase";

export interface LifecycleWebhookPayload {
  schema_version: string;
  client_account_id: string;
  subaccount_id_ghl?: string;
  contact: {
    lead_uid: string;
    contact_id_ghl?: string;
    first_name?: string;
    last_name?: string;
    email?: string;
    phone_e164?: string;
    phone?: string;
    phone_digits?: string;
    city?: string;
    state?: string;
    zip?: string;
    country?: string;
    date_of_birth?: string;
  };
  /** Optional — omit for operational-only checkpoints. */
  attribution?: {
    source_platform?: string;
    source_type?: string;
    campaign_id?: string;
    campaign_name?: string;
    adset_id?: string;
    adset_name?: string;
    ad_id?: string;
    ad_name?: string;
    fbclid?: string;
    fbc?: string;
    fbp?: string;
    utm_source?: string;
    utm_medium?: string;
    utm_campaign?: string;
    utm_content?: string;
    utm_term?: string;
    meta_pixel_id?: string;
    meta_dataset_id?: string;
  };
  state: {
    lead_type?: string;
    lifecycle_stage?: string;
    lead_status?: string;
    appointment_status?: string;
    agent_disposition?: string;
    policy_status?: string | null;
    ai_status?: string;
    routing_status?: string;
    dead_lead_flag?: boolean;
  };
  event: {
    event_uuid: string;
    event_name_internal: InternalEventName | string;
    event_name_meta: MetaEventName | string;
    event_time_unix: number;
    value_score?: number;
    currency?: string;
    send_to_meta?: boolean;
  };
  ownership?: {
    assigned_agent_id?: string;
    assigned_agent_name?: string;
    updated_by?: string;
  };
  routing?: {
    niche_key?: string;
    source_dataset_id?: string;
    source_dataset_name?: string;
    master_dataset_id?: string;
    master_dataset_name?: string;
    calendar_id?: string;
    calendar_link?: string;
    sa360_calendar_id?: string;
    sa360_calendar_link?: string;
  };
  appointment?: {
    appointment_id?: string;
    appointment_status?: string;
    appointment_start_time?: string;
    appointment_end_time?: string;
    appointment_created_at?: string;
    appointment_updated_at?: string;
    appointment_cancelled_at?: string;
    appointment_showed_at?: string;
    appointment_no_show_at?: string;
    appointment_rescheduled_at?: string;
    scheduled_at?: string;
    timezone?: string;
    status?: string;
    calendar_id?: string;
    calendar_name?: string;
    calendar_link?: string;
    calendar_slug?: string;
    booking_source?: string;
    booked_by?: string;
    booked_by_type?: string;
    booking_channel?: string;
    ai_booked?: boolean | string;
    ai_provider?: string;
    confirmation_status?: string;
    reminder_status?: string;
    location?: string;
    meeting_url?: string;
    notes?: string;
    reschedule_link?: string;
    cancellation_reason?: string;
    no_show_reason?: string;
    show_outcome?: string;
    source?: string;
  };
  call?: {
    call_id?: string;
    direction?: "inbound" | "outbound";
    outcome?: string;
    duration_seconds?: number;
    logged_at?: string;
  };
  policy?: {
    policy_status?: string | null;
    carrier?: string;
    product_type?: string;
    monthly_premium?: string | number;
    annual_premium?: string | number;
    policy_effective_date?: string;
    application_status?: string;
    application_started_at?: string;
    application_submitted_at?: string;
    underwriting_status?: string;
    policy_number?: string;
    face_amount?: string | number;
    effective_date?: string;
    issued_at?: string;
    declined_at?: string;
    cancelled_at?: string;
    status?: string;
    premium_estimate?: string | number;
  };
  ai?: {
    channel?: string;
    outcome?: string;
    booked?: boolean;
    failure_reason?: string;
    provider?: string;
  };
  disposition?: {
    code?: string;
    notes?: string;
    logged_by?: string;
  };
}
