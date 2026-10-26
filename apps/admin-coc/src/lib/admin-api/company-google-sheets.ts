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
  controlBasis: "company_created" | "drive_owner_verified" | "approved_shared_drive";
  folderPlacement: string;
  destinationSaved: false;
  created?: boolean;
  writable: false;
};

export type CompanySheetsFolderChoice = {
  folderId: string;
  title: string;
  url: string;
  source?: "recorded" | "name";
};

export type CompanySheetsFolderPrepareResult = {
  ok: true;
  outcome: "reused" | "created" | "linked" | "select" | "in_progress" | "unknown";
  created: boolean;
  linked: boolean;
  driveDeleted: false;
  folder: CompanySheetsFolderChoice | null;
  folders: CompanySheetsFolderChoice[];
};

export type CompanySheetsFolderSpreadsheetList = {
  ok: true;
  folder: CompanySheetsFolderChoice | null;
  spreadsheets: Array<{ spreadsheetId: string; title: string; url: string }>;
  nextPageToken: string | null;
  skipped: number;
  links: Array<{
    spreadsheetId: string;
    spreadsheetTitle: string | null;
    spreadsheetUrl: string;
    status: string;
    recordedAt: string;
    supersededAt: string | null;
  }>;
  folderEvents: Array<{ folderId: string; folderTitle: string; action: string; createdAt: string }>;
  currentDestination: {
    spreadsheetId: string;
    spreadsheetTitle: string | null;
    spreadsheetUrl: string;
    updatedAt: string;
  } | null;
};

export type CompanySheetsDispatchView = {
  ok: true;
  configured: boolean;
  dispatchFlagEnabled: boolean;
  campaignDispatchEnabled: boolean;
  campaignDispatchNotBefore: string | null;
  agedDispatchEnabled: boolean;
  agedDispatchNotBefore: string | null;
  lastCampaignDelivery: {
    jobId: string;
    status: string;
    spreadsheetId: string;
    worksheetId: number;
    worksheetTitle: string;
    createdAt: string;
    finishedAt: string | null;
    appendStartedAt: string | null;
    uncertainReason: string | null;
  } | null;
};

export type CompanySheetsColumnMapping = {
  ok: true;
  schemaVersion: string;
  niche: "vet" | "unsupported";
  timezone: "America/New_York";
  columns: Array<{
    header: string;
    sourceField: string;
    group: string;
    help: string;
    systemRequired: boolean;
    example: string;
    missingExample: string;
  }>;
  unmappedSampleLabels: Array<{ label: string; reason: string }>;
  warnings: string[];
  readiness: string;
  spreadsheetId: string | null;
  worksheetId: number | null;
  boundSchemaVersion: string | null;
  customMapping: false;
};

export type CompanySheetsWriteProbe = {
  ok: true;
  permissionProbe: true;
  canEdit: boolean | null;
  campaignDeliveryVerified: false;
  inventoryAffected: false;
  rowWritten: false;
  spreadsheetId: string;
  spreadsheetTitle: string;
  worksheetTitle: string;
  boundCampaignWorksheetId: number | null;
  matchesBoundCampaignTab: boolean;
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
  input: {
    role: "campaign" | "aged" | "canary";
    worksheetId: number;
    exportPackageId?: string;
    schemaVersion?: string;
  }
) {
  return adminRequestJson<{ ok: true; destinationRevision: number }>(
    "POST",
    clientPath(clientAccountId, "tabs/bind"),
    input
  );
}

export function prepareCompanyClientFolder(
  clientAccountId: string,
  input: { intent: "inspect" | "link" | "create"; folderId?: string }
) {
  return adminRequestJson<CompanySheetsFolderPrepareResult>("POST", clientPath(clientAccountId, "folder"), input);
}

export function unlinkCompanyClientFolder(clientAccountId: string) {
  return adminRequestJson<{ ok: true; unlinked: boolean; folderId: string | null; driveDeleted: false }>(
    "POST",
    clientPath(clientAccountId, "folder/unlink"),
    {}
  );
}

export function listCompanyClientSpreadsheets(clientAccountId: string, pageToken?: string) {
  const qs = pageToken ? `?${new URLSearchParams({ pageToken }).toString()}` : "";
  return adminRequestJson<CompanySheetsFolderSpreadsheetList>(
    "GET",
    `${clientPath(clientAccountId, "folder/spreadsheets")}${qs}`
  );
}

export function probeCompanySheetWrite(clientAccountId: string, input: { spreadsheetId: string; worksheetId: number }) {
  return adminRequestJson<CompanySheetsWriteProbe>("POST", clientPath(clientAccountId, "write-probe"), input);
}

export type CompanySheetsCampaignTestRow = {
  ok: true;
  testRow: true;
  inventoryAffected: false;
  billingAffected: false;
  deliveryEnabled: false;
  automaticRetry: false;
  spreadsheetId: string;
  spreadsheetTitle: string | null;
  worksheetId: number;
  worksheetTitle: string;
  schemaVersion: string;
  jobId: string;
  status: string;
  appended: boolean;
  rowWritten: boolean;
};

export function sendCompanySheetsCampaignTestRow(clientAccountId: string) {
  return adminRequestJson<CompanySheetsCampaignTestRow>("POST", clientPath(clientAccountId, "campaign-test"), {});
}

export function reviewCompanySheetsColumns(
  clientAccountId: string,
  input: { schemaVersion?: string; nicheKey?: string }
) {
  return adminRequestJson<CompanySheetsColumnMapping>("POST", clientPath(clientAccountId, "column-mapping"), input);
}

export function fetchCompanySheetsDispatch(clientAccountId: string) {
  return adminRequestJson<CompanySheetsDispatchView>("GET", clientPath(clientAccountId, "dispatch"));
}

export function activateCompanySheetsDispatch(
  clientAccountId: string,
  input: { campaignEnabled?: boolean; agedEnabled?: boolean }
) {
  return adminRequestJson<{
    ok: true;
    campaignDispatchEnabled: boolean;
    campaignDispatchNotBefore: string | null;
    agedDispatchEnabled: boolean;
    agedDispatchNotBefore: string | null;
    googleCalled: false;
  }>("POST", clientPath(clientAccountId, "dispatch-activation"), input);
}

export function createCompanySheetsTab(
  clientAccountId: string,
  input: { role: "campaign" | "aged" | "canary"; exportPackageId?: string; schemaVersion?: string }
) {
  return adminRequestJson<{ ok: true; valuesWritten: false; destinationRevision: number }>(
    "POST",
    clientPath(clientAccountId, "tabs/create"),
    input
  );
}
