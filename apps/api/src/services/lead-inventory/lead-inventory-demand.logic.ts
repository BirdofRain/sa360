import type { LeadInventoryAgeBand } from "./lead-inventory.constants.js";
import { normalizeInventoryState } from "./lead-inventory-state.js";

export type OrderLineDemandRecord = {
  id: string;
  normalizedStatesJson: unknown;
  ageBandKeysJson: unknown;
  minAgeDays: number | null;
  maxAgeDays: number | null;
  requestedQuantity: number;
  reservedQuantity: number;
  nicheKey: string;
  productType: string | null;
  fulfillmentPriority: number;
};

export type ExactCellDemandAssignment = {
  kind: "exact";
  lineId: string;
  state: string;
  ageBandKey: string;
  remainingQuantity: number;
  nicheKey: string;
  productType: string | null;
  fulfillmentPriority: number;
};

export type FlexibleDemandAssignment = {
  kind: "flexible";
  lineId: string;
  remainingQuantity: number;
  eligibleStates: string[];
  eligibleAgeBandKeys: string[];
  nicheKey: string;
  productType: string | null;
  fulfillmentPriority: number;
};

export type DemandAssignment = ExactCellDemandAssignment | FlexibleDemandAssignment;

export type DemandOverlayResult = {
  exactCellDemand: Map<string, number>;
  flexibleDemandLines: FlexibleDemandAssignment[];
  flexibleDemandTotal: number;
  flexibleDemandLineCount: number;
};

function parseStringArrayJson(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

export function remainingOrderLineQuantity(line: Pick<OrderLineDemandRecord, "requestedQuantity" | "reservedQuantity">): number {
  return Math.max(line.requestedQuantity - line.reservedQuantity, 0);
}

export function resolveLineEligibleStates(line: OrderLineDemandRecord): string[] {
  const states = parseStringArrayJson(line.normalizedStatesJson)
    .map((state) => normalizeInventoryState(state) ?? state.trim().toUpperCase())
    .filter((state) => state.length > 0);
  return [...new Set(states)];
}

export function bandIntersectsLineAgeRange(
  band: LeadInventoryAgeBand,
  minAgeDays: number | null,
  maxAgeDays: number | null
): boolean {
  const bandMin = band.minDaysInclusive;
  const bandMax = band.maxDaysExclusive == null ? Number.POSITIVE_INFINITY : band.maxDaysExclusive - 1;

  if (minAgeDays != null && bandMax < minAgeDays) return false;
  if (maxAgeDays != null && bandMin > maxAgeDays) return false;
  return true;
}

export function resolveLineEligibleAgeBands(
  line: OrderLineDemandRecord,
  ageBands: LeadInventoryAgeBand[]
): LeadInventoryAgeBand[] {
  const explicitBandKeys = parseStringArrayJson(line.ageBandKeysJson);
  if (explicitBandKeys.length > 0) {
    return ageBands.filter((band) => explicitBandKeys.includes(band.key));
  }

  if (line.minAgeDays == null && line.maxAgeDays == null) {
    return [];
  }

  return ageBands.filter((band) =>
    bandIntersectsLineAgeRange(band, line.minAgeDays, line.maxAgeDays)
  );
}

export function classifyOrderLineDemand(
  line: OrderLineDemandRecord,
  ageBands: LeadInventoryAgeBand[]
): DemandAssignment | null {
  const remainingQuantity = remainingOrderLineQuantity(line);
  if (remainingQuantity <= 0) return null;

  const eligibleStates = resolveLineEligibleStates(line);
  const eligibleBands = resolveLineEligibleAgeBands(line, ageBands);

  if (eligibleStates.length === 1 && eligibleBands.length === 1) {
    return {
      kind: "exact",
      lineId: line.id,
      state: eligibleStates[0]!,
      ageBandKey: eligibleBands[0]!.key,
      remainingQuantity,
      nicheKey: line.nicheKey,
      productType: line.productType,
      fulfillmentPriority: line.fulfillmentPriority,
    };
  }

  return {
    kind: "flexible",
    lineId: line.id,
    remainingQuantity,
    eligibleStates,
    eligibleAgeBandKeys: eligibleBands.map((band) => band.key),
    nicheKey: line.nicheKey,
    productType: line.productType,
    fulfillmentPriority: line.fulfillmentPriority,
  };
}

export function buildDemandOverlayFromLines(
  lines: OrderLineDemandRecord[],
  ageBands: LeadInventoryAgeBand[]
): DemandOverlayResult {
  const exactCellDemand = new Map<string, number>();
  const flexibleDemandLines: FlexibleDemandAssignment[] = [];

  for (const line of lines) {
    const assignment = classifyOrderLineDemand(line, ageBands);
    if (!assignment) continue;

    if (assignment.kind === "exact") {
      const key = `${assignment.state}::${assignment.ageBandKey}`;
      exactCellDemand.set(key, (exactCellDemand.get(key) ?? 0) + assignment.remainingQuantity);
      continue;
    }

    flexibleDemandLines.push(assignment);
  }

  const flexibleDemandTotal = flexibleDemandLines.reduce(
    (sum, line) => sum + line.remainingQuantity,
    0
  );

  return {
    exactCellDemand,
    flexibleDemandLines,
    flexibleDemandTotal,
    flexibleDemandLineCount: flexibleDemandLines.length,
  };
}

export function computeCellCoverage(input: {
  exactCellDemand: number;
  supply: number;
}): { unmet: number; oversupply: number; coverageRatio: number | null } {
  const unmet = Math.max(input.exactCellDemand - input.supply, 0);
  const oversupply = Math.max(input.supply - input.exactCellDemand, 0);
  const coverageRatio =
    input.exactCellDemand > 0 ? Number((input.supply / input.exactCellDemand).toFixed(4)) : null;
  return { unmet, oversupply, coverageRatio };
}
