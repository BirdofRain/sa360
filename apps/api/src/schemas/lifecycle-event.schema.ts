import { z } from "zod";

export const lifecycleEventSchema = z.object({
  schema_version: z.string(),
  client_account_id: z.string(),
  subaccount_id_ghl: z.string().optional(),
  contact: z.object({
    lead_uid: z.string(),
    contact_id_ghl: z.string().optional(),
    first_name: z.string().optional(),
    last_name: z.string().optional(),
    email: z.string().optional(),
    phone_e164: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    zip: z.string().optional(),
    country: z.string().optional(),
    date_of_birth: z.string().optional(),
  }),
  attribution: z.object({
    source_platform: z.string().optional(),
    source_type: z.string().optional(),
    campaign_id: z.string().optional(),
    campaign_name: z.string().optional(),
    adset_id: z.string().optional(),
    adset_name: z.string().optional(),
    ad_id: z.string().optional(),
    ad_name: z.string().optional(),
    fbclid: z.string().optional(),
    utm_source: z.string().optional(),
    utm_medium: z.string().optional(),
    utm_campaign: z.string().optional(),
    utm_content: z.string().optional(),
    utm_term: z.string().optional(),
    meta_pixel_id: z.string().optional(),
    meta_dataset_id: z.string().optional(),
  }),
  state: z.object({
    lead_type: z.string().optional(),
    lifecycle_stage: z.string().optional(),
    lead_status: z.string().optional(),
    appointment_status: z.string().optional(),
    agent_disposition: z.string().optional(),
    policy_status: z.string().nullable().optional(),
    ai_status: z.string().optional(),
    routing_status: z.string().optional(),
    dead_lead_flag: z.boolean().optional(),
  }),
  event: z.object({
    event_uuid: z.string(),
    event_name_internal: z.string(),
    event_name_meta: z.string(),
    event_time_unix: z.number(),
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
});

export type LifecycleEventSchema = z.infer<typeof lifecycleEventSchema>;