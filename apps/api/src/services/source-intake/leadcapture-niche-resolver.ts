/**
 * Resolve LeadCapture niche from materialized / canonical incoming values.
 *
 * Precedence:
 * 1. niche_key
 * 2. niche
 * 3. explicit canonical locations already supported on the payload
 * 4. trusted SA360 route-key token (LCIO_LEGACY_<NICHE>_… / LCIO_NG_<NICHE>_…)
 * 5. unresolved
 *
 * Explicit niche always wins over route. Missing or unknown niches never
 * silently become VET. Route fallback is not a universal VET default.
 */

export const LEADCAPTURE_RECOGNIZED_NICHE_KEYS = [
  "VET",
  "NURSE",
  "MORTGAGE",
  "TRUCKER",
  "HEALTH",
] as const;

export type LeadCaptureRecognizedNicheKey =
  (typeof LEADCAPTURE_RECOGNIZED_NICHE_KEYS)[number];

const RECOGNIZED = new Set<string>(LEADCAPTURE_RECOGNIZED_NICHE_KEYS);

const VET_DEFAULT_LABEL = "Veteran";
const VET_DEFAULT_PRODUCT_TYPE = "Final Expense";

export type ResolvedLeadCaptureNiche = {
  nicheKey: LeadCaptureRecognizedNicheKey | undefined;
  leadType: LeadCaptureRecognizedNicheKey | undefined;
  nicheLabel: string | undefined;
  productType: string | undefined;
  resolved: boolean;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function trimOrUndefined(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function canonicalizeRecognizedNiche(
  raw: string
): LeadCaptureRecognizedNicheKey | undefined {
  const key = raw.trim().toUpperCase();
  if (RECOGNIZED.has(key)) return key as LeadCaptureRecognizedNicheKey;
  return undefined;
}

const TRUSTED_ROUTE_NICHE_PATTERN = /^LCIO_(?:LEGACY|NG|NEXTGEN)_([A-Z0-9]+)(?:_|$)/;

/**
 * Parse a controlled SA360 route key such as
 * `LCIO_LEGACY_VET_LIFE_JAMES_TORREY_VET_FEX` or `LCIO_NG_NURSE_ANDRU_DURANSO`.
 * Does not scan campaign names, URLs, or arbitrary "vet" substrings.
 */
export function parseTrustedLeadCaptureRouteNiche(
  routeKey: unknown
): LeadCaptureRecognizedNicheKey | undefined {
  const raw = trimOrUndefined(routeKey);
  if (!raw) return undefined;
  const match = raw.toUpperCase().match(TRUSTED_ROUTE_NICHE_PATTERN);
  if (!match) return undefined;
  return canonicalizeRecognizedNiche(match[1]);
}

function firstTrustedRouteKey(effective: Record<string, unknown>): string | undefined {
  const routing = asRecord(effective.routing);
  const sourceIntake = routing ? asRecord(routing.source_intake) : null;
  return (
    trimOrUndefined(effective.sa360_route_key) ??
    trimOrUndefined(effective.sourceRouteKey) ??
    trimOrUndefined(routing?.source_route_key) ??
    trimOrUndefined(sourceIntake?.source_route_key)
  );
}

function firstPresentNicheCandidate(
  effective: Record<string, unknown>
): string | undefined {
  const classification = asRecord(effective.classification);
  const routing = asRecord(effective.routing);
  const sourceIntake = routing ? asRecord(routing.source_intake) : null;
  const candidates = [
    effective.niche_key,
    effective.niche,
    effective.sa360_niche_key,
    classification?.niche_key,
    routing?.niche_key,
    sourceIntake?.niche_key,
    sourceIntake?.niche,
  ];
  for (const candidate of candidates) {
    const present = trimOrUndefined(candidate);
    if (present) return present;
  }
  return undefined;
}

function resolveExplicitProductType(effective: Record<string, unknown>): string | undefined {
  const routing = asRecord(effective.routing);
  return (
    trimOrUndefined(effective.product_type) ??
    trimOrUndefined(routing?.product_type)
  );
}

function stampResolvedNiche(
  recognized: LeadCaptureRecognizedNicheKey,
  explicitProductType: string | undefined
): ResolvedLeadCaptureNiche {
  if (recognized === "VET") {
    return {
      nicheKey: "VET",
      leadType: "VET",
      nicheLabel: VET_DEFAULT_LABEL,
      productType: explicitProductType ?? VET_DEFAULT_PRODUCT_TYPE,
      resolved: true,
    };
  }
  return {
    nicheKey: recognized,
    leadType: recognized,
    nicheLabel: undefined,
    productType: explicitProductType,
    resolved: true,
  };
}

export function resolveLeadCaptureNiche(
  effective: Record<string, unknown>
): ResolvedLeadCaptureNiche {
  const explicitProductType = resolveExplicitProductType(effective);
  const incoming = firstPresentNicheCandidate(effective);
  if (incoming) {
    const recognized = canonicalizeRecognizedNiche(incoming);
    if (!recognized) {
      return {
        nicheKey: undefined,
        leadType: undefined,
        nicheLabel: undefined,
        productType: explicitProductType,
        resolved: false,
      };
    }
    return stampResolvedNiche(recognized, explicitProductType);
  }

  const fromRoute = parseTrustedLeadCaptureRouteNiche(firstTrustedRouteKey(effective));
  if (fromRoute) {
    return stampResolvedNiche(fromRoute, explicitProductType);
  }

  return {
    nicheKey: undefined,
    leadType: undefined,
    nicheLabel: undefined,
    productType: explicitProductType,
    resolved: false,
  };
}
