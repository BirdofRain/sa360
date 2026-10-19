/** Exact `true` only. Every other value, including unset, keeps both census routes off. */
export function isHistoricalCampaignCensusEnabled(): boolean {
  return process.env.SA360_HISTORICAL_CAMPAIGN_CENSUS_ENABLED === "true";
}

/** Order numbers such as `LO-1053`. Bound as a query parameter, never concatenated into SQL. */
export function isHistoricalOrderNumber(value: string): boolean {
  return /^[A-Z0-9][A-Z0-9-]{1,31}$/.test(value);
}
