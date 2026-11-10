/**
 * Read-only presentation of company-owned Google Sheets setup.
 * Life Agent Launch owns the Google account. A readable spreadsheet URL is
 * not company control. This module does not write.
 */

export const COMPANY_SHEETS_CONTROL_BASES = [
  "company_created",
  "drive_owner_verified",
  "approved_shared_drive",
] as const;

export type CompanySheetsControlBasis = (typeof COMPANY_SHEETS_CONTROL_BASES)[number];

export type CompanySheetsDiscoveryState =
  | "configured"
  | "verified"
  | "active"
  | "pending"
  | "blocked"
  | "unavailable";

export type CompanySheetsDiscoveryFact = {
  id: string;
  label: string;
  state: CompanySheetsDiscoveryState;
  detail: string;
};

export type CompanySheetsDiscoveryStep = {
  id: string;
  label: string;
  state: "complete" | "attention" | "not_read" | "blocked";
  detail: string;
};

export type CompanySheetsDiscoverySpreadsheet = {
  spreadsheetId: string;
  title: string;
  saved: boolean;
  control: "not_checked" | "company_controlled" | "rejected";
  detail: string;
};

export type CompanySheetsDiscoveryWorksheet = {
  worksheetId: number;
  title: string;
  sheetType: string | null;
  saved: boolean;
  grid: boolean;
};

export type CompanySheetsDiscoveryView = {
  availability: "ready" | "disabled" | "error";
  message: string | null;
  uncertain: boolean;
  clientAccountId: string;
  configured: boolean;
  verified: boolean;
  active: boolean;
  operationalWrite: false;
  googleAccountEmail: string | null;
  connectionStatus: string;
  oauthAvailable: boolean;
  sheetsSetupAvailable: boolean;
  approvedParent: { folderId: string; title: string | null; verifiedAt: string } | null;
  clientFolderStatus: "not_read" | "missing" | "recorded" | "outside_approved" | "unlinked" | "unavailable";
  clientFolderDetail: string;
  candidateFolders: Array<{ folderId: string; title: string }>;
  spreadsheets: CompanySheetsDiscoverySpreadsheet[];
  worksheets: CompanySheetsDiscoveryWorksheet[];
  worksheetReadFor: string | null;
  savedDestination: {
    spreadsheetId: string;
    spreadsheetTitle: string | null;
    worksheetId: number;
    worksheetTitle: string;
    recordedControlBasis: string;
    accessStatus: string;
    destinationRevision: number | null;
  } | null;
  campaignContract: {
    setupState: string;
    setupReason: string | null;
    worksheetId: number | null;
    worksheetTitle: string | null;
    schemaVersion: string | null;
  } | null;
  columnMappingReadiness: string;
  columnMappingDetail: string;
  delivery: {
    campaignDispatchEnabled: boolean;
    agedDispatchEnabled: boolean;
    dispatchFlagEnabled: boolean | null;
    executionFlagRead: false;
  };
  selection: {
    spreadsheetId: string | null;
    worksheetId: number | null;
    matchesSavedSpreadsheet: boolean;
    matchesSavedWorksheet: boolean;
  };
  facts: CompanySheetsDiscoveryFact[];
  steps: CompanySheetsDiscoveryStep[];
  blockers: string[];
  summary: string;
};

export type CompanySheetsConnectionSnapshot = {
  configured: boolean;
  status: string;
  connected: boolean;
  reconnectRequired: boolean;
  googleEmail: string | null;
  googleDisplayName: string | null;
  missingScopes: string[];
  destinationFolder: { folderId: string; title: string | null; verifiedAt: string } | null;
  oauthAvailable: boolean;
  sheetsSetupAvailable: boolean;
};

export type CompanySheetsDestinationSnapshot = {
  spreadsheetId: string;
  spreadsheetTitle: string | null;
  worksheetId: number;
  worksheetTitle: string;
  controlBasis: string;
  accessStatus: string;
  destinationRevision: number | null;
};

export type CompanySheetsContractSnapshot = {
  role: string;
  setupState: string;
  setupReason: string | null;
  worksheetId: number | null;
  worksheetTitle: string | null;
  schemaVersion: string | null;
};

export type CompanySheetsDispatchSnapshot = {
  campaignDispatchEnabled: boolean;
  agedDispatchEnabled: boolean;
  dispatchFlagEnabled: boolean;
};

export type CompanySheetsMappingSnapshot = {
  readiness: string;
  schemaVersion: string | null;
  boundSchemaVersion: string | null;
};

export type CompanySheetsStorageSnapshot = {
  inspectError: string | null;
  listError: string | null;
  folder: { folderId: string; title: string } | null;
  folderUnlinked: boolean;
  folderCheck: { ok: true; basis: string } | { ok: false; code: string } | null;
  spreadsheets: Array<{ spreadsheetId: string; title: string }>;
  skipped: number;
  candidates: Array<{ folderId: string; title: string }>;
};

export type CompanySheetsWorksheetReadSnapshot = {
  spreadsheetId: string;
  ok: boolean;
  code: string | null;
  title: string | null;
  controlBasis: string | null;
  worksheets: Array<{ worksheetId: number; title: string; sheetType: string | null }>;
};

export type CompanySheetsDiscoverySnapshot = {
  clientAccountId: string;
  disabledReason: string | null;
  uncertain: boolean;
  loadError: string | null;
  connection: CompanySheetsConnectionSnapshot | null;
  destination: CompanySheetsDestinationSnapshot | null;
  contracts: CompanySheetsContractSnapshot[];
  dispatch: CompanySheetsDispatchSnapshot | null;
  mapping: CompanySheetsMappingSnapshot | null;
  mappingError: string | null;
  storage: CompanySheetsStorageSnapshot | null;
  worksheetRead: CompanySheetsWorksheetReadSnapshot | null;
  selection: { spreadsheetId: string | null; worksheetId: number | null };
};

const ERROR_TEXT: Record<string, string> = {
  destination_disabled: "Company Sheets setup is turned off. Nothing was created and delivery was not started.",
  google_not_connected: "No company Google account is connected. This page does not ask a client to connect Google.",
  google_reconnect_required: "The company Google account needs to be reconnected. This page does not start that connection.",
  oauth_not_configured: "Company Google sign-in is not configured. Account credentials were not shown or changed.",
  access_denied: "Google denied permission for this file. Nothing was created.",
  drive_scope_required: "The company Google account is missing Drive metadata permission. The file was not treated as company-controlled.",
  drive_file_scope_required: "The company Google account cannot add files in Drive. Nothing was created.",
  spreadsheets_scope_required: "The company Google account is missing Sheets permission. Worksheets were not read.",
  approved_drive_unconfigured: "The approved shared drive is not configured. A readable file was not treated as company-controlled.",
  approved_parent_unconfigured: "The approved shared drive or parent folder is not configured. The client folder was not listed.",
  unapproved_shared_drive: "This file is in a shared drive that is not the approved company drive.",
  outside_approved_parent: "This file is outside the approved company folder.",
  not_approved_parent: "The stored parent folder is not the approved company parent.",
  not_company_controlled: "This spreadsheet is readable, and it is not company-controlled.",
  shortcut_bypass: "A shortcut cannot be used as the company file. The shortcut was not followed.",
  trashed_file: "This file is in the trash.",
  insufficient_capability: "The company account cannot edit this file.",
  ancestry_unavailable: "The folder ancestry could not be read, so company control was not confirmed.",
  ancestry_cycle: "The folder ancestry loops, so company control was not confirmed.",
  ancestry_limit: "The folder ancestry is too deep to confirm company control.",
  spreadsheet_unavailable: "The spreadsheet could not be found with the company account.",
  folder_unavailable: "The folder could not be found with the company account.",
  worksheet_unavailable: "That worksheet is not on this spreadsheet.",
  worksheet_not_grid: "That worksheet is not a grid tab.",
  invalid_spreadsheet_ref: "Enter a spreadsheet id or a Google Sheets link. The link alone is not company control.",
  invalid_folder: "That folder id cannot be checked.",
  invalid_worksheet: "That worksheet id cannot be checked.",
  client_not_found: "This client was not found. Nothing was created.",
  retryable: "Google is unavailable right now. Nothing was created and delivery was not started.",
  provider_error: "Google returned an unexpected response. Nothing was created and delivery was not started.",
  ownership_unverified: "Company control could not be confirmed. The file was not saved.",
  folder_not_company_owned: "This folder is not owned by the company account and is not in the approved shared drive.",
  recorded_folder_unavailable: "The recorded client folder is no longer usable. A new folder was not created.",
  ambiguous_client_folder: "More than one client folder matches. None was chosen or created.",
  forbidden: "You do not have permission to read Company Sheets for this client. Nothing was written.",
  storage_changed: "The storage check reported a folder change. This page only asked to look. Reload before continuing. Nothing else was changed from this page.",
};

export function companySheetsDiscoveryError(code: string | null | undefined): string {
  if (!code) return "Company Sheets could not be read. Nothing was written.";
  return ERROR_TEXT[code] ?? "Company Sheets could not be read. Nothing was written.";
}

export function controlBasisLabel(basis: string | null | undefined): string {
  if (basis === "company_created") return "Created by the company account";
  if (basis === "approved_shared_drive") return "Approved company shared drive";
  if (basis === "drive_owner_verified") return "Owned by the company account";
  return "Not confirmed";
}

export function emptyCompanySheetsDiscovery(clientAccountId: string, message: string): CompanySheetsDiscoveryView {
  return presentCompanySheetsDiscovery({
    clientAccountId,
    disabledReason: message,
    uncertain: false,
    loadError: null,
    connection: null,
    destination: null,
    contracts: [],
    dispatch: null,
    mapping: null,
    mappingError: null,
    storage: null,
    worksheetRead: null,
    selection: { spreadsheetId: null, worksheetId: null },
  });
}

export function presentCompanySheetsDiscovery(input: CompanySheetsDiscoverySnapshot): CompanySheetsDiscoveryView {
  const campaign = input.contracts.find((contract) => contract.role === "campaign") ?? null;
  const destination = input.destination;
  const connection = input.connection;
  const dispatch = input.dispatch;
  const active = Boolean(dispatch?.campaignDispatchEnabled || dispatch?.agedDispatchEnabled);
  const configured = destination != null;
  const storage = input.storage;
  const read = input.worksheetRead;
  const savedSpreadsheet = destination?.spreadsheetId ?? null;
  const savedWorksheet = destination?.worksheetId ?? null;
  const selectedSpreadsheet = cleanId(input.selection.spreadsheetId);
  const selectedWorksheet = input.selection.worksheetId;
  const controlConfirmed = savedControlConfirmed(read, savedSpreadsheet, savedWorksheet);
  const contractBound =
    campaign?.setupState === "bound" &&
    campaign.worksheetId != null &&
    savedWorksheet != null &&
    campaign.worksheetId === savedWorksheet;
  const verified = Boolean(controlConfirmed && contractBound);
  const folder = classifyFolder(storage);
  const spreadsheets = presentSpreadsheets(storage, read, savedSpreadsheet, folder.status);
  const worksheets = presentWorksheets(read, savedWorksheet, savedSpreadsheet);
  const mapping = mappingFact(input.mapping, input.mappingError, connection);
  const blockers = collectBlockers({
    input,
    connection,
    destination,
    campaign,
    active,
    verified,
    folder,
    mapping,
    read,
    selectedSpreadsheet,
    selectedWorksheet,
    savedSpreadsheet,
    savedWorksheet,
  });
  const facts = collectFacts({
    connection,
    folder,
    destination,
    campaign,
    mapping,
    dispatch,
    active,
    verified,
    read,
  });
  const steps = collectSteps({ connection, folder, destination, campaign, mapping, storage, read, verified });
  const availability = input.disabledReason ? "disabled" : input.loadError ? "error" : "ready";
  const view: CompanySheetsDiscoveryView = {
    availability,
    message: input.disabledReason ?? input.loadError,
    uncertain: input.uncertain,
    clientAccountId: input.clientAccountId,
    configured,
    verified,
    active,
    operationalWrite: false,
    googleAccountEmail: connection?.googleEmail ?? null,
    connectionStatus: connection?.status ?? "not_read",
    oauthAvailable: connection?.oauthAvailable ?? false,
    sheetsSetupAvailable: connection?.sheetsSetupAvailable ?? false,
    approvedParent: connection?.destinationFolder ?? null,
    clientFolderStatus: folder.status,
    clientFolderDetail: folder.detail,
    candidateFolders: storage?.candidates ?? [],
    spreadsheets,
    worksheets,
    worksheetReadFor: read?.spreadsheetId ?? null,
    savedDestination: destination
      ? {
          spreadsheetId: destination.spreadsheetId,
          spreadsheetTitle: destination.spreadsheetTitle,
          worksheetId: destination.worksheetId,
          worksheetTitle: destination.worksheetTitle,
          recordedControlBasis: destination.controlBasis,
          accessStatus: destination.accessStatus,
          destinationRevision: destination.destinationRevision,
        }
      : null,
    campaignContract: campaign
      ? {
          setupState: campaign.setupState,
          setupReason: campaign.setupReason,
          worksheetId: campaign.worksheetId,
          worksheetTitle: campaign.worksheetTitle,
          schemaVersion: campaign.schemaVersion,
        }
      : null,
    columnMappingReadiness: mapping.readiness,
    columnMappingDetail: mapping.detail,
    delivery: {
      campaignDispatchEnabled: dispatch?.campaignDispatchEnabled === true,
      agedDispatchEnabled: dispatch?.agedDispatchEnabled === true,
      dispatchFlagEnabled: dispatch ? dispatch.dispatchFlagEnabled : null,
      executionFlagRead: false,
    },
    selection: {
      spreadsheetId: selectedSpreadsheet,
      worksheetId: selectedWorksheet,
      matchesSavedSpreadsheet: Boolean(selectedSpreadsheet && selectedSpreadsheet === savedSpreadsheet),
      matchesSavedWorksheet: selectedWorksheet != null && selectedWorksheet === savedWorksheet && Boolean(selectedSpreadsheet === savedSpreadsheet || !selectedSpreadsheet),
    },
    facts,
    steps,
    blockers,
    summary: "",
  };
  view.summary = summaryFor(view);
  return view;
}

function classifyFolder(storage: CompanySheetsStorageSnapshot | null): {
  status: CompanySheetsDiscoveryView["clientFolderStatus"];
  detail: string;
} {
  if (!storage) {
    return {
      status: "not_read",
      detail: "The client folder has not been checked. Checking it does not create a folder.",
    };
  }
  if (storage.inspectError === "approved_parent_unconfigured" || storage.inspectError === "approved_drive_unconfigured") {
    return { status: "unavailable", detail: companySheetsDiscoveryError(storage.inspectError) };
  }
  if (storage.folderUnlinked) {
    return {
      status: "unlinked",
      detail: "A previous client folder was unlinked. This page did not create a replacement.",
    };
  }
  if (storage.folderCheck && !storage.folderCheck.ok) {
    const outside = storage.folderCheck.code === "outside_approved_parent" || storage.folderCheck.code === "unapproved_shared_drive" || storage.folderCheck.code === "not_approved_parent" || storage.folderCheck.code === "folder_not_company_owned";
    return {
      status: outside ? "outside_approved" : "unavailable",
      detail: companySheetsDiscoveryError(storage.folderCheck.code),
    };
  }
  if (!storage.folder) {
    if (storage.listError || storage.inspectError) {
      return { status: "unavailable", detail: companySheetsDiscoveryError(storage.listError ?? storage.inspectError) };
    }
    return {
      status: "missing",
      detail: "This client has no recorded folder. A folder was not created.",
    };
  }
  return {
    status: "recorded",
    detail: storage.folder.title
      ? `Recorded folder “${storage.folder.title}” is inside approved company storage.`
      : "A recorded client folder is inside approved company storage.",
  };
}

function presentSpreadsheets(
  storage: CompanySheetsStorageSnapshot | null,
  read: CompanySheetsWorksheetReadSnapshot | null,
  savedId: string | null,
  folderStatus: CompanySheetsDiscoveryView["clientFolderStatus"]
): CompanySheetsDiscoverySpreadsheet[] {
  if (!storage || folderStatus === "outside_approved" || folderStatus === "unlinked") return [];
  return storage.spreadsheets.map((item) => {
    const checked = read?.spreadsheetId === item.spreadsheetId ? read : null;
    if (checked?.ok && isControlBasis(checked.controlBasis)) {
      return {
        spreadsheetId: item.spreadsheetId,
        title: checked.title || item.title || item.spreadsheetId,
        saved: item.spreadsheetId === savedId,
        control: "company_controlled" as const,
        detail: controlBasisLabel(checked.controlBasis),
      };
    }
    if (checked && !checked.ok) {
      return {
        spreadsheetId: item.spreadsheetId,
        title: item.title || item.spreadsheetId,
        saved: item.spreadsheetId === savedId,
        control: "rejected" as const,
        detail: companySheetsDiscoveryError(checked.code),
      };
    }
    return {
      spreadsheetId: item.spreadsheetId,
      title: item.title || item.spreadsheetId,
      saved: item.spreadsheetId === savedId,
      control: "not_checked" as const,
      detail: "In the recorded client folder. Company control is not confirmed until worksheets are read.",
    };
  });
}

function presentWorksheets(
  read: CompanySheetsWorksheetReadSnapshot | null,
  savedWorksheet: number | null,
  savedSpreadsheet: string | null
): CompanySheetsDiscoveryWorksheet[] {
  if (!read?.ok) return [];
  const savedHere = read.spreadsheetId === savedSpreadsheet;
  return read.worksheets.map((sheet) => ({
    worksheetId: sheet.worksheetId,
    title: sheet.title || `Worksheet ${sheet.worksheetId}`,
    sheetType: sheet.sheetType,
    saved: savedHere && sheet.worksheetId === savedWorksheet,
    grid: isGrid(sheet.sheetType),
  }));
}

function mappingFact(
  mapping: CompanySheetsMappingSnapshot | null,
  mappingError: string | null,
  connection: CompanySheetsConnectionSnapshot | null
): { readiness: string; detail: string } {
  if (connection && !connection.sheetsSetupAvailable) {
    return {
      readiness: "not_reviewed",
      detail: "Company Sheets setup is turned off, so column mapping was not reviewed. No column map was published.",
    };
  }
  if (mappingError) {
    return { readiness: "not_reviewed", detail: companySheetsDiscoveryError(mappingError) };
  }
  if (!mapping) {
    return { readiness: "not_read", detail: "Column mapping has not been reviewed. No column map was published." };
  }
  const details: Record<string, string> = {
    ready: "The bound campaign header matches the reviewed template. Cells were not rewritten.",
    destination_not_saved: "No destination is saved, so there is no column mapping to review.",
    tab_not_bound: "No campaign tab contract is bound, so column mapping is not ready.",
    schema_not_bound: "The bound campaign tab uses a different schema than this review.",
    incompatible_header: "The bound header does not match the template. Existing cells were not rewritten.",
  };
  return {
    readiness: mapping.readiness,
    detail: details[mapping.readiness] ?? "Column mapping was reviewed and is not ready. No column map was published.",
  };
}

function collectBlockers(args: {
  input: CompanySheetsDiscoverySnapshot;
  connection: CompanySheetsConnectionSnapshot | null;
  destination: CompanySheetsDestinationSnapshot | null;
  campaign: CompanySheetsContractSnapshot | null;
  active: boolean;
  verified: boolean;
  folder: { status: CompanySheetsDiscoveryView["clientFolderStatus"]; detail: string };
  mapping: { readiness: string; detail: string };
  read: CompanySheetsWorksheetReadSnapshot | null;
  selectedSpreadsheet: string | null;
  selectedWorksheet: number | null;
  savedSpreadsheet: string | null;
  savedWorksheet: number | null;
}): string[] {
  const blockers: string[] = [];
  if (args.input.disabledReason) blockers.push(args.input.disabledReason);
  if (args.input.loadError) blockers.push(args.input.loadError);
  const connection = args.connection;
  if (!connection) {
    if (!args.input.disabledReason) blockers.push("The company Google connection has not been read.");
  } else if (!connection.configured || connection.status === "disconnected") {
    blockers.push("No company Google account is connected. Clients are not asked to connect their own Google account.");
  } else if (connection.reconnectRequired || connection.status === "reconnect_required" || connection.status === "error") {
    blockers.push(companySheetsDiscoveryError("google_reconnect_required"));
  }
  if (connection && connection.missingScopes.length > 0) {
    blockers.push(`The company Google account is missing permission: ${connection.missingScopes.join(", ")}.`);
  }
  if (connection && !connection.oauthAvailable) {
    blockers.push("Company Google sign-in is turned off. The stored connection was only read.");
  }
  if (connection && !connection.sheetsSetupAvailable) {
    blockers.push("Company Sheets setup is turned off. Folders, spreadsheets, and worksheets were not read from Google.");
  }
  if (connection && !connection.destinationFolder) {
    blockers.push("No verified approved parent folder is stored for the company account.");
  }
  if (args.folder.status === "missing" || args.folder.status === "outside_approved" || args.folder.status === "unavailable" || args.folder.status === "unlinked") {
    blockers.push(args.folder.detail);
  }
  if (args.input.storage && args.input.storage.skipped > 0) {
    blockers.push("Some Drive items were skipped because they are shortcuts, trashed, or outside the approved drive.");
  }
  if (!args.destination) blockers.push("No Company Sheets destination is saved for this client.");
  if (args.read && !args.read.ok) blockers.push(companySheetsDiscoveryError(args.read.code));
  if (args.read?.ok && args.savedSpreadsheet && args.read.spreadsheetId === args.savedSpreadsheet && args.savedWorksheet != null) {
    const found = args.read.worksheets.find((sheet) => sheet.worksheetId === args.savedWorksheet);
    if (!found) blockers.push("The saved worksheet id is not on the saved spreadsheet.");
    else if (found.sheetType && found.sheetType !== "GRID") blockers.push("The saved worksheet is not a grid tab.");
  }
  if (!args.campaign || args.campaign.setupState === "missing" || args.campaign.worksheetId == null) {
    blockers.push("No campaign tab contract is saved.");
  } else if (args.campaign.setupState !== "bound") {
    blockers.push(
      args.campaign.setupReason
        ? `The campaign tab contract is ${args.campaign.setupState}: ${args.campaign.setupReason}.`
        : `The campaign tab contract is ${args.campaign.setupState}.`
    );
  } else if (args.savedWorksheet != null && args.campaign.worksheetId !== args.savedWorksheet) {
    blockers.push("The campaign tab contract worksheet does not match the saved destination worksheet.");
  }
  if (args.mapping.readiness !== "ready") blockers.push(args.mapping.detail);
  if (args.active) {
    blockers.push("An active Company Sheets destination already exists. This page will not change it.");
  }
  if (!args.verified && args.destination) {
    blockers.push("Company control has not been confirmed in this session. A saved spreadsheet is not verification.");
  }
  if (args.selectedSpreadsheet && args.selectedSpreadsheet !== args.savedSpreadsheet) {
    blockers.push("Unsaved choice: the highlighted spreadsheet is not the saved destination. It was not saved.");
  }
  if (
    args.selectedWorksheet != null &&
    args.savedWorksheet != null &&
    args.selectedWorksheet !== args.savedWorksheet &&
    (args.selectedSpreadsheet == null || args.selectedSpreadsheet === args.savedSpreadsheet)
  ) {
    blockers.push("Unsaved choice: the highlighted worksheet does not match the saved destination. It was not saved.");
  }
  return unique(blockers);
}

function collectFacts(args: {
  connection: CompanySheetsConnectionSnapshot | null;
  folder: { status: CompanySheetsDiscoveryView["clientFolderStatus"]; detail: string };
  destination: CompanySheetsDestinationSnapshot | null;
  campaign: CompanySheetsContractSnapshot | null;
  mapping: { readiness: string; detail: string };
  dispatch: CompanySheetsDispatchSnapshot | null;
  active: boolean;
  verified: boolean;
  read: CompanySheetsWorksheetReadSnapshot | null;
}): CompanySheetsDiscoveryFact[] {
  const connection = args.connection;
  const accountDetail = !connection
    ? "Not read."
    : connection.connected
      ? `${connection.googleEmail ?? "Company account"} is connected. Credentials are not shown.`
      : companySheetsDiscoveryError(connection.status === "reconnect_required" || connection.status === "error" ? "google_reconnect_required" : "google_not_connected");
  return [
    {
      id: "google_account",
      label: "Company Google account",
      state: connection?.connected ? "configured" : connection ? "blocked" : "unavailable",
      detail: accountDetail,
    },
    {
      id: "approved_storage",
      label: "Approved storage",
      state: connection?.destinationFolder ? "verified" : "blocked",
      detail: connection?.destinationFolder
        ? "A verified parent folder is stored. This page did not change it."
        : "No verified parent folder is stored.",
    },
    {
      id: "client_folder",
      label: "Client folder",
      state: args.folder.status === "recorded" ? "configured" : args.folder.status === "not_read" ? "pending" : "blocked",
      detail: args.folder.detail,
    },
    {
      id: "destination",
      label: "Saved destination",
      state: args.destination ? "configured" : "pending",
      detail: args.destination
        ? `${args.destination.spreadsheetTitle ?? args.destination.spreadsheetId}, worksheet ${args.destination.worksheetId}. Previously recorded control: ${controlBasisLabel(args.destination.controlBasis)}.`
        : "No destination is saved.",
    },
    {
      id: "control",
      label: "Company control",
      state: args.verified ? "verified" : "pending",
      detail: args.verified
        ? "This session confirmed the saved spreadsheet and the bound campaign worksheet."
        : "Verified only after this session reads the saved spreadsheet and the bound campaign worksheet matches. A link is not enough.",
    },
    {
      id: "campaign_tab",
      label: "Campaign tab contract",
      state: args.campaign?.setupState === "bound" ? "configured" : "blocked",
      detail: args.campaign
        ? `State ${args.campaign.setupState}. Worksheet ${args.campaign.worksheetId ?? "none"}. Schema ${args.campaign.schemaVersion ?? "none"}.`
        : "No campaign tab contract is saved.",
    },
    {
      id: "column_mapping",
      label: "Column mapping",
      state: args.mapping.readiness === "ready" ? "verified" : "blocked",
      detail: args.mapping.detail,
    },
    {
      id: "delivery",
      label: "Delivery",
      state: args.active ? "active" : "pending",
      detail: args.active
        ? "Campaign or aged dispatch is already on for this destination. This page does not change that switch."
        : args.dispatch
          ? "Destination dispatch is off. The execution flag is not part of this read, and it was not turned on."
          : "Dispatch status was not read. Delivery was not turned on.",
    },
  ];
}

function collectSteps(args: {
  connection: CompanySheetsConnectionSnapshot | null;
  folder: { status: CompanySheetsDiscoveryView["clientFolderStatus"] };
  destination: CompanySheetsDestinationSnapshot | null;
  campaign: CompanySheetsContractSnapshot | null;
  mapping: { readiness: string };
  storage: CompanySheetsStorageSnapshot | null;
  read: CompanySheetsWorksheetReadSnapshot | null;
  verified: boolean;
}): CompanySheetsDiscoveryStep[] {
  return [
    {
      id: "account",
      label: "Company Google account",
      state: args.connection?.connected ? "complete" : args.connection ? "blocked" : "not_read",
      detail: args.connection?.connected ? "Connected" : "Needs a company account",
    },
    {
      id: "storage",
      label: "Approved parent folder",
      state: args.connection?.destinationFolder ? "complete" : "attention",
      detail: args.connection?.destinationFolder ? "Stored and verified earlier" : "Not stored",
    },
    {
      id: "folder",
      label: "Client folder",
      state: args.folder.status === "recorded" ? "complete" : args.folder.status === "not_read" ? "not_read" : "blocked",
      detail: args.folder.status === "not_read" ? "Not checked yet" : args.folder.status,
    },
    {
      id: "spreadsheet",
      label: "Spreadsheet",
      state: args.destination ? "complete" : args.storage ? "attention" : "not_read",
      detail: args.destination ? "Saved" : "Not saved",
    },
    {
      id: "worksheet",
      label: "Worksheet",
      state: args.verified ? "complete" : args.read ? "attention" : "not_read",
      detail: args.verified ? "Matches the saved destination" : args.read ? "Read, not a saved change" : "Not read from Google",
    },
    {
      id: "contract",
      label: "Tab and columns",
      state: args.campaign?.setupState === "bound" && args.mapping.readiness === "ready" ? "complete" : "attention",
      detail: args.mapping.readiness === "ready" ? "Mapping ready" : "Mapping not ready",
    },
    {
      id: "delivery",
      label: "Delivery status",
      state: "attention",
      detail: "Shown separately from configured and verified",
    },
  ];
}

function summaryFor(view: CompanySheetsDiscoveryView): string {
  const folder =
    view.clientFolderStatus === "not_read"
      ? "Client folder not checked"
      : `Client folder ${view.clientFolderStatus.replaceAll("_", " ")}`;
  return [
    view.configured ? "Configured" : "Not configured",
    view.verified ? "Verified" : "Not verified",
    view.active ? "Active" : "Not active",
    folder,
    `Column mapping ${view.columnMappingReadiness.replaceAll("_", " ")}`,
    view.active ? "Dispatch on" : "Dispatch off",
  ].join(". ") + ".";
}

function savedControlConfirmed(
  read: CompanySheetsWorksheetReadSnapshot | null,
  savedSpreadsheet: string | null,
  savedWorksheet: number | null
): boolean {
  if (!read?.ok || !savedSpreadsheet || savedWorksheet == null) return false;
  if (read.spreadsheetId !== savedSpreadsheet || !isControlBasis(read.controlBasis)) return false;
  return read.worksheets.some((sheet) => sheet.worksheetId === savedWorksheet && isGrid(sheet.sheetType));
}

function isGrid(sheetType: string | null): boolean {
  return sheetType === "GRID";
}

function isControlBasis(value: string | null | undefined): value is CompanySheetsControlBasis {
  return COMPANY_SHEETS_CONTROL_BASES.some((basis) => basis === value);
}

function cleanId(value: string | null): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed : null;
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}
