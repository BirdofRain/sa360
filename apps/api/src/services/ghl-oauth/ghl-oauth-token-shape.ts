import type { GhlOAuthExchangeResult } from "./ghl-oauth-client.service.js";

/** Safe boolean flags for admin debug — never includes token values. */
export type GhlOAuthTokenResponseSafeShape = {
  userType: string | null;
  companyIdPresent: boolean;
  locationIdPresent: boolean;
  userIdPresent: boolean;
  scopePresent: boolean;
  tokenTypePresent: boolean;
  expiresInPresent: boolean;
  appIdPresent: boolean;
};

export function buildGhlOAuthTokenResponseSafeShape(
  tokens: Pick<
    GhlOAuthExchangeResult,
    | "userType"
    | "companyId"
    | "locationId"
    | "userId"
    | "scopes"
    | "appId"
    | "tokenType"
    | "expiresIn"
  >
): GhlOAuthTokenResponseSafeShape {
  return {
    userType: tokens.userType,
    companyIdPresent: Boolean(tokens.companyId?.trim()),
    locationIdPresent: Boolean(tokens.locationId?.trim()),
    userIdPresent: Boolean(tokens.userId?.trim()),
    scopePresent: tokens.scopes.length > 0,
    tokenTypePresent: Boolean(tokens.tokenType?.trim()),
    expiresInPresent: typeof tokens.expiresIn === "number" && Number.isFinite(tokens.expiresIn),
    appIdPresent: Boolean(tokens.appId?.trim()),
  };
}

export function inferGhlOAuthTokenLevel(
  shape: Pick<GhlOAuthTokenResponseSafeShape, "userType" | "locationIdPresent">
): "location" | "company_or_agency" | "unknown" {
  const ut = shape.userType?.toLowerCase();
  if (ut === "location" || shape.locationIdPresent) return "location";
  if (ut === "company" || ut === "agency") return "company_or_agency";
  if (shape.locationIdPresent) return "location";
  return "unknown";
}
