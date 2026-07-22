import { z } from "zod";
import { isLeadCaptureUuidLeadId } from "../lib/leadcapture-lead-id.js";

const uuidLeadId = z
  .string()
  .trim()
  .min(1)
  .refine((value) => isLeadCaptureUuidLeadId(value), {
    message: "lead_id must be a UUID (Next-Gen)",
  });

/**
 * Structured validation for LeadCapture Next-Gen lead-created webhooks.
 * Unknown fields are retained on the raw object; this schema only validates known keys.
 */
export const leadCaptureNextGenLeadCreatedSchema = z
  .object({
    lead_id: uuidLeadId,
    submitted_at: z.string().trim().min(1).optional(),
    first_name: z.string().optional(),
    last_name: z.string().optional(),
    email: z.string().optional(),
    phone: z.string().optional(),
    phone_number: z.string().optional(),
    state: z.string().optional(),
    parent_url: z.string().optional(),
    source_url: z.string().optional(),
    niche: z.string().optional(),
    niche_key: z.string().optional(),
    campaign_id: z.string().optional(),
    form_id: z.string().optional(),
    funnel_id: z.string().optional(),
    sa360_route_key: z.string().optional(),
    sa360_campaign_name: z.string().optional(),
    sa360_funnel_name: z.string().optional(),
    sa360_source_system: z.string().optional(),
    consent_status: z.string().optional(),
    consent_text: z.string().optional(),
    consent_timestamp: z.string().optional(),
    disclosure_text: z.string().optional(),
    disclosure_version: z.string().optional(),
    tcpa_consent: z.union([z.string(), z.boolean()]).optional(),
    trustedform_cert_url: z.string().optional(),
    leadid_token: z.string().optional(),
    leadproof_hash: z.string().optional(),
    leadproof_id: z.string().optional(),
    leadproof_url: z.string().optional(),
    verfi_proof_url: z.string().optional(),
    provider: z.string().optional(),
    schema_version: z.string().optional(),
  })
  .passthrough();

export type LeadCaptureNextGenLeadCreatedPayload = z.infer<
  typeof leadCaptureNextGenLeadCreatedSchema
>;

export const LEADCAPTURE_NEXTGEN_MAX_BODY_BYTES = 1_048_576;
