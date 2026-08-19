import { fingerprintIdentityValue } from "../../lib/identity-fingerprint.js";
import { isAcceptDisposition } from "./aged-inventory-bulk-normalize.js";
import type { AgedBulkNormalizedRow, AgedBulkRowDisposition } from "./aged-inventory-bulk.types.js";
import {
  RECOVERY_HISTORICAL_DATE_CUT_ISO,
  type RecoveryAmbiguousReason,
  type RecoveryDecision,
  type RecoveryGrouping,
} from "./aged-inventory-bulk.types.js";

export type RecoveryIdentityHit = {
  inventoryItemId: string;
  sourceLeadEventId: string;
  sourceProvider: string;
  sourceSystem: string;
  sourceLane: string;
  phoneFingerprint: string | null;
  emailFingerprint: string | null;
};

export type RecoveryConsumerVerdict =
  | { kind: "none" }
  | { kind: "existing_consumer"; hits: RecoveryIdentityHit[] }
  | { kind: "ambiguous"; reason: RecoveryAmbiguousReason; hits: RecoveryIdentityHit[] };

export type RecoveryInvalidBucket =
  | "quarantine_identity_conflict"
  | "reject_invalid_state"
  | "reject_invalid_date"
  | "reject_invalid_name"
  | "other";

export function generatedDateIso(generatedAt: Date): string {
  return generatedAt.toISOString().slice(0, 10);
}

export function assignRecoveryGrouping(generatedAt: Date): RecoveryGrouping {
  return generatedDateIso(generatedAt) <= RECOVERY_HISTORICAL_DATE_CUT_ISO
    ? "HISTORICAL_PARSER_RECOVERY"
    : "POST_SNAPSHOT_MASTER_DELTA";
}

export function recoveryLotKey(input: {
  grouping: RecoveryGrouping;
  nicheKey: string;
  fileSha256: string;
}): string {
  const suffix =
    input.grouping === "HISTORICAL_PARSER_RECOVERY" ? "historical_parser" : "post_snapshot";
  return `lot_aged_recovery_${suffix}_${input.nicheKey}_${input.fileSha256.slice(0, 12)}`;
}

export function recoverySourceRouteKey(grouping: RecoveryGrouping, lotKey: string): string {
  return `AGED_BULK_RECOVERY::${grouping}::${lotKey}`;
}

export function recoveryFingerprints(row: Pick<AgedBulkNormalizedRow, "phoneE164" | "email">): {
  phoneFingerprint: string | null;
  emailFingerprint: string | null;
} {
  return {
    phoneFingerprint: row.phoneE164 ? fingerprintIdentityValue("phone", row.phoneE164) : null,
    emailFingerprint: row.email
      ? fingerprintIdentityValue("email", row.email.trim().toLowerCase())
      : null,
  };
}

export function invalidDispositionBucket(disposition: AgedBulkRowDisposition): RecoveryInvalidBucket {
  if (disposition === "quarantine_identity_conflict") return "quarantine_identity_conflict";
  if (disposition === "reject_invalid_state") return "reject_invalid_state";
  if (disposition === "reject_invalid_date") return "reject_invalid_date";
  if (disposition === "reject_invalid_name") return "reject_invalid_name";
  return "other";
}

function dedupeHits(hits: RecoveryIdentityHit[]): RecoveryIdentityHit[] {
  const seen = new Set<string>();
  const out: RecoveryIdentityHit[] = [];
  for (const hit of hits) {
    if (seen.has(hit.inventoryItemId)) continue;
    seen.add(hit.inventoryItemId);
    out.push(hit);
  }
  return out;
}

/**
 * Strong consumer identity: phone fingerprint and/or email fingerprint.
 * Same fingerprint across multiple inventory items is one consumer.
 * Phone pointing at one consumer and email pointing at a disjoint consumer is ambiguous.
 * Never fuzzy-matches names.
 */
export function classifyStrongConsumerIdentity(input: {
  phoneHits: RecoveryIdentityHit[];
  emailHits: RecoveryIdentityHit[];
}): RecoveryConsumerVerdict {
  const phoneHits = input.phoneHits;
  const emailHits = input.emailHits;
  if (phoneHits.length === 0 && emailHits.length === 0) return { kind: "none" };

  if (phoneHits.length > 0 && emailHits.length > 0) {
    const phoneIds = new Set(phoneHits.map((h) => h.inventoryItemId));
    const emailIds = new Set(emailHits.map((h) => h.inventoryItemId));
    const overlap = [...phoneIds].some((id) => emailIds.has(id));
    const hits = dedupeHits([...phoneHits, ...emailHits]);
    if (!overlap) {
      return { kind: "ambiguous", reason: "phone_email_diverge", hits };
    }
    return { kind: "existing_consumer", hits };
  }

  return {
    kind: "existing_consumer",
    hits: phoneHits.length > 0 ? phoneHits : emailHits,
  };
}

/**
 * Recovery file identity is derivable when the normalizer already computed a
 * sourceLeadId from name + date + phone/email. Missing name/date/identity
 * material is not reserved — do not invent an ID.
 */
export function isRecoverySourceIdentityDerivable(
  row: Pick<
    AgedBulkNormalizedRow,
    "sourceLeadId" | "firstName" | "lastName" | "phoneE164" | "email" | "generatedAt"
  >
): boolean {
  if (!row.sourceLeadId.trim()) return false;
  if (!row.firstName.trim() || !row.lastName.trim()) return false;
  if (!row.phoneE164 && !row.email) return false;
  if (Number.isNaN(row.generatedAt.getTime()) || row.generatedAt.getTime() === 0) return false;
  return generatedDateIso(row.generatedAt) !== "1970-01-01";
}

export type RecoveryFileOccurrence = "FILE_DUPLICATE" | "FIRST_OCCURRENCE" | "NOT_DERIVABLE";

/**
 * First deterministic sourceLeadId in this file owns that identity regardless
 * of disposition. Later same-ID rows are FILE_DUPLICATE.
 */
export function claimRecoverySourceLeadId(
  seen: Set<string>,
  row: Pick<
    AgedBulkNormalizedRow,
    "sourceLeadId" | "firstName" | "lastName" | "phoneE164" | "email" | "generatedAt"
  >
): RecoveryFileOccurrence {
  if (!isRecoverySourceIdentityDerivable(row)) return "NOT_DERIVABLE";
  if (seen.has(row.sourceLeadId)) return "FILE_DUPLICATE";
  seen.add(row.sourceLeadId);
  return "FIRST_OCCURRENCE";
}

export function classifyRecoveryRowDecision(input: {
  row: AgedBulkNormalizedRow;
  exactSourceExists: boolean;
  consumer: RecoveryConsumerVerdict;
  sameFileSourceAlreadySeen?: boolean;
}): RecoveryDecision {
  if (input.sameFileSourceAlreadySeen) return "FILE_DUPLICATE";
  if (input.row.disposition === "exact_source_duplicate") return "FILE_DUPLICATE";
  if (!isAcceptDisposition(input.row.disposition)) return "INVALID";
  if (input.exactSourceExists) return "EXISTING_EXACT";
  if (input.consumer.kind === "existing_consumer") return "EXISTING_CONSUMER";
  if (input.consumer.kind === "ambiguous") return "AMBIGUOUS";
  return "RECOVERY_CANDIDATE";
}

export function sourceMatchKey(hit: Pick<RecoveryIdentityHit, "sourceProvider" | "sourceSystem" | "sourceLane">): string {
  return `${hit.sourceProvider}/${hit.sourceSystem}/${hit.sourceLane}`;
}
