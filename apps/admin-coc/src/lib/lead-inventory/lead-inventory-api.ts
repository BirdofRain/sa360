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
  exactCellDemand: number;
  supply: number;
  unmet: number;
  coverageRatio: number | null;
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
  dataSource: "live" | "empty";
  loadError: string | null;
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

export async function loadLeadInventoryPageData(): Promise<LeadInventoryPageLoadResult> {
  if (!isAdminApiConfigured()) {
    return {
      summary: EMPTY_SUMMARY,
      facets: [],
      lots: [],
      dataSource: "empty",
      loadError: "Admin API is not configured for this app.",
      evaluatedAt: null,
    };
  }

  const [summaryRes, facetsRes, lotsRes] = await Promise.all([
    adminFetchJson<{ ok: boolean; summary: LeadInventorySummary }>("/admin/v1/lead-inventory/summary"),
    adminFetchJson<{
      ok: boolean;
      facets: {
        rows: LeadInventoryFacetRow[];
        evaluatedAt: string;
        flexibleDemandTotal: number;
        flexibleDemandLineCount: number;
      };
    }>(
      "/admin/v1/lead-inventory/facets"
    ),
    adminFetchJson<{
      ok: boolean;
      lots: LeadInventoryPageLoadResult["lots"];
      evaluatedAt: string;
    }>("/admin/v1/lead-inventory/lots"),
  ]);

  if (!summaryRes.ok) {
    return {
      summary: EMPTY_SUMMARY,
      facets: [],
      lots: [],
      dataSource: "empty",
      loadError: `Admin API error (${summaryRes.status}): ${summaryRes.body.slice(0, 280)}`,
      evaluatedAt: null,
    };
  }
  if (!facetsRes.ok) {
    return {
      summary: EMPTY_SUMMARY,
      facets: [],
      lots: [],
      dataSource: "empty",
      loadError: `Admin API error (${facetsRes.status}): ${facetsRes.body.slice(0, 280)}`,
      evaluatedAt: null,
    };
  }
  if (!lotsRes.ok) {
    return {
      summary: EMPTY_SUMMARY,
      facets: [],
      lots: [],
      dataSource: "empty",
      loadError: `Admin API error (${lotsRes.status}): ${lotsRes.body.slice(0, 280)}`,
      evaluatedAt: null,
    };
  }

  return {
    summary: summaryRes.data.summary,
    facets: facetsRes.data.facets.rows,
    lots: lotsRes.data.lots,
    dataSource: "live",
    loadError: null,
    evaluatedAt: facetsRes.data.facets.evaluatedAt ?? lotsRes.data.evaluatedAt,
  };
}
