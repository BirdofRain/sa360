export type PortalAccountSnapshot = {
  available: boolean;
  ordersActive: number | null;
  ordersNeedingSetup: number | null;
  leadsDelivered: number | null;
  trustWarnings: number | null;
  latestLeadEvent: string | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function emptyPortalAccountSnapshot(): PortalAccountSnapshot {
  return {
    available: false,
    ordersActive: null,
    ordersNeedingSetup: null,
    leadsDelivered: null,
    trustWarnings: null,
    latestLeadEvent: null,
  };
}

export function mapClientFrontOfficeSummary(raw: unknown): PortalAccountSnapshot {
  const root = asRecord(raw);
  const kpis = asRecord(root?.kpis);
  if (!kpis) return emptyPortalAccountSnapshot();

  return {
    available: true,
    ordersActive: asNumber(kpis.ordersActive),
    ordersNeedingSetup: asNumber(kpis.ordersNeedingSetup),
    leadsDelivered: asNumber(kpis.leadsDelivered),
    trustWarnings: asNumber(kpis.trustWarnings),
    latestLeadEvent: asString(kpis.latestLeadEvent),
  };
}
