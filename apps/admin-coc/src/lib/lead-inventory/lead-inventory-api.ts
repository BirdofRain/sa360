import "server-only";

import { adminFetchJson, isAdminApiConfigured } from "@/lib/admin-api/server";

export type LeadInventorySummary = {
  totalItems: number;
  available: number;
  reserved: number;
  committed: number;
  fulfilled: number;
  quarantined: number;
  expired: number;
  lotsActive: number;
  lotsPaused: number;
  proofReady: number;
  verificationReady: number;
  evaluatedAt: string;
};

export type LeadInventoryFacetRow = {
  state: string;
  ageBandKey: string;
  ageBandLabel: string;
  total: number;
  available: number;
  reserved: number;
  blocked: number;
  /** Null when demand overlay is unavailable (render as Unavailable, not 0). */
  exactCellDemand: number | null;
  supply: number;
  /** Null when demand overlay is unavailable. */
  unmet: number | null;
  coverageRatio: number | null;
};

export type LeadInventoryFacetWarning = {
  code: string;
  message: string;
};

export type LeadInventoryPageLoadResult = {
  summary: LeadInventorySummary | null;
  facets: LeadInventoryFacetRow[];
  lots: Array<{
    id: string;
    displayName: string;
    status: string;
    total: number;
    available: number;
    reserved: number;
    blocked: number;
  }>;
  dataSource: "live" | "empty" | "partial";
  loadError: string | null;
  facetsWarning: string | null;
  facetsDegraded: boolean;
  evaluatedAt: string | null;
};

const EMPTY_SUMMARY: LeadInventorySummary = {
  totalItems: 0,
  available: 0,
  reserved: 0,
  committed: 0,
  fulfilled: 0,
  quarantined: 0,
  expired: 0,
  lotsActive: 0,
  lotsPaused: 0,
  proofReady: 0,
  verificationReady: 0,
  evaluatedAt: new Date(0).toISOString(),
};

type FacetsApiResponse = {
  ok: boolean;
  facets: {
    rows: LeadInventoryFacetRow[];
    evaluatedAt: string;
    flexibleDemandTotal: number;
    flexibleDemandLineCount: number;
    partial?: boolean;
    degraded?: boolean;
    unavailableSections?: string[];
    warnings?: LeadInventoryFacetWarning[];
  };
  partial?: boolean;
  degraded?: boolean;
  unavailableSections?: string[];
  warnings?: LeadInventoryFacetWarning[];
};

function formatFacetsWarning(
  facetsRes: { ok: true; data: FacetsApiResponse } | { ok: false; status: number; body: string }
): { warning: string | null; degraded: boolean; rows: LeadInventoryFacetRow[]; evaluatedAt: string | null } {
  if (!facetsRes.ok) {
    return {
      warning: `Inventory matrix temporarily unavailable (API ${facetsRes.status}). Summary and lots may still be usable.`,
      degraded: true,
      rows: [],
      evaluatedAt: null,
    };
  }

  const payload = facetsRes.data;
  const facets = payload.facets;
  const degraded = Boolean(payload.degraded || payload.partial || facets.degraded || facets.partial);
  const warnings = payload.warnings ?? facets.warnings ?? [];
  const warning =
    warnings[0]?.message ??
    (degraded ? "Some inventory matrix sections are temporarily unavailable." : null);

  return {
    warning: degraded ? warning : null,
    degraded,
    rows: Array.isArray(facets.rows) ? facets.rows : [],
    evaluatedAt: facets.evaluatedAt ?? null,
  };
}

export async function loadLeadInventoryPageData(): Promise<LeadInventoryPageLoadResult> {
  if (!isAdminApiConfigured()) {
    return {
      summary: EMPTY_SUMMARY,
      facets: [],
      lots: [],
      dataSource: "empty",
      loadError: "Admin API is not configured for this app.",
      facetsWarning: null,
      facetsDegraded: false,
      evaluatedAt: null,
    };
  }

  // Independent fetches — facets failure must not blank summary/lots.
  const [summaryRes, facetsRes, lotsRes] = await Promise.all([
    adminFetchJson<{ ok: boolean; summary: LeadInventorySummary }>("/admin/v1/lead-inventory/summary"),
    adminFetchJson<FacetsApiResponse>("/admin/v1/lead-inventory/facets"),
    adminFetchJson<{
      ok: boolean;
      lots: LeadInventoryPageLoadResult["lots"];
      evaluatedAt: string;
    }>("/admin/v1/lead-inventory/lots"),
  ]);

  const facetsParsed = formatFacetsWarning(facetsRes);
  const summary = summaryRes.ok ? summaryRes.data.summary : null;
  const lots = lotsRes.ok ? lotsRes.data.lots : [];

  const sectionErrors: string[] = [];
  if (!summaryRes.ok) {
    sectionErrors.push(
      `Summary unavailable (${summaryRes.status}): ${summaryRes.body.slice(0, 160)}`
    );
  }
  if (!lotsRes.ok) {
    sectionErrors.push(`Lots unavailable (${lotsRes.status}): ${lotsRes.body.slice(0, 160)}`);
  }

  const hasLive = Boolean(summary) || lots.length > 0 || facetsParsed.rows.length > 0;
  const dataSource: LeadInventoryPageLoadResult["dataSource"] = !hasLive
    ? "empty"
    : sectionErrors.length > 0 || facetsParsed.degraded
      ? "partial"
      : "live";

  return {
    summary: summary ?? EMPTY_SUMMARY,
    facets: facetsParsed.rows,
    lots,
    dataSource,
    loadError: sectionErrors.length > 0 ? sectionErrors.join(" · ") : null,
    facetsWarning: facetsParsed.warning,
    facetsDegraded: facetsParsed.degraded,
    evaluatedAt:
      facetsParsed.evaluatedAt ??
      (lotsRes.ok ? lotsRes.data.evaluatedAt : null) ??
      summary?.evaluatedAt ??
      null,
  };
}
