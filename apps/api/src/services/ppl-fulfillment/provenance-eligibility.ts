/**
 * Canonical PPL provenance eligibility.
 *
 * Unresolved-origin `manual_import` / `csv_import` inventory stays ineligible
 * until a persisted origin ClientAccount or an explicitly supplied verified
 * acquisition id exists. Campaign labels, `exclusive`, Used By, acquisition
 * cost, and a null origin are not acquisition evidence and are not read here.
 *
 * A confirmed origin is eligible for buyers other than that origin. Same-origin
 * exclusion stays in `isOriginClientBuyerIneligible`. Null-origin LeadCapture
 * remains eligible; every other null-origin provider fails closed.
 */
import { SOURCE_FUNNEL_LEADCAPTURE_PROVIDER } from "../source-intake/source-funnel.service.js";

export const PPL_PROVENANCE_ELIGIBILITY_POLICY_ID = "ppl-provenance-eligibility-v1";

/** Source system written by the aged bulk CSV importer. Not a LeadCapture feed. */
export const CSV_IMPORT_SOURCE_SYSTEM = "csv_import";

export type ProvenanceEligibilityCode =
  | "eligible_confirmed_origin"
  | "eligible_verified_acquisition"
  | "eligible_leadcapture_unstamped"
  | "unresolved_origin";

export type ProvenanceEligibilityDecision = {
  eligible: boolean;
  code: ProvenanceEligibilityCode;
  policyId: typeof PPL_PROVENANCE_ELIGIBILITY_POLICY_ID;
};

export type ProvenanceEligibilityInput = {
  originClientAccountId?: string | null;
  itemSourceProvider?: string | null;
  eventSourceProvider?: string | null;
  eventSourceSystem?: string | null;
  /**
   * Id of an already verified acquisition record. Callers must pass null
   * unless that record exists. This function never invents one.
   */
  verifiedAcquisitionEvidenceId?: string | null;
};

function present(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function evaluateProvenanceEligibility(
  input: ProvenanceEligibilityInput
): ProvenanceEligibilityDecision {
  const policyId = PPL_PROVENANCE_ELIGIBILITY_POLICY_ID;
  if (present(input.verifiedAcquisitionEvidenceId)) {
    return { eligible: true, code: "eligible_verified_acquisition", policyId };
  }
  if (present(input.originClientAccountId)) {
    return { eligible: true, code: "eligible_confirmed_origin", policyId };
  }

  const sourceSystem = present(input.eventSourceSystem);
  if (sourceSystem === CSV_IMPORT_SOURCE_SYSTEM) {
    return { eligible: false, code: "unresolved_origin", policyId };
  }

  const providers = [present(input.itemSourceProvider), present(input.eventSourceProvider)].filter(
    (provider): provider is string => provider != null
  );
  if (
    providers.length > 0 &&
    providers.every((provider) => provider === SOURCE_FUNNEL_LEADCAPTURE_PROVIDER)
  ) {
    return { eligible: true, code: "eligible_leadcapture_unstamped", policyId };
  }
  return { eligible: false, code: "unresolved_origin", policyId };
}
