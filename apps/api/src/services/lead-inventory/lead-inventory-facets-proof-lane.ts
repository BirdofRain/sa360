/**
 * Facets matrix proof_lane normalization.
 *
 * Must stay byte-for-byte equivalent to the SQL CASE in
 * aggregateLeadInventoryFacetCells (inventory-derived).
 *
 * Authorized aliases (exact):
 *   facebook_meta_lead_ads → meta_lead_ads
 *   google_sheets_google_sheet_import → google_sheet_import
 *
 * Proof-required under currently deployed facets rule (unchanged):
 *   leadcapture_io, leadconduit_facebook
 */

export const FACETS_PROOF_REQUIRED_LANES = ["leadcapture_io", "leadconduit_facebook"] as const;

export type FacetsProofRequiredLane = (typeof FACETS_PROOF_REQUIRED_LANES)[number];

/** Mirrors SQL: LOWER(TRIM(BOTH FROM inventory_item."sourceLane")) + aliases. */
export function normalizeFacetsProofLaneFromInventorySourceLane(
  sourceLane: string | null | undefined
): string {
  const raw = (sourceLane ?? "").trim().toLowerCase();
  if (raw === "facebook_meta_lead_ads") return "meta_lead_ads";
  if (raw === "google_sheets_google_sheet_import") return "google_sheet_import";
  return raw;
}

/**
 * Legacy event-derived expression (pre-narrow-event), kept only for parity fixtures.
 * Mirrors deployed SQL that read enrichmentMetadataJson / sourceProvider / sourceSystem.
 */
export function normalizeFacetsProofLaneFromEvent(input: {
  enrichmentSourceLane?: string | null;
  sourceProvider?: string | null;
  sourceSystem?: string | null;
}): string {
  const enrichment = (input.enrichmentSourceLane ?? "").trim();
  const fallback = `${input.sourceProvider ?? ""}_${input.sourceSystem ?? ""}`;
  const coalesced = enrichment !== "" ? enrichment : fallback;
  const raw = coalesced.trim().toLowerCase();
  if (raw === "facebook_meta_lead_ads") return "meta_lead_ads";
  if (raw === "google_sheets_google_sheet_import") return "google_sheet_import";
  return raw;
}

export function isFacetsProofRequiredLane(normalizedLane: string): boolean {
  return (FACETS_PROOF_REQUIRED_LANES as readonly string[]).includes(normalizedLane);
}

/** Deterministic fixtures used by parity + classification regression tests. */
export const FACETS_SOURCE_LANE_PARITY_FIXTURES: Array<{
  name: string;
  inventorySourceLane: string;
  eventEnrichmentSourceLane: string | null;
  eventSourceProvider: string;
  eventSourceSystem: string;
}> = [
  {
    name: "leadcapture_io",
    inventorySourceLane: "leadcapture_io",
    eventEnrichmentSourceLane: "leadcapture_io",
    eventSourceProvider: "leadcapture_io",
    eventSourceSystem: "leadcapture_io_legacy",
  },
  {
    name: "leadconduit_facebook",
    inventorySourceLane: "leadconduit_facebook",
    eventEnrichmentSourceLane: "leadconduit_facebook",
    eventSourceProvider: "facebook",
    eventSourceSystem: "leadconduit",
  },
  {
    name: "meta_lead_ads",
    inventorySourceLane: "meta_lead_ads",
    eventEnrichmentSourceLane: "meta_lead_ads",
    eventSourceProvider: "facebook",
    eventSourceSystem: "meta_lead_ads",
  },
  {
    name: "facebook_meta_lead_ads alias",
    inventorySourceLane: "facebook_meta_lead_ads",
    eventEnrichmentSourceLane: "facebook_meta_lead_ads",
    eventSourceProvider: "facebook",
    eventSourceSystem: "meta_lead_ads",
  },
  {
    name: "google_sheet_import",
    inventorySourceLane: "google_sheet_import",
    eventEnrichmentSourceLane: "google_sheet_import",
    eventSourceProvider: "google_sheets",
    eventSourceSystem: "google_sheet_import",
  },
  {
    name: "google_sheets_google_sheet_import alias",
    inventorySourceLane: "google_sheets_google_sheet_import",
    eventEnrichmentSourceLane: "google_sheets_google_sheet_import",
    eventSourceProvider: "google_sheets",
    eventSourceSystem: "google_sheet_import",
  },
  {
    name: "uppercase variant",
    inventorySourceLane: "LEADCAPTURE_IO",
    eventEnrichmentSourceLane: "LEADCAPTURE_IO",
    eventSourceProvider: "leadcapture_io",
    eventSourceSystem: "leadcapture_io_legacy",
  },
  {
    name: "mixed-case variant",
    inventorySourceLane: "LeadConduit_Facebook",
    eventEnrichmentSourceLane: "LeadConduit_Facebook",
    eventSourceProvider: "facebook",
    eventSourceSystem: "leadconduit",
  },
  {
    name: "leading whitespace",
    inventorySourceLane: "  meta_lead_ads",
    eventEnrichmentSourceLane: "  meta_lead_ads",
    eventSourceProvider: "facebook",
    eventSourceSystem: "meta_lead_ads",
  },
  {
    name: "trailing whitespace",
    inventorySourceLane: "meta_lead_ads  ",
    eventEnrichmentSourceLane: "meta_lead_ads  ",
    eventSourceProvider: "facebook",
    eventSourceSystem: "meta_lead_ads",
  },
  {
    name: "unknown lane",
    inventorySourceLane: "totally_unknown_lane",
    eventEnrichmentSourceLane: "totally_unknown_lane",
    eventSourceProvider: "unknown",
    eventSourceSystem: "unknown",
  },
  {
    name: "empty enrichment falls back to provider_system",
    // Event COALESCE(NULLIF('', ''), CONCAT(provider, '_', system)) → provider_system.
    // Inventory stores that same composite when enrichment is blank.
    inventorySourceLane: "manual_import_sheet",
    eventEnrichmentSourceLane: "",
    eventSourceProvider: "manual_import",
    eventSourceSystem: "sheet",
  },
  {
    name: "manual_import",
    inventorySourceLane: "manual_import",
    eventEnrichmentSourceLane: "manual_import",
    eventSourceProvider: "manual",
    eventSourceSystem: "import",
  },
  {
    name: "csv_import",
    inventorySourceLane: "csv_import",
    eventEnrichmentSourceLane: "csv_import",
    eventSourceProvider: "csv",
    eventSourceSystem: "import",
  },
  {
    name: "aged_inventory_csv",
    inventorySourceLane: "aged_inventory_csv",
    eventEnrichmentSourceLane: "aged_inventory_csv",
    eventSourceProvider: "csv",
    eventSourceSystem: "aged_inventory",
  },
];
