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
 * Treat JSON `null` as semantic absence for optional LeadCapture provider fields.
 * Validation only — callers must persist the original request body, not this output.
 */
export function nullAsAbsent<Schema extends z.ZodTypeAny>(schema: Schema) {
  return z.preprocess((value) => (value === null ? undefined : value), schema);
}

const optionalProviderString = nullAsAbsent(z.string().optional());

/**
 * Structured validation for LeadCapture Next-Gen lead-created webhooks.
 * Unknown fields are retained on the raw object; this schema only validates known keys.
 *
 * Field classes:
 * - REQUIRED / STRUCTURALLY STRICT: `lead_id` (UUID). null / missing / empty / non-UUID fail.
 * - OPTIONAL PROVIDER VALUE: known strings (and `tcpa_consent`) where JSON null means empty.
 * - NESTED OBJECT: `lead_proof` stays an optional object. Provider evidence shows a populated
 *   Nurse object or omission — not `lead_proof: null` — so the object itself is not nullable.
 *   Nested proof strings may be null-as-absent. Wrong non-null types still fail.
 *
 * Known Madison/Nurse fields deliberately left untyped (passthrough) so mixed
 * string/boolean provider values such as `is_partial_lead` and `email_verified`
 * are not newly constrained: ip_address, user_agent, campaign extras, sales
 * questions, fbc/fbp, phone_verified, email_verified, is_partial_lead, etc.
 */
export const leadCaptureNextGenLeadCreatedSchema = z
  .object({
    lead_id: uuidLeadId,
    submitted_at: nullAsAbsent(z.string().trim().min(1).optional()),
    first_name: optionalProviderString,
    last_name: optionalProviderString,
    email: optionalProviderString,
    phone: optionalProviderString,
    phone_number: optionalProviderString,
    state: optionalProviderString,
    parent_url: optionalProviderString,
    source_url: optionalProviderString,
    niche: optionalProviderString,
    niche_key: optionalProviderString,
    campaign_id: optionalProviderString,
    campaign_name: optionalProviderString,
    form_id: optionalProviderString,
    form_name: optionalProviderString,
    funnel_id: optionalProviderString,
    funnel_name: optionalProviderString,
    sa360_form_id: optionalProviderString,
    sa360_route_key: optionalProviderString,
    sa360_campaign_name: optionalProviderString,
    sa360_funnel_name: optionalProviderString,
    sa360_source_system: optionalProviderString,
    consent_status: optionalProviderString,
    consent_text: optionalProviderString,
    consent_timestamp: optionalProviderString,
    disclosure_text: optionalProviderString,
    disclosure_version: optionalProviderString,
    tcpa_consent: nullAsAbsent(z.union([z.string(), z.boolean()]).optional()),
    trustedform_cert_url: optionalProviderString,
    leadid_token: optionalProviderString,
    leadproof_hash: optionalProviderString,
    leadproof_id: optionalProviderString,
    leadproof_url: optionalProviderString,
    verfi_proof_url: optionalProviderString,
    lead_proof: z
      .object({
        proof_url: optionalProviderString,
        integrity_hash: optionalProviderString,
        verification_key: optionalProviderString,
      })
      .passthrough()
      .optional(),
    provider: optionalProviderString,
    schema_version: optionalProviderString,
  })
  .passthrough();

export type LeadCaptureNextGenLeadCreatedPayload = z.infer<
  typeof leadCaptureNextGenLeadCreatedSchema
>;

export const LEADCAPTURE_NEXTGEN_MAX_BODY_BYTES = 1_048_576;
