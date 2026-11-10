/**
 * Company Sheets destination configuration-request gate.
 *
 * Only trim() equal to the exact string "true" enables the API.
 * Unset, blank, TRUE, 1, yes, and on stay off.
 * The gate does not write CompanySheetsDestination and does not arm delivery.
 */
export function isCompanySheetsConfigRequestEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SA360_COMPANY_SHEETS_CONFIG_REQUEST_ENABLED?.trim() === "true";
}
