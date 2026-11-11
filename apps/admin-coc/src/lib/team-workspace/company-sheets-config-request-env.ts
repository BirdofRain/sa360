/**
 * Company Sheets configuration-request gate for Admin C.O.C.
 * Only trim() equal to the exact string "true" enables the request panel.
 * Unset, blank, TRUE, 1, yes, and on stay off.
 * This does not write CompanySheetsDestination or arm delivery.
 */
export function isCompanySheetsConfigRequestEnabled(env?: {
  SA360_COMPANY_SHEETS_CONFIG_REQUEST_ENABLED?: string;
}): boolean {
  const value =
    env === undefined
      ? process.env.SA360_COMPANY_SHEETS_CONFIG_REQUEST_ENABLED
      : env.SA360_COMPANY_SHEETS_CONFIG_REQUEST_ENABLED;
  return value?.trim() === "true";
}
