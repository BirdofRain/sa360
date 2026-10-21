import { adminRequestJson } from "./server";

export type CompanyGoogleConnectionView = {
  configured: boolean;
  status: "connected" | "reconnect_required" | "disconnected" | "error";
  connected: boolean;
  reconnectRequired: boolean;
  googleEmail: string | null;
  googleDisplayName: string | null;
  connectedAt: string | null;
  reconnectRequiredAt: string | null;
  scopes: string[];
  missingScopes: string[];
  destinationFolder: {
    folderId: string;
    title: string | null;
    verifiedAt: string;
  } | null;
  liveDeliveryEnabled: false;
  oauthAvailable: boolean;
  sheetsSetupAvailable: boolean;
};

export type CompanySheetsSharingView = {
  status: "missing_recipient" | "intended_recipient_recorded_not_applied";
  intendedRecipientEmail: string | null;
  mechanism: "explicit_user_permission_not_applied";
  anyoneWithLink: false;
  public: false;
  portalLinkGrantsGoogleAccess: false;
  clientGooglePermission: "not_granted";
  missingRecipientPolicy: boolean;
};

export type CompanySheetsDestinationView = {
  configured: true;
  clientAccountId: string;
  spreadsheetId: string;
  spreadsheetTitle: string | null;
  spreadsheetUrl: string;
  worksheetId: number;
  worksheetTitle: string;
  controlBasis: "company_created" | "drive_owner_verified" | "approved_shared_drive";
  accessStatus: string;
  accessCheckedAt: string | null;
  writeReadiness: "not_verified";
  deliveryExecution: "disabled";
  liveDeliveryEnabled: false;
  enabled: false;
  sharing: CompanySheetsSharingView;
  connection: {
    status: CompanyGoogleConnectionView["status"];
    connected: boolean;
    reconnectRequired: boolean;
  };
  destinationRevision?: number;
  tabContracts?: CompanySheetsTabContractView[];
};

export type CompanySheetsTabContractView = {
  role: "campaign" | "aged" | "canary";
  setupState: string;
  setupReason: string | null;
  worksheetId: number | null;
  worksheetTitle: string | null;
  schemaVersion: string | null;
  tabUrl: string | null;
  deliveryState: string;
};

export type CompanySheetsResolvedWorksheet = {
  sheetId: number;
  title: string;
  index: number;
  sheetType?: string;
};

export type CompanySheetsResolvedSpreadsheet = {
  spreadsheetId: string;
  title: string;
  spreadsheetUrl: string;
  worksheets: CompanySheetsResolvedWorksheet[];
  controlBasis: "company_created" | "drive_owner_verified" | "approved_shared_drive";
  writable: false;
};

export type CompanySheetsCreatedSpreadsheet = {
  spreadsheetId: string;
  title: string;
  spreadsheetUrl: string;
  worksheet: { sheetId: number; title: string };
  controlBasis: "company_created";
  folderPlacement: string;
  destinationSaved: false;
  writable: false;
};

function clientPath(clientAccountId: string, suffix: string): string {
  return `/admin/v1/clients/${encodeURIComponent(clientAccountId)}/google-sheets/${suffix}`;
}

export function fetchCompanyGoogleConnection() {
  return adminRequestJson<{ ok: true; connection: CompanyGoogleConnectionView }>(
    "GET",
    "/admin/v1/integrations/google/company"
  );
}

export function startCompanyGoogleOAuth(returnTo: string) {
  const qs = new URLSearchParams({ returnTo });
  return adminRequestJson<{ ok: true; authorizeUrl: string }>(
    "GET",
    `/admin/v1/integrations/google/company/oauth/start?${qs.toString()}`
  );
}

export function disconnectCompanyGoogle() {
  return adminRequestJson<{ ok: true }>("POST", "/admin/v1/integrations/google/company/disconnect", {});
}

export function saveCompanyGoogleFolder(folder: string) {
  return adminRequestJson<{ ok: true; connection: CompanyGoogleConnectionView }>(
    "PUT",
    "/admin/v1/integrations/google/company/folder",
    { folder }
  );
}

export function clearCompanyGoogleFolder() {
  return adminRequestJson<{ ok: true }>("DELETE", "/admin/v1/integrations/google/company/folder");
}

export function fetchCompanySheetsDestination(clientAccountId: string) {
  return adminRequestJson<{ ok: true; destination: CompanySheetsDestinationView | null }>(
    "GET",
    clientPath(clientAccountId, "destination")
  );
}

export function resolveCompanySpreadsheet(clientAccountId: string, spreadsheet: string) {
  return adminRequestJson<{ ok: true; spreadsheet: CompanySheetsResolvedSpreadsheet }>(
    "POST",
    clientPath(clientAccountId, "resolve"),
    { spreadsheet }
  );
}

export function createCompanySpreadsheet(clientAccountId: string, title?: string, folderId?: string) {
  return adminRequestJson<{ ok: true; spreadsheet: CompanySheetsCreatedSpreadsheet }>(
    "POST",
    clientPath(clientAccountId, "create"),
    {
      ...(title ? { title } : {}),
      ...(folderId ? { folderId } : {}),
    }
  );
}

export function resolveCompanyClientFolder(clientAccountId: string, folder: string) {
  return adminRequestJson<{
    ok: true;
    folder: { folderId: string; title: string; driveId: string | null; basis: string };
  }>("POST", clientPath(clientAccountId, "folder/resolve"), { folder });
}

export function testCompanySpreadsheetAccess(
  clientAccountId: string,
  input: { spreadsheetId: string; worksheetId: number }
) {
  return adminRequestJson<{
    ok: true;
    readOnlyAccess: true;
    writePermissionVerified: false;
    spreadsheetTitle: string;
    worksheetTitle: string;
  }>("POST", clientPath(clientAccountId, "test"), input);
}

export function saveCompanySheetsDestination(
  clientAccountId: string,
  input: { spreadsheetId: string; worksheetId: number; intendedRecipientEmail?: string }
) {
  return adminRequestJson<{ ok: true; destination: CompanySheetsDestinationView }>(
    "PUT",
    clientPath(clientAccountId, "destination"),
    {
      spreadsheetId: input.spreadsheetId,
      worksheetId: input.worksheetId,
      ...(input.intendedRecipientEmail
        ? { intendedRecipientEmail: input.intendedRecipientEmail }
        : {}),
    }
  );
}

export function deleteCompanySheetsDestination(clientAccountId: string) {
  return adminRequestJson<{ ok: true; destination: null }>(
    "DELETE",
    clientPath(clientAccountId, "destination")
  );
}

export function inspectCompanySheetsTabs(clientAccountId: string, exportPackageId?: string) {
  return adminRequestJson<{ ok: true; googleMutations: 0; contracts: CompanySheetsTabContractView[] }>(
    "POST",
    clientPath(clientAccountId, "tabs/inspect"),
    exportPackageId ? { exportPackageId } : {}
  );
}

export function bindCompanySheetsTab(
  clientAccountId: string,
  input: { role: "campaign" | "aged" | "canary"; worksheetId: number; exportPackageId?: string }
) {
  return adminRequestJson<{ ok: true; destinationRevision: number }>(
    "POST",
    clientPath(clientAccountId, "tabs/bind"),
    input
  );
}

export function createCompanySheetsTab(
  clientAccountId: string,
  input: { role: "campaign" | "aged" | "canary"; exportPackageId?: string }
) {
  return adminRequestJson<{ ok: true; valuesWritten: false; destinationRevision: number }>(
    "POST",
    clientPath(clientAccountId, "tabs/create"),
    input
  );
}
