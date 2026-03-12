export type InternalEventName =
  | "lead_created"
  | "first_response"
  | "appointment_set"
  | "appointment_showed"
  | "sale_logged";

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
    city?: string;
    state?: string;
    zip?: string;
    country?: string;
    date_of_birth?: string;
  };
  attribution: {
    source_platform?: string;
    source_type?: string;
    campaign_id?: string;
    campaign_name?: string;
    adset_id?: string;
    adset_name?: string;
    ad_id?: string;
    ad_name?: string;
    fbclid?: string;
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
    event_name_internal: InternalEventName;
    event_name_meta: MetaEventName;
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
}