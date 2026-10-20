/**
 * Display model for the Inventory Provenance Impact panel.
 * Counts are accepted only when the payload reconciles. A failed parse is
 * unavailable, which the panel renders without numeric totals.
 */

export const PROVENANCE_IMPACT_POLICY_ID = "ppl-provenance-eligibility-v1" as const;

export type ProvenanceBreakdownView = {
  key: string;
  before: number;
  blocked: number;
  remaining: number;
};

export type BlockedRecoveryView = {
  key: string;
  blocked: number;
  consistentOriginalLabel: number;
  missingCampaignLabel: number;
  conflictingCampaignEvidence: number;
  furtherAuthorizationRequired: number;
};

export type ProvenanceMeasurementView = {
  readOnlySnapshot: "complete";
  databaseIdentity: {
    source: "postgresql";
    name: string;
    serverAddress: string;
    capturedAt: string;
  };
  operatorVerifiedProduction: false;
  environmentLabelTrusted: false;
};

export type ProvenanceImpactView = {
  productionImpactMeasured: false;
  measurement: ProvenanceMeasurementView;
  policyId: typeof PROVENANCE_IMPACT_POLICY_ID;
  database: {
    name: string;
    serverAddress: string;
    capturedAt: string;
  };
  structuralGate: {
    availableBeforeGate: number;
    blockedByGate: number;
    remainingAfterGate: number;
    percentBlocked: string | null;
  };
  breakdowns: {
    byNiche: ProvenanceBreakdownView[];
    byLot: ProvenanceBreakdownView[];
    byItemProvider: ProvenanceBreakdownView[];
    byEventProvider: ProvenanceBreakdownView[];
    byEventSystem: ProvenanceBreakdownView[];
  };
  blockedInventoryRecovery: {
    campaignLabelIsRecoveryCandidateOnly: true;
    blocked: number;
    consistentOriginalLabel: number;
    missingCampaignLabel: number;
    conflictingCampaignEvidence: number;
    furtherAuthorizationRequired: number;
    byNiche: BlockedRecoveryView[];
    byLot: BlockedRecoveryView[];
  };
  historicalCampaignLabels: {
    events: number;
    eventsWithNonemptySourceCampaignName: number;
    distinctSourceCampaignNameCount: number;
    recoverableConsistentEvents: number;
    conflictingEvents: number;
    missingEvents: number;
    distinctRecoverableLabelCount: number;
    distinctConflictingLabelCount: number;
  };
  reservedAndAllocations: {
    reservedItemsUnresolved: number;
    openAllocationsUnresolved: number;
    ordersWithUnresolvedReservedAllocations: number;
    ordersWithMixedEligibleAndUnresolvedReservedAllocations: number;
    unresolvedReservedOrderNumbers: string[];
    mixedReservedOrderNumbers: string[];
  };
  furtherEvidenceRequired: {
    unresolvedInStructuralGate: number;
    unresolvedReservedItems: number;
    unresolvedOpenAllocations: number;
    campaignEventsNotSafelyRecoverable: number;
    verifiedAcquisitionCannotClearRows: true;
  };
  buyerSpecificEligibilityApplied: false;
};

export type ProvenanceImpactPanelModel =
  | { state: "disabled" }
  | { state: "unavailable" }
  | { state: "ready"; report: ProvenanceImpactView };

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
  "clientaccountid",
]);

const EMAILISH = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const MAX_BREAKDOWN_ROWS = 2000;

function forbiddenKey(key: string): boolean {
  return FORBIDDEN_KEYS.has(key.toLowerCase().replace(/[_-]/g, ""));
}

function payloadIsSafe(value: unknown): boolean {
  if (Array.isArray(value)) return value.every((item) => payloadIsSafe(item));
  if (!value || typeof value !== "object") {
    return typeof value !== "string" || !EMAILISH.test(value);
  }
  return Object.entries(value).every(([key, child]) => !forbiddenKey(key) && payloadIsSafe(child));
}

function exactCount(value: unknown): number | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value === "string" && /^(0|[1-9]\d*)$/.test(value)) {
    const numeric = Number(value);
    if (Number.isSafeInteger(numeric)) return numeric;
  }
  return null;
}

function safeText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) return null;
  if (/[\u0000-\u001f@]/.test(value) || value.includes("://")) return null;
  return value;
}

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function formatPercentBlocked(numerator: number, denominator: number): string | null {
  if (denominator === 0) return null;
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || numerator < 0) {
    return null;
  }
  const scaled = Math.round((numerator * 1_000_000) / denominator);
  const whole = Math.floor(scaled / 10_000);
  const fraction = String(scaled % 10_000).padStart(4, "0");
  return `${whole}.${fraction}`;
}

function parseBreakdown(value: unknown): ProvenanceBreakdownView[] | null {
  if (!Array.isArray(value) || value.length > MAX_BREAKDOWN_ROWS) return null;
  const rows: ProvenanceBreakdownView[] = [];
  for (const item of value) {
    const row = record(item);
    if (!row) return null;
    const key = safeText(row.key, 200);
    const before = exactCount(row.before);
    const blocked = exactCount(row.blocked);
    const remaining = exactCount(row.remaining);
    if (key === null || before === null || blocked === null || remaining === null) return null;
    if (blocked + remaining !== before) return null;
    rows.push({ key, before, blocked, remaining });
  }
  return rows;
}

function parseBlockedRecovery(value: unknown): BlockedRecoveryView[] | null {
  if (!Array.isArray(value) || value.length > MAX_BREAKDOWN_ROWS) return null;
  const rows: BlockedRecoveryView[] = [];
  for (const item of value) {
    const row = record(item);
    if (!row) return null;
    const key = safeText(row.key, 200);
    const blocked = exactCount(row.blocked);
    const consistentOriginalLabel = exactCount(row.consistentOriginalLabel);
    const missingCampaignLabel = exactCount(row.missingCampaignLabel);
    const conflictingCampaignEvidence = exactCount(row.conflictingCampaignEvidence);
    const furtherAuthorizationRequired = exactCount(row.furtherAuthorizationRequired);
    if (
      key === null ||
      blocked === null ||
      consistentOriginalLabel === null ||
      missingCampaignLabel === null ||
      conflictingCampaignEvidence === null ||
      furtherAuthorizationRequired === null
    ) {
      return null;
    }
    if (consistentOriginalLabel + missingCampaignLabel + conflictingCampaignEvidence !== blocked) return null;
    if (furtherAuthorizationRequired !== blocked) return null;
    rows.push({
      key,
      blocked,
      consistentOriginalLabel,
      missingCampaignLabel,
      conflictingCampaignEvidence,
      furtherAuthorizationRequired,
    });
  }
  return rows;
}

function sumRecovery(rows: BlockedRecoveryView[], field: keyof Omit<BlockedRecoveryView, "key">): number {
  return rows.reduce((sum, row) => sum + row[field], 0);
}

function sumBefore(rows: ProvenanceBreakdownView[]): number {
  return rows.reduce((sum, row) => sum + row.before, 0);
}

function parseOrderNumbers(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const numbers: string[] = [];
  for (const item of value) {
    const text = safeText(item, 80);
    if (!text) return null;
    numbers.push(text);
  }
  if (new Set(numbers).size !== numbers.length) return null;
  return numbers;
}

export function parseProvenanceImpactReport(value: unknown): ProvenanceImpactView | null {
  if (!payloadIsSafe(value)) return null;
  const body = record(value);
  if (!body) return null;
  if (body.ok !== true || body.complete !== true || body.productionImpactMeasured !== false) return null;
  if (body.policyId !== PROVENANCE_IMPACT_POLICY_ID) return null;
  if (body.countSemantics !== "exact" || body.rowCeilingApplied !== false) return null;

  const verified = record(body.verifiedAcquisitionEvidence);
  if (
    !verified ||
    verified.persistedVerifiedRecord !== false ||
    verified.authenticatedLookup !== false ||
    verified.treatedAs !== "absent"
  ) {
    return null;
  }

  const buyer = record(body.buyerSpecificEligibility);
  if (!buyer || buyer.applied !== false) return null;

  const gate = record(body.structuralGate);
  const labels = record(body.historicalCampaignLabels);
  const reserved = record(body.reservedAndAllocations);
  const evidence = record(body.furtherEvidenceRequired);
  const database = record(body.database);
  const breakdowns = record(body.breakdowns);
  const classification = record(body.inventoryClassification);
  const gateCodes = gate ? record(gate.byCode) : null;
  if (!gate || !labels || !reserved || !evidence || !database || !breakdowns || !classification || !gateCodes) {
    return null;
  }
  if (exactCount(classification.eligible_verified_acquisition) !== 0) return null;
  if (exactCount(gateCodes.eligible_verified_acquisition) !== 0) return null;

  const availableBeforeGate = exactCount(gate.availableBeforeGate);
  const blockedByGate = exactCount(gate.blockedByGate);
  const remainingAfterGate = exactCount(gate.remainingAfterGate);
  if (availableBeforeGate === null || blockedByGate === null || remainingAfterGate === null) return null;
  if (blockedByGate + remainingAfterGate !== availableBeforeGate) return null;
  const percentBlocked = formatPercentBlocked(blockedByGate, availableBeforeGate);
  if (gate.percentBlocked !== percentBlocked) return null;

  const byNiche = parseBreakdown(breakdowns.byNiche);
  const byLot = parseBreakdown(breakdowns.byLot);
  const byItemProvider = parseBreakdown(breakdowns.byItemProvider);
  const byEventProvider = parseBreakdown(breakdowns.byEventProvider);
  const byEventSystem = parseBreakdown(breakdowns.byEventSystem);
  if (!byNiche || !byLot || !byItemProvider || !byEventProvider || !byEventSystem) return null;
  if (
    sumBefore(byNiche) !== availableBeforeGate ||
    sumBefore(byLot) !== availableBeforeGate ||
    sumBefore(byItemProvider) !== availableBeforeGate ||
    sumBefore(byEventProvider) !== availableBeforeGate ||
    sumBefore(byEventSystem) !== availableBeforeGate
  ) {
    return null;
  }

  const events = exactCount(labels.events);
  const eventsWithNonemptySourceCampaignName = exactCount(labels.eventsWithNonemptySourceCampaignName);
  const distinctSourceCampaignNameCount = exactCount(labels.distinctSourceCampaignNameCount);
  const recoverableConsistentEvents = exactCount(labels.recoverableConsistentEvents);
  const conflictingEvents = exactCount(labels.conflictingEvents);
  const missingEvents = exactCount(labels.missingEvents);
  const distinctRecoverableLabelCount = exactCount(labels.distinctRecoverableLabelCount);
  const distinctConflictingLabelCount = exactCount(labels.distinctConflictingLabelCount);
  if (
    events === null ||
    eventsWithNonemptySourceCampaignName === null ||
    distinctSourceCampaignNameCount === null ||
    recoverableConsistentEvents === null ||
    conflictingEvents === null ||
    missingEvents === null ||
    distinctRecoverableLabelCount === null ||
    distinctConflictingLabelCount === null
  ) {
    return null;
  }
  if (recoverableConsistentEvents + conflictingEvents + missingEvents !== events) return null;
  if (eventsWithNonemptySourceCampaignName > events) return null;
  if (distinctSourceCampaignNameCount > eventsWithNonemptySourceCampaignName) return null;
  if (distinctRecoverableLabelCount > recoverableConsistentEvents) return null;
  if (distinctConflictingLabelCount > conflictingEvents) return null;

  const agreement = record(labels.agreement);
  if (agreement) {
    const parts = [
      exactCount(agreement.all_missing),
      exactCount(agreement.july_column_only),
      exactCount(agreement.july_column_agrees),
      exactCount(agreement.july_column_conflicts),
      exactCount(agreement.post_july_label_without_column),
    ];
    if (parts.some((part) => part === null)) return null;
    const agreementSum = (parts as number[]).reduce((sum, part) => sum + part, 0);
    if (agreementSum !== events) return null;
  }

  const unresolvedReservedOrderNumbers = parseOrderNumbers(reserved.unresolvedReservedOrderNumbers);
  const mixedReservedOrderNumbers = parseOrderNumbers(reserved.mixedReservedOrderNumbers);
  const atRisk = exactCount(reserved.ordersWithUnresolvedReservedAllocations);
  const mixed = exactCount(reserved.ordersWithMixedEligibleAndUnresolvedReservedAllocations);
  const reservedItemsUnresolved = exactCount(reserved.reservedItemsUnresolved);
  const openAllocationsUnresolved = exactCount(reserved.openAllocationsUnresolved);
  if (
    !unresolvedReservedOrderNumbers ||
    !mixedReservedOrderNumbers ||
    atRisk === null ||
    mixed === null ||
    reservedItemsUnresolved === null ||
    openAllocationsUnresolved === null
  ) {
    return null;
  }
  if (unresolvedReservedOrderNumbers.length !== atRisk || mixedReservedOrderNumbers.length !== mixed) return null;
  if (mixed > atRisk) return null;
  const atRiskSet = new Set(unresolvedReservedOrderNumbers);
  if (mixedReservedOrderNumbers.some((orderNumber) => !atRiskSet.has(orderNumber))) return null;

  const unresolvedInStructuralGate = exactCount(evidence.unresolvedInStructuralGate);
  const unresolvedReservedItems = exactCount(evidence.unresolvedReservedItems);
  const unresolvedOpenAllocations = exactCount(evidence.unresolvedOpenAllocations);
  const campaignEventsNotSafelyRecoverable = exactCount(evidence.campaignEventsNotSafelyRecoverable);
  if (
    unresolvedInStructuralGate === null ||
    unresolvedReservedItems === null ||
    unresolvedOpenAllocations === null ||
    campaignEventsNotSafelyRecoverable === null ||
    evidence.verifiedAcquisitionCannotClearRows !== true
  ) {
    return null;
  }
  if (unresolvedInStructuralGate !== blockedByGate) return null;
  if (unresolvedReservedItems !== reservedItemsUnresolved) return null;
  if (unresolvedOpenAllocations !== openAllocationsUnresolved) return null;
  if (campaignEventsNotSafelyRecoverable !== conflictingEvents + missingEvents) return null;

  const name = safeText(database.name, 128);
  const serverAddress = safeText(database.serverAddress, 128);
  const capturedAt = safeText(database.capturedAt, 40);
  if (!name || !serverAddress || !capturedAt || Number.isNaN(Date.parse(capturedAt))) return null;

  const measurement = record(body.measurement);
  const identity = measurement ? record(measurement.databaseIdentity) : null;
  if (
    !measurement ||
    !identity ||
    measurement.readOnlySnapshot !== "complete" ||
    measurement.operatorVerifiedProduction !== false ||
    measurement.environmentLabelTrusted !== false ||
    identity.source !== "postgresql" ||
    identity.name !== name ||
    identity.serverAddress !== serverAddress ||
    identity.capturedAt !== capturedAt
  ) {
    return null;
  }

  const recovery = record(body.blockedInventoryRecovery);
  if (!recovery || recovery.campaignLabelIsRecoveryCandidateOnly !== true) return null;
  const recoveryBlocked = exactCount(recovery.blocked);
  const consistentOriginalLabel = exactCount(recovery.consistentOriginalLabel);
  const missingCampaignLabel = exactCount(recovery.missingCampaignLabel);
  const conflictingCampaignEvidence = exactCount(recovery.conflictingCampaignEvidence);
  const furtherAuthorizationRequired = exactCount(recovery.furtherAuthorizationRequired);
  const recoveryByNiche = parseBlockedRecovery(recovery.byNiche);
  const recoveryByLot = parseBlockedRecovery(recovery.byLot);
  if (
    recoveryBlocked === null ||
    consistentOriginalLabel === null ||
    missingCampaignLabel === null ||
    conflictingCampaignEvidence === null ||
    furtherAuthorizationRequired === null ||
    !recoveryByNiche ||
    !recoveryByLot
  ) {
    return null;
  }
  if (consistentOriginalLabel + missingCampaignLabel + conflictingCampaignEvidence !== recoveryBlocked) return null;
  if (recoveryBlocked !== blockedByGate || furtherAuthorizationRequired !== blockedByGate) return null;
  if (
    sumRecovery(recoveryByNiche, "blocked") !== blockedByGate ||
    sumRecovery(recoveryByLot, "blocked") !== blockedByGate ||
    sumRecovery(recoveryByNiche, "consistentOriginalLabel") !== consistentOriginalLabel ||
    sumRecovery(recoveryByLot, "consistentOriginalLabel") !== consistentOriginalLabel ||
    sumRecovery(recoveryByNiche, "missingCampaignLabel") !== missingCampaignLabel ||
    sumRecovery(recoveryByLot, "missingCampaignLabel") !== missingCampaignLabel ||
    sumRecovery(recoveryByNiche, "conflictingCampaignEvidence") !== conflictingCampaignEvidence ||
    sumRecovery(recoveryByLot, "conflictingCampaignEvidence") !== conflictingCampaignEvidence
  ) {
    return null;
  }

  return {
    productionImpactMeasured: false,
    measurement: {
      readOnlySnapshot: "complete",
      databaseIdentity: {
        source: "postgresql",
        name,
        serverAddress,
        capturedAt,
      },
      operatorVerifiedProduction: false,
      environmentLabelTrusted: false,
    },
    policyId: PROVENANCE_IMPACT_POLICY_ID,
    database: { name, serverAddress, capturedAt },
    structuralGate: {
      availableBeforeGate,
      blockedByGate,
      remainingAfterGate,
      percentBlocked,
    },
    breakdowns: { byNiche, byLot, byItemProvider, byEventProvider, byEventSystem },
    blockedInventoryRecovery: {
      campaignLabelIsRecoveryCandidateOnly: true,
      blocked: recoveryBlocked,
      consistentOriginalLabel,
      missingCampaignLabel,
      conflictingCampaignEvidence,
      furtherAuthorizationRequired,
      byNiche: recoveryByNiche,
      byLot: recoveryByLot,
    },
    historicalCampaignLabels: {
      events,
      eventsWithNonemptySourceCampaignName,
      distinctSourceCampaignNameCount,
      recoverableConsistentEvents,
      conflictingEvents,
      missingEvents,
      distinctRecoverableLabelCount,
      distinctConflictingLabelCount,
    },
    reservedAndAllocations: {
      reservedItemsUnresolved,
      openAllocationsUnresolved,
      ordersWithUnresolvedReservedAllocations: atRisk,
      ordersWithMixedEligibleAndUnresolvedReservedAllocations: mixed,
      unresolvedReservedOrderNumbers,
      mixedReservedOrderNumbers,
    },
    furtherEvidenceRequired: {
      unresolvedInStructuralGate,
      unresolvedReservedItems,
      unresolvedOpenAllocations,
      campaignEventsNotSafelyRecoverable,
      verifiedAcquisitionCannotClearRows: true,
    },
    buyerSpecificEligibilityApplied: false,
  };
}

export function provenanceImpactModelFromAdminFetch(
  result: { ok: true; data: unknown } | { ok: false; status: number; body: string }
): ProvenanceImpactPanelModel {
  if (!result.ok) {
    if (result.status === 404) return { state: "disabled" };
    return { state: "unavailable" };
  }
  const report = parseProvenanceImpactReport(result.data);
  if (!report) return { state: "unavailable" };
  return { state: "ready", report };
}
