import {
  isCommerceAgeBucketKey,
  pplAgedBucketLabel,
  type CommerceAgeBucketKey,
} from "@sa360/shared";

import {
  buildPplOrderLineCreateData,
  readPplOrderLineMetadata,
  snapshotPricedPplFromOrderLines,
  type PplOrderLinePricingSnapshot,
} from "../ppl-fulfillment/ppl-order-pricing.js";

export const CLIENT_AGED_OPTIONS_MARKER = "sa360.portalAgedOptions.v1";

export const CLIENT_SHORTFALL_POLICIES = [
  "REFUND_UNFILLED",
  "ALLOW_OLDER_WITH_PRICE_ADJUSTMENT",
] as const;

export type ClientAgedShortfallPolicy = (typeof CLIENT_SHORTFALL_POLICIES)[number];

const SHORTFALL_SET = new Set<string>(CLIENT_SHORTFALL_POLICIES);

export type ClientAgedCommerceOptions = {
  requestedAgeBucket: CommerceAgeBucketKey | null;
  shortfallPolicy: ClientAgedShortfallPolicy | null;
};

export type PresentedAgedCommerce = {
  requestedAgeBucket: CommerceAgeBucketKey;
  shortfallPolicy: ClientAgedShortfallPolicy;
  label: string;
};

export type PresentedPricedPpl = {
  commerceAgeBucketKey: CommerceAgeBucketKey;
  pricingVersion: string;
  unitPriceCents: number;
  lineTotalCents: number;
  requestedQuantity: number;
  label: string;
};

export function isClientAgedShortfallPolicy(
  value: unknown
): value is ClientAgedShortfallPolicy {
  return typeof value === "string" && SHORTFALL_SET.has(value);
}

export function countPortalAgedOptionMarkers(notes: string | null | undefined): number {
  if (!notes) return 0;
  let count = 0;
  let from = 0;
  while (from < notes.length) {
    const index = notes.indexOf(CLIENT_AGED_OPTIONS_MARKER, from);
    if (index < 0) break;
    count += 1;
    from = index + CLIENT_AGED_OPTIONS_MARKER.length;
  }
  return count;
}

function parseAgedOptionsObject(raw: Record<string, unknown>): ClientAgedCommerceOptions {
  const bucket = typeof raw.requestedAgeBucket === "string" ? raw.requestedAgeBucket.trim() : "";
  const shortfall = typeof raw.shortfallPolicy === "string" ? raw.shortfallPolicy.trim() : "";
  return {
    requestedAgeBucket: isCommerceAgeBucketKey(bucket) ? bucket : null,
    shortfallPolicy: isClientAgedShortfallPolicy(shortfall) ? shortfall : null,
  };
}

export function readClientAgedCommerceOptions(
  notes: string | null | undefined
): ClientAgedCommerceOptions {
  const empty: ClientAgedCommerceOptions = {
    requestedAgeBucket: null,
    shortfallPolicy: null,
  };
  if (!notes) return empty;
  const markerIndex = notes.indexOf(CLIENT_AGED_OPTIONS_MARKER);
  if (markerIndex < 0) return empty;
  const jsonMatch = notes
    .slice(markerIndex + CLIENT_AGED_OPTIONS_MARKER.length)
    .match(/\{[\s\S]*?\}/);
  if (!jsonMatch) return empty;
  try {
    const parsed: unknown = JSON.parse(jsonMatch[0]);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return empty;
    return parseAgedOptionsObject(parsed as Record<string, unknown>);
  } catch {
    return empty;
  }
}

export type ExclusivePortalAgedOptions =
  | { ok: true; options: { requestedAgeBucket: CommerceAgeBucketKey; shortfallPolicy: ClientAgedShortfallPolicy } }
  | { ok: false; code: "notes_request_incomplete" | "notes_marker_conflict"; reasons: string[] };

/** Repair-only: exactly one marker, one canonical bucket, one valid shortfall. */
export function readExclusiveClientAgedCommerceOptions(
  notes: string | null | undefined
): ExclusivePortalAgedOptions {
  const markerCount = countPortalAgedOptionMarkers(notes);
  if (markerCount === 0) {
    return {
      ok: false,
      code: "notes_request_incomplete",
      reasons: ["notes_age_bucket_missing_or_ambiguous"],
    };
  }
  if (markerCount !== 1) {
    return {
      ok: false,
      code: "notes_marker_conflict",
      reasons: ["conflicting_portal_aged_option_markers", `marker_count:${markerCount}`],
    };
  }
  const parsed = readClientAgedCommerceOptions(notes);
  if (!parsed.requestedAgeBucket || !parsed.shortfallPolicy) {
    return {
      ok: false,
      code: "notes_request_incomplete",
      reasons: [
        !parsed.requestedAgeBucket ? "notes_age_bucket_missing_or_ambiguous" : "",
        !parsed.shortfallPolicy ? "notes_shortfall_policy_missing" : "",
      ].filter(Boolean),
    };
  }
  return {
    ok: true,
    options: {
      requestedAgeBucket: parsed.requestedAgeBucket,
      shortfallPolicy: parsed.shortfallPolicy,
    },
  };
}

export function stripPortalAgedOptionsFromNotes(notes: string): string {
  if (!notes.includes(CLIENT_AGED_OPTIONS_MARKER)) return notes.trim();
  return notes
    .replace(/Aged order options[^\n]*\n---\nsa360\.portalAgedOptions\.v1\s*\{[\s\S]*?\}/, "")
    .replace(/sa360\.portalAgedOptions\.v1\s*\{[\s\S]*?\}/, "")
    .replace(/^---\s*$/gm, "")
    .trim();
}

export function presentAgedCommerceFromNotes(
  notes: string | null | undefined
): PresentedAgedCommerce | null {
  const aged = readClientAgedCommerceOptions(notes);
  if (!aged.requestedAgeBucket || !aged.shortfallPolicy) return null;
  return {
    requestedAgeBucket: aged.requestedAgeBucket,
    shortfallPolicy: aged.shortfallPolicy,
    label: pplAgedBucketLabel(aged.requestedAgeBucket),
  };
}

export function presentPricedPpl(
  snapshot: Omit<PplOrderLinePricingSnapshot, "lineId"> | PplOrderLinePricingSnapshot | null
): PresentedPricedPpl | null {
  if (!snapshot) return null;
  if (!isCommerceAgeBucketKey(snapshot.commerceAgeBucketKey)) return null;
  return {
    commerceAgeBucketKey: snapshot.commerceAgeBucketKey,
    pricingVersion: snapshot.pricingVersion,
    unitPriceCents: snapshot.unitPriceCents,
    lineTotalCents: snapshot.lineTotalCents,
    requestedQuantity: snapshot.requestedQuantity,
    label: snapshot.label,
  };
}

export function presentPricedPplFromOrderLines(
  lines: unknown
): PresentedPricedPpl | null {
  if (!Array.isArray(lines)) return null;
  return presentPricedPpl(snapshotPricedPplFromOrderLines(lines));
}

export function buildPortalAgedPplOrderLine(input: {
  nicheKey: string;
  states: string[];
  requestedQuantity: number;
  commerceAgeBucketKey: string;
}) {
  return buildPplOrderLineCreateData(input);
}

export type PortalAgedOrderLineRepairExpectedSnapshot = {
  clientAccountId: string;
  nicheKey: string;
  states: string[];
  leadVolume: number;
  paymentConfirmationStatus: string;
  status: string;
  unitPriceCents: number;
  pricingVersion: string;
};

export type PortalAgedOrderLineRepairEvidence = {
  orderNumber?: string | null;
  clientAccountId: string;
  nicheKey: string;
  states: string[];
  leadVolume: number;
  campaignType?: string | null;
  notes?: string | null;
  paymentConfirmationStatus?: string | null;
  status?: string | null;
  existingLines?: unknown;
  reservedQuantity?: unknown;
  fulfilledQuantity?: unknown;
  proposedQuantity?: unknown;
  committedAllocationCount?: unknown;
  /** Every LeadAllocation row for the order, including released/shadow history. */
  allocationRowCount?: unknown;
  exportPackageCount?: unknown;
  deliveryReceiptCount?: unknown;
  /**
   * No recovery policy is approved in this PR. Any supplied policy is ignored
   * and the historical allocation still blocks repair.
   */
  historicalAllocationRecovery?: { policy?: unknown; ticket?: unknown } | null;
  expected?: Partial<PortalAgedOrderLineRepairExpectedSnapshot> | null;
  /** @deprecated use expected.unitPriceCents — ignored unless expected is complete */
  expectedUnitPriceCents?: number;
};

const REPAIRABLE_STATUSES = new Set(["submitted", "ready", "active"]);
const REQUIRED_COUNT_FIELDS = [
  "reservedQuantity",
  "fulfilledQuantity",
  "proposedQuantity",
  "committedAllocationCount",
  "allocationRowCount",
  "exportPackageCount",
  "deliveryReceiptCount",
] as const;

export type PortalAgedOrderLineRepairDecision =
  | {
      eligible: true;
      alreadyRepaired: boolean;
      commerceAgeBucketKey: CommerceAgeBucketKey;
      shortfallPolicy: ClientAgedShortfallPolicy;
      line: ReturnType<typeof buildPplOrderLineCreateData> & { ok: true };
      reasons: string[];
    }
  | {
      eligible: false;
      alreadyRepaired: boolean;
      code: string;
      reasons: string[];
    };

function sameStringSet(left: string[], right: string[]): boolean {
  const a = [...left].map((s) => s.trim().toUpperCase()).filter(Boolean).sort();
  const b = [...right].map((s) => s.trim().toUpperCase()).filter(Boolean).sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function readVerifiedCount(
  value: unknown,
  field: string
): { ok: true; value: number } | { ok: false; reason: string } {
  if (value === undefined || value === null) {
    return { ok: false, reason: `${field}_unverified` };
  }
  if (typeof value !== "number" || !Number.isInteger(value) || !Number.isFinite(value) || value < 0) {
    return { ok: false, reason: `${field}_invalid` };
  }
  return { ok: true, value };
}

function readRequiredExpected(
  expected: PortalAgedOrderLineRepairEvidence["expected"]
): { ok: true; value: PortalAgedOrderLineRepairExpectedSnapshot } | { ok: false; reasons: string[] } {
  const reasons: string[] = [];
  if (!expected || typeof expected !== "object") {
    return { ok: false, reasons: ["expected_snapshot_missing"] };
  }
  if (typeof expected.clientAccountId !== "string" || !expected.clientAccountId.trim()) {
    reasons.push("expected_buyer_missing");
  }
  if (typeof expected.nicheKey !== "string" || !expected.nicheKey.trim()) {
    reasons.push("expected_niche_missing");
  }
  if (!Array.isArray(expected.states) || expected.states.length === 0) {
    reasons.push("expected_states_missing");
  }
  if (
    typeof expected.leadVolume !== "number" ||
    !Number.isInteger(expected.leadVolume) ||
    expected.leadVolume < 1
  ) {
    reasons.push("expected_quantity_missing");
  }
  if (
    typeof expected.paymentConfirmationStatus !== "string" ||
    !expected.paymentConfirmationStatus.trim()
  ) {
    reasons.push("expected_payment_decision_missing");
  }
  if (typeof expected.status !== "string" || !expected.status.trim()) {
    reasons.push("expected_status_missing");
  }
  if (
    typeof expected.unitPriceCents !== "number" ||
    !Number.isInteger(expected.unitPriceCents) ||
    expected.unitPriceCents < 1
  ) {
    reasons.push("expected_quoted_price_missing");
  }
  if (typeof expected.pricingVersion !== "string" || !expected.pricingVersion.trim()) {
    reasons.push("expected_pricing_version_missing");
  }
  if (reasons.length > 0) return { ok: false, reasons };
  return {
    ok: true,
    value: {
      clientAccountId: expected.clientAccountId!.trim(),
      nicheKey: expected.nicheKey!.trim(),
      states: expected.states as string[],
      leadVolume: expected.leadVolume as number,
      paymentConfirmationStatus: expected.paymentConfirmationStatus!.trim(),
      status: expected.status!.trim(),
      unitPriceCents: expected.unitPriceCents as number,
      pricingVersion: expected.pricingVersion!.trim(),
    },
  };
}

type InspectedOrderLine =
  | {
      kind: "priced";
      nicheKey: string;
      states: string[];
      requestedQuantity: number;
      commerceAgeBucketKey: CommerceAgeBucketKey;
      pricingVersion: string;
      unitPriceCents: number;
      lineTotalCents: number;
    }
  | { kind: "unrecognized" };

function inspectExistingLine(line: unknown): InspectedOrderLine {
  if (!line || typeof line !== "object" || Array.isArray(line)) return { kind: "unrecognized" };
  const row = line as Record<string, unknown>;
  const snapshot = snapshotPricedPplFromOrderLines([row]);
  const meta = readPplOrderLineMetadata(row.metadataJson);
  if (!snapshot || !meta || !isCommerceAgeBucketKey(snapshot.commerceAgeBucketKey)) {
    return { kind: "unrecognized" };
  }
  if (
    typeof row.requestedQuantity !== "number" ||
    !Number.isInteger(row.requestedQuantity) ||
    row.requestedQuantity < 1
  ) {
    return { kind: "unrecognized" };
  }
  if (typeof row.nicheKey !== "string" || !row.nicheKey.trim()) {
    return { kind: "unrecognized" };
  }
  return {
    kind: "priced",
    nicheKey: row.nicheKey.trim(),
    states: snapshot.states,
    requestedQuantity: row.requestedQuantity,
    commerceAgeBucketKey: snapshot.commerceAgeBucketKey,
    pricingVersion: meta.pricingVersion,
    unitPriceCents: snapshot.unitPriceCents,
    lineTotalCents: snapshot.lineTotalCents,
  };
}

function inspectExistingLines(lines: unknown):
  | { ok: true; priced: Extract<InspectedOrderLine, { kind: "priced" }>[] }
  | { ok: false; reasons: string[] } {
  if (lines === undefined || lines === null) {
    return { ok: false, reasons: ["existing_lines_unverified"] };
  }
  if (!Array.isArray(lines)) {
    return { ok: false, reasons: ["existing_lines_invalid"] };
  }
  const priced: Extract<InspectedOrderLine, { kind: "priced" }>[] = [];
  const reasons: string[] = [];
  for (const [index, line] of lines.entries()) {
    const inspected = inspectExistingLine(line);
    if (inspected.kind === "unrecognized") {
      reasons.push("unrecognized_existing_line", `line_index:${index}`);
      continue;
    }
    priced.push(inspected);
  }
  if (reasons.length > 0) return { ok: false, reasons };
  return { ok: true, priced };
}

function decideFailureCode(reasons: string[]): string {
  if (
    reasons.includes("expected_snapshot_missing") ||
    reasons.includes("existing_lines_unverified") ||
    reasons.includes("existing_lines_invalid") ||
    reasons.some((reason) => reason.startsWith("expected_"))
  ) {
    return "comparison_evidence_incomplete";
  }
  if (reasons.some((reason) => reason.endsWith("_unverified") || reason.endsWith("_invalid"))) {
    return "counts_unverified";
  }
  if (reasons.includes("conflicting_portal_aged_option_markers")) return "notes_marker_conflict";
  if (reasons.includes("unrecognized_existing_line")) return "unrecognized_existing_line";
  if (
    reasons.includes("conflicting_priced_order_line") ||
    reasons.includes("conflicting_priced_order_lines") ||
    reasons.includes("existing_line_price_mismatch") ||
    reasons.includes("existing_line_field_mismatch")
  ) {
    return "conflicting_priced_order_line";
  }
  if (
    reasons.some((reason) => reason.startsWith("inventory_")) ||
    reasons.includes("historical_allocation_exists") ||
    reasonIncludes(reasons, "export_exists") ||
    reasonIncludes(reasons, "delivery_receipt_exists")
  ) {
    return "fulfillment_already_started";
  }
  if (reasons.includes("order_status_changed") || reasons.includes("order_status_not_repairable")) {
    return "order_status_changed";
  }
  if (reasons.some((reason) => reason.endsWith("_changed"))) return "original_request_changed";
  if (reasons.includes("catalog_unit_price_does_not_match_expected")) {
    return "original_price_unrecoverable";
  }
  return "notes_request_incomplete";
}

function reasonIncludes(reasons: string[], value: string): boolean {
  return reasons.includes(value);
}

function existingLineMatchesRepair(
  line: Extract<InspectedOrderLine, { kind: "priced" }>,
  expected: PortalAgedOrderLineRepairExpectedSnapshot,
  live: { nicheKey: string; states: string[]; leadVolume: number; bucket: CommerceAgeBucketKey }
): string[] {
  const mismatches: string[] = [];
  if (line.nicheKey !== live.nicheKey || line.nicheKey !== expected.nicheKey) {
    mismatches.push("existing_line_niche_mismatch");
  }
  if (!sameStringSet(line.states, live.states) || !sameStringSet(line.states, expected.states)) {
    mismatches.push("existing_line_states_mismatch");
  }
  if (line.requestedQuantity !== live.leadVolume || line.requestedQuantity !== expected.leadVolume) {
    mismatches.push("existing_line_quantity_mismatch");
  }
  if (line.commerceAgeBucketKey !== live.bucket) {
    mismatches.push("existing_line_bucket_mismatch");
  }
  if (line.unitPriceCents !== expected.unitPriceCents) {
    mismatches.push("existing_line_price_mismatch");
  }
  if (line.pricingVersion !== expected.pricingVersion) {
    mismatches.push("existing_line_pricing_version_mismatch");
  }
  if (line.lineTotalCents !== expected.leadVolume * expected.unitPriceCents) {
    mismatches.push("existing_line_total_mismatch");
  }
  return mismatches;
}

/**
 * Idempotent eligibility for reconstructing a missing portal aged PPL line.
 * Never writes. Missing/null/NaN/negative counts are unverified — never treated as zero.
 */
export function evaluatePortalAgedOrderLineRepair(
  evidence: PortalAgedOrderLineRepairEvidence
): PortalAgedOrderLineRepairDecision {
  const reasons: string[] = [];

  const expectedRead = readRequiredExpected(evidence.expected);
  if (!expectedRead.ok) reasons.push(...expectedRead.reasons);
  const expected = expectedRead.ok ? expectedRead.value : null;

  if (!Array.isArray(evidence.existingLines) && evidence.existingLines !== undefined) {
    reasons.push("existing_lines_invalid");
  }
  const linesRead = inspectExistingLines(evidence.existingLines);
  if (!linesRead.ok) reasons.push(...linesRead.reasons);
  const pricedLines = linesRead.ok ? linesRead.priced : [];

  for (const field of REQUIRED_COUNT_FIELDS) {
    const count = readVerifiedCount(evidence[field], field);
    if (!count.ok) {
      reasons.push(count.reason);
      continue;
    }
    if (count.value > 0) {
      if (field === "exportPackageCount") reasons.push("export_exists");
      else if (field === "deliveryReceiptCount") reasons.push("delivery_receipt_exists");
      else if (field === "reservedQuantity") reasons.push("inventory_reserved");
      else if (field === "fulfilledQuantity") reasons.push("inventory_fulfilled");
      else if (field === "proposedQuantity") reasons.push("inventory_proposed");
      else if (field === "committedAllocationCount") reasons.push("inventory_committed");
      else if (field === "allocationRowCount") reasons.push("historical_allocation_exists");
    }
  }
  if (
    evidence.historicalAllocationRecovery != null &&
    reasons.includes("historical_allocation_exists")
  ) {
    reasons.push("historical_allocation_recovery_not_approved");
  }

  const aged = readExclusiveClientAgedCommerceOptions(evidence.notes);
  if (!aged.ok) reasons.push(...aged.reasons);

  if (expected) {
    if (expected.clientAccountId !== evidence.clientAccountId) reasons.push("buyer_changed");
    if (expected.nicheKey !== evidence.nicheKey) reasons.push("niche_changed");
    if (expected.leadVolume !== evidence.leadVolume) reasons.push("quantity_changed");
    if (!sameStringSet(expected.states, evidence.states)) reasons.push("states_changed");
    if (expected.paymentConfirmationStatus !== evidence.paymentConfirmationStatus) {
      reasons.push("payment_decision_changed");
    }
    if (expected.status !== evidence.status) reasons.push("order_status_changed");
  }
  if (typeof evidence.status !== "string" || !REPAIRABLE_STATUSES.has(evidence.status)) {
    reasons.push("order_status_not_repairable");
  }

  if (pricedLines.length > 1) {
    reasons.push("conflicting_priced_order_lines");
  }

  if (reasons.length > 0 || !aged.ok || !expected) {
    return {
      eligible: false,
      alreadyRepaired: false,
      code: decideFailureCode(reasons),
      reasons: reasons.length ? reasons : ["notes_request_incomplete"],
    };
  }

  const line = buildPplOrderLineCreateData({
    nicheKey: evidence.nicheKey,
    states: evidence.states,
    requestedQuantity: evidence.leadVolume,
    commerceAgeBucketKey: aged.options.requestedAgeBucket,
  });
  if (!line.ok) {
    return {
      eligible: false,
      alreadyRepaired: false,
      code: "priced_line_unavailable",
      reasons: [line.code],
    };
  }

  if (expected.unitPriceCents !== line.snapshot.unitPriceCents) {
    return {
      eligible: false,
      alreadyRepaired: false,
      code: "original_price_unrecoverable",
      reasons: [
        "catalog_unit_price_does_not_match_expected",
        `expected_unit_price_cents:${expected.unitPriceCents}`,
        `catalog_unit_price_cents:${line.snapshot.unitPriceCents}`,
      ],
    };
  }
  if (expected.pricingVersion !== line.snapshot.pricingVersion) {
    return {
      eligible: false,
      alreadyRepaired: false,
      code: "original_price_unrecoverable",
      reasons: [
        "catalog_pricing_version_does_not_match_expected",
        `expected_pricing_version:${expected.pricingVersion}`,
        `catalog_pricing_version:${line.snapshot.pricingVersion}`,
      ],
    };
  }

  if (pricedLines.length === 1) {
    const mismatches = existingLineMatchesRepair(pricedLines[0]!, expected, {
      nicheKey: evidence.nicheKey,
      states: evidence.states,
      leadVolume: evidence.leadVolume,
      bucket: aged.options.requestedAgeBucket,
    });
    if (mismatches.length > 0) {
      return {
        eligible: false,
        alreadyRepaired: false,
        code: "conflicting_priced_order_line",
        reasons: ["existing_line_field_mismatch", ...mismatches],
      };
    }
    return {
      eligible: true,
      alreadyRepaired: true,
      commerceAgeBucketKey: aged.options.requestedAgeBucket,
      shortfallPolicy: aged.options.shortfallPolicy,
      line,
      reasons: ["already_has_matching_priced_line"],
    };
  }

  return {
    eligible: true,
    alreadyRepaired: false,
    commerceAgeBucketKey: aged.options.requestedAgeBucket,
    shortfallPolicy: aged.options.shortfallPolicy,
    line,
    reasons: ["reconstruct_from_verified_notes_and_current_catalog"],
  };
}

export type PortalAgedOrderLineRepairAuthorization = {
  confirmed: true;
  ticket: string;
  orderNumber: string;
};

export type PortalAgedRepairDb = {
  $transaction: <T>(
    fn: (tx: PortalAgedRepairDb) => Promise<T>,
    options?: { isolationLevel?: string }
  ) => Promise<T>;
  /** Required for FOR UPDATE. Missing capability fails closed. */
  $queryRaw?: (query: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;
  leadOrder: {
    findUnique: (args: unknown) => Promise<Record<string, unknown> | null>;
    update: (args: unknown) => Promise<Record<string, unknown>>;
  };
  leadOrderLine: {
    findMany: (args: unknown) => Promise<unknown[]>;
    create: (args: unknown) => Promise<unknown>;
  };
  leadAllocation: {
    findMany: (args: unknown) => Promise<Array<{ id: string; status: string }>>;
    count: (args: unknown) => Promise<number>;
  };
  leadDeliveryExportPackage: { count: (args: unknown) => Promise<number> };
  buyerDeliveredIdentity: { count: (args: unknown) => Promise<number> };
};

const ACTIVE_ALLOCATION_STATUSES = [
  "shadow",
  "reserved",
  "delivering",
  "committed",
  "review_required",
] as const;

function parseStatesJson(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => String(entry).trim()).filter(Boolean);
}

function liveScalarCount(value: unknown): unknown {
  if (typeof value === "bigint") {
    const asNumber = Number(value);
    return Number.isSafeInteger(asNumber) ? asNumber : value;
  }
  return value;
}

function isPrismaKnownError(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && String(error.code) === code);
}

function readErrorMetaCode(error: unknown): string {
  if (!error || typeof error !== "object" || !("meta" in error)) return "";
  const meta = error.meta;
  if (!meta || typeof meta !== "object") return "";
  if ("code" in meta && meta.code != null) return String(meta.code);
  return "";
}

function isSerializableConflict(error: unknown): boolean {
  if (isPrismaKnownError(error, "P2034")) return true;
  const message = error instanceof Error ? error.message : String(error);
  if (/could not serialize access|serialize access due to concurrent update/i.test(message)) {
    return true;
  }
  return isPrismaKnownError(error, "P2010") && /40001/.test(`${readErrorMetaCode(error)} ${message}`);
}

function concurrentRepairConflictResult(): ApplyPortalAgedOrderLineRepairResult {
  return {
    eligible: false,
    alreadyRepaired: false,
    code: "concurrent_repair_conflict",
    reasons: ["serializable_write_conflict"],
    wrote: false,
  };
}

export type ApplyPortalAgedOrderLineRepairInput = {
  orderId: string;
  expected: PortalAgedOrderLineRepairExpectedSnapshot;
  authorization: PortalAgedOrderLineRepairAuthorization;
  environment: "local_test" | "authorized_production";
};

export type ApplyPortalAgedOrderLineRepairResult =
  | (PortalAgedOrderLineRepairDecision & { wrote: false })
  | (Extract<PortalAgedOrderLineRepairDecision, { eligible: true }> & {
      wrote: true;
      lineId: string;
    });

function repairEnvironmentBlocked(
  input: ApplyPortalAgedOrderLineRepairInput
): PortalAgedOrderLineRepairDecision | null {
  const ticket = input.authorization?.ticket?.trim();
  if (!input.authorization?.confirmed || !ticket) {
    return {
      eligible: false,
      alreadyRepaired: false,
      code: "authorization_required",
      reasons: ["authorization_required"],
    };
  }
  if (input.environment === "local_test") return null;
  const allowed = process.env.SA360_PORTAL_AGED_LINE_REPAIR_TICKET?.trim();
  if (input.environment !== "authorized_production" || !allowed || allowed !== ticket) {
    return {
      eligible: false,
      alreadyRepaired: false,
      code: "repair_environment_blocked",
      reasons: ["repair_environment_blocked"],
    };
  }
  return null;
}

async function lockLeadOrderForRepair(
  tx: PortalAgedRepairDb,
  orderId: string
): Promise<PortalAgedOrderLineRepairDecision | null> {
  if (typeof tx.$queryRaw !== "function") {
    return {
      eligible: false,
      alreadyRepaired: false,
      code: "row_lock_unavailable",
      reasons: ["row_lock_unavailable"],
    };
  }
  const locked = await tx.$queryRaw`SELECT id FROM "LeadOrder" WHERE id = ${orderId} FOR UPDATE`;
  if (!Array.isArray(locked) || locked.length !== 1) {
    return {
      eligible: false,
      alreadyRepaired: false,
      code: "row_lock_unavailable",
      reasons: ["row_lock_did_not_return_order"],
    };
  }
  return null;
}

async function gatherLiveRepairEvidence(
  tx: PortalAgedRepairDb,
  orderId: string,
  expected: PortalAgedOrderLineRepairExpectedSnapshot
): Promise<PortalAgedOrderLineRepairEvidence | { error: PortalAgedOrderLineRepairDecision }> {
  const lockError = await lockLeadOrderForRepair(tx, orderId);
  if (lockError) return { error: lockError };
  const order = await tx.leadOrder.findUnique({
    where: { id: orderId },
    include: { orderLines: { orderBy: { lineNumber: "asc" } } },
  });
  if (!order) {
    return {
      error: {
        eligible: false,
        alreadyRepaired: false,
        code: "lead_order_not_found",
        reasons: ["lead_order_not_found"],
      },
    };
  }
  const lines = await tx.leadOrderLine.findMany({
    where: { leadOrderId: orderId },
    orderBy: { lineNumber: "asc" },
  });
  const allocations = await tx.leadAllocation.findMany({
    where: { leadOrderId: orderId },
    select: { id: true, status: true },
  });
  const allocationRowCount = allocations.length;
  const committedAllocationCount = allocations.filter((row) => row.status === "committed").length;
  const activeAllocationCount = allocations.filter((row) =>
    (ACTIVE_ALLOCATION_STATUSES as readonly string[]).includes(row.status)
  ).length;
  const exportPackageCount = await tx.leadDeliveryExportPackage.count({
    where: { leadOrderId: orderId },
  });
  const allocationIds = allocations.map((row) => row.id);
  const deliveryReceiptCount =
    allocationIds.length === 0
      ? 0
      : await tx.buyerDeliveredIdentity.count({
          where: { leadAllocationId: { in: allocationIds } },
        });
  if (activeAllocationCount > 0 && Number(order.reservedQuantity ?? 0) === 0) {
    return {
      error: {
        eligible: false,
        alreadyRepaired: false,
        code: "counts_inconsistent",
        reasons: ["order_counters_disagree_with_allocations"],
      },
    };
  }
  return {
    orderNumber: typeof order.orderNumber === "string" ? order.orderNumber : null,
    clientAccountId: String(order.clientAccountId),
    nicheKey: String(order.nicheKey),
    states: parseStatesJson(order.statesJson ?? order.states),
    leadVolume: Number(order.leadVolume),
    campaignType: typeof order.campaignType === "string" ? order.campaignType : null,
    notes: typeof order.notes === "string" ? order.notes : null,
    paymentConfirmationStatus:
      typeof order.paymentConfirmationStatus === "string"
        ? order.paymentConfirmationStatus
        : null,
    status: typeof order.status === "string" ? order.status : null,
    existingLines: Array.isArray(order.orderLines) ? order.orderLines : lines,
    reservedQuantity: liveScalarCount(order.reservedQuantity),
    fulfilledQuantity: liveScalarCount(order.fulfilledQuantity),
    proposedQuantity: liveScalarCount(order.proposedQuantity),
    committedAllocationCount,
    allocationRowCount,
    exportPackageCount,
    deliveryReceiptCount,
    expected,
  };
}

/**
 * Authorized apply: re-reads the order, lines, and counts inside one serializable
 * transaction, then creates the missing line or returns alreadyRepaired.
 * Duplicate lineNumber 1 races resolve to alreadyRepaired / fail-closed — never two lines.
 * Does not run against production unless environment + matching ticket env are set.
 */
export async function applyAuthorizedPortalAgedOrderLineRepair(
  input: ApplyPortalAgedOrderLineRepairInput,
  db: PortalAgedRepairDb
): Promise<ApplyPortalAgedOrderLineRepairResult> {
  const blocked = repairEnvironmentBlocked(input);
  if (blocked) return { ...blocked, wrote: false };

  const isolation = { isolationLevel: "Serializable" };

  const run = async (tx: PortalAgedRepairDb): Promise<ApplyPortalAgedOrderLineRepairResult> => {
    const gathered = await gatherLiveRepairEvidence(tx, input.orderId.trim(), input.expected);
    if ("error" in gathered) return { ...gathered.error, wrote: false };

    if (
      gathered.orderNumber &&
      gathered.orderNumber !== input.authorization.orderNumber.trim()
    ) {
      return {
        eligible: false,
        alreadyRepaired: false,
        code: "authorization_order_mismatch",
        reasons: ["authorization_order_mismatch"],
        wrote: false,
      };
    }

    const decision = evaluatePortalAgedOrderLineRepair(gathered);
    if (!decision.eligible || decision.alreadyRepaired) {
      return { ...decision, wrote: false };
    }

    const created = (await tx.leadOrderLine.create({
      data: {
        ...decision.line.data,
        leadOrderId: input.orderId.trim(),
      },
    })) as { id?: string };
    const current = await tx.leadOrder.findUnique({ where: { id: input.orderId.trim() } });
    const patch: Record<string, unknown> = {};
    if (current && current.orderKind == null) patch.orderKind = "pay_per_lead";
    if (current && current.fulfillmentMode == null) patch.fulfillmentMode = "pooled_matching";
    if (
      current &&
      (current.requestedQuantity == null || Number(current.requestedQuantity) <= 0)
    ) {
      patch.requestedQuantity = gathered.leadVolume;
    }
    if (Object.keys(patch).length > 0) {
      await tx.leadOrder.update({
        where: { id: input.orderId.trim() },
        data: patch,
      });
    }
    return {
      ...decision,
      wrote: true,
      lineId: typeof created?.id === "string" ? created.id : "",
    };
  };

  const maxAttempts = 2;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await db.$transaction((tx) => run(tx), isolation);
    } catch (error) {
      const uniqueRace = isPrismaKnownError(error, "P2002");
      const serializeRace = isSerializableConflict(error);
      if (!uniqueRace && !serializeRace) throw error;
      if (attempt === maxAttempts - 1) return concurrentRepairConflictResult();
    }
  }
  return concurrentRepairConflictResult();
}
