import { parseTrustedPortalPublicOrigin } from "./google-oauth-env.js";
import { resolvePortalPublicBaseUrl } from "./portal-public-url.js";

export const COMPANY_GOOGLE_CONNECTION_KEY = "life_agent_launch";

/**
 * Defensive adapter key. Company destinations are stored on CompanySheetsDestination,
 * not DeliveryTarget. If a later change inserts this key onto DeliveryTarget, LF2
 * planning must keep excluding it until an explicit execution phase.
 */
export const COMPANY_GOOGLE_SHEETS_DELIVERY_ADAPTER_KEY = "google_sheets.company.v1";

export const COMPANY_SHEETS_WRITE_READINESS_NOT_VERIFIED = "not_verified";
export const COMPANY_SHEETS_DELIVERY_EXECUTION_DISABLED = "disabled";
export const COMPANY_SHEETS_DEFAULT_WORKSHEET_TITLE = "Leads";

export const COMPANY_GOOGLE_DRIVE_METADATA_SCOPE =
  "https://www.googleapis.com/auth/drive.metadata.readonly";
export const COMPANY_GOOGLE_DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";
export const COMPANY_GOOGLE_SPREADSHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";

export const COMPANY_GOOGLE_OAUTH_SCOPES = [
  "openid",
  "email",
  "profile",
  COMPANY_GOOGLE_SPREADSHEETS_SCOPE,
  COMPANY_GOOGLE_DRIVE_METADATA_SCOPE,
  COMPANY_GOOGLE_DRIVE_FILE_SCOPE,
] as const;

export const COMPANY_GOOGLE_DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files";

const UNTRUSTED_DESTINATION_FIELDS = [
  "ownedByCompany",
  "companyOwned",
  "createdBySa360",
  "ownership",
  "owner",
  "controlBasis",
  "enabled",
  "isPrimary",
  "isRequired",
  "writeReadiness",
  "deliveryExecution",
  "accessStatus",
  "sharingStatus",
  "liveDeliveryEnabled",
  "readinessStatus",
] as const;

export type CompanySheetsControlBasis = "company_created" | "drive_owner_verified";

export type CompanySheetsControlResult =
  | { ok: true; controlBasis: CompanySheetsControlBasis }
  | { ok: false; reason: "not_company_controlled" | "ownership_unverified" };

export function isCompanyGoogleOAuthEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SA360_COMPANY_GOOGLE_OAUTH_ENABLED?.trim().toLowerCase() === "true";
}

export function isCompanyGoogleSheetsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SA360_COMPANY_GOOGLE_SHEETS_ENABLED?.trim().toLowerCase() === "true";
}

/** Live Sheets writes, including the admin canary executor. Default off. */
export function isCompanyGoogleSheetsExecutionEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SA360_COMPANY_GOOGLE_SHEETS_EXECUTION_ENABLED?.trim().toLowerCase() === "true";
}

export const COMPANY_SHEETS_DELIVERY_BATCH_SIZE = 25;
export const COMPANY_SHEETS_RECONCILE_ROW_CAP = 5000;
export const COMPANY_SHEETS_RELEASE_HOLD_PHRASE = "RETRY AFTER RECONCILE";
export const COMPANY_SHEETS_LEAD_HEADER = [
  "delivery_row_id",
  "client_account_id",
  "source_lead_event_id",
  "received_at",
  "full_name",
  "email",
  "phone",
] as const;

export function grantedScopeList(scopes: unknown): string[] {
  if (!Array.isArray(scopes)) return [];
  return scopes.filter((scope): scope is string => typeof scope === "string" && scope.trim().length > 0);
}

export function missingCompanyOperationalScopes(scopes: unknown): string[] {
  const granted = new Set(grantedScopeList(scopes));
  return [
    COMPANY_GOOGLE_SPREADSHEETS_SCOPE,
    COMPANY_GOOGLE_DRIVE_METADATA_SCOPE,
    COMPANY_GOOGLE_DRIVE_FILE_SCOPE,
  ].filter((scope) => !granted.has(scope));
}

/**
 * Company control is server-derived.
 * A readable file that the company account does not own is not company-managed.
 * A creation marker proves this server created the file. A later Drive owner
 * mismatch means the file left company control and is rejected.
 * When Drive ownership cannot be checked, a creation marker is still accepted
 * and a pasted URL is not.
 */
export function deriveCompanySheetsControl(input: {
  creationMarker: boolean;
  driveOwnerMatch: boolean | null;
}): CompanySheetsControlResult {
  if (input.driveOwnerMatch === false) {
    return { ok: false, reason: "not_company_controlled" };
  }
  if (input.creationMarker) {
    return { ok: true, controlBasis: "company_created" };
  }
  if (input.driveOwnerMatch === true) {
    return { ok: true, controlBasis: "drive_owner_verified" };
  }
  return { ok: false, reason: "ownership_unverified" };
}

export function listUntrustedDestinationFields(body: unknown): string[] {
  if (!body || typeof body !== "object" || Array.isArray(body)) return [];
  return UNTRUSTED_DESTINATION_FIELDS.filter((key) =>
    Object.prototype.hasOwnProperty.call(body, key)
  );
}

const FOLDER_ID_PATTERN = /^[a-zA-Z0-9_-]{10,128}$/;

export function parseCompanyDriveFolderRef(
  raw: unknown
): { ok: true; folderId: string } | { ok: false; reason: "empty" | "invalid" } {
  if (typeof raw !== "string") return { ok: false, reason: "empty" };
  const value = raw.trim();
  if (!value) return { ok: false, reason: "empty" };
  if (/[\u0000-\u001f\u007f]/.test(value)) return { ok: false, reason: "invalid" };
  if (/^[a-zA-Z][a-zA-Z+.-]*:/.test(value) || value.startsWith("//")) {
    return extractFolderId(value);
  }
  if (value.includes("/") || value.includes("?") || value.includes("#") || value.includes("\\")) {
    return { ok: false, reason: "invalid" };
  }
  if (!FOLDER_ID_PATTERN.test(value)) return { ok: false, reason: "invalid" };
  return { ok: true, folderId: value };
}

function extractFolderId(
  value: string
): { ok: true; folderId: string } | { ok: false; reason: "invalid" } {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (url.protocol !== "https:") return { ok: false, reason: "invalid" };
  if (url.username || url.password) return { ok: false, reason: "invalid" };
  if (url.hostname !== "drive.google.com") return { ok: false, reason: "invalid" };
  const pathname = url.pathname;
  if (pathname.includes("..") || pathname.includes("%")) return { ok: false, reason: "invalid" };
  const match = pathname.match(/\/folders\/([a-zA-Z0-9_-]{10,128})(?:\/|$)/);
  if (!match?.[1] || !FOLDER_ID_PATTERN.test(match[1])) {
    return { ok: false, reason: "invalid" };
  }
  return { ok: true, folderId: match[1] };
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseIntendedRecipientEmail(
  raw: unknown
): { ok: true; email: string | null } | { ok: false } {
  if (raw == null || raw === "") return { ok: true, email: null };
  if (typeof raw !== "string") return { ok: false };
  const email = raw.trim().toLowerCase();
  if (!email) return { ok: true, email: null };
  if (email.length > 254 || /[\u0000-\u001f\u007f]/.test(email) || !EMAIL_PATTERN.test(email)) {
    return { ok: false };
  }
  return { ok: true, email };
}

export type CompanySheetsSharingProjection = {
  status: "missing_recipient" | "intended_recipient_recorded_not_applied";
  intendedRecipientEmail: string | null;
  mechanism: "explicit_user_permission_not_applied";
  anyoneWithLink: false;
  public: false;
  portalLinkGrantsGoogleAccess: false;
  clientGooglePermission: "not_granted";
  missingRecipientPolicy: boolean;
};

export function projectCompanySheetsSharing(
  email: string | null
): CompanySheetsSharingProjection {
  const intendedRecipientEmail = email?.trim().toLowerCase() || null;
  const recorded = Boolean(intendedRecipientEmail);
  return {
    status: recorded ? "intended_recipient_recorded_not_applied" : "missing_recipient",
    intendedRecipientEmail,
    mechanism: "explicit_user_permission_not_applied",
    anyoneWithLink: false,
    public: false,
    portalLinkGrantsGoogleAccess: false,
    clientGooglePermission: "not_granted",
    missingRecipientPolicy: !recorded,
  };
}

/**
 * Spreadsheet cells are data. Values that a spreadsheet would treat as formulas
 * are prefixed so a later writer cannot be interpreted as a formula.
 * This foundation does not append rows.
 */
export function neutralizeSpreadsheetCell(value: string): string {
  if (!value) return value;
  const trimmed = value.trimStart();
  if (/^[=+\-@]/.test(trimmed)) return `'${value}`;
  return value;
}

const DEFAULT_ADMIN_RETURN_TO = "/clients";
const ADMIN_RETURN_ORIGIN = "https://sa360.invalid";
const CLIENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

function containsControlChars(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

export function parseSafeCompanyAdminReturnTo(
  raw: string | null | undefined
): string | null {
  if (raw == null || !raw.trim()) return DEFAULT_ADMIN_RETURN_TO;
  const value = raw.trim();
  if (containsControlChars(value)) return null;
  if (value.includes("%") || value.includes("\\") || value.includes("?")) return null;
  const lower = value.toLowerCase();
  if (
    lower.startsWith("javascript:") ||
    lower.startsWith("data:") ||
    lower.startsWith("http:") ||
    lower.startsWith("https:") ||
    value.startsWith("//") ||
    value.includes("://")
  ) {
    return null;
  }
  if (!value.startsWith("/")) return null;
  if (value.split("/").some((segment) => segment === ".." || segment === ".")) return null;
  let url: URL;
  try {
    url = new URL(value, ADMIN_RETURN_ORIGIN);
  } catch {
    return null;
  }
  if (url.origin !== ADMIN_RETURN_ORIGIN || url.username || url.password) return null;
  if (url.search || url.hash) return null;
  const pathname = url.pathname;
  if (pathname === "/clients") return pathname;
  const parts = pathname.split("/");
  if (parts.length < 3 || parts[0] !== "" || parts[1] !== "clients") return null;
  const clientId = parts[2] ?? "";
  if (!CLIENT_ID_PATTERN.test(clientId)) return null;
  if (parts.length === 3) return pathname;
  if (parts.length === 4) {
    const leaf = parts[3];
    if (leaf === "google-sheets" || leaf === "settings" || leaf === "delivery-config") {
      return pathname;
    }
  }
  return null;
}

export function resolveCompanyAdminPublicOrigin(
  env: NodeJS.ProcessEnv = process.env
): string | null {
  const raw =
    env.SA360_ADMIN_PUBLIC_BASE_URL?.trim() ||
    env.ADMIN_COC_BASE_URL?.trim() ||
    resolvePortalPublicBaseUrl(env);
  return parseTrustedPortalPublicOrigin(raw);
}

export type CompanyGoogleOAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  adminPublicBaseUrl: string;
};

export function getCompanyGoogleOAuthConfig(
  env: NodeJS.ProcessEnv = process.env
): CompanyGoogleOAuthConfig | null {
  const clientId = env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  const redirectUri = env.COMPANY_GOOGLE_OAUTH_REDIRECT_URI?.trim();
  const adminPublicBaseUrl = resolveCompanyAdminPublicOrigin(env);
  if (!clientId || !clientSecret || !redirectUri || !adminPublicBaseUrl) return null;
  let parsed: URL;
  try {
    parsed = new URL(redirectUri);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  if (parsed.username || parsed.password) return null;
  if (!parsed.pathname.endsWith("/integrations/google/company/oauth/callback")) return null;
  return { clientId, clientSecret, redirectUri, adminPublicBaseUrl };
}

export function buildCompanyGoogleAuthorizeUrl(input: {
  config: Pick<CompanyGoogleOAuthConfig, "clientId" | "redirectUri">;
  state: string;
  codeChallenge: string;
}): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: input.config.clientId,
    redirect_uri: input.config.redirectUri,
    scope: COMPANY_GOOGLE_OAUTH_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    state: input.state,
    code_challenge: input.codeChallenge,
    code_challenge_method: "S256",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export function buildCompanyAdminRedirect(
  adminPublicBaseUrl: string,
  returnTo: string,
  status: "connected" | "cancelled" | "error" | "account_in_use"
): string {
  const origin = parseTrustedPortalPublicOrigin(adminPublicBaseUrl);
  if (!origin) throw new Error("Admin public base URL is invalid.");
  const path = parseSafeCompanyAdminReturnTo(returnTo) ?? DEFAULT_ADMIN_RETURN_TO;
  const url = new URL(path, `${origin}/`);
  if (url.origin !== origin || !url.pathname.startsWith("/clients")) {
    const fallback = new URL(DEFAULT_ADMIN_RETURN_TO, `${origin}/`);
    fallback.searchParams.set("companyGoogle", status);
    return fallback.toString();
  }
  url.searchParams.set("companyGoogle", status);
  return url.toString();
}
