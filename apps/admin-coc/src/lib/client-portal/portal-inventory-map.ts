import { isCanonicalUsStateCode, type CanonicalUsStateCode } from "@sa360/shared";

/**
 * Portal live inventory map — advisory read model.
 *
 * Mirrors the client-safe API contract from
 * `GET /client/v1/leads-on-demand/state-availability`: bucketed labels only,
 * never exact counts, never pricing. Nothing in this module (or the map UI it
 * feeds) reserves inventory or creates orders.
 */

export const PORTAL_INVENTORY_MAP_ADVISORY_LINE =
  "Availability is advisory. Nothing is reserved or ordered from this map.";

export const PORTAL_INVENTORY_AVAILABILITY_LABELS = [
  "Available",
  "Limited",
  "Currently unavailable",
] as const;

export type PortalInventoryAvailabilityLabel =
  (typeof PORTAL_INVENTORY_AVAILABILITY_LABELS)[number];

export type PortalInventoryMapModel = {
  dataStatus: "live" | "unavailable";
  evaluatedAt: string | null;
  nicheKey: string | null;
  productType: string | null;
  /** Only canonical state codes; absent when `dataStatus` is `unavailable`. */
  states: Partial<Record<CanonicalUsStateCode, PortalInventoryAvailabilityLabel>>;
  summary: Record<PortalInventoryAvailabilityLabel, number>;
};

export type PortalInventoryMapLoadResult =
  | { ok: true; model: PortalInventoryMapModel }
  | { ok: false; error: string };

const LABEL_SET = new Set<string>(PORTAL_INVENTORY_AVAILABILITY_LABELS);

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function emptySummary(): Record<PortalInventoryAvailabilityLabel, number> {
  return { Available: 0, Limited: 0, "Currently unavailable": 0 };
}

export function isPortalInventoryAvailabilityLabel(
  value: unknown
): value is PortalInventoryAvailabilityLabel {
  return typeof value === "string" && LABEL_SET.has(value);
}

/**
 * Accepts either the raw API envelope (`{ ok, availability }`) or the bare
 * availability object. Unknown states and labels are dropped, never guessed.
 */
export function parsePortalInventoryMapPayload(raw: unknown): PortalInventoryMapModel | null {
  const row = asRecord(raw);
  if (!row) return null;
  const availability = asRecord(row.availability) ?? row;
  const dataStatus = availability.dataStatus === "live" ? "live" : "unavailable";
  const filters = asRecord(availability.filters);

  const states: PortalInventoryMapModel["states"] = {};
  const summary = emptySummary();
  if (dataStatus === "live" && Array.isArray(availability.states)) {
    for (const entry of availability.states) {
      const item = asRecord(entry);
      if (!item) continue;
      const code = asString(item.stateCode)?.toUpperCase();
      const label = item.availabilityLabel;
      if (!code || !isCanonicalUsStateCode(code) || !isPortalInventoryAvailabilityLabel(label)) {
        continue;
      }
      if (states[code]) continue;
      states[code] = label;
      summary[label] += 1;
    }
  }

  return {
    dataStatus,
    evaluatedAt: asString(availability.evaluatedAt),
    nicheKey: asString(filters?.nicheKey),
    productType: asString(filters?.productType),
    states,
    summary,
  };
}

export function portalInventoryMapRequestPath(query: {
  nicheKey?: string | null;
  productType?: string | null;
}): string {
  const params = new URLSearchParams();
  const nicheKey = query.nicheKey?.trim();
  const productType = query.productType?.trim();
  if (nicheKey) params.set("nicheKey", nicheKey);
  if (productType) params.set("productType", productType);
  const qs = params.toString();
  return `/api/client-portal/inventory-map${qs ? `?${qs}` : ""}`;
}

/** True when the live read model has no sellable supply in any state. */
export function portalInventoryMapIsEmpty(model: PortalInventoryMapModel): boolean {
  return model.dataStatus === "live" && model.summary.Available + model.summary.Limited === 0;
}

export type PortalInventoryMapTone = PortalInventoryAvailabilityLabel | "unknown";

export function portalInventoryMapTone(
  model: PortalInventoryMapModel | null,
  stateCode: string
): PortalInventoryMapTone {
  if (!model || model.dataStatus !== "live") return "unknown";
  if (!isCanonicalUsStateCode(stateCode)) return "unknown";
  return model.states[stateCode] ?? "unknown";
}

/** Light-theme SVG fills for the portal (the admin explorer uses its own dark palette). */
export function portalInventoryMapFill(tone: PortalInventoryMapTone): string {
  switch (tone) {
    case "Available":
      return "#34d399";
    case "Limited":
      return "#fcd34d";
    case "Currently unavailable":
      return "#e2e8f0";
    case "unknown":
    default:
      return "url(#portal-map-unknown)";
  }
}

export function portalInventoryMapToneLabel(tone: PortalInventoryMapTone): string {
  switch (tone) {
    case "Available":
      return "Available";
    case "Limited":
      return "Limited";
    case "Currently unavailable":
      return "Currently unavailable";
    case "unknown":
    default:
      return "Availability unknown";
  }
}

export function portalInventoryMapFreshnessLabel(
  evaluatedAt: string | null,
  now: Date = new Date()
): string | null {
  if (!evaluatedAt) return null;
  const at = new Date(evaluatedAt);
  if (Number.isNaN(at.getTime())) return null;
  const minutes = Math.max(0, Math.floor((now.getTime() - at.getTime()) / 60_000));
  if (minutes < 1) return "Checked just now";
  if (minutes < 60) return `Checked ${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return `Checked ${hours} hr ago`;
}

/** Per-bucket counts for the states a buyer has selected (state counts, not leads). */
export function summarizePortalInventorySelection(
  model: PortalInventoryMapModel | null,
  selectedStates: readonly string[]
): Record<PortalInventoryMapTone, number> {
  const out: Record<PortalInventoryMapTone, number> = { ...emptySummary(), unknown: 0 };
  for (const code of selectedStates) {
    out[portalInventoryMapTone(model, code)] += 1;
  }
  return out;
}

export function formatPortalInventorySelectionSummary(
  summary: Record<PortalInventoryMapTone, number>
): string | null {
  const parts: string[] = [];
  if (summary.Available) parts.push(`${summary.Available} available`);
  if (summary.Limited) parts.push(`${summary.Limited} limited`);
  if (summary["Currently unavailable"]) {
    parts.push(`${summary["Currently unavailable"]} currently unavailable`);
  }
  if (summary.unknown) parts.push(`${summary.unknown} unknown`);
  return parts.length ? parts.join(" · ") : null;
}
