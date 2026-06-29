import { z } from "zod";

/**
 * Validation schema for the Google Sheet cutover-rehearsal intake payload.
 *
 * This mirrors the normalized envelope emitted by the Apps Script connector
 * (`schema_version`, `client_account_id`, `contact`, `attribution`, `state`,
 * `event`, `ownership`, `routing`, `rehearsal`, `raw`). It is intentionally more
 * permissive than the strict lifecycle schema: nested objects use `.passthrough()`
 * so the connector can evolve its column set without breaking intake. The
 * normalizer maps this envelope into the strict lifecycle schema used by routing.
 */

const optionalString = z.string().optional();

export const googleSheetContactSchema = z
  .object({
    lead_uid: optionalString,
    contact_id_ghl: optionalString,
    first_name: optionalString,
    last_name: optionalString,
    full_name: optionalString,
    email: optionalString,
    phone: optionalString,
    phone_e164: optionalString,
    phone_digits: optionalString,
    city: optionalString,
    state: optionalString,
    zip: optionalString,
    country: optionalString,
    date_of_birth: optionalString,
  })
  .passthrough();

export const googleSheetAttributionSchema = z
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
    fbc: optionalString,
    fbp: optionalString,
    utm_source: optionalString,
    utm_medium: optionalString,
    utm_campaign: optionalString,
    utm_content: optionalString,
    utm_term: optionalString,
    meta_pixel_id: optionalString,
    meta_dataset_id: optionalString,
  })
  .passthrough();

export const googleSheetStateSchema = z
  .object({
    lead_type: optionalString,
    lifecycle_stage: optionalString,
    lead_status: optionalString,
    appointment_status: optionalString,
    agent_disposition: optionalString,
    policy_status: z.string().nullable().optional(),
    ai_status: optionalString,
    routing_status: optionalString,
    dead_lead_flag: z.boolean().optional(),
  })
  .passthrough();

export const googleSheetEventSchema = z
  .object({
    event_uuid: optionalString,
    event_name_internal: optionalString,
    event_name_meta: optionalString,
    event_time_unix: z.coerce.number().optional(),
    value_score: z.number().optional(),
    currency: optionalString,
    send_to_meta: z.boolean().optional(),
  })
  .passthrough();

export const googleSheetOwnershipSchema = z
  .object({
    assigned_agent_id: optionalString,
    assigned_agent_name: optionalString,
    updated_by: optionalString,
  })
  .passthrough();

/** Rehearsal/cutover bookkeeping. Stored on the SourceLeadEvent; never delivered live. */
export const googleSheetRehearsalSchema = z
  .object({
    rehearsal_id: optionalString,
    batch_id: optionalString,
    cutover_phase: optionalString,
    source_sheet_id: optionalString,
    source_sheet_name: optionalString,
    source_tab_name: optionalString,
    source_row_number: z.coerce.number().optional(),
    /** When true, callers expect shadow-only behavior (the default for this endpoint). */
    dry_run: z.boolean().optional(),
  })
  .passthrough();

export const googleSheetLeadSchema = z
  .object({
    schema_version: z.string().trim().min(1, "schema_version is required"),
    client_account_id: z.string().trim().min(1, "client_account_id is required"),
    subaccount_id_ghl: optionalString,
    contact: googleSheetContactSchema,
    attribution: googleSheetAttributionSchema.optional(),
    state: googleSheetStateSchema.optional(),
    event: googleSheetEventSchema.optional(),
    ownership: googleSheetOwnershipSchema.optional(),
    routing: z.record(z.unknown()).optional(),
    rehearsal: googleSheetRehearsalSchema.optional(),
    /** Original sheet row / vendor payload retained for audit. */
    raw: z.unknown().optional(),
  })
  .passthrough();

export type GoogleSheetLeadPayload = z.infer<typeof googleSheetLeadSchema>;
