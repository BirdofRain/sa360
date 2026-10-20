/**
 * Operator view of the read-only ownership catalog and preview.
 * Unknown payload keys are dropped. Confirmation is not represented here.
 */

export const HISTORICAL_OWNERSHIP_CONTRACT_ID = "historical-campaign-association-v1" as const;
export const PROTECTED_RESERVATION_ORDER_NUMBER = "LO-1053" as const;

const CONFLICTS = new Set(["none", "duplicate_proposal", "existing_other_origin", "conflicting_label_evidence"]);
const SCOPE_CONFLICTS = new Set(["none", "multiple_counterpart_scopes", "registry_disagreement"]);

export type CatalogCampaignView = {
  displayLabel: string;
  normalizedLabel: string;
  lotKey: string;
  importRequest: string;
  nicheKey: string;
  inventoryRows: number;
  availableRows: number;
  reservedRows: number;
  conflictingAttributionRows: number;
  stampedOriginRows: number;
  distinctOriginCount: number;
  originConflict: boolean;
  whitespaceVariantCount: number;
  lotAliasStatus: string;
  importAliasStatus: string;
  lotConfirmedOriginClientAccountId: string | null;
  importConfirmedOriginClientAccountId: string | null;
  persistedDecision: "eligible" | "not_eligible";
  persistedReason: string;
  persistedOriginClientAccountId: string | null;
};

export type CatalogView = {
  page: number;
  pageSize: number;
  totalCampaigns: number;
  missingLabelRows: number;
  conflictingLabelRows: number;
  campaigns: CatalogCampaignView[];
};

export type PreviewProposalView = {
  normalizedLabel: string;
  originClientAccountId: string;
  lotKey: string | null;
  importRequest: string | null;
  inventoryRows: number;
  availableRows: number;
  reservedRows: number;
  missingLabelRows: number;
  alreadyStampedToSameClient: number;
  alreadyStampedToOtherClient: number;
  conflictingLabelRows: number;
  ambiguous: boolean;
  conflict: string;
  scopeConflict: string;
  duplicateProposal: boolean;
  verificationStatus: "UNVERIFIED";
  persistedDecision: string;
  persistedReason: string;
  persistedOriginClientAccountId: string | null;
  hypotheticalDecision: string;
  hypotheticalReason: string;
  hypotheticalOriginClientAccountId: string | null;
  hypotheticalRejection: string | null;
  rowsThatWouldExcludeProposedClientAsBuyer: number;
  rowsAlreadyStampedToProposedClient: number;
  reservedOrCommittedAllocationsToProposedClient: number;
  lo1053ReservedAllocations: number;
};

export type PreviewView = {
  verificationStatus: "UNVERIFIED";
  stampApplied: false;
  resaleAuthorizationApplied: false;
  registryRowsWritten: false;
  inventoryRowsWritten: false;
  scopeMode: string;
  scopeKey: string;
  unlabeledRowsInSelectedScopes: number;
  lo1053ReservedAllocations: number;
  proposals: PreviewProposalView[];
};

export type OwnershipWorkbenchResult =
  | { state: "ready"; catalog?: CatalogView; preview?: PreviewView }
  | { state: "disabled" | "invalid" | "unavailable"; code: string };

type AdminResult = { ok: true; data: unknown } | { ok: false; status: number; body: string };

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function str(value: unknown, max = 2_000): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= max ? value : null;
}

function nullableId(value: unknown): string | null | undefined {
  if (value == null) return null;
  if (typeof value !== "string" || value.length < 1 || value.length > 128 || /\s/.test(value)) return undefined;
  return value;
}

const READ_FAILURE_REASONS = new Set(["statement_timeout", "shape_invalid", "snapshot_failed"]);

function codeFromFailure(result: { status: number; body: string }, fallback: string): OwnershipWorkbenchResult {
  let code = fallback;
  let reason: string | null = null;
  try {
    const parsed = JSON.parse(result.body) as { code?: unknown; reason?: unknown };
    if (typeof parsed.code === "string" && /^[a-z0-9_]{1,80}$/.test(parsed.code)) code = parsed.code;
    if (typeof parsed.reason === "string" && READ_FAILURE_REASONS.has(parsed.reason)) reason = parsed.reason;
  } catch {
    code = fallback;
  }
  if (reason && code.endsWith("_unavailable")) code = reason;
  if (code === "historical_campaign_association_disabled" || result.status === 404 && code === fallback) {
    return { state: "disabled", code: "historical_campaign_association_disabled" };
  }
  if (result.status === 400) return { state: "invalid", code };
  return { state: "unavailable", code };
}

export function ownershipWorkbenchNotice(code: string): string {
  if (code === "historical_campaign_association_disabled") {
    return "The ownership workbench is off. Set SA360_HISTORICAL_CAMPAIGN_ASSOCIATION_ENABLED=true on the API. No campaign labels are loaded.";
  }
  if (code === "historical_campaign_catalog_scope_required") {
    return "Enter an inventory lot or an import request before searching.";
  }
  if (code === "origin_client_not_found") return "Choose a ClientAccount that already exists.";
  if (code === "mapping_rejected") return "The mapping file was rejected. Remove contact fields and try again.";
  if (code === "historical_ownership_confirmation_not_available") {
    return "Ownership confirmation is not available in this workbench.";
  }
  if (code === "historical_ownership_preview_invalid" || code === "historical_campaign_catalog_invalid") {
    return "The request was rejected. Nothing was written.";
  }
  if (code === "statement_timeout") {
    return "The read exceeded the 20 second limit and was cancelled. Nothing was written.";
  }
  return "The read could not be completed. Nothing was written.";
}

function campaignView(value: unknown): CatalogCampaignView | null {
  const row = record(value);
  if (!row) return null;
  const displayLabel = str(row.displayLabel);
  const normalizedLabel = str(row.normalizedLabel);
  const lotKey = str(row.lotKey);
  const importRequest = str(row.importRequest);
  const nicheKey = str(row.nicheKey);
  const inventoryRows = num(row.inventoryRows);
  const availableRows = num(row.availableRows);
  const reservedRows = num(row.reservedRows);
  const conflictingAttributionRows = num(row.conflictingAttributionRows);
  const stampedOriginRows = num(row.stampedOriginRows);
  const distinctOriginCount = num(row.distinctOriginCount);
  const whitespaceVariantCount = num(row.whitespaceVariantCount);
  const lotAliasStatus = str(row.lotAliasStatus);
  const importAliasStatus = str(row.importAliasStatus);
  const persistedDecision = row.persistedDecision === "eligible" || row.persistedDecision === "not_eligible"
    ? row.persistedDecision
    : null;
  const persistedReason = str(row.persistedReason);
  const lotOrigin = nullableId(row.lotConfirmedOriginClientAccountId);
  const importOrigin = nullableId(row.importConfirmedOriginClientAccountId);
  const persistedOrigin = nullableId(row.persistedOriginClientAccountId);
  if (
    !displayLabel ||
    !normalizedLabel ||
    !lotKey ||
    !importRequest ||
    !nicheKey ||
    inventoryRows == null ||
    availableRows == null ||
    reservedRows == null ||
    conflictingAttributionRows == null ||
    stampedOriginRows == null ||
    distinctOriginCount == null ||
    whitespaceVariantCount == null ||
    !lotAliasStatus ||
    !importAliasStatus ||
    !persistedDecision ||
    !persistedReason ||
    lotOrigin === undefined ||
    importOrigin === undefined ||
    persistedOrigin === undefined
  ) {
    return null;
  }
  return {
    displayLabel,
    normalizedLabel,
    lotKey,
    importRequest,
    nicheKey,
    inventoryRows,
    availableRows,
    reservedRows,
    conflictingAttributionRows,
    stampedOriginRows,
    distinctOriginCount,
    originConflict: row.originConflict === true || distinctOriginCount > 1,
    whitespaceVariantCount,
    lotAliasStatus,
    importAliasStatus,
    lotConfirmedOriginClientAccountId: lotOrigin,
    importConfirmedOriginClientAccountId: importOrigin,
    persistedDecision,
    persistedReason,
    persistedOriginClientAccountId: persistedOrigin,
  };
}

export function catalogViewFromAdminResult(result: AdminResult): { status: number; body: OwnershipWorkbenchResult } {
  if (!result.ok) return { status: result.status || 503, body: codeFromFailure(result, "historical_campaign_catalog_unavailable") };
  const payload = record(result.data);
  const campaigns = Array.isArray(payload?.campaigns) ? payload.campaigns.map(campaignView) : null;
  const scope = record(payload?.scopeAttribution);
  if (
    !payload ||
    payload.ok !== true ||
    payload.contractId !== HISTORICAL_OWNERSHIP_CONTRACT_ID ||
    payload.registryRowsWritten !== false ||
    payload.inventoryRowsWritten !== false ||
    !campaigns ||
    campaigns.some((row) => row == null) ||
    num(payload.page) == null ||
    num(payload.pageSize) == null ||
    num(payload.totalCampaigns) == null ||
    !scope ||
    num(scope.missingLabelRows) == null ||
    num(scope.conflictingLabelRows) == null
  ) {
    return { status: 503, body: { state: "unavailable", code: "historical_campaign_catalog_unavailable" } };
  }
  return {
    status: 200,
    body: {
      state: "ready",
      catalog: {
        page: num(payload.page) ?? 1,
        pageSize: num(payload.pageSize) ?? 25,
        totalCampaigns: num(payload.totalCampaigns) ?? 0,
        missingLabelRows: num(scope.missingLabelRows) ?? 0,
        conflictingLabelRows: num(scope.conflictingLabelRows) ?? 0,
        campaigns: campaigns.filter((row): row is CatalogCampaignView => row != null),
      },
    },
  };
}

function proposalView(value: unknown): PreviewProposalView | null {
  const row = record(value);
  const persisted = record(row?.persisted);
  const hypothetical = record(row?.hypothetical);
  const exclusion = record(row?.exclusionImpact);
  const reservation = record(row?.protectedReservation);
  if (!row || !persisted || !hypothetical || !exclusion || !reservation) return null;
  const conflict = str(row.conflict);
  const scopeConflict = str(row.scopeConflict);
  const normalizedLabel = str(row.normalizedLabel);
  const originClientAccountId = str(row.originClientAccountId, 128);
  const lotKey = row.lotKey == null ? null : str(row.lotKey);
  const importRequest = row.importRequest == null ? null : str(row.importRequest);
  const persistedOrigin = nullableId(persisted.originClientAccountId);
  const hypotheticalOrigin = nullableId(hypothetical.originClientAccountId);
  const rejection = hypothetical.rejection == null ? null : str(hypothetical.rejection);
  if (
    !normalizedLabel ||
    !originClientAccountId ||
    (row.lotKey != null && !lotKey) ||
    (row.importRequest != null && !importRequest) ||
    !conflict ||
    !CONFLICTS.has(conflict) ||
    !scopeConflict ||
    !SCOPE_CONFLICTS.has(scopeConflict) ||
    num(row.inventoryRows) == null ||
    num(row.availableRows) == null ||
    num(row.reservedRows) == null ||
    num(row.missingLabelRows) == null ||
    num(row.alreadyStampedToSameClient) == null ||
    num(row.alreadyStampedToOtherClient) == null ||
    num(row.conflictingLabelRows) == null ||
    typeof row.ambiguous !== "boolean" ||
    typeof row.duplicateProposal !== "boolean" ||
    row.verificationStatus !== "UNVERIFIED" ||
    !str(persisted.decision) ||
    !str(persisted.reason) ||
    persistedOrigin === undefined ||
    !str(hypothetical.decision) ||
    !str(hypothetical.reason) ||
    hypotheticalOrigin === undefined ||
    (hypothetical.rejection != null && !rejection) ||
    hypothetical.registryWritePerformed !== false ||
    num(exclusion.rowsThatWouldExcludeProposedClientAsBuyer) == null ||
    num(exclusion.rowsAlreadyStampedToProposedClient) == null ||
    num(exclusion.reservedOrCommittedAllocationsToProposedClient) == null ||
    exclusion.selectionUnchanged !== true ||
    reservation.orderNumber !== PROTECTED_RESERVATION_ORDER_NUMBER ||
    reservation.modified !== false ||
    num(reservation.reservedAllocationsAffected) == null
  ) {
    return null;
  }
  return {
    normalizedLabel,
    originClientAccountId,
    lotKey,
    importRequest,
    inventoryRows: num(row.inventoryRows) ?? 0,
    availableRows: num(row.availableRows) ?? 0,
    reservedRows: num(row.reservedRows) ?? 0,
    missingLabelRows: num(row.missingLabelRows) ?? 0,
    alreadyStampedToSameClient: num(row.alreadyStampedToSameClient) ?? 0,
    alreadyStampedToOtherClient: num(row.alreadyStampedToOtherClient) ?? 0,
    conflictingLabelRows: num(row.conflictingLabelRows) ?? 0,
    ambiguous: row.ambiguous,
    conflict,
    scopeConflict,
    duplicateProposal: row.duplicateProposal,
    verificationStatus: "UNVERIFIED",
    persistedDecision: str(persisted.decision) ?? "",
    persistedReason: str(persisted.reason) ?? "",
    persistedOriginClientAccountId: persistedOrigin,
    hypotheticalDecision: str(hypothetical.decision) ?? "",
    hypotheticalReason: str(hypothetical.reason) ?? "",
    hypotheticalOriginClientAccountId: hypotheticalOrigin,
    hypotheticalRejection: rejection,
    rowsThatWouldExcludeProposedClientAsBuyer: num(exclusion.rowsThatWouldExcludeProposedClientAsBuyer) ?? 0,
    rowsAlreadyStampedToProposedClient: num(exclusion.rowsAlreadyStampedToProposedClient) ?? 0,
    reservedOrCommittedAllocationsToProposedClient:
      num(exclusion.reservedOrCommittedAllocationsToProposedClient) ?? 0,
    lo1053ReservedAllocations: num(reservation.reservedAllocationsAffected) ?? 0,
  };
}

export function previewViewFromAdminResult(result: AdminResult): { status: number; body: OwnershipWorkbenchResult } {
  if (!result.ok) {
    return { status: result.status || 503, body: codeFromFailure(result, "historical_ownership_preview_unavailable") };
  }
  const payload = record(result.data);
  const proposals = Array.isArray(payload?.proposals) ? payload.proposals.map(proposalView) : null;
  const reservation = record(payload?.protectedReservation);
  if (
    !payload ||
    payload.ok !== true ||
    payload.contractId !== HISTORICAL_OWNERSHIP_CONTRACT_ID ||
    payload.stampApplied !== false ||
    payload.resaleAuthorizationApplied !== false ||
    payload.clientNameMatchEstablishesOwnership !== false ||
    payload.registryRowsWritten !== false ||
    payload.inventoryRowsWritten !== false ||
    payload.verificationStatus !== "UNVERIFIED" ||
    !str(payload.scopeMode) ||
    !str(payload.scopeKey) ||
    num(payload.unlabeledRowsInSelectedScopes) == null ||
    !reservation ||
    reservation.orderNumber !== PROTECTED_RESERVATION_ORDER_NUMBER ||
    reservation.modified !== false ||
    num(reservation.reservedAllocationsAffected) == null ||
    !proposals ||
    proposals.some((row) => row == null)
  ) {
    return { status: 503, body: { state: "unavailable", code: "historical_ownership_preview_unavailable" } };
  }
  return {
    status: 200,
    body: {
      state: "ready",
      preview: {
        verificationStatus: "UNVERIFIED",
        stampApplied: false,
        resaleAuthorizationApplied: false,
        registryRowsWritten: false,
        inventoryRowsWritten: false,
        scopeMode: str(payload.scopeMode) ?? "",
        scopeKey: str(payload.scopeKey) ?? "",
        unlabeledRowsInSelectedScopes: num(payload.unlabeledRowsInSelectedScopes) ?? 0,
        lo1053ReservedAllocations: num(reservation.reservedAllocationsAffected) ?? 0,
        proposals: proposals.filter((row): row is PreviewProposalView => row != null),
      },
    },
  };
}

export function campaignSelectionKey(row: {
  lotKey: string;
  importRequest: string;
  normalizedLabel: string;
}): string {
  return `${row.lotKey}\n${row.importRequest}\n${row.normalizedLabel}`;
}
