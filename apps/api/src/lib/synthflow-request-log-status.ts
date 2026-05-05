/**
 * Canonical processingStatus for SynthflowRequestLog rows (dashboard-friendly).
 * Maps raw `metadata.lookup_status` from the Synthflow-shaped response.
 */
export type SynthflowLogProcessingStatus =
  | "received"
  | "validation_failed"
  | "matched_local"
  | "matched_ghl"
  | "not_found"
  | "not_found_local"
  | "lookup_error"
  | "guardrail"
  | "failed";

export function deriveSynthflowProcessingStatus(rawLookupStatus: string): SynthflowLogProcessingStatus {
  const ls = rawLookupStatus.trim();
  switch (ls) {
    case "matched_local":
      return "matched_local";
    case "matched_ghl":
      return "matched_ghl";
    case "not_found":
      return "not_found";
    case "not_found_local":
      return "not_found_local";
    case "lookup_error":
      return "lookup_error";
    case "invalid_payload":
      return "validation_failed";
    case "internal_error":
      return "guardrail";
    case "disabled":
    case "invalid_phone":
      return "guardrail";
    case "error":
      return "failed";
    default:
      return "failed";
  }
}

/** Maps outbound-context `metadata.lookup_status` to dashboard-friendly `processingStatus`. */
export function deriveOutboundLookupProcessingStatus(rawLookupStatus: string): SynthflowLogProcessingStatus {
  const ls = rawLookupStatus.trim();
  switch (ls) {
    case "matched_composite":
    case "matched_contact_id":
    case "matched_lead_uid":
    case "matched_phone_scoped":
    case "matched_phone_global":
      return "matched_local";
    case "not_found":
      return "not_found";
    case "invalid_payload":
      return "validation_failed";
    case "disabled":
    case "invalid_phone":
      return "guardrail";
    case "internal_error":
      return "guardrail";
    default:
      return "failed";
  }
}
