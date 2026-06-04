import type { RoutingDryRunStats } from "./types.ts";

function num(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function numOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function strOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** Coerce stats API payload so StatsCards never throws on partial/null fields. */
export function normalizeRoutingDryRunStats(raw: unknown): RoutingDryRunStats | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const master = str(r.masterClientAccountId).trim();
  if (!master) return null;
  return {
    masterClientAccountId: master,
    destinationClientAccountId: strOrNull(r.destinationClientAccountId),
    createdAfter: strOrNull(r.createdAfter),
    createdBefore: strOrNull(r.createdBefore),
    totalDecisions: num(r.totalDecisions),
    matched: num(r.matched),
    reviewRequired: num(r.reviewRequired),
    generatedPlans: num(r.generatedPlans),
    needsConfigPlans: num(r.needsConfigPlans),
    validatedMatchedLegacy: num(r.validatedMatchedLegacy),
    mismatches: num(r.mismatches),
    needsMapping: num(r.needsMapping),
    ignoredTest: num(r.ignoredTest),
    legacyUnknown: num(r.legacyUnknown),
    unreviewed: num(r.unreviewed),
    matchRate: numOrNull(r.matchRate),
    validationCoverage: numOrNull(r.validationCoverage),
  };
}
