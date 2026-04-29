import { InboundContactClientStatus } from "@prisma/client";
import type { LifecycleEventSchema } from "../schemas/lifecycle-event.schema.js";
import type { GhlContactSearchSummary } from "../services/ghl-contact-search.service.js";

/**
 * Conservative `clientStatus` rules for `InboundContactIndex`.
 *
 * ## Strength order (promotion only)
 * `EXISTING_CLIENT` (3) > `UNKNOWN` (2) > `LEAD` (1)
 *
 * ## Promotion to `EXISTING_CLIENT` (same rule for lifecycle + GHL)
 * Only when `policy_status` / `policyStatus` is a **non-empty string** after trim and its lowercased value is **not**
 * one of: `none`, `n/a`, `null`, `unknown`.
 * No other lifecycle/GHL fields are used for this promotion (keeps heuristics minimal).
 *
 * ## `UNKNOWN` (lifecycle only)
 * When `dead_lead_flag === true` on the lifecycle payload, status is `UNKNOWN` (ambiguous / not a normal active lead).
 * GHL responses do **not** set `UNKNOWN` from heuristics — only the above promotion or merge applies.
 *
 * ## Default
 * Otherwise `LEAD` for lifecycle-derived rows. GHL-derived **opinion** uses `null` internally meaning “no new
 * evidence”; see `mergeClientStatusPreferStronger` / `resolveClientStatusAfterGhlEvidence`.
 *
 * ## Downgrades
 * **None.** A stored `EXISTING_CLIENT` or `UNKNOWN` is never replaced by `LEAD` from a later ambiguous payload.
 * Merges only allow **promotions** (higher rank) or ties that **keep the existing** value.
 */

function rank(s: InboundContactClientStatus | null | undefined): number {
  if (s === InboundContactClientStatus.EXISTING_CLIENT) {
    return 3;
  }
  if (s === InboundContactClientStatus.UNKNOWN) {
    return 2;
  }
  if (s === InboundContactClientStatus.LEAD) {
    return 1;
  }
  return 0;
}

function isStrongPolicyEvidence(policyRaw: string | null | undefined): boolean {
  if (policyRaw === null || policyRaw === undefined) {
    return false;
  }
  const t = String(policyRaw).trim().toLowerCase();
  if (!t || t === "none" || t === "n/a" || t === "null" || t === "unknown") {
    return false;
  }
  return true;
}

export function deriveClientStatusFromLifecyclePayload(
  payload: LifecycleEventSchema
): InboundContactClientStatus {
  if (payload.state.dead_lead_flag === true) {
    return InboundContactClientStatus.UNKNOWN;
  }
  if (isStrongPolicyEvidence(payload.state.policy_status)) {
    return InboundContactClientStatus.EXISTING_CLIENT;
  }
  return InboundContactClientStatus.LEAD;
}

/**
 * Returns an opinionated status from GHL evidence, or `null` when GHL provides **no** policy signal
 * (caller should keep the existing DB value for `clientStatus` in that case).
 */
export function deriveClientStatusFromGhlSummary(
  g: GhlContactSearchSummary
): InboundContactClientStatus | null {
  if (isStrongPolicyEvidence(g.policyStatus)) {
    return InboundContactClientStatus.EXISTING_CLIENT;
  }
  return null;
}

/**
 * Merge incoming derived status with an existing row: **promotions only** (or keep existing on tie / stronger existing).
 */
export function mergeClientStatusPreferStronger(
  existing: InboundContactClientStatus | null | undefined,
  derived: InboundContactClientStatus
): InboundContactClientStatus {
  const re = rank(existing);
  const rd = rank(derived);
  if (rd > re) {
    return derived;
  }
  if (existing !== null && existing !== undefined) {
    return existing;
  }
  return derived;
}

export function resolveClientStatusAfterGhlEvidence(
  existing: InboundContactClientStatus | null | undefined,
  g: GhlContactSearchSummary
): InboundContactClientStatus {
  const fromGhl = deriveClientStatusFromGhlSummary(g);
  if (fromGhl === null) {
    return existing ?? InboundContactClientStatus.LEAD;
  }
  return mergeClientStatusPreferStronger(existing, fromGhl);
}

export function formatClientStatusForSynthflow(
  s: InboundContactClientStatus | null | undefined
): string {
  if (!s) {
    return "";
  }
  return s;
}
