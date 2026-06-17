import type {
  BulkLeadImportRowDeliveryStatus,
  BulkLeadImportRowValidationStatus,
} from "@prisma/client";

export type BulkImportRowEligibilityView = {
  id?: string;
  validationStatus: BulkLeadImportRowValidationStatus;
  sourceLeadEventId: string | null;
  excluded: boolean;
  deliveryStatus: BulkLeadImportRowDeliveryStatus;
  errorSummary?: string | null;
  blockerReasonsJson?: unknown;
};

const SIMULATION_VALIDATION_STATUSES = new Set<BulkLeadImportRowValidationStatus>([
  "eligible",
  "ready_for_simulation",
]);

const SIMULATION_DELIVERY_STATUSES = new Set<BulkLeadImportRowDeliveryStatus>([
  "pending",
  "failed",
  "simulated",
]);

export type SourceIntakeNormalizationState =
  | "ready"
  | "missing"
  | "schema_failed"
  | "persistence_failed"
  | "not_applicable";

export function isIdentityEligibleStatus(
  status: BulkLeadImportRowValidationStatus
): boolean {
  return SIMULATION_VALIDATION_STATUSES.has(status);
}

export function isIdentityEligibleRow(row: BulkImportRowEligibilityView): boolean {
  if (row.excluded) return false;
  return isIdentityEligibleStatus(row.validationStatus);
}

export function isMissingSourceEventRow(row: BulkImportRowEligibilityView): boolean {
  if (row.excluded) return false;
  return isIdentityEligibleStatus(row.validationStatus) && !row.sourceLeadEventId;
}

export function isSimulationReadyRow(row: BulkImportRowEligibilityView): boolean {
  if (row.excluded) return false;
  if (!row.sourceLeadEventId) return false;
  if (!SIMULATION_VALIDATION_STATUSES.has(row.validationStatus)) return false;
  return SIMULATION_DELIVERY_STATUSES.has(row.deliveryStatus);
}

export function resolveSourceIntakeNormalizationState(row: {
  sourceLeadEventId: string | null;
  validationStatus: BulkLeadImportRowValidationStatus;
  errorSummary?: string | null;
}): SourceIntakeNormalizationState {
  if (row.sourceLeadEventId) return "ready";
  if (row.errorSummary === "source_event_persistence_failed") return "persistence_failed";
  if (row.validationStatus === "failed") return "schema_failed";
  if (isIdentityEligibleStatus(row.validationStatus)) return "missing";
  return "not_applicable";
}

export type BulkImportEligibilitySummary = {
  totalRows: number;
  identityEligible: number;
  normalizedSourceEvents: number;
  eligibleForSimulation: number;
  normalizationFailed: number;
  missingSourceEvent: number;
  blockedIdentity: number;
  duplicateReview: number;
  mappingRequired: number;
  excluded: number;
  /** @deprecated use identityEligible */
  validIdentity: number;
};

export function summarizeBulkImportRowEligibility(
  rows: BulkImportRowEligibilityView[]
): BulkImportEligibilitySummary {
  const summary: BulkImportEligibilitySummary = {
    totalRows: rows.length,
    identityEligible: 0,
    normalizedSourceEvents: 0,
    eligibleForSimulation: 0,
    normalizationFailed: 0,
    missingSourceEvent: 0,
    blockedIdentity: 0,
    duplicateReview: 0,
    mappingRequired: 0,
    excluded: 0,
    validIdentity: 0,
  };

  for (const row of rows) {
    if (row.excluded) {
      summary.excluded++;
      continue;
    }

    if (row.sourceLeadEventId) {
      summary.normalizedSourceEvents++;
    }

    if (isSimulationReadyRow(row)) {
      summary.eligibleForSimulation++;
    }

    if (isMissingSourceEventRow(row)) {
      summary.missingSourceEvent++;
    }

    if (isIdentityEligibleRow(row)) {
      summary.identityEligible++;
      summary.validIdentity++;
    }

    switch (row.validationStatus) {
      case "identity_blocked":
        summary.blockedIdentity++;
        break;
      case "duplicate_review":
        summary.duplicateReview++;
        break;
      case "mapping_required":
        summary.mappingRequired++;
        break;
      case "failed":
        summary.normalizationFailed++;
        break;
      default:
        break;
    }
  }

  return summary;
}
