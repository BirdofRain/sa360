/**
 * Resolve LeadCapture niche from materialized / canonical incoming values.
 *
 * Precedence:
 * 1. niche_key
 * 2. niche
 * 3. explicit canonical locations already supported on the payload
 * 4. standardized funnel/form-name parser
 * 5. trusted SA360 route-key token (LCIO_LEGACY_<NICHE>_… / LCIO_NG_<NICHE>_…)
 * 6. unresolved
 *
 * Explicit niche always wins over route. Missing or unknown niches never
 * silently become VET. Route fallback is not a universal VET default.
 * Name parsing is deterministic and never uses agent/client names as keys.
 */

import {
  firstParsedLeadCaptureNameNiche,
  type LeadCaptureInventoryNicheKey,
} from "./leadcapture-funnel-name-niche.js";

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

const RECOGNIZED_TO_INVENTORY_NICHE: Record<
  LeadCaptureRecognizedNicheKey,
  LeadCaptureInventoryNicheKey
> = {
  VET: "vet_fex",
  NURSE: "nurse_life",
  HEALTH: "health_insurance",
  TRUCKER: "trucker_life",
  MORTGAGE: "mortgage_protection",
};

const INVENTORY_NICHE_ALIASES: Record<string, LeadCaptureInventoryNicheKey> = {
  vet_fex: "vet_fex",
  nurse_life: "nurse_life",
  health_insurance: "health_insurance",
  trucker_life: "trucker_life",
  mortgage_protection: "mortgage_protection",
  final_expense: "final_expense",
};

const INVENTORY_TO_RECOGNIZED: Partial<
  Record<LeadCaptureInventoryNicheKey, LeadCaptureRecognizedNicheKey>
> = {
  vet_fex: "VET",
  nurse_life: "NURSE",
  health_insurance: "HEALTH",
  trucker_life: "TRUCKER",
  mortgage_protection: "MORTGAGE",
};

export type LeadCaptureNicheResolutionSource =
  | "niche_key"
  | "niche"
  | "structured_metadata"
  | "funnel_form_name"
  | "trusted_route_key"
  | "unresolved";

export type ResolvedLeadCaptureNiche = {
  nicheKey: LeadCaptureRecognizedNicheKey | undefined;
  leadType: LeadCaptureRecognizedNicheKey | undefined;
  nicheLabel: string | undefined;
  productType: string | undefined;
  resolved: boolean;
  inventoryNicheKey: LeadCaptureInventoryNicheKey | undefined;
  resolutionSource: LeadCaptureNicheResolutionSource;
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
): { value: string; source: Exclude<LeadCaptureNicheResolutionSource, "funnel_form_name" | "trusted_route_key" | "unresolved"> } | undefined {
  const classification = asRecord(effective.classification);
  const routing = asRecord(effective.routing);
  const sourceIntake = routing ? asRecord(routing.source_intake) : null;
  const groups: Array<{
    source: Exclude<LeadCaptureNicheResolutionSource, "funnel_form_name" | "trusted_route_key" | "unresolved">;
    values: unknown[];
  }> = [
    { source: "niche_key", values: [effective.niche_key, effective.sa360_niche_key] },
    { source: "niche", values: [effective.niche] },
    {
      source: "structured_metadata",
      values: [
        classification?.niche_key,
        routing?.niche_key,
        sourceIntake?.niche_key,
        sourceIntake?.niche,
      ],
    },
  ];
  for (const group of groups) {
    for (const candidate of group.values) {
      const present = trimOrUndefined(candidate);
      if (present) return { value: present, source: group.source };
    }
  }
  return undefined;
}

function firstPresentNameLabels(effective: Record<string, unknown>): unknown[] {
  const routing = asRecord(effective.routing);
  const sourceIntake = routing ? asRecord(routing.source_intake) : null;
  return [
    effective.funnel_name,
    effective.sa360_funnel_name,
    effective.form_name,
    effective.sa360_form_name,
    sourceIntake?.funnel_name,
    sourceIntake?.form_name,
    effective.campaign_name,
    effective.sa360_campaign_name,
    sourceIntake?.campaign_name,
  ];
}

function canonicalizeInventoryNiche(
  raw: string
): LeadCaptureInventoryNicheKey | undefined {
  return INVENTORY_NICHE_ALIASES[raw.trim().toLowerCase()];
}

function resolveExplicitProductType(effective: Record<string, unknown>): string | undefined {
  const routing = asRecord(effective.routing);
  return (
    trimOrUndefined(effective.product_type) ??
    trimOrUndefined(routing?.product_type)
  );
}

function unresolvedNiche(
  explicitProductType: string | undefined
): ResolvedLeadCaptureNiche {
  return {
    nicheKey: undefined,
    leadType: undefined,
    nicheLabel: undefined,
    productType: explicitProductType,
    resolved: false,
    inventoryNicheKey: undefined,
    resolutionSource: "unresolved",
  };
}

function stampResolvedNiche(
  recognized: LeadCaptureRecognizedNicheKey | undefined,
  inventoryNicheKey: LeadCaptureInventoryNicheKey | undefined,
  explicitProductType: string | undefined,
  resolutionSource: Exclude<LeadCaptureNicheResolutionSource, "unresolved">
): ResolvedLeadCaptureNiche {
  if (!recognized && !inventoryNicheKey) return unresolvedNiche(explicitProductType);
  if (recognized === "VET") {
    return {
      nicheKey: "VET",
      leadType: "VET",
      nicheLabel: VET_DEFAULT_LABEL,
      productType: explicitProductType ?? VET_DEFAULT_PRODUCT_TYPE,
      resolved: true,
      inventoryNicheKey: inventoryNicheKey ?? RECOGNIZED_TO_INVENTORY_NICHE.VET,
      resolutionSource,
    };
  }
  return {
    nicheKey: recognized,
    leadType: recognized,
    nicheLabel: undefined,
    productType: explicitProductType,
    resolved: true,
    inventoryNicheKey: inventoryNicheKey ?? (recognized ? RECOGNIZED_TO_INVENTORY_NICHE[recognized] : undefined),
    resolutionSource,
  };
}

export function resolveLeadCaptureNiche(
  effective: Record<string, unknown>
): ResolvedLeadCaptureNiche {
  const explicitProductType = resolveExplicitProductType(effective);
  const incoming = firstPresentNicheCandidate(effective);
  if (incoming) {
    const recognized = canonicalizeRecognizedNiche(incoming.value);
    if (recognized) {
      return stampResolvedNiche(
        recognized,
        RECOGNIZED_TO_INVENTORY_NICHE[recognized],
        explicitProductType,
        incoming.source
      );
    }
    const inventory = canonicalizeInventoryNiche(incoming.value);
    if (inventory) {
      return stampResolvedNiche(
        INVENTORY_TO_RECOGNIZED[inventory],
        inventory,
        explicitProductType,
        incoming.source
      );
    }
    return unresolvedNiche(explicitProductType);
  }

  const fromName = firstParsedLeadCaptureNameNiche(firstPresentNameLabels(effective));
  if (fromName) {
    return stampResolvedNiche(
      fromName.recognizedNicheKey,
      fromName.inventoryNicheKey,
      explicitProductType,
      "funnel_form_name"
    );
  }

  const fromRoute = parseTrustedLeadCaptureRouteNiche(firstTrustedRouteKey(effective));
  if (fromRoute) {
    return stampResolvedNiche(
      fromRoute,
      RECOGNIZED_TO_INVENTORY_NICHE[fromRoute],
      explicitProductType,
      "trusted_route_key"
    );
  }

  return unresolvedNiche(explicitProductType);
}
