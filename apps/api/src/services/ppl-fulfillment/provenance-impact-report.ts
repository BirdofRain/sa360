import { PPL_PROVENANCE_ELIGIBILITY_POLICY_ID } from "./provenance-eligibility.js";
import {
  PROVENANCE_AUDIT_OPEN_ALLOCATION_STATUSES,
  formatPercentBlocked,
} from "./provenance-impact-query.js";

export const PROVENANCE_IMPACT_UNAVAILABLE = "provenance_impact_unavailable" as const;

export type ProvenanceBreakdown = {
  key: string;
  before: number;
  blocked: number;
  remaining: number;
};

export type BlockedRecoveryRow = {
  key: string;
  blocked: number;
  consistentOriginalLabel: number;
  missingCampaignLabel: number;
  conflictingCampaignEvidence: number;
  furtherAuthorizationRequired: number;
};

/**
 * Three separate facts. A completed snapshot and the PostgreSQL identity do
 * not prove the database is production. The server never reads an environment
 * label for that proof, and it never records operator verification.
 */
export type ProvenanceMeasurement = {
  readOnlySnapshot: "complete" | "incomplete";
  databaseIdentity: {
    source: "postgresql";
    name: string;
    serverAddress: string;
    capturedAt: string;
  } | null;
  operatorVerifiedProduction: false;
  environmentLabelTrusted: false;
};

export type ProvenanceCodeCounts = {
  eligible_confirmed_origin: number;
  eligible_verified_acquisition: number;
  eligible_leadcapture_unstamped: number;
  unresolved_origin: number;
};

export type ProvenanceImpactReport = {
  ok: true;
  complete: true;
  /**
   * False until an operator independently verifies the PostgreSQL identity.
   * The server does not infer production from an environment variable, so a
   * completed snapshot leaves this false.
   */
  productionImpactMeasured: false;
  measurement: ProvenanceMeasurement;
  policyId: typeof PPL_PROVENANCE_ELIGIBILITY_POLICY_ID;
  countSemantics: "exact";
  rowCeilingApplied: false;
  snapshot: {
    isolation: "repeatable_read";
    readOnly: true;
    consistent: true;
    statementTimeoutMs: number;
  };
  database: {
    name: string;
    serverAddress: string;
    capturedAt: string;
  };
  verifiedAcquisitionEvidence: {
    persistedVerifiedRecord: false;
    authenticatedLookup: false;
    treatedAs: "absent";
  };
  buyerSpecificEligibility: {
    applied: false;
    reason: "same_origin_exclusion_depends_on_the_buyer";
    confirmedOriginRowsInStructuralGate: number;
  };
  inventoryTotals: {
    totalItems: number;
    byStatusAndClass: Array<{ status: string; inventoryClass: string; count: number }>;
  };
  inventoryClassification: ProvenanceCodeCounts;
  structuralGate: {
    population: "available_aged_active_lot_not_commerce_excluded";
    availableBeforeGate: number;
    blockedByGate: number;
    remainingAfterGate: number;
    percentBlocked: string | null;
    percentBlockedNumerator: number;
    percentBlockedDenominator: number;
    byCode: ProvenanceCodeCounts;
  };
  breakdowns: {
    byNiche: ProvenanceBreakdown[];
    byLot: ProvenanceBreakdown[];
    byItemProvider: ProvenanceBreakdown[];
    byEventProvider: ProvenanceBreakdown[];
    byEventSystem: ProvenanceBreakdown[];
  };
  blockedInventoryRecovery: {
    scope: "structural_gate_unresolved_origin";
    campaignLabelIsRecoveryCandidateOnly: true;
    blocked: number;
    consistentOriginalLabel: number;
    missingCampaignLabel: number;
    conflictingCampaignEvidence: number;
    furtherAuthorizationRequired: number;
    byNiche: BlockedRecoveryRow[];
    byLot: BlockedRecoveryRow[];
  };
  reservedAndAllocations: {
    openAllocationStatuses: typeof PROVENANCE_AUDIT_OPEN_ALLOCATION_STATUSES;
    reservedItems: number;
    reservedItemsUnresolved: number;
    reservedItemsEligible: number;
    openAllocations: number;
    openAllocationsUnresolved: number;
    openAllocationsEligible: number;
    openAllocationsMissingInventory: number;
    ordersWithUnresolvedReservedAllocations: number;
    ordersWithMixedEligibleAndUnresolvedReservedAllocations: number;
    unresolvedReservedOrderNumbers: string[];
    mixedReservedOrderNumbers: string[];
  };
  historicalCampaignLabels: {
    scope: "source_system_csv_import";
    events: number;
    eventsWithNonemptySourceCampaignName: number;
    distinctSourceCampaignNameCount: number;
    recoverableConsistentEvents: number;
    conflictingEvents: number;
    missingEvents: number;
    distinctRecoverableLabelCount: number;
    distinctConflictingLabelCount: number;
    inventoryLinkedEvents: number;
    inventoryRowsWithNonemptySourceCampaignName: number;
    recoverableConsistentInventoryRows: number;
    conflictingInventoryRows: number;
    missingInventoryRows: number;
    agreement: {
      all_missing: number;
      july_column_only: number;
      july_column_agrees: number;
      july_column_conflicts: number;
      post_july_label_without_column: number;
    };
  };
  furtherEvidenceRequired: {
    unresolvedInventoryItems: number;
    unresolvedInStructuralGate: number;
    unresolvedReservedItems: number;
    unresolvedOpenAllocations: number;
    openAllocationsMissingInventory: number;
    campaignEventsNotSafelyRecoverable: number;
    campaignInventoryRowsNotSafelyRecoverable: number;
    verifiedAcquisitionCannotClearRows: true;
  };
};

export type ProvenanceImpactUnavailable = {
  ok: false;
  complete: false;
  code: typeof PROVENANCE_IMPACT_UNAVAILABLE;
  reason:
    | "snapshot_failed"
    | "statement_timeout"
    | "reconciliation_failed"
    | "incomplete_result"
    | "unsafe_response"
    | "verified_acquisition_lookup_unexpected";
  productionImpactMeasured: false;
  measurement: ProvenanceMeasurement;
  policyId: typeof PPL_PROVENANCE_ELIGIBILITY_POLICY_ID;
};

export class ProvenanceImpactShapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProvenanceImpactShapeError";
  }
}

const FORBIDDEN_KEYS = new Set([
  "phone",
  "email",
  "firstname",
  "lastname",
  "clientdisplayname",
  "clientname",
  "rawpayload",
  "rawpayloadjson",
  "normalizedpayload",
  "normalizedpayloadjson",
  "sourcecampaignname",
  "secret",
  "password",
  "token",
  "authorization",
  "apikey",
  "auditkey",
  "credential",
  "beneficiary",
  "dateofbirth",
]);
const EMAILISH = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

function forbiddenReportKey(key: string): boolean {
  return FORBIDDEN_KEYS.has(key.toLowerCase().replace(/[_-]/g, ""));
}

export function exactCount(value: unknown, label: string): number {
  let numeric: bigint;
  if (typeof value === "bigint") numeric = value;
  else if (typeof value === "number" && Number.isSafeInteger(value)) numeric = BigInt(value);
  else if (typeof value === "string" && /^(0|[1-9]\d*)$/.test(value)) numeric = BigInt(value);
  else throw new ProvenanceImpactShapeError(`count_not_exact:${label}`);
  if (numeric < 0n || numeric > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new ProvenanceImpactShapeError(`count_not_exact:${label}`);
  }
  return Number(numeric);
}

function jsonValue(value: unknown, label: string): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new ProvenanceImpactShapeError(`json_shape:${label}`);
  }
}

function safeText(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) {
    throw new ProvenanceImpactShapeError(`unsafe_value:${label}`);
  }
  if (/[\u0000-\u001f@]/.test(value) || value.includes("://")) {
    throw new ProvenanceImpactShapeError(`unsafe_value:${label}`);
  }
  return value;
}

function parseBlockedRecovery(value: unknown, label: string): BlockedRecoveryRow[] {
  const parsed = jsonValue(value, label);
  if (!Array.isArray(parsed)) throw new ProvenanceImpactShapeError(`blocked_recovery_shape:${label}`);
  return parsed.map((row, index) => {
    if (!row || typeof row !== "object") throw new ProvenanceImpactShapeError(`blocked_recovery_shape:${label}`);
    const record = row as Record<string, unknown>;
    const key = safeText(record.key, `${label}.${index}`, 200);
    const blocked = exactCount(record.blocked, `${label}.blocked`);
    const consistentOriginalLabel = exactCount(record.consistentOriginalLabel, `${label}.consistent`);
    const missingCampaignLabel = exactCount(record.missingCampaignLabel, `${label}.missing`);
    const conflictingCampaignEvidence = exactCount(record.conflictingCampaignEvidence, `${label}.conflicting`);
    const furtherAuthorizationRequired = exactCount(
      record.furtherAuthorizationRequired,
      `${label}.authorization`
    );
    if (consistentOriginalLabel + missingCampaignLabel + conflictingCampaignEvidence !== blocked) {
      throw new ProvenanceImpactShapeError(`blocked_recovery_sum:${label}`);
    }
    if (furtherAuthorizationRequired !== blocked) {
      throw new ProvenanceImpactShapeError(`blocked_recovery_authorization:${label}`);
    }
    return {
      key,
      blocked,
      consistentOriginalLabel,
      missingCampaignLabel,
      conflictingCampaignEvidence,
      furtherAuthorizationRequired,
    };
  });
}

function sumRecovery(rows: BlockedRecoveryRow[], field: keyof Omit<BlockedRecoveryRow, "key">): number {
  return rows.reduce((sum, row) => sum + row[field], 0);
}

function completedMeasurement(database: {
  name: string;
  serverAddress: string;
  capturedAt: string;
}): ProvenanceMeasurement {
  return {
    readOnlySnapshot: "complete",
    databaseIdentity: { source: "postgresql", ...database },
    operatorVerifiedProduction: false,
    environmentLabelTrusted: false,
  };
}

export function incompleteProvenanceMeasurement(): ProvenanceMeasurement {
  return {
    readOnlySnapshot: "incomplete",
    databaseIdentity: null,
    operatorVerifiedProduction: false,
    environmentLabelTrusted: false,
  };
}

function parseBreakdown(value: unknown, label: string): ProvenanceBreakdown[] {
  const parsed = jsonValue(value, label);
  if (!Array.isArray(parsed)) throw new ProvenanceImpactShapeError(`breakdown_shape:${label}`);
  return parsed.map((row, index) => {
    if (!row || typeof row !== "object") throw new ProvenanceImpactShapeError(`breakdown_shape:${label}`);
    const record = row as Record<string, unknown>;
    const key = safeText(record.key, `${label}.${index}`, 200);
    const before = exactCount(record.before, `${label}.before`);
    const blocked = exactCount(record.blocked, `${label}.blocked`);
    const remaining = exactCount(record.remaining, `${label}.remaining`);
    if (blocked + remaining !== before) throw new ProvenanceImpactShapeError(`breakdown_sum:${label}`);
    return { key, before, blocked, remaining };
  });
}

function parseStatusClass(value: unknown): ProvenanceImpactReport["inventoryTotals"]["byStatusAndClass"] {
  const parsed = jsonValue(value, "by_status_and_class");
  if (!Array.isArray(parsed)) throw new ProvenanceImpactShapeError("status_shape");
  return parsed.map((row, index) => {
    if (!row || typeof row !== "object") throw new ProvenanceImpactShapeError("status_shape");
    const record = row as Record<string, unknown>;
    return {
      status: safeText(record.status, `status.${index}`, 80),
      inventoryClass: safeText(record.inventoryClass, `class.${index}`, 80),
      count: exactCount(record.count, `status.${index}.count`),
    };
  });
}

function parseOrderNumbers(value: unknown, label: string): string[] {
  const parsed = jsonValue(value, label);
  if (!Array.isArray(parsed)) throw new ProvenanceImpactShapeError(`orders_shape:${label}`);
  return parsed.map((item, index) => safeText(item, `${label}.${index}`, 80));
}

function sumBy(rows: Array<{ count?: number; before?: number }>, field: "count" | "before"): number {
  return rows.reduce((sum, row) => sum + (row[field] ?? 0), 0);
}

function codeSum(codes: ProvenanceCodeCounts): number {
  return (
    codes.eligible_confirmed_origin +
    codes.eligible_verified_acquisition +
    codes.eligible_leadcapture_unstamped +
    codes.unresolved_origin
  );
}

function assertWalkSafe(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) assertWalkSafe(item);
    return;
  }
  if (!value || typeof value !== "object") {
    if (typeof value === "string" && EMAILISH.test(value)) {
      throw new ProvenanceImpactShapeError("unsafe_string");
    }
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenReportKey(key)) throw new ProvenanceImpactShapeError(`unsafe_key:${key}`);
    assertWalkSafe(child);
  }
}

function isoTimestamp(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return null;
}

function assertEqual(actual: number, expected: number, label: string): void {
  if (actual !== expected) throw new ProvenanceImpactShapeError(`reconcile:${label}`);
}

export function assembleProvenanceImpactReport(
  row: Record<string, unknown> | undefined,
  statementTimeoutMs: number
): ProvenanceImpactReport {
  if (!row) throw new ProvenanceImpactShapeError("missing_row");
  const count = (name: string) => exactCount(row[name], name);
  const inventoryTotals = parseStatusClass(row.by_status_and_class);
  const totalItems = count("classified_items");
  assertEqual(totalItems, count("inventory_item_rows"), "inventory_join");
  assertEqual(totalItems, sumBy(inventoryTotals, "count"), "status_class_sum");

  const inventoryClassification: ProvenanceCodeCounts = {
    eligible_confirmed_origin: count("all_confirmed"),
    eligible_verified_acquisition: count("all_verified"),
    eligible_leadcapture_unstamped: count("all_leadcapture"),
    unresolved_origin: count("all_unresolved"),
  };
  assertEqual(codeSum(inventoryClassification), totalItems, "inventory_codes");
  assertEqual(inventoryClassification.eligible_verified_acquisition, 0, "verified_acquisition_absent");

  const byCode: ProvenanceCodeCounts = {
    eligible_confirmed_origin: count("gate_confirmed"),
    eligible_verified_acquisition: count("gate_verified"),
    eligible_leadcapture_unstamped: count("gate_leadcapture"),
    unresolved_origin: count("gate_unresolved"),
  };
  const availableBeforeGate = count("gate_before");
  const blockedByGate = count("gate_blocked");
  const remainingAfterGate = count("gate_remaining");
  assertEqual(blockedByGate + remainingAfterGate, availableBeforeGate, "gate_sum");
  assertEqual(codeSum(byCode), availableBeforeGate, "gate_codes");
  assertEqual(byCode.unresolved_origin, blockedByGate, "gate_blocked_code");
  assertEqual(byCode.eligible_verified_acquisition, 0, "gate_verified_absent");
  assertEqual(
    byCode.eligible_confirmed_origin + byCode.eligible_leadcapture_unstamped,
    remainingAfterGate,
    "gate_remaining_codes"
  );

  const breakdowns = {
    byNiche: parseBreakdown(row.by_niche, "niche"),
    byLot: parseBreakdown(row.by_lot, "lot"),
    byItemProvider: parseBreakdown(row.by_item_provider, "item_provider"),
    byEventProvider: parseBreakdown(row.by_event_provider, "event_provider"),
    byEventSystem: parseBreakdown(row.by_event_system, "event_system"),
  };
  for (const [name, rows] of Object.entries(breakdowns)) {
    assertEqual(sumBy(rows, "before"), availableBeforeGate, name);
  }

  const consistentOriginalLabel = count("blocked_consistent");
  const missingCampaignLabel = count("blocked_missing");
  const conflictingCampaignEvidence = count("blocked_conflicting");
  assertEqual(
    consistentOriginalLabel + missingCampaignLabel + conflictingCampaignEvidence,
    blockedByGate,
    "blocked_recovery"
  );
  const blockedByNiche = parseBlockedRecovery(row.by_blocked_niche, "blocked_niche");
  const blockedByLot = parseBlockedRecovery(row.by_blocked_lot, "blocked_lot");
  assertEqual(sumRecovery(blockedByNiche, "blocked"), blockedByGate, "blocked_niche");
  assertEqual(sumRecovery(blockedByLot, "blocked"), blockedByGate, "blocked_lot");
  assertEqual(sumRecovery(blockedByNiche, "consistentOriginalLabel"), consistentOriginalLabel, "blocked_niche_consistent");
  assertEqual(sumRecovery(blockedByLot, "consistentOriginalLabel"), consistentOriginalLabel, "blocked_lot_consistent");
  assertEqual(sumRecovery(blockedByNiche, "missingCampaignLabel"), missingCampaignLabel, "blocked_niche_missing");
  assertEqual(sumRecovery(blockedByLot, "missingCampaignLabel"), missingCampaignLabel, "blocked_lot_missing");
  assertEqual(
    sumRecovery(blockedByNiche, "conflictingCampaignEvidence"),
    conflictingCampaignEvidence,
    "blocked_niche_conflicting"
  );
  assertEqual(
    sumRecovery(blockedByLot, "conflictingCampaignEvidence"),
    conflictingCampaignEvidence,
    "blocked_lot_conflicting"
  );

  const percentBlocked = formatPercentBlocked(blockedByGate, availableBeforeGate);
  if (availableBeforeGate === 0 && percentBlocked !== null) {
    throw new ProvenanceImpactShapeError("percent_on_empty");
  }
  if (availableBeforeGate > 0 && percentBlocked !== formatPercentBlocked(blockedByGate, availableBeforeGate)) {
    throw new ProvenanceImpactShapeError("percent");
  }

  const reservedItems = count("reserved_items");
  const reservedItemsUnresolved = count("reserved_unresolved");
  const reservedItemsEligible = count("reserved_eligible");
  assertEqual(reservedItemsUnresolved + reservedItemsEligible, reservedItems, "reserved_items");

  const openAllocations = count("open_alloc_rows");
  assertEqual(openAllocations, count("open_allocation_rows"), "allocation_join");
  const openAllocationsUnresolved = count("open_alloc_unresolved");
  const openAllocationsEligible = count("open_alloc_eligible");
  const openAllocationsMissingInventory = count("open_alloc_missing_inventory");
  assertEqual(openAllocationsUnresolved + openAllocationsEligible, openAllocations, "open_allocations");
  if (openAllocationsMissingInventory > openAllocationsUnresolved) {
    throw new ProvenanceImpactShapeError("reconcile:missing_inventory");
  }

  const unresolvedReservedOrderNumbers = parseOrderNumbers(row.at_risk_order_numbers, "at_risk");
  const mixedReservedOrderNumbers = parseOrderNumbers(row.mixed_order_numbers, "mixed");
  const atRiskOrders = count("at_risk_orders");
  const mixedOrders = count("mixed_orders");
  assertEqual(unresolvedReservedOrderNumbers.length, atRiskOrders, "at_risk_orders");
  assertEqual(mixedReservedOrderNumbers.length, mixedOrders, "mixed_orders");
  const atRiskSet = new Set(unresolvedReservedOrderNumbers);
  if (mixedReservedOrderNumbers.some((orderNumber) => !atRiskSet.has(orderNumber))) {
    throw new ProvenanceImpactShapeError("reconcile:mixed_subset");
  }
  if (new Set(unresolvedReservedOrderNumbers).size !== unresolvedReservedOrderNumbers.length) {
    throw new ProvenanceImpactShapeError("reconcile:duplicate_order_numbers");
  }

  const agreement = {
    all_missing: count("agree_all_missing"),
    july_column_only: count("agree_column_only"),
    july_column_agrees: count("agree_agrees"),
    july_column_conflicts: count("agree_conflicts"),
    post_july_label_without_column: count("agree_post_july"),
  };
  const events = count("csv_events");
  assertEqual(events, count("csv_event_rows"), "csv_events");
  const recoverableConsistentEvents = count("csv_recoverable");
  const conflictingEvents = count("csv_conflicting");
  const missingEvents = count("csv_missing");
  assertEqual(
    recoverableConsistentEvents + conflictingEvents + missingEvents,
    events,
    "label_partition"
  );
  assertEqual(
    agreement.all_missing +
      agreement.july_column_only +
      agreement.july_column_agrees +
      agreement.july_column_conflicts +
      agreement.post_july_label_without_column,
    events,
    "agreement_sum"
  );
  assertEqual(
    agreement.july_column_only + agreement.july_column_agrees,
    recoverableConsistentEvents,
    "recoverable"
  );
  assertEqual(agreement.july_column_conflicts, conflictingEvents, "conflicting");
  assertEqual(
    agreement.all_missing + agreement.post_july_label_without_column,
    missingEvents,
    "missing"
  );

  const eventsWithNonemptySourceCampaignName = count("csv_nonempty");
  const distinctSourceCampaignNameCount = count("csv_distinct");
  const distinctRecoverableLabelCount = count("csv_distinct_recoverable");
  const distinctConflictingLabelCount = count("csv_distinct_conflicting");
  if (distinctSourceCampaignNameCount > eventsWithNonemptySourceCampaignName) {
    throw new ProvenanceImpactShapeError("reconcile:distinct_labels");
  }
  if (distinctRecoverableLabelCount > recoverableConsistentEvents) {
    throw new ProvenanceImpactShapeError("reconcile:distinct_recoverable");
  }
  if (distinctConflictingLabelCount > conflictingEvents) {
    throw new ProvenanceImpactShapeError("reconcile:distinct_conflicting");
  }

  const inventoryLinkedEvents = count("inv_linked");
  const recoverableConsistentInventoryRows = count("inv_recoverable");
  const conflictingInventoryRows = count("inv_conflicting");
  const missingInventoryRows = count("inv_missing");
  if (inventoryLinkedEvents > events) throw new ProvenanceImpactShapeError("reconcile:linked_events");
  assertEqual(
    recoverableConsistentInventoryRows + conflictingInventoryRows + missingInventoryRows,
    inventoryLinkedEvents,
    "inventory_labels"
  );
  const inventoryRowsWithNonemptySourceCampaignName = count("inv_nonempty");
  if (inventoryRowsWithNonemptySourceCampaignName > inventoryLinkedEvents) {
    throw new ProvenanceImpactShapeError("reconcile:inventory_nonempty");
  }

  const capturedAt = isoTimestamp(row.captured_at);
  if (!capturedAt) throw new ProvenanceImpactShapeError("captured_at");

  const database = {
    name: safeText(row.database_name, "database_name", 80),
    serverAddress: safeText(row.server_address, "server_address", 80),
    capturedAt,
  };
  const report: ProvenanceImpactReport = {
    ok: true,
    complete: true,
    productionImpactMeasured: false,
    measurement: completedMeasurement(database),
    policyId: PPL_PROVENANCE_ELIGIBILITY_POLICY_ID,
    countSemantics: "exact",
    rowCeilingApplied: false,
    snapshot: {
      isolation: "repeatable_read",
      readOnly: true,
      consistent: true,
      statementTimeoutMs,
    },
    database,
    verifiedAcquisitionEvidence: {
      persistedVerifiedRecord: false,
      authenticatedLookup: false,
      treatedAs: "absent",
    },
    buyerSpecificEligibility: {
      applied: false,
      reason: "same_origin_exclusion_depends_on_the_buyer",
      confirmedOriginRowsInStructuralGate: byCode.eligible_confirmed_origin,
    },
    inventoryTotals: { totalItems, byStatusAndClass: inventoryTotals },
    inventoryClassification,
    structuralGate: {
      population: "available_aged_active_lot_not_commerce_excluded",
      availableBeforeGate,
      blockedByGate,
      remainingAfterGate,
      percentBlocked,
      percentBlockedNumerator: blockedByGate,
      percentBlockedDenominator: availableBeforeGate,
      byCode,
    },
    breakdowns,
    blockedInventoryRecovery: {
      scope: "structural_gate_unresolved_origin",
      campaignLabelIsRecoveryCandidateOnly: true,
      blocked: blockedByGate,
      consistentOriginalLabel,
      missingCampaignLabel,
      conflictingCampaignEvidence,
      furtherAuthorizationRequired: blockedByGate,
      byNiche: blockedByNiche,
      byLot: blockedByLot,
    },
    reservedAndAllocations: {
      openAllocationStatuses: PROVENANCE_AUDIT_OPEN_ALLOCATION_STATUSES,
      reservedItems,
      reservedItemsUnresolved,
      reservedItemsEligible,
      openAllocations,
      openAllocationsUnresolved,
      openAllocationsEligible,
      openAllocationsMissingInventory,
      ordersWithUnresolvedReservedAllocations: atRiskOrders,
      ordersWithMixedEligibleAndUnresolvedReservedAllocations: mixedOrders,
      unresolvedReservedOrderNumbers,
      mixedReservedOrderNumbers,
    },
    historicalCampaignLabels: {
      scope: "source_system_csv_import",
      events,
      eventsWithNonemptySourceCampaignName,
      distinctSourceCampaignNameCount,
      recoverableConsistentEvents,
      conflictingEvents,
      missingEvents,
      distinctRecoverableLabelCount,
      distinctConflictingLabelCount,
      inventoryLinkedEvents,
      inventoryRowsWithNonemptySourceCampaignName,
      recoverableConsistentInventoryRows,
      conflictingInventoryRows,
      missingInventoryRows,
      agreement,
    },
    furtherEvidenceRequired: {
      unresolvedInventoryItems: inventoryClassification.unresolved_origin,
      unresolvedInStructuralGate: blockedByGate,
      unresolvedReservedItems: reservedItemsUnresolved,
      unresolvedOpenAllocations: openAllocationsUnresolved,
      openAllocationsMissingInventory,
      campaignEventsNotSafelyRecoverable: conflictingEvents + missingEvents,
      campaignInventoryRowsNotSafelyRecoverable: conflictingInventoryRows + missingInventoryRows,
      verifiedAcquisitionCannotClearRows: true,
    },
  };
  assertWalkSafe(report);
  return report;
}

export function unavailableProvenanceImpact(
  reason: ProvenanceImpactUnavailable["reason"]
): ProvenanceImpactUnavailable {
  return {
    ok: false,
    complete: false,
    code: PROVENANCE_IMPACT_UNAVAILABLE,
    reason,
    productionImpactMeasured: false,
    measurement: incompleteProvenanceMeasurement(),
    policyId: PPL_PROVENANCE_ELIGIBILITY_POLICY_ID,
  };
}

function databasePassword(databaseUrl: string | undefined): string | undefined {
  if (!databaseUrl) return undefined;
  try {
    const password = decodeURIComponent(new URL(databaseUrl).password);
    return password || undefined;
  } catch {
    return undefined;
  }
}

export function responseContainsSecret(serialized: string): boolean {
  const secrets = [
    process.env.SA360_AUDIT_READONLY_KEY,
    process.env.ADMIN_API_KEY,
    process.env.SA360_ADMIN_KEY,
    process.env.SA360_ADMIN_API_KEY,
    databasePassword(process.env.DATABASE_URL),
    databasePassword(process.env.SA360_TEST_DATABASE_URL),
  ];
  return secrets.some((secret) => {
    const value = secret?.trim() ?? "";
    return value.length >= 8 && serialized.includes(value);
  });
}
