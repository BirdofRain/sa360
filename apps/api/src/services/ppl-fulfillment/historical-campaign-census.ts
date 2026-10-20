import { PrismaClient } from "@prisma/client";

import { PPL_PROVENANCE_ELIGIBILITY_POLICY_ID } from "./provenance-eligibility.js";
import { withProvenanceAuditSnapshot } from "./provenance-impact-audit.js";
import {
  ProvenanceImpactShapeError,
  exactCount,
  responseContainsSecret,
} from "./provenance-impact-report.js";
import {
  HISTORICAL_CENSUS_MAX_GROUPS,
  HISTORICAL_CENSUS_STATEMENT_TIMEOUT_MS,
  HISTORICAL_ORDER_STATEMENT_TIMEOUT_MS,
  buildHistoricalCampaignCensusQuery,
  buildHistoricalOrderDrilldownQuery,
} from "./historical-campaign-census-query.js";

export const HISTORICAL_CAMPAIGN_CENSUS_POLICY_ID = "historical-campaign-census-v1" as const;
export const HISTORICAL_RECOVERY_POLICY_ID = "historical-campaign-recovery-v1" as const;
export const HISTORICAL_CENSUS_UNAVAILABLE = "historical_campaign_census_unavailable" as const;
export const HISTORICAL_ORDER_UNAVAILABLE = "historical_order_drilldown_unavailable" as const;
export const HISTORICAL_ORDER_NOT_FOUND = "historical_order_not_found" as const;

const EMAILISH = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const UNSAFE_KEYS = new Set([
  "phone",
  "email",
  "firstname",
  "lastname",
  "clientdisplayname",
  "clientname",
  "sourcecampaignname",
  "campaignname",
  "csvcontent",
  "rawpayload",
  "rawpayloadjson",
  "normalizedpayload",
  "normalizedpayloadjson",
  "beneficiary",
  "dateofbirth",
  "password",
  "token",
  "secret",
  "authorization",
  "apikey",
]);

export class HistoricalCensusShapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HistoricalCensusShapeError";
  }
}

export type HistoricalCensusGroup = {
  inventoryRows: number;
  distinctOriginalLabels: number;
  unresolvedOriginRows: number;
  stampedOriginRows: number;
  consistentOriginalLabelRows: number;
  missingAttributionRows: number;
  conflictingAttributionRows: number;
  reservedRows: number;
};

export type HistoricalCensusReport = {
  ok: true;
  complete: true;
  policyId: typeof HISTORICAL_CAMPAIGN_CENSUS_POLICY_ID;
  provenancePolicyId: typeof PPL_PROVENANCE_ELIGIBILITY_POLICY_ID;
  recoveryPolicyId: typeof HISTORICAL_RECOVERY_POLICY_ID;
  ownershipStampApplied: false;
  resaleAuthorizationApplied: false;
  clientNameMatchUsed: false;
  julySourceCampaignNamePreserved: true;
  labelTextOmitted: true;
  buyerSpecificEligibilityApplied: false;
  measurement: {
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
  byNiche: Array<HistoricalCensusGroup & { nicheKey: string }>;
  byLot: Array<HistoricalCensusGroup & { lotKey: string }>;
  byNicheAndLot: Array<HistoricalCensusGroup & { nicheKey: string; lotKey: string }>;
  byImportRequest: Array<HistoricalCensusGroup & { importRequest: string }>;
  byAgreement: Array<HistoricalCensusGroup & { agreement: string }>;
  byInventoryStatus: Array<HistoricalCensusGroup & { status: string }>;
  openAllocations: {
    rows: number;
    byStatus: Array<{ status: string; allocations: number }>;
  };
  stampedOriginClients: Array<{ originClientAccountId: string; inventoryRows: number }>;
};

export type HistoricalCensusUnavailable = {
  ok: false;
  complete: false;
  code: typeof HISTORICAL_CENSUS_UNAVAILABLE;
  reason:
    | "census_already_running"
    | "statement_timeout"
    | "snapshot_failed"
    | "reconciliation_failed"
    | "unsafe_response"
    | "incomplete_result";
  policyId: typeof HISTORICAL_CAMPAIGN_CENSUS_POLICY_ID;
  measurement: {
    readOnlySnapshot: "incomplete";
    databaseIdentity: null;
    operatorVerifiedProduction: false;
    environmentLabelTrusted: false;
  };
};

export type HistoricalOrderReport = {
  ok: true;
  complete: true;
  policyId: typeof HISTORICAL_CAMPAIGN_CENSUS_POLICY_ID;
  provenancePolicyId: typeof PPL_PROVENANCE_ELIGIBILITY_POLICY_ID;
  recoveryPolicyId: typeof HISTORICAL_RECOVERY_POLICY_ID;
  orderNumber: string;
  orderStatus: string;
  buyerClientAccountId: string;
  resaleAuthorizationPersisted: false;
  ownershipStampApplied: false;
  contactOmitted: true;
  measurement: HistoricalCensusReport["measurement"];
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

export type HistoricalOrderNotFound = {
  ok: false;
  complete: false;
  code: typeof HISTORICAL_ORDER_NOT_FOUND;
  orderNumber: string;
  policyId: typeof HISTORICAL_CAMPAIGN_CENSUS_POLICY_ID;
};

export type HistoricalOrderUnavailable = {
  ok: false;
  complete: false;
  code: typeof HISTORICAL_ORDER_UNAVAILABLE;
  reason: "statement_timeout" | "snapshot_failed" | "reconciliation_failed" | "unsafe_response" | "incomplete_result";
  orderNumber: string;
  policyId: typeof HISTORICAL_CAMPAIGN_CENSUS_POLICY_ID;
  measurement: HistoricalCensusUnavailable["measurement"];
};

export type HistoricalCensusResult = HistoricalCensusReport | HistoricalCensusUnavailable;
export type HistoricalOrderResult = HistoricalOrderReport | HistoricalOrderNotFound | HistoricalOrderUnavailable;

let censusInFlight = false;

function unavailableCensus(reason: HistoricalCensusUnavailable["reason"]): HistoricalCensusUnavailable {
  return {
    ok: false,
    complete: false,
    code: HISTORICAL_CENSUS_UNAVAILABLE,
    reason,
    policyId: HISTORICAL_CAMPAIGN_CENSUS_POLICY_ID,
    measurement: {
      readOnlySnapshot: "incomplete",
      databaseIdentity: null,
      operatorVerifiedProduction: false,
      environmentLabelTrusted: false,
    },
  };
}

function unavailableOrder(
  orderNumber: string,
  reason: HistoricalOrderUnavailable["reason"]
): HistoricalOrderUnavailable {
  return {
    ok: false,
    complete: false,
    code: HISTORICAL_ORDER_UNAVAILABLE,
    reason,
    orderNumber,
    policyId: HISTORICAL_CAMPAIGN_CENSUS_POLICY_ID,
    measurement: unavailableCensus("incomplete_result").measurement,
  };
}

function isStatementTimeout(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: string }).code;
  if (code === "57014") return true;
  const message = error instanceof Error ? error.message : "";
  return /statement timeout|canceling statement/i.test(message);
}

function jsonValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  return JSON.parse(value) as unknown;
}

const ACCOUNT_ID_KEYS = new Set(["buyerclientaccountid", "originclientaccountid"]);

function normalizedKey(key: string): string {
  return key.toLowerCase().replace(/[_-]/g, "");
}

function safeToken(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) {
    throw new HistoricalCensusShapeError(`unsafe_value:${label}`);
  }
  if (/[\u0000-\u001f@]/.test(value) || value.includes("://")) {
    throw new HistoricalCensusShapeError(`unsafe_value:${label}`);
  }
  return value;
}

/** Client account ids are identifiers. A display name or contact value is rejected. */
function safeAccountId(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 120) {
    throw new HistoricalCensusShapeError(`unsafe_value:${label}`);
  }
  if (/[\u0000-\u001f\s]/.test(value) || value.includes("://")) {
    throw new HistoricalCensusShapeError(`unsafe_value:${label}`);
  }
  return value;
}

function assertWalkSafe(value: unknown, parentKey = ""): void {
  if (Array.isArray(value)) {
    for (const item of value) assertWalkSafe(item, parentKey);
    return;
  }
  if (!value || typeof value !== "object") {
    if (
      typeof value === "string" &&
      !ACCOUNT_ID_KEYS.has(normalizedKey(parentKey)) &&
      EMAILISH.test(value)
    ) {
      throw new HistoricalCensusShapeError("unsafe_string");
    }
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (UNSAFE_KEYS.has(normalizedKey(key))) {
      throw new HistoricalCensusShapeError(`unsafe_key:${key}`);
    }
    assertWalkSafe(child, key);
  }
}

function measurement(row: Record<string, unknown>): HistoricalCensusReport["measurement"] {
  const name = safeToken(row.database_name, "database_name", 80);
  const serverAddress = safeToken(row.server_address, "server_address", 80);
  const capturedAt = row.captured_at;
  const iso =
    capturedAt instanceof Date
      ? capturedAt.toISOString()
      : typeof capturedAt === "string"
        ? new Date(capturedAt).toISOString()
        : "";
  if (!iso || Number.isNaN(Date.parse(iso))) throw new HistoricalCensusShapeError("captured_at");
  return {
    readOnlySnapshot: "complete",
    databaseIdentity: { source: "postgresql", name, serverAddress, capturedAt: iso },
    operatorVerifiedProduction: false,
    environmentLabelTrusted: false,
  };
}

function groupMetrics(record: Record<string, unknown>, label: string): HistoricalCensusGroup {
  const metrics: HistoricalCensusGroup = {
    inventoryRows: exactCount(record.inventoryRows, `${label}.inventoryRows`),
    distinctOriginalLabels: exactCount(record.distinctOriginalLabels, `${label}.distinct`),
    unresolvedOriginRows: exactCount(record.unresolvedOriginRows, `${label}.unresolved`),
    stampedOriginRows: exactCount(record.stampedOriginRows, `${label}.stamped`),
    consistentOriginalLabelRows: exactCount(record.consistentOriginalLabelRows, `${label}.consistent`),
    missingAttributionRows: exactCount(record.missingAttributionRows, `${label}.missing`),
    conflictingAttributionRows: exactCount(record.conflictingAttributionRows, `${label}.conflicting`),
    reservedRows: exactCount(record.reservedRows, `${label}.reserved`),
  };
  const attribution =
    metrics.consistentOriginalLabelRows + metrics.missingAttributionRows + metrics.conflictingAttributionRows;
  if (attribution !== metrics.inventoryRows) throw new HistoricalCensusShapeError(`group_sum:${label}`);
  if (metrics.stampedOriginRows + metrics.unresolvedOriginRows !== metrics.inventoryRows) {
    throw new HistoricalCensusShapeError(`group_origin:${label}`);
  }
  if (metrics.reservedRows > metrics.inventoryRows) {
    throw new HistoricalCensusShapeError(`group_reserved:${label}`);
  }
  return metrics;
}

function parseGroups<T extends HistoricalCensusGroup>(
  value: unknown,
  label: string,
  identity: (record: Record<string, unknown>, index: number) => Omit<T, keyof HistoricalCensusGroup>
): T[] {
  const parsed = jsonValue(value);
  if (!Array.isArray(parsed)) throw new HistoricalCensusShapeError(`groups:${label}`);
  if (parsed.length > HISTORICAL_CENSUS_MAX_GROUPS) {
    throw new HistoricalCensusShapeError(`group_limit:${label}`);
  }
  return parsed.map((item, index) => {
    if (!item || typeof item !== "object") throw new HistoricalCensusShapeError(`groups:${label}`);
    const record = item as Record<string, unknown>;
    return { ...identity(record, index), ...groupMetrics(record, `${label}.${index}`) } as T;
  });
}

function sumGroups(rows: HistoricalCensusGroup[]): number {
  return rows.reduce((sum, row) => sum + row.inventoryRows, 0);
}

function parseCountRows(
  value: unknown,
  label: string,
  key: string,
  countKey: string
): Array<Record<string, string | number>> {
  const parsed = jsonValue(value);
  if (!Array.isArray(parsed)) throw new HistoricalCensusShapeError(`counts:${label}`);
  if (parsed.length > HISTORICAL_CENSUS_MAX_GROUPS) throw new HistoricalCensusShapeError(`group_limit:${label}`);
  return parsed.map((item, index) => {
    if (!item || typeof item !== "object") throw new HistoricalCensusShapeError(`counts:${label}`);
    const record = item as Record<string, unknown>;
    return {
      [key]: safeToken(record[key], `${label}.${index}`, 80),
      [countKey]: exactCount(record[countKey], `${label}.${index}`),
    };
  });
}

export function assembleHistoricalCensusReport(row: Record<string, unknown>): HistoricalCensusReport {
  const population = {
    inventoryRows: exactCount(row.inventory_rows, "inventory_rows"),
    unresolvedOriginRows: exactCount(row.unresolved_origin_rows, "unresolved_origin_rows"),
    stampedOriginRows: exactCount(row.stamped_origin_rows, "stamped_origin_rows"),
    consistentOriginalLabelRows: exactCount(row.consistent_original_label_rows, "consistent"),
    missingAttributionRows: exactCount(row.missing_attribution_rows, "missing"),
    conflictingAttributionRows: exactCount(row.conflicting_attribution_rows, "conflicting"),
    rowsWithOriginalLabel: exactCount(row.rows_with_original_label, "rows_with_original_label"),
    rowsMissingOriginalLabel: exactCount(row.rows_missing_original_label, "rows_missing_original_label"),
    distinctOriginalLabels: exactCount(row.distinct_original_labels, "distinct_original_labels"),
  };
  const labelPopulations = {
    oneRow: exactCount(row.labels_one, "labels_one"),
    twoToTenRows: exactCount(row.labels_two_to_ten, "labels_two_to_ten"),
    elevenToOneHundredRows: exactCount(row.labels_eleven_to_one_hundred, "labels_eleven"),
    oneHundredOneToOneThousandRows: exactCount(row.labels_one_hundred_one_to_one_thousand, "labels_101"),
    overOneThousandRows: exactCount(row.labels_over_one_thousand, "labels_over"),
    largestLabelInventoryRows: exactCount(row.largest_label_inventory_rows, "largest_label"),
  };
  const attribution =
    population.consistentOriginalLabelRows +
    population.missingAttributionRows +
    population.conflictingAttributionRows;
  if (attribution !== population.inventoryRows) throw new HistoricalCensusShapeError("attribution_sum");
  if (population.rowsWithOriginalLabel + population.rowsMissingOriginalLabel !== population.inventoryRows) {
    throw new HistoricalCensusShapeError("label_presence_sum");
  }
  if (population.stampedOriginRows + population.unresolvedOriginRows !== population.inventoryRows) {
    throw new HistoricalCensusShapeError("origin_partition");
  }
  const labelBuckets =
    labelPopulations.oneRow +
    labelPopulations.twoToTenRows +
    labelPopulations.elevenToOneHundredRows +
    labelPopulations.oneHundredOneToOneThousandRows +
    labelPopulations.overOneThousandRows;
  if (labelBuckets !== population.distinctOriginalLabels) throw new HistoricalCensusShapeError("label_bucket_sum");
  if (population.distinctOriginalLabels === 0 && labelPopulations.largestLabelInventoryRows !== 0) {
    throw new HistoricalCensusShapeError("largest_label");
  }

  const byNiche = parseGroups<HistoricalCensusGroup & { nicheKey: string }>(row.by_niche, "niche", (record, index) => ({
    nicheKey: safeToken(record.nicheKey, `niche.${index}`, 120),
  }));
  const byLot = parseGroups<HistoricalCensusGroup & { lotKey: string }>(row.by_lot, "lot", (record, index) => ({
    lotKey: safeToken(record.lotKey, `lot.${index}`, 160),
  }));
  const byNicheAndLot = parseGroups<HistoricalCensusGroup & { nicheKey: string; lotKey: string }>(
    row.by_niche_and_lot,
    "niche_lot",
    (record, index) => ({
      nicheKey: safeToken(record.nicheKey, `niche_lot.${index}.niche`, 120),
      lotKey: safeToken(record.lotKey, `niche_lot.${index}.lot`, 160),
    })
  );
  const byImportRequest = parseGroups<HistoricalCensusGroup & { importRequest: string }>(
    row.by_import_request,
    "import",
    (record, index) => ({
      importRequest: safeToken(record.importRequest, `import.${index}`, 160),
    })
  );
  const byAgreement = parseGroups<HistoricalCensusGroup & { agreement: string }>(
    row.by_agreement,
    "agreement",
    (record, index) => ({
      agreement: safeToken(record.agreement, `agreement.${index}`, 80),
    })
  );
  const byInventoryStatus = parseGroups<HistoricalCensusGroup & { status: string }>(
    row.by_inventory_status,
    "status",
    (record, index) => ({
      status: safeToken(record.status, `status.${index}`, 80),
    })
  );
  for (const [label, rows] of [
    ["niche", byNiche],
    ["lot", byLot],
    ["niche_lot", byNicheAndLot],
    ["import", byImportRequest],
    ["agreement", byAgreement],
    ["status", byInventoryStatus],
  ] as const) {
    if (sumGroups(rows) !== population.inventoryRows) throw new HistoricalCensusShapeError(`breakdown_sum:${label}`);
  }

  const openByStatus = parseCountRows(row.open_allocations_by_status, "open", "status", "allocations").map(
    (item) => ({ status: String(item.status), allocations: Number(item.allocations) })
  );
  const openRows = exactCount(row.open_allocation_rows, "open_allocation_rows");
  if (openByStatus.reduce((sum, item) => sum + item.allocations, 0) !== openRows) {
    throw new HistoricalCensusShapeError("open_allocation_sum");
  }

  const stampedParsed = jsonValue(row.stamped_origin_clients);
  if (!Array.isArray(stampedParsed)) throw new HistoricalCensusShapeError("stamped_clients");
  if (stampedParsed.length > HISTORICAL_CENSUS_MAX_GROUPS) {
    throw new HistoricalCensusShapeError("group_limit:stamped_clients");
  }
  const stampedOriginClients = stampedParsed.map((item, index) => {
    if (!item || typeof item !== "object") throw new HistoricalCensusShapeError("stamped_clients");
    const record = item as Record<string, unknown>;
    return {
      originClientAccountId: safeAccountId(record.originClientAccountId, `origin.${index}`),
      inventoryRows: exactCount(record.inventoryRows, `origin.${index}`),
    };
  });
  const stampedFromClients = stampedOriginClients.reduce((sum, item) => sum + item.inventoryRows, 0);
  if (stampedFromClients !== population.stampedOriginRows) {
    throw new HistoricalCensusShapeError("stamped_client_sum");
  }

  const report: HistoricalCensusReport = {
    ok: true,
    complete: true,
    policyId: HISTORICAL_CAMPAIGN_CENSUS_POLICY_ID,
    provenancePolicyId: PPL_PROVENANCE_ELIGIBILITY_POLICY_ID,
    recoveryPolicyId: HISTORICAL_RECOVERY_POLICY_ID,
    ownershipStampApplied: false,
    resaleAuthorizationApplied: false,
    clientNameMatchUsed: false,
    julySourceCampaignNamePreserved: true,
    labelTextOmitted: true,
    buyerSpecificEligibilityApplied: false,
    measurement: measurement(row),
    population,
    labelPopulations,
    byNiche,
    byLot,
    byNicheAndLot,
    byImportRequest,
    byAgreement,
    byInventoryStatus,
    openAllocations: { rows: openRows, byStatus: openByStatus },
    stampedOriginClients,
  };
  assertWalkSafe(report);
  return report;
}

function countList<T extends Record<string, string | number>>(rows: T[], key: string): number {
  return rows.reduce((sum, row) => sum + Number(row[key]), 0);
}

export function assembleHistoricalOrderReport(
  row: Record<string, unknown>,
  requestedOrderNumber: string
): HistoricalOrderReport | HistoricalOrderNotFound {
  const orderRows = exactCount(row.order_rows, "order_rows");
  if (orderRows === 0) {
    return {
      ok: false,
      complete: false,
      code: HISTORICAL_ORDER_NOT_FOUND,
      orderNumber: requestedOrderNumber,
      policyId: HISTORICAL_CAMPAIGN_CENSUS_POLICY_ID,
    };
  }
  if (orderRows !== 1) throw new HistoricalCensusShapeError("order_rows");
  const orderNumber = safeToken(row.order_number, "order_number", 32);
  if (orderNumber !== requestedOrderNumber) throw new HistoricalCensusShapeError("order_number_mismatch");

  const byStatus = parseCountRows(row.by_status, "alloc_status", "status", "allocations").map((item) => ({
    status: String(item.status),
    allocations: Number(item.allocations),
  }));
  const byProvenance = parseCountRows(row.by_provenance, "provenance", "provenance", "allocations").map((item) => ({
    provenance: String(item.provenance),
    allocations: Number(item.allocations),
  }));
  const lotsParsed = jsonValue(row.by_lot);
  if (!Array.isArray(lotsParsed)) throw new HistoricalCensusShapeError("lots");
  const byLot = lotsParsed.map((item, index) => {
    if (!item || typeof item !== "object") throw new HistoricalCensusShapeError("lots");
    const record = item as Record<string, unknown>;
    const lot = {
      lotKey: safeToken(record.lotKey, `lot.${index}`, 160),
      allocations: exactCount(record.allocations, `lot.${index}.allocations`),
      unresolvedOrigin: exactCount(record.unresolvedOrigin, `lot.${index}.unresolved`),
      originEqualsBuyer: exactCount(record.originEqualsBuyer, `lot.${index}.same`),
      originOtherClient: exactCount(record.originOtherClient, `lot.${index}.other`),
      originUnstamped: exactCount(record.originUnstamped, `lot.${index}.unstamped`),
    };
    const originParts = lot.originEqualsBuyer + lot.originOtherClient + lot.originUnstamped;
    if (originParts > lot.allocations || lot.unresolvedOrigin > lot.allocations) {
      throw new HistoricalCensusShapeError("lot_sum");
    }
    return lot;
  });
  const allocationRows = exactCount(row.allocation_rows, "allocation_rows");
  if (countList(byStatus, "allocations") !== allocationRows) throw new HistoricalCensusShapeError("status_sum");
  if (countList(byProvenance, "allocations") !== allocationRows) throw new HistoricalCensusShapeError("provenance_sum");
  if (byLot.reduce((sum, lot) => sum + lot.allocations, 0) !== allocationRows) {
    throw new HistoricalCensusShapeError("lot_allocation_sum");
  }

  const reservedRevisedPolicy = {
    wouldBlockUnresolvedOrigin: exactCount(row.reserved_block_unresolved, "reserved_unresolved"),
    wouldBlockSameOrigin: exactCount(row.reserved_block_same_origin, "reserved_same"),
    wouldBlockUntilResaleAuthorization: exactCount(row.reserved_block_resale, "reserved_resale"),
    outsideHistoricalGate: exactCount(row.reserved_outside_historical, "reserved_outside"),
    wouldBlockMissingInventory: exactCount(row.reserved_block_missing, "reserved_missing"),
  };
  const reservedRows = exactCount(row.reserved_rows, "reserved_rows");
  const reservedPolicySum =
    reservedRevisedPolicy.wouldBlockUnresolvedOrigin +
    reservedRevisedPolicy.wouldBlockSameOrigin +
    reservedRevisedPolicy.wouldBlockUntilResaleAuthorization +
    reservedRevisedPolicy.outsideHistoricalGate +
    reservedRevisedPolicy.wouldBlockMissingInventory;
  if (reservedPolicySum !== reservedRows) throw new HistoricalCensusShapeError("reserved_policy_sum");

  const notifyByStatus = parseCountRows(row.notify_by_status, "notify", "status", "packages").map((item) => ({
    status: String(item.status),
    packages: Number(item.packages),
  }));
  const instructionsByStatus = parseCountRows(row.instructions_by_status, "instruction", "status", "instructions").map(
    (item) => ({ status: String(item.status), instructions: Number(item.instructions) })
  );
  const replacementsByStatus = parseCountRows(row.replacements_by_status, "replacement", "status", "requests").map(
    (item) => ({ status: String(item.status), requests: Number(item.requests) })
  );
  const packages = exactCount(row.export_packages, "export_packages");
  if (countList(notifyByStatus, "packages") !== packages) throw new HistoricalCensusShapeError("notify_sum");

  const report: HistoricalOrderReport = {
    ok: true,
    complete: true,
    policyId: HISTORICAL_CAMPAIGN_CENSUS_POLICY_ID,
    provenancePolicyId: PPL_PROVENANCE_ELIGIBILITY_POLICY_ID,
    recoveryPolicyId: HISTORICAL_RECOVERY_POLICY_ID,
    orderNumber,
    orderStatus: safeToken(row.order_status, "order_status", 40),
    buyerClientAccountId: safeAccountId(row.buyer_client_account_id, "buyer"),
    resaleAuthorizationPersisted: false,
    ownershipStampApplied: false,
    contactOmitted: true,
    measurement: measurement(row),
    allocations: {
      rows: allocationRows,
      reservedRows,
      buyerMismatchRows: exactCount(row.buyer_mismatch_rows, "buyer_mismatch"),
      missingInventoryRows: exactCount(row.missing_inventory_rows, "missing_inventory"),
      originEqualsBuyerRows: exactCount(row.origin_equals_buyer_rows, "origin_equals"),
      originOtherClientRows: exactCount(row.origin_other_client_rows, "origin_other"),
      originUnstampedRows: exactCount(row.origin_unstamped_rows, "origin_unstamped"),
      byStatus,
      byProvenance,
      byLot,
    },
    reservedRevisedPolicy,
    delivery: {
      packages,
      spreadsheetDeliveredPackages: exactCount(row.spreadsheet_delivered_packages, "delivered_packages"),
      notifyByStatus,
      instructionsByStatus,
    },
    replacementsByStatus,
  };
  if (report.delivery.spreadsheetDeliveredPackages > report.delivery.packages) {
    throw new HistoricalCensusShapeError("delivered_packages");
  }
  const originAccounted =
    report.allocations.originEqualsBuyerRows +
    report.allocations.originOtherClientRows +
    report.allocations.originUnstampedRows +
    report.allocations.missingInventoryRows;
  if (originAccounted !== allocationRows) throw new HistoricalCensusShapeError("origin_account_sum");
  assertWalkSafe(report);
  return report;
}

export type HistoricalCensusRunOptions = {
  afterSnapshotOpened?: () => Promise<void>;
};

export async function runHistoricalCampaignCensus(
  db: PrismaClient,
  options?: HistoricalCensusRunOptions
): Promise<HistoricalCensusResult> {
  if (censusInFlight) return unavailableCensus("census_already_running");
  censusInFlight = true;
  try {
    const report = await withProvenanceAuditSnapshot(
      db,
      async (tx) => {
        const rows = await tx.$queryRaw<Array<Record<string, unknown>>>(buildHistoricalCampaignCensusQuery());
        if (rows.length !== 1) throw new HistoricalCensusShapeError("incomplete_result");
        return assembleHistoricalCensusReport(rows[0] ?? {});
      },
      {
        statementTimeoutMs: HISTORICAL_CENSUS_STATEMENT_TIMEOUT_MS,
        afterSnapshotOpened: options?.afterSnapshotOpened,
      }
    );
    if (responseContainsSecret(JSON.stringify(report))) return unavailableCensus("unsafe_response");
    return report;
  } catch (error) {
    if (error instanceof HistoricalCensusShapeError || error instanceof ProvenanceImpactShapeError) {
      return unavailableCensus(
        error.message === "incomplete_result" ? "incomplete_result" : "reconciliation_failed"
      );
    }
    if (isStatementTimeout(error)) return unavailableCensus("statement_timeout");
    return unavailableCensus("snapshot_failed");
  } finally {
    censusInFlight = false;
  }
}

export async function runHistoricalOrderDrilldown(
  db: PrismaClient,
  orderNumber: string
): Promise<HistoricalOrderResult> {
  try {
    const report = await withProvenanceAuditSnapshot(
      db,
      async (tx) => {
        const rows = await tx.$queryRaw<Array<Record<string, unknown>>>(
          buildHistoricalOrderDrilldownQuery(orderNumber)
        );
        if (rows.length !== 1) throw new HistoricalCensusShapeError("incomplete_result");
        return assembleHistoricalOrderReport(rows[0] ?? {}, orderNumber);
      },
      { statementTimeoutMs: HISTORICAL_ORDER_STATEMENT_TIMEOUT_MS }
    );
    if (report.ok && responseContainsSecret(JSON.stringify(report))) {
      return unavailableOrder(orderNumber, "unsafe_response");
    }
    return report;
  } catch (error) {
    if (error instanceof HistoricalCensusShapeError || error instanceof ProvenanceImpactShapeError) {
      return unavailableOrder(
        orderNumber,
        error.message === "incomplete_result" ? "incomplete_result" : "reconciliation_failed"
      );
    }
    if (isStatementTimeout(error)) return unavailableOrder(orderNumber, "statement_timeout");
    return unavailableOrder(orderNumber, "snapshot_failed");
  }
}

export function historicalCensusQueriesAreReadOnly(): boolean {
  buildHistoricalCampaignCensusQuery();
  buildHistoricalOrderDrilldownQuery("LO-1053");
  return true;
}
