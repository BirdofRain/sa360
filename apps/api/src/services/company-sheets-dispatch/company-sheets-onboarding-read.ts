/**
 * Read and row-shape helpers the onboarding planner may call.
 * The company Sheets writer stays in its own module. This file only re-exports
 * the existing campaign-row mapper and the values reader.
 */

export { campaignLeadIdentityFromPayload, companySheetsCampaignRowValues } from "../company-sheets-delivery/company-sheets-campaign-row.js";
export { getSheetValues, quoteSheetTitle } from "../company-sheets-delivery/company-sheets-values-http.js";
