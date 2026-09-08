import {
  sanitizeCanonicalUsStates,
} from "@sa360/shared";

import {
  createEmptyPortalOrderRequestDraft,
  type PortalOrderRequestCatalogs,
  type PortalOrderRequestDraft,
} from "@/lib/client-portal/portal-order-request";

import {
  clampPublicLeadQuantity,
  PUBLIC_PORTAL_PLACE_ORDER_NEXT,
  PUBLIC_VETERAN_FRESHNESS_OPTIONS,
  resolvePublicFreshness,
  type PublicLeadPreviewDraft,
  type PublicVeteranFreshnessId,
} from "./lead-request-preview.ts";

export const PUBLIC_LEAD_PREFILL_STORAGE_KEY = "sa360.agedvet.lead-prefill.v1";

export const PUBLIC_LEAD_PREFILL_ALLOWED_KEYS = ["states", "qty", "freshness", "niche"] as const;

const FRESHNESS_IDS = new Set<string>(
  PUBLIC_VETERAN_FRESHNESS_OPTIONS.map((option) => option.id)
);

export type ParsedPublicLeadPrefill = {
  states: string[];
  quantity: number | null;
  freshnessId: PublicVeteranFreshnessId | null;
  nicheKey: "vet" | null;
  dropped: string[];
};

export type AppliedPublicLeadPrefill = {
  draft: PortalOrderRequestDraft;
  applied: boolean;
  dropped: string[];
  freshnessId: PublicVeteranFreshnessId | null;
};

function firstString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return undefined;
}

function isFreshnessId(value: string): value is PublicVeteranFreshnessId {
  return FRESHNESS_IDS.has(value);
}

function parseQuantity(raw: string | undefined): number | null {
  if (raw == null || !raw.trim()) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  const clamped = clampPublicLeadQuantity(n);
  if (!Number.isInteger(clamped)) return null;
  return clamped;
}

function parseNiche(raw: string | undefined): "vet" | null {
  if (!raw) return null;
  const key = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (key === "vet" || key === "veteran") return "vet";
  return null;
}

export function publicFreshnessAgeBucketNotes(
  freshnessId: PublicVeteranFreshnessId | null
): string | null {
  if (freshnessId === "aged-30-90") return "Requested age bucket: 30–90 days";
  if (freshnessId === "aged-90-plus") return "Requested age bucket: 90+ days";
  return null;
}

export function mergeAgeBucketNotes(
  existing: string,
  freshnessId: PublicVeteranFreshnessId | null
): string {
  const snippet = publicFreshnessAgeBucketNotes(freshnessId);
  if (!snippet) return existing.trim();
  const trimmed = existing.trim();
  if (!trimmed) return snippet;
  if (trimmed.includes("Requested age bucket:")) return trimmed;
  const merged = `${snippet}\n${trimmed}`;
  return merged.length > 2000 ? trimmed.slice(0, 2000) : merged;
}

export function emptyPublicLeadPrefill(): ParsedPublicLeadPrefill {
  return {
    states: [],
    quantity: null,
    freshnessId: null,
    nicheKey: null,
    dropped: [],
  };
}

export function publicLeadPrefillHasValues(prefill: ParsedPublicLeadPrefill): boolean {
  return (
    prefill.states.length > 0 ||
    prefill.quantity != null ||
    prefill.freshnessId != null ||
    prefill.nicheKey != null
  );
}

export function parsePublicLeadPrefillInput(raw: Record<string, unknown>): ParsedPublicLeadPrefill {
  const dropped: string[] = [];
  const allowed = new Set<string>([...PUBLIC_LEAD_PREFILL_ALLOWED_KEYS, "quantity"]);
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key.toLowerCase())) dropped.push(key);
  }

  const statesRaw = firstString(raw.states);
  const states = sanitizeCanonicalUsStates(
    statesRaw ? statesRaw.split(/[,;\s]+/) : []
  ).slice(0, 20);
  if (statesRaw && states.length === 0) dropped.push("states");

  const quantity = parseQuantity(firstString(raw.qty) ?? firstString(raw.quantity));
  const qtyRaw = firstString(raw.qty) ?? firstString(raw.quantity);
  if (qtyRaw != null && qtyRaw !== "" && quantity == null) dropped.push("qty");

  const freshnessRaw = firstString(raw.freshness)?.trim() ?? "";
  const freshnessId = freshnessRaw && isFreshnessId(freshnessRaw) ? freshnessRaw : null;
  if (freshnessRaw && !freshnessId) dropped.push("freshness");

  const nicheRaw = firstString(raw.niche);
  const nicheKey = parseNiche(nicheRaw);
  if (nicheRaw && !nicheKey) dropped.push("niche");

  return { states, quantity, freshnessId, nicheKey, dropped };
}

export function serializePublicLeadPrefillQuery(
  draft: Pick<PublicLeadPreviewDraft, "states" | "quantity" | "freshnessId">
): string {
  const params = new URLSearchParams();
  const states = sanitizeCanonicalUsStates(draft.states).slice(0, 20);
  if (states.length > 0) params.set("states", states.join(","));
  params.set("qty", String(clampPublicLeadQuantity(draft.quantity)));
  const freshness = PUBLIC_VETERAN_FRESHNESS_OPTIONS.find((option) => option.id === draft.freshnessId);
  if (freshness) params.set("freshness", freshness.id);
  params.set("niche", "vet");
  return params.toString();
}

export function serializeParsedPrefillQuery(prefill: ParsedPublicLeadPrefill): string {
  const params = new URLSearchParams();
  if (prefill.states.length > 0) params.set("states", prefill.states.join(","));
  if (prefill.quantity != null) params.set("qty", String(prefill.quantity));
  if (prefill.freshnessId) params.set("freshness", prefill.freshnessId);
  if (prefill.nicheKey) params.set("niche", prefill.nicheKey);
  return params.toString();
}

export function publicLeadPrefillOrderPath(
  draft: Pick<PublicLeadPreviewDraft, "states" | "quantity" | "freshnessId">
): string {
  const qs = serializePublicLeadPrefillQuery(draft);
  return qs ? `${PUBLIC_PORTAL_PLACE_ORDER_NEXT}?${qs}` : PUBLIC_PORTAL_PLACE_ORDER_NEXT;
}

export function publicLeadPrefillNextPath(prefill: ParsedPublicLeadPrefill): string {
  const qs = serializeParsedPrefillQuery(prefill);
  return qs ? `${PUBLIC_PORTAL_PLACE_ORDER_NEXT}?${qs}` : PUBLIC_PORTAL_PLACE_ORDER_NEXT;
}

export function isGenericPortalDashboardNext(nextPath: string): boolean {
  return nextPath.trim() === "/portal";
}

export function resolveVeteranNicheKey(
  catalogs: PortalOrderRequestCatalogs
): string | null {
  const match = catalogs.nicheKeys.find((option) => {
    const key = option.value.trim().toLowerCase();
    return key === "vet" || key === "veteran";
  });
  return match?.value ?? null;
}

export function applyPublicLeadPrefillToDraft(
  catalogs: PortalOrderRequestCatalogs,
  prefill: ParsedPublicLeadPrefill,
  base: PortalOrderRequestDraft = createEmptyPortalOrderRequestDraft(catalogs)
): AppliedPublicLeadPrefill {
  const dropped = [...prefill.dropped];
  const next: PortalOrderRequestDraft = { ...base };
  let applied = false;

  if (prefill.states.length > 0) {
    next.states = prefill.states;
    applied = true;
  }

  if (prefill.quantity != null) {
    next.leadVolume = prefill.quantity;
    applied = true;
  }

  if (prefill.freshnessId) {
    const freshness = resolvePublicFreshness(prefill.freshnessId);
    const allowed = new Set(catalogs.campaignTypes.map((option) => option.value));
    if (allowed.has(freshness.campaignType)) {
      next.campaignType = freshness.campaignType;
      next.notes = mergeAgeBucketNotes(next.notes, prefill.freshnessId);
      applied = true;
    } else {
      dropped.push("freshness");
    }
  }

  if (prefill.nicheKey) {
    const veteranKey = resolveVeteranNicheKey(catalogs);
    if (veteranKey) {
      next.nicheKey = veteranKey;
      applied = true;
    } else {
      dropped.push("niche");
    }
  }

  return {
    draft: next,
    applied,
    dropped,
    freshnessId: prefill.freshnessId,
  };
}

type StoredPrefill = {
  v: 1;
  states: string[];
  quantity: number;
  freshnessId: PublicVeteranFreshnessId;
};

function isStoredPrefill(value: unknown): value is StoredPrefill {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  if (row.v !== 1) return false;
  if ("crmPackage" in row || "crm_package" in row || "sku" in row) return false;
  if (!Array.isArray(row.states) || typeof row.quantity !== "number") return false;
  if (typeof row.freshnessId !== "string" || !isFreshnessId(row.freshnessId)) return false;
  return true;
}

export function publicLeadPrefillFromDraft(draft: PublicLeadPreviewDraft): ParsedPublicLeadPrefill {
  return parsePublicLeadPrefillInput({
    states: sanitizeCanonicalUsStates(draft.states).join(","),
    qty: String(clampPublicLeadQuantity(draft.quantity)),
    freshness: draft.freshnessId,
    niche: "vet",
  });
}

export function writePublicLeadPrefill(draft: PublicLeadPreviewDraft): void {
  if (typeof window === "undefined") return;
  const payload: StoredPrefill = {
    v: 1,
    states: sanitizeCanonicalUsStates(draft.states).slice(0, 20),
    quantity: clampPublicLeadQuantity(draft.quantity),
    freshnessId: resolvePublicFreshness(draft.freshnessId).id,
  };
  try {
    window.sessionStorage.setItem(PUBLIC_LEAD_PREFILL_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* private mode / quota */
  }
}

export function writePublicLeadPrefillFromParsed(prefill: ParsedPublicLeadPrefill): void {
  if (typeof window === "undefined") return;
  if (!publicLeadPrefillHasValues(prefill)) return;
  const freshnessId = prefill.freshnessId ?? "aged-30-90";
  writePublicLeadPrefill({
    states: prefill.states,
    quantity: prefill.quantity ?? 100,
    freshnessId,
  });
}

export function readPublicLeadPrefill(): ParsedPublicLeadPrefill {
  if (typeof window === "undefined") return emptyPublicLeadPrefill();
  try {
    const raw = window.sessionStorage.getItem(PUBLIC_LEAD_PREFILL_STORAGE_KEY);
    if (!raw) return emptyPublicLeadPrefill();
    const parsed: unknown = JSON.parse(raw);
    if (!isStoredPrefill(parsed)) return emptyPublicLeadPrefill();
    return parsePublicLeadPrefillInput({
      states: parsed.states.join(","),
      qty: String(parsed.quantity),
      freshness: parsed.freshnessId,
      niche: "vet",
    });
  } catch {
    return emptyPublicLeadPrefill();
  }
}

export function clearPublicLeadPrefill(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(PUBLIC_LEAD_PREFILL_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
