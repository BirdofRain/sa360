/** Exact `true` only. Every other value, including unset, keeps the workbench off. */
export function isHistoricalCampaignAssociationEnabled(): boolean {
  return process.env.SA360_HISTORICAL_CAMPAIGN_ASSOCIATION_ENABLED === "true";
}
