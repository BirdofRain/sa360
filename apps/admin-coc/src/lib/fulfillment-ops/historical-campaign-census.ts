/**
 * Display model for the historical campaign census and one-order drill-down.
 * Counts render only after the payload reconciles. A failed parse is unavailable.
 * The association block is a contract preview. This module registers no writes.
 */

export const HISTORICAL_CAMPAIGN_CENSUS_POLICY_ID = "historical-campaign-census-v1" as const;
export const HISTORICAL_CENSUS_PROVENANCE_POLICY_ID = "ppl-provenance-eligibility-v1" as const;
export const HISTORICAL_RECOVERY_POLICY_ID = "historical-campaign-recovery-v1" as const;
export const HISTORICAL_ASSOCIATION_CONTRACT_ID = "historical-campaign-association-v1" as const;

export const HISTORICAL_ORDER_NUMBER = /^[A-Z0-9][A-Z0-9-]{1,31}$/;

export function isHistoricalOrderNumber(value: string): boolean {
  return HISTORICAL_ORDER_NUMBER.test(value);
}

/** Confirmation and resale stay unregistered. Ownership preview is a separate read-only route. */
export const HISTORICAL_ASSOCIATION_CONTRACT_VIEW = {
  contractId: HISTORICAL_ASSOCIATION_CONTRACT_ID,
  authHeader: "x-sa360-admin-key",
  auditCredentialAccepted: false,
  featureFlag: "SA360_HISTORICAL_CAMPAIGN_ASSOCIATION_ENABLED",
  defaultEnabled: false,
  implemented: false,
  previewRegistered: true,
  confirmationRegistered: false,
  routes: [
    {
      name: "Ownership preview",
      method: "POST",
      path: "/admin/v1/historical-campaign-associations/ownership-previews",
      effect: "Import-scoped label proposals. Does not stamp origin or confirm resale.",
    },
    {
      name: "Ownership confirmation",
      method: "POST",
      path: "/admin/v1/historical-campaign-associations/ownership-confirmations",
      effect: "Future stamp of a null origin when the July label still matches. Does not confirm resale.",
    },
    {
      name: "Ownership reassignment",
      method: "POST",
      path: "/admin/v1/historical-campaign-associations/ownership-reassignments",
      effect: "Future reassignment with the previous client kept in an event. Does not confirm resale.",
    },
    {
      name: "Resale preview",
      method: "POST",
      path: "/admin/v1/historical-campaign-resale/previews",
      effect: "Separate from ownership. A label, exclusive flag, or Used By value is not evidence.",
    },
    {
      name: "Resale confirmation",
      method: "POST",
      path: "/admin/v1/historical-campaign-resale/confirmations",
      effect: "Future resale authorization. Does not stamp origin.",
    },
  ],
} as const;

export type HistoricalCensusGroupView = {
  inventoryRows: number;
  distinctOriginalLabels: number;
  unresolvedOriginRows: number;
  stampedOriginRows: number;
  consistentOriginalLabelRows: number;
  missingAttributionRows: number;
  conflictingAttributionRows: number;
  reservedRows: number;
};

export type HistoricalCensusMeasurementView = {
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

export type HistoricalCensusView = {
  policyId: typeof HISTORICAL_CAMPAIGN_CENSUS_POLICY_ID;
  provenancePolicyId: typeof HISTORICAL_CENSUS_PROVENANCE_POLICY_ID;
  recoveryPolicyId: typeof HISTORICAL_RECOVERY_POLICY_ID;
  ownershipStampApplied: false;
  resaleAuthorizationApplied: false;
  clientNameMatchUsed: false;
  julySourceCampaignNamePreserved: true;
  labelTextOmitted: true;
  buyerSpecificEligibilityApplied: false;
  measurement: HistoricalCensusMeasurementView;
  population: {
    inventoryRows: number;
    unresolvedOriginRows: number;
    stampedOriginRows: number;
    consistentOriginalLabelRows: number;
    missingAttributionRows: number;
    conflictingAttributionRows: number;
    rowsWithOriginalLabel: number;
    rowsMissingOriginalLabel: number;
    distinctOriginalLabels: number;
  };
  labelPopulations: {
    oneRow: number;
    twoToTenRows: number;
    elevenToOneHundredRows: number;
    oneHundredOneToOneThousandRows: number;
    overOneThousandRows: number;
    largestLabelInventoryRows: number;
  };
  byNiche: Array<HistoricalCensusGroupView & { nicheKey: string }>;
  byLot: Array<HistoricalCensusGroupView & { lotKey: string }>;
  byNicheAndLot: Array<HistoricalCensusGroupView & { nicheKey: string; lotKey: string }>;
  byImportRequest: Array<HistoricalCensusGroupView & { importRequest: string }>;
  byAgreement: Array<HistoricalCensusGroupView & { agreement: string }>;
  byInventoryStatus: Array<HistoricalCensusGroupView & { status: string }>;
  openAllocations: {
    rows: number;
    byStatus: Array<{ status: string; allocations: number }>;
  };
  stampedOriginClients: Array<{ originClientAccountId: string; inventoryRows: number }>;
};

export type HistoricalOrderView = {
  policyId: typeof HISTORICAL_CAMPAIGN_CENSUS_POLICY_ID;
  provenancePolicyId: typeof HISTORICAL_CENSUS_PROVENANCE_POLICY_ID;
  recoveryPolicyId: typeof HISTORICAL_RECOVERY_POLICY_ID;
  orderNumber: string;
  orderStatus: string;
  buyerClientAccountId: string;
  resaleAuthorizationPersisted: false;
  ownershipStampApplied: false;
  contactOmitted: true;
  measurement: HistoricalCensusMeasurementView;
  allocations: {
    rows: number;
    reservedRows: number;
    buyerMismatchRows: number;
    missingInventoryRows: number;
    originEqualsBuyerRows: number;
    originOtherClientRows: number;
    originUnstampedRows: number;
    byStatus: Array<{ status: string; allocations: number }>;
    byProvenance: Array<{ provenance: string; allocations: number }>;
    byLot: Array<{
      lotKey: string;
      allocations: number;
      unresolvedOrigin: number;
      originEqualsBuyer: number;
      originOtherClient: number;
      originUnstamped: number;
    }>;
  };
  reservedRevisedPolicy: {
    wouldBlockUnresolvedOrigin: number;
    wouldBlockSameOrigin: number;
    wouldBlockUntilResaleAuthorization: number;
    outsideHistoricalGate: number;
    wouldBlockMissingInventory: number;
  };
  delivery: {
    packages: number;
    spreadsheetDeliveredPackages: number;
    notifyByStatus: Array<{ status: string; packages: number }>;
    instructionsByStatus: Array<{ status: string; instructions: number }>;
  };
  replacementsByStatus: Array<{ status: string; requests: number }>;
};

export type HistoricalCensusPanelModel =
  | { state: "idle" }
  | { state: "disabled" }
  | { state: "unavailable" }
  | { state: "ready"; report: HistoricalCensusView };

export type HistoricalOrderPanelModel =
  | { state: "idle" }
  | { state: "disabled" }
  | { state: "unavailable" }
  | { state: "invalid" }
  | { state: "not_found"; orderNumber: string }
  | { state: "ready"; report: HistoricalOrderView };

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
  "campaignname",
  "csvcontent",
  "secret",
  "password",
  "token",
  "authorization",
  "apikey",
  "beneficiary",
  "dateofbirth",
  "reason",
]);

const ACCOUNT_ID_KEYS = new Set(["buyerclientaccountid", "originclientaccountid"]);
const EMAILISH = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const MAX_GROUPS = 500;

function normalizedKey(key: string): string {
  return key.toLowerCase().replace(/[_-]/g, "");
}

function payloadIsSafe(value: unknown, parentKey = ""): boolean {
  if (Array.isArray(value)) return value.every((item) => payloadIsSafe(item, parentKey));
  if (!value || typeof value !== "object") {
    if (typeof value !== "string" || ACCOUNT_ID_KEYS.has(normalizedKey(parentKey))) return true;
    return !EMAILISH.test(value);
  }
  return Object.entries(value).every(
    ([key, child]) => !FORBIDDEN_KEYS.has(normalizedKey(key)) && payloadIsSafe(child, key)
  );
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

function safeAccountId(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 120) return null;
  if (/[\u0000-\u001f\s]/.test(value) || value.includes("://")) return null;
  return value;
}

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function codeFromBody(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as { code?: unknown; orderNumber?: unknown };
    return typeof parsed.code === "string" ? parsed.code : null;
  } catch {
    return null;
  }
}

function orderNumberFromBody(body: string, fallback: string): string {
  try {
    const parsed = JSON.parse(body) as { orderNumber?: unknown };
    const orderNumber = safeText(parsed.orderNumber, 32);
    return orderNumber ?? fallback;
  } catch {
    return fallback;
  }
}

type GroupIdentity = Record<string, string>;

function parseGroupMetrics(row: Record<string, unknown>): HistoricalCensusGroupView | null {
  const inventoryRows = exactCount(row.inventoryRows);
  const distinctOriginalLabels = exactCount(row.distinctOriginalLabels);
  const unresolvedOriginRows = exactCount(row.unresolvedOriginRows);
  const stampedOriginRows = exactCount(row.stampedOriginRows);
  const consistentOriginalLabelRows = exactCount(row.consistentOriginalLabelRows);
  const missingAttributionRows = exactCount(row.missingAttributionRows);
  const conflictingAttributionRows = exactCount(row.conflictingAttributionRows);
  const reservedRows = exactCount(row.reservedRows);
  if (
    inventoryRows === null ||
    distinctOriginalLabels === null ||
    unresolvedOriginRows === null ||
    stampedOriginRows === null ||
    consistentOriginalLabelRows === null ||
    missingAttributionRows === null ||
    conflictingAttributionRows === null ||
    reservedRows === null
  ) {
    return null;
  }
  if (consistentOriginalLabelRows + missingAttributionRows + conflictingAttributionRows !== inventoryRows) {
    return null;
  }
  if (stampedOriginRows + unresolvedOriginRows !== inventoryRows) return null;
  if (reservedRows > inventoryRows) return null;
  return {
    inventoryRows,
    distinctOriginalLabels,
    unresolvedOriginRows,
    stampedOriginRows,
    consistentOriginalLabelRows,
    missingAttributionRows,
    conflictingAttributionRows,
    reservedRows,
  };
}

function parseGroups<T extends GroupIdentity>(
  value: unknown,
  identity: (row: Record<string, unknown>) => T | null
): Array<HistoricalCensusGroupView & T> | null {
  if (!Array.isArray(value) || value.length > MAX_GROUPS) return null;
  const rows: Array<HistoricalCensusGroupView & T> = [];
  for (const item of value) {
    const row = record(item);
    if (!row) return null;
    const key = identity(row);
    const metrics = parseGroupMetrics(row);
    if (!key || !metrics) return null;
    rows.push({ ...key, ...metrics });
  }
  return rows;
}

function sumInventory(rows: HistoricalCensusGroupView[]): number {
  return rows.reduce((sum, row) => sum + row.inventoryRows, 0);
}

function parseMeasurement(body: Record<string, unknown>): HistoricalCensusMeasurementView | null {
  const measurement = record(body.measurement);
  const identity = measurement ? record(measurement.databaseIdentity) : null;
  if (!measurement || !identity) return null;
  const name = safeText(identity.name, 80);
  const serverAddress = safeText(identity.serverAddress, 80);
  const capturedAt = safeText(identity.capturedAt, 40);
  if (!name || !serverAddress || !capturedAt || Number.isNaN(Date.parse(capturedAt))) return null;
  if (
    measurement.readOnlySnapshot !== "complete" ||
    measurement.operatorVerifiedProduction !== false ||
    measurement.environmentLabelTrusted !== false ||
    identity.source !== "postgresql"
  ) {
    return null;
  }
  return {
    readOnlySnapshot: "complete",
    databaseIdentity: { source: "postgresql", name, serverAddress, capturedAt },
    operatorVerifiedProduction: false,
    environmentLabelTrusted: false,
  };
}

export function parseHistoricalCensusReport(body: unknown): HistoricalCensusView | null {
  if (!payloadIsSafe(body)) return null;
  const row = record(body);
  if (!row) return null;
  if (row.ok !== true || row.complete !== true) return null;
  if (row.policyId !== HISTORICAL_CAMPAIGN_CENSUS_POLICY_ID) return null;
  if (row.provenancePolicyId !== HISTORICAL_CENSUS_PROVENANCE_POLICY_ID) return null;
  if (row.recoveryPolicyId !== HISTORICAL_RECOVERY_POLICY_ID) return null;
  if (
    row.ownershipStampApplied !== false ||
    row.resaleAuthorizationApplied !== false ||
    row.clientNameMatchUsed !== false ||
    row.julySourceCampaignNamePreserved !== true ||
    row.labelTextOmitted !== true ||
    row.buyerSpecificEligibilityApplied !== false
  ) {
    return null;
  }
  const populationRow = record(row.population);
  const labelRow = record(row.labelPopulations);
  const measurement = parseMeasurement(row);
  if (!populationRow || !labelRow || !measurement) return null;
  const population = {
    inventoryRows: exactCount(populationRow.inventoryRows),
    unresolvedOriginRows: exactCount(populationRow.unresolvedOriginRows),
    stampedOriginRows: exactCount(populationRow.stampedOriginRows),
    consistentOriginalLabelRows: exactCount(populationRow.consistentOriginalLabelRows),
    missingAttributionRows: exactCount(populationRow.missingAttributionRows),
    conflictingAttributionRows: exactCount(populationRow.conflictingAttributionRows),
    rowsWithOriginalLabel: exactCount(populationRow.rowsWithOriginalLabel),
    rowsMissingOriginalLabel: exactCount(populationRow.rowsMissingOriginalLabel),
    distinctOriginalLabels: exactCount(populationRow.distinctOriginalLabels),
  };
  if (Object.values(population).some((value) => value === null)) return null;
  const counts = population as { [K in keyof typeof population]: number };
  if (
    counts.consistentOriginalLabelRows + counts.missingAttributionRows + counts.conflictingAttributionRows !==
    counts.inventoryRows
  ) {
    return null;
  }
  if (counts.rowsWithOriginalLabel + counts.rowsMissingOriginalLabel !== counts.inventoryRows) return null;
  if (counts.stampedOriginRows + counts.unresolvedOriginRows !== counts.inventoryRows) return null;
  const labelPopulations = {
    oneRow: exactCount(labelRow.oneRow),
    twoToTenRows: exactCount(labelRow.twoToTenRows),
    elevenToOneHundredRows: exactCount(labelRow.elevenToOneHundredRows),
    oneHundredOneToOneThousandRows: exactCount(labelRow.oneHundredOneToOneThousandRows),
    overOneThousandRows: exactCount(labelRow.overOneThousandRows),
    largestLabelInventoryRows: exactCount(labelRow.largestLabelInventoryRows),
  };
  if (Object.values(labelPopulations).some((value) => value === null)) return null;
  const labels = labelPopulations as { [K in keyof typeof labelPopulations]: number };
  const buckets =
    labels.oneRow +
    labels.twoToTenRows +
    labels.elevenToOneHundredRows +
    labels.oneHundredOneToOneThousandRows +
    labels.overOneThousandRows;
  if (buckets !== counts.distinctOriginalLabels) return null;
  if (counts.distinctOriginalLabels === 0 && labels.largestLabelInventoryRows !== 0) return null;

  const byNiche = parseGroups(row.byNiche, (item) => {
    const nicheKey = safeText(item.nicheKey, 120);
    return nicheKey ? { nicheKey } : null;
  });
  const byLot = parseGroups(row.byLot, (item) => {
    const lotKey = safeText(item.lotKey, 160);
    return lotKey ? { lotKey } : null;
  });
  const byNicheAndLot = parseGroups(row.byNicheAndLot, (item) => {
    const nicheKey = safeText(item.nicheKey, 120);
    const lotKey = safeText(item.lotKey, 160);
    return nicheKey && lotKey ? { nicheKey, lotKey } : null;
  });
  const byImportRequest = parseGroups(row.byImportRequest, (item) => {
    const importRequest = safeText(item.importRequest, 160);
    return importRequest ? { importRequest } : null;
  });
  const byAgreement = parseGroups(row.byAgreement, (item) => {
    const agreement = safeText(item.agreement, 80);
    return agreement ? { agreement } : null;
  });
  const byInventoryStatus = parseGroups(row.byInventoryStatus, (item) => {
    const status = safeText(item.status, 80);
    return status ? { status } : null;
  });
  if (!byNiche || !byLot || !byNicheAndLot || !byImportRequest || !byAgreement || !byInventoryStatus) return null;
  if (
    [byNiche, byLot, byNicheAndLot, byImportRequest, byAgreement, byInventoryStatus].some(
      (rows) => sumInventory(rows) !== counts.inventoryRows
    )
  ) {
    return null;
  }

  const open = record(row.openAllocations);
  if (!open || !Array.isArray(open.byStatus) || open.byStatus.length > MAX_GROUPS) return null;
  const openRows = exactCount(open.rows);
  if (openRows === null) return null;
  const byStatus: Array<{ status: string; allocations: number }> = [];
  for (const item of open.byStatus) {
    const statusRow = record(item);
    if (!statusRow) return null;
    const status = safeText(statusRow.status, 80);
    const allocations = exactCount(statusRow.allocations);
    if (!status || allocations === null) return null;
    byStatus.push({ status, allocations });
  }
  if (byStatus.reduce((sum, item) => sum + item.allocations, 0) !== openRows) return null;

  if (!Array.isArray(row.stampedOriginClients) || row.stampedOriginClients.length > MAX_GROUPS) return null;
  const stampedOriginClients: HistoricalCensusView["stampedOriginClients"] = [];
  for (const item of row.stampedOriginClients) {
    const client = record(item);
    if (!client) return null;
    const originClientAccountId = safeAccountId(client.originClientAccountId);
    const inventoryRows = exactCount(client.inventoryRows);
    if (!originClientAccountId || inventoryRows === null) return null;
    stampedOriginClients.push({ originClientAccountId, inventoryRows });
  }
  if (stampedOriginClients.reduce((sum, item) => sum + item.inventoryRows, 0) !== counts.stampedOriginRows) {
    return null;
  }

  return {
    policyId: HISTORICAL_CAMPAIGN_CENSUS_POLICY_ID,
    provenancePolicyId: HISTORICAL_CENSUS_PROVENANCE_POLICY_ID,
    recoveryPolicyId: HISTORICAL_RECOVERY_POLICY_ID,
    ownershipStampApplied: false,
    resaleAuthorizationApplied: false,
    clientNameMatchUsed: false,
    julySourceCampaignNamePreserved: true,
    labelTextOmitted: true,
    buyerSpecificEligibilityApplied: false,
    measurement,
    population: counts,
    labelPopulations: labels,
    byNiche,
    byLot,
    byNicheAndLot,
    byImportRequest,
    byAgreement,
    byInventoryStatus,
    openAllocations: { rows: openRows, byStatus },
    stampedOriginClients,
  };
}

function parseNamedCounts(
  value: unknown,
  key: string,
  countKey: string
): Array<Record<string, string | number>> | null {
  if (!Array.isArray(value) || value.length > MAX_GROUPS) return null;
  const rows: Array<Record<string, string | number>> = [];
  for (const item of value) {
    const row = record(item);
    if (!row) return null;
    const name = safeText(row[key], 80);
    const count = exactCount(row[countKey]);
    if (!name || count === null) return null;
    rows.push({ [key]: name, [countKey]: count });
  }
  return rows;
}

export function parseHistoricalOrderReport(body: unknown): HistoricalOrderView | null {
  if (!payloadIsSafe(body)) return null;
  const row = record(body);
  if (!row) return null;
  if (row.ok !== true || row.complete !== true) return null;
  if (row.policyId !== HISTORICAL_CAMPAIGN_CENSUS_POLICY_ID) return null;
  if (row.provenancePolicyId !== HISTORICAL_CENSUS_PROVENANCE_POLICY_ID) return null;
  if (row.recoveryPolicyId !== HISTORICAL_RECOVERY_POLICY_ID) return null;
  if (row.resaleAuthorizationPersisted !== false || row.ownershipStampApplied !== false || row.contactOmitted !== true) {
    return null;
  }
  const orderNumber = safeText(row.orderNumber, 32);
  const orderStatus = safeText(row.orderStatus, 40);
  const buyerClientAccountId = safeAccountId(row.buyerClientAccountId);
  const measurement = parseMeasurement(row);
  const allocations = record(row.allocations);
  const policy = record(row.reservedRevisedPolicy);
  const delivery = record(row.delivery);
  if (!orderNumber || !isHistoricalOrderNumber(orderNumber) || !orderStatus || !buyerClientAccountId) return null;
  if (!measurement || !allocations || !policy || !delivery) return null;

  const allocationRows = exactCount(allocations.rows);
  const reservedRows = exactCount(allocations.reservedRows);
  const buyerMismatchRows = exactCount(allocations.buyerMismatchRows);
  const missingInventoryRows = exactCount(allocations.missingInventoryRows);
  const originEqualsBuyerRows = exactCount(allocations.originEqualsBuyerRows);
  const originOtherClientRows = exactCount(allocations.originOtherClientRows);
  const originUnstampedRows = exactCount(allocations.originUnstampedRows);
  if (
    allocationRows === null ||
    reservedRows === null ||
    buyerMismatchRows === null ||
    missingInventoryRows === null ||
    originEqualsBuyerRows === null ||
    originOtherClientRows === null ||
    originUnstampedRows === null
  ) {
    return null;
  }
  if (
    originEqualsBuyerRows + originOtherClientRows + originUnstampedRows + missingInventoryRows !==
    allocationRows
  ) {
    return null;
  }
  const byStatus = parseNamedCounts(allocations.byStatus, "status", "allocations");
  const byProvenance = parseNamedCounts(allocations.byProvenance, "provenance", "allocations");
  if (!byStatus || !byProvenance) return null;
  if (byStatus.reduce((sum, item) => sum + Number(item.allocations), 0) !== allocationRows) return null;
  if (byProvenance.reduce((sum, item) => sum + Number(item.allocations), 0) !== allocationRows) return null;
  if (!Array.isArray(allocations.byLot) || allocations.byLot.length > MAX_GROUPS) return null;
  const byLot: HistoricalOrderView["allocations"]["byLot"] = [];
  for (const item of allocations.byLot) {
    const lot = record(item);
    if (!lot) return null;
    const lotKey = safeText(lot.lotKey, 160);
    const lotAllocations = exactCount(lot.allocations);
    const unresolvedOrigin = exactCount(lot.unresolvedOrigin);
    const originEqualsBuyer = exactCount(lot.originEqualsBuyer);
    const originOtherClient = exactCount(lot.originOtherClient);
    const originUnstamped = exactCount(lot.originUnstamped);
    if (
      !lotKey ||
      lotAllocations === null ||
      unresolvedOrigin === null ||
      originEqualsBuyer === null ||
      originOtherClient === null ||
      originUnstamped === null
    ) {
      return null;
    }
    if (originEqualsBuyer + originOtherClient + originUnstamped > lotAllocations) return null;
    if (unresolvedOrigin > lotAllocations) return null;
    byLot.push({ lotKey, allocations: lotAllocations, unresolvedOrigin, originEqualsBuyer, originOtherClient, originUnstamped });
  }
  if (byLot.reduce((sum, lot) => sum + lot.allocations, 0) !== allocationRows) return null;

  const reservedRevisedPolicy = {
    wouldBlockUnresolvedOrigin: exactCount(policy.wouldBlockUnresolvedOrigin),
    wouldBlockSameOrigin: exactCount(policy.wouldBlockSameOrigin),
    wouldBlockUntilResaleAuthorization: exactCount(policy.wouldBlockUntilResaleAuthorization),
    outsideHistoricalGate: exactCount(policy.outsideHistoricalGate),
    wouldBlockMissingInventory: exactCount(policy.wouldBlockMissingInventory),
  };
  if (Object.values(reservedRevisedPolicy).some((value) => value === null)) return null;
  const revised = reservedRevisedPolicy as { [K in keyof typeof reservedRevisedPolicy]: number };
  if (
    revised.wouldBlockUnresolvedOrigin +
      revised.wouldBlockSameOrigin +
      revised.wouldBlockUntilResaleAuthorization +
      revised.outsideHistoricalGate +
      revised.wouldBlockMissingInventory !==
    reservedRows
  ) {
    return null;
  }

  const packages = exactCount(delivery.packages);
  const spreadsheetDeliveredPackages = exactCount(delivery.spreadsheetDeliveredPackages);
  const notifyByStatus = parseNamedCounts(delivery.notifyByStatus, "status", "packages");
  const instructionsByStatus = parseNamedCounts(delivery.instructionsByStatus, "status", "instructions");
  const replacementsByStatus = parseNamedCounts(row.replacementsByStatus, "status", "requests");
  if (
    packages === null ||
    spreadsheetDeliveredPackages === null ||
    spreadsheetDeliveredPackages > packages ||
    !notifyByStatus ||
    !instructionsByStatus ||
    !replacementsByStatus
  ) {
    return null;
  }
  if (notifyByStatus.reduce((sum, item) => sum + Number(item.packages), 0) !== packages) return null;

  return {
    policyId: HISTORICAL_CAMPAIGN_CENSUS_POLICY_ID,
    provenancePolicyId: HISTORICAL_CENSUS_PROVENANCE_POLICY_ID,
    recoveryPolicyId: HISTORICAL_RECOVERY_POLICY_ID,
    orderNumber,
    orderStatus,
    buyerClientAccountId,
    resaleAuthorizationPersisted: false,
    ownershipStampApplied: false,
    contactOmitted: true,
    measurement,
    allocations: {
      rows: allocationRows,
      reservedRows,
      buyerMismatchRows,
      missingInventoryRows,
      originEqualsBuyerRows,
      originOtherClientRows,
      originUnstampedRows,
      byStatus: byStatus.map((item) => ({ status: String(item.status), allocations: Number(item.allocations) })),
      byProvenance: byProvenance.map((item) => ({
        provenance: String(item.provenance),
        allocations: Number(item.allocations),
      })),
      byLot,
    },
    reservedRevisedPolicy: revised,
    delivery: {
      packages,
      spreadsheetDeliveredPackages,
      notifyByStatus: notifyByStatus.map((item) => ({ status: String(item.status), packages: Number(item.packages) })),
      instructionsByStatus: instructionsByStatus.map((item) => ({
        status: String(item.status),
        instructions: Number(item.instructions),
      })),
    },
    replacementsByStatus: replacementsByStatus.map((item) => ({
      status: String(item.status),
      requests: Number(item.requests),
    })),
  };
}

type AdminFetch = { ok: true; data: unknown } | { ok: false; status: number; body: string };

export function historicalCensusModelFromAdminFetch(result: AdminFetch): HistoricalCensusPanelModel {
  if (!result.ok) {
    if (result.status === 404 && codeFromBody(result.body) === "historical_campaign_census_disabled") {
      return { state: "disabled" };
    }
    return { state: "unavailable" };
  }
  const report = parseHistoricalCensusReport(result.data);
  if (!report) return { state: "unavailable" };
  return { state: "ready", report };
}

export function historicalOrderModelFromAdminFetch(
  result: AdminFetch,
  requestedOrderNumber: string
): HistoricalOrderPanelModel {
  if (!result.ok) {
    const code = codeFromBody(result.body);
    if (result.status === 404 && code === "historical_campaign_census_disabled") return { state: "disabled" };
    if (result.status === 404 && code === "historical_order_not_found") {
      return { state: "not_found", orderNumber: orderNumberFromBody(result.body, requestedOrderNumber) };
    }
    if (result.status === 400 && code === "historical_order_number_invalid") return { state: "invalid" };
    return { state: "unavailable" };
  }
  const report = parseHistoricalOrderReport(result.data);
  if (!report || report.orderNumber !== requestedOrderNumber) return { state: "unavailable" };
  return { state: "ready", report };
}
