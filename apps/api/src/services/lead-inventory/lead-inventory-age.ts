import type { LeadInventoryAgeBand } from "./lead-inventory.constants.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Elapsed whole days between generatedAt and evaluationTime (UTC timestamps). */
export function calculateInventoryAgeDays(generatedAt: Date, evaluatedAt: Date): number {
  const deltaMs = evaluatedAt.getTime() - generatedAt.getTime();
  return Math.floor(deltaMs / MS_PER_DAY);
}

export function resolveAgeBandKey(
  ageDays: number,
  bands: LeadInventoryAgeBand[]
): string | null {
  const sorted = [...bands].sort((a, b) => a.sortOrder - b.sortOrder);
  for (const band of sorted) {
    if (ageDays < band.minDaysInclusive) continue;
    if (band.maxDaysExclusive == null || ageDays < band.maxDaysExclusive) {
      return band.key;
    }
  }
  return null;
}

export function ageDaysInBand(
  ageDays: number,
  band: LeadInventoryAgeBand
): boolean {
  if (ageDays < band.minDaysInclusive) return false;
  if (band.maxDaysExclusive == null) return true;
  return ageDays < band.maxDaysExclusive;
}

export function generatedAtRangeForBand(
  band: LeadInventoryAgeBand,
  evaluatedAt: Date
): { gte: Date; lt?: Date } {
  const evalMs = evaluatedAt.getTime();
  const maxGeneratedMs = evalMs - band.minDaysInclusive * MS_PER_DAY;
  const minGeneratedMs =
    band.maxDaysExclusive == null
      ? null
      : evalMs - band.maxDaysExclusive * MS_PER_DAY;
  return {
    gte: new Date(minGeneratedMs ?? 0),
    lt: band.maxDaysExclusive == null ? undefined : new Date(maxGeneratedMs + 1),
  };
}

export function generatedAtRangeForMinMaxAge(
  minAgeDays: number | null | undefined,
  maxAgeDays: number | null | undefined,
  evaluatedAt: Date
): { gte?: Date; lte?: Date } {
  const evalMs = evaluatedAt.getTime();
  const range: { gte?: Date; lte?: Date } = {};
  if (maxAgeDays != null) {
    range.gte = new Date(evalMs - (maxAgeDays + 1) * MS_PER_DAY + 1);
  }
  if (minAgeDays != null) {
    range.lte = new Date(evalMs - minAgeDays * MS_PER_DAY);
  }
  return range;
}
