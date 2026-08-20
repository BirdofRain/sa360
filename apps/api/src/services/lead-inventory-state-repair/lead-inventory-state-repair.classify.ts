import { extractUsStateCode, isCanonicalUsStateCode } from "@sa360/shared";

export const STATE_REPAIR_CLASSIFICATIONS = [
  "REPAIRABLE_CANONICAL_STATE",
  "UNRESOLVED_INVALID_STATE",
  "CONFLICTING_STATE_EVIDENCE",
] as const;

export type StateRepairClassification = (typeof STATE_REPAIR_CLASSIFICATIONS)[number];

export const STATE_REPAIR_EVIDENCE_SOURCES = [
  "source_event_contact_state",
  "source_event_payload_state",
  "authoritative_master_row",
  "historical_master_row",
  "extract_us_state_code",
] as const;

export type StateRepairEvidenceSource = (typeof STATE_REPAIR_EVIDENCE_SOURCES)[number];

export type StateRepairEvidence = {
  source: StateRepairEvidenceSource;
  raw: string;
  resolved: string | null;
};

export type StateRepairClassificationResult = {
  classification: StateRepairClassification;
  proposedState: string | null;
  evidence: StateRepairEvidence[];
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Read contact.state / payload.state without preferring one over the other. */
export function readSourceEventStateFields(normalizedPayloadJson: unknown): {
  contactState: string | null;
  payloadState: string | null;
} {
  const payload = asRecord(normalizedPayloadJson);
  if (!payload) return { contactState: null, payloadState: null };
  const contact = asRecord(payload.contact);
  return {
    contactState: contact ? readString(contact.state) ?? readString(contact.stateCode) : null,
    payloadState: readString(payload.state) ?? readString(payload.stateCode),
  };
}

function pushEvidence(
  evidence: StateRepairEvidence[],
  source: StateRepairEvidenceSource,
  raw: string | null | undefined
): void {
  const value = raw?.trim();
  if (!value) return;
  evidence.push({
    source,
    raw: value,
    resolved: extractUsStateCode(value),
  });
}

/**
 * Classify one invalid inventory state using deterministic evidence only.
 * Multiple resolved sources must agree or the row is CONFLICTING.
 */
export function classifyInvalidInventoryState(input: {
  currentNormalizedState: string;
  contactState?: string | null;
  payloadState?: string | null;
  authoritativeMasterStateZip?: string | null;
  historicalMasterStateZip?: string | null;
}): StateRepairClassificationResult {
  const evidence: StateRepairEvidence[] = [];
  pushEvidence(evidence, "source_event_contact_state", input.contactState);
  pushEvidence(evidence, "source_event_payload_state", input.payloadState);
  pushEvidence(evidence, "authoritative_master_row", input.authoritativeMasterStateZip);
  pushEvidence(evidence, "historical_master_row", input.historicalMasterStateZip);
  pushEvidence(evidence, "extract_us_state_code", input.currentNormalizedState);

  const resolved = [
    ...new Set(
      evidence
        .map((row) => row.resolved)
        .filter((value): value is string => !!value && isCanonicalUsStateCode(value))
    ),
  ];

  if (resolved.length > 1) {
    return { classification: "CONFLICTING_STATE_EVIDENCE", proposedState: null, evidence };
  }
  if (resolved.length === 1) {
    return {
      classification: "REPAIRABLE_CANONICAL_STATE",
      proposedState: resolved[0]!,
      evidence,
    };
  }
  return { classification: "UNRESOLVED_INVALID_STATE", proposedState: null, evidence };
}
