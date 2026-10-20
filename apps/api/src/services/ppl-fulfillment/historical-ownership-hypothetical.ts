/**
 * In-memory mirror of `historical_campaign_ownership_decision`.
 *
 * This is a preview of what confirmation would mean. It is not the write gate.
 * A later confirmation PR must call the SQL function after a real registry
 * write. Do not insert a temporary alias to evaluate this result.
 */

export const OWNERSHIP_ALIAS_STATUSES = [
  "absent",
  "missing_scope",
  "unassigned",
  "suggested",
  "conflicted",
  "confirmed",
  "retired",
] as const;

export type OwnershipAliasStatus = (typeof OWNERSHIP_ALIAS_STATUSES)[number];

export type OwnershipAliasView = {
  status: OwnershipAliasStatus;
  originClientAccountId: string | null;
};

export type OwnershipDecisionView = {
  decision: "eligible" | "not_eligible";
  reason: string;
  originClientAccountId: string | null;
  lotStatus: OwnershipAliasStatus;
  importStatus: OwnershipAliasStatus;
};

const OPEN_COVERAGE = new Set<OwnershipAliasStatus>(["absent", "retired", "missing_scope"]);

export function absentAlias(): OwnershipAliasView {
  return { status: "absent", originClientAccountId: null };
}

export function isOwnershipAliasStatus(value: string): value is OwnershipAliasStatus {
  return (OWNERSHIP_ALIAS_STATUSES as readonly string[]).includes(value);
}

/**
 * Same branch order as the SQL function. An origin id is returned only when
 * the decision is eligible.
 */
export function ownershipDecisionFromAliases(
  lot: OwnershipAliasView,
  importScope: OwnershipAliasView
): OwnershipDecisionView {
  let decision: "eligible" | "not_eligible" = "not_eligible";
  let reason = "no_coverage";
  let origin: string | null = null;
  const lotOrigin = lot.status === "confirmed" ? lot.originClientAccountId : null;
  const importOrigin = importScope.status === "confirmed" ? importScope.originClientAccountId : null;

  if (lot.status === "missing_scope" && importScope.status === "missing_scope") {
    reason = "fail_closed_missing_scope";
  } else if (lot.status === "conflicted" || importScope.status === "conflicted") {
    reason = "fail_closed_conflicted";
  } else if (lot.status === "confirmed" && importScope.status === "confirmed") {
    if (lotOrigin && lotOrigin === importOrigin) {
      decision = "eligible";
      reason = "eligible_scopes_agree";
      origin = lotOrigin;
    } else {
      reason = "fail_closed_conflicting_clients";
    }
  } else if (lot.status === "confirmed" && OPEN_COVERAGE.has(importScope.status)) {
    decision = "eligible";
    reason = "eligible_lot_only";
    origin = lotOrigin;
  } else if (importScope.status === "confirmed" && OPEN_COVERAGE.has(lot.status)) {
    decision = "eligible";
    reason = "eligible_import_request_only";
    origin = importOrigin;
  } else if (lot.status === "confirmed" || importScope.status === "confirmed") {
    reason = "fail_closed_ambiguous";
  } else if (
    (lot.status === "unassigned" || lot.status === "suggested") &&
    (importScope.status === "unassigned" || importScope.status === "suggested")
  ) {
    reason = "fail_closed_ambiguous";
  } else if (
    lot.status === "unassigned" ||
    lot.status === "suggested" ||
    importScope.status === "unassigned" ||
    importScope.status === "suggested"
  ) {
    reason = "suggestion_is_not_ownership";
  } else {
    reason = "no_coverage";
  }

  if (decision === "eligible" && (!origin || origin.trim().length === 0)) {
    decision = "not_eligible";
    reason = "fail_closed_incomplete_origin";
    origin = null;
  }

  return {
    decision,
    reason,
    originClientAccountId: decision === "eligible" ? origin : null,
    lotStatus: lot.status,
    importStatus: importScope.status,
  };
}

export type HypotheticalRejection =
  | "confirmation_would_be_rejected"
  | "existing_other_origin"
  | "duplicate_proposal";

export type HypotheticalOwnership = {
  source: "hypothetical_not_persisted";
  registryWritePerformed: false;
  decision: "eligible" | "not_eligible";
  reason: string;
  originClientAccountId: string | null;
  lotStatus: OwnershipAliasStatus;
  importStatus: OwnershipAliasStatus;
  rejection: HypotheticalRejection | null;
};

function projectScope(
  current: OwnershipAliasView,
  proposedClientId: string
): { next: OwnershipAliasView; rejection: HypotheticalRejection | null } {
  if (current.status === "missing_scope") return { next: current, rejection: null };
  if (current.status === "conflicted" || current.status === "retired") {
    return { next: current, rejection: "confirmation_would_be_rejected" };
  }
  if (current.status === "confirmed") {
    const origin = current.originClientAccountId?.trim() || "";
    if (origin !== proposedClientId) return { next: current, rejection: "existing_other_origin" };
    return { next: current, rejection: null };
  }
  if (current.status === "absent" || current.status === "unassigned" || current.status === "suggested") {
    return {
      next: { status: "confirmed", originClientAccountId: proposedClientId },
      rejection: null,
    };
  }
  return { next: current, rejection: "confirmation_would_be_rejected" };
}

/**
 * Projects confirming both present scopes to the proposed client.
 * Conflicted, retired, and confirmed-to-someone-else stay not eligible.
 * Absent, unassigned, and suggested scopes become confirmed only in this object.
 */
export function hypotheticalOwnershipConfirmation(input: {
  lot: OwnershipAliasView;
  importScope: OwnershipAliasView;
  proposedOriginClientAccountId: string;
  duplicateProposal?: boolean;
}): HypotheticalOwnership {
  if (input.duplicateProposal) {
    return {
      source: "hypothetical_not_persisted",
      registryWritePerformed: false,
      decision: "not_eligible",
      reason: "duplicate_proposal",
      originClientAccountId: null,
      lotStatus: input.lot.status,
      importStatus: input.importScope.status,
      rejection: "duplicate_proposal",
    };
  }

  const proposed = input.proposedOriginClientAccountId.trim();
  const lot = projectScope(input.lot, proposed);
  const importScope = projectScope(input.importScope, proposed);
  const rejection = lot.rejection ?? importScope.rejection;
  if (rejection) {
    return {
      source: "hypothetical_not_persisted",
      registryWritePerformed: false,
      decision: "not_eligible",
      reason: rejection,
      originClientAccountId: null,
      lotStatus: input.lot.status,
      importStatus: input.importScope.status,
      rejection,
    };
  }

  const decision = ownershipDecisionFromAliases(lot.next, importScope.next);
  return {
    source: "hypothetical_not_persisted",
    registryWritePerformed: false,
    decision: decision.decision,
    reason: decision.reason,
    originClientAccountId: decision.originClientAccountId,
    lotStatus: decision.lotStatus,
    importStatus: decision.importStatus,
    rejection: null,
  };
}
