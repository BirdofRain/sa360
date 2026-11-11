/**
 * Intended Company Sheets configuration requests.
 * A stored request is not a CompanySheetsDestination. Titles and control
 * basis are display copies from the server. They are not submitted.
 *
 * Spreadsheet link parsing stays aligned with
 * apps/api/src/lib/google-spreadsheet-ref.ts.
 */

import {
  COMPANY_SHEETS_CONTROL_BASES,
  companySheetsDiscoveryError,
  controlBasisLabel,
  type CompanySheetsControlBasis,
  type CompanySheetsDiscoveryView,
  type CompanySheetsWorksheetReadSnapshot,
} from "@/lib/team-workspace/company-sheets-discovery";

export { controlBasisLabel };

const SPREADSHEET_ID_PATTERN = /^[a-zA-Z0-9_-]{10,80}$/;
const PATH_ID_PATTERN = /^\/spreadsheets(?:\/u\/\d+)?\/d\/([a-zA-Z0-9_-]+)(?:\/|$)/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ERROR_CODE = /^[a-z0-9_]{1,80}$/;
const WORKSHEET_MAX = 2_147_483_647;

const BOUNDARY_FLAGS = [
  "operationalWrite",
  "destinationUpdated",
  "dispatchChanged",
  "driveChanged",
  "tabContractChanged",
  "columnMapPublished",
  "deliveryArmed",
  "routingChanged",
  "fulfillmentChanged",
] as const;

const CONTROL_BASES = new Set<string>(COMPANY_SHEETS_CONTROL_BASES);

export type CompanySheetsOperationalDestination = {
  exists: boolean;
  destinationRevision: number | null;
  campaignDispatchEnabled: boolean;
  agedDispatchEnabled: boolean;
};

export type CompanySheetsStoredRequest = {
  requestId: string;
  revision: number;
  spreadsheetId: string;
  worksheetId: number;
  spreadsheetTitle: string;
  worksheetTitle: string;
  controlBasis: string;
  controlCheckedAt: string;
  expectedDestinationRevision: number | null;
  createdAt: string;
};

export type CompanySheetsConfigHead = {
  clientAccountId: string;
  revision: number;
  operationalDestination: CompanySheetsOperationalDestination;
  configuration: CompanySheetsStoredRequest | null;
};

export type CompanySheetsConfigSubmitBody = {
  requestId: string;
  expectedRevision: number;
  expectedDestinationRevision: number | null;
  spreadsheetId: string;
  worksheetId: number;
};

export type CompanySheetsConfigConnection = {
  connected: boolean;
  reconnectRequired: boolean;
  status: string;
  googleEmail: string | null;
  sheetsSetupAvailable: boolean;
  approvedParentStored: boolean;
};

export type CompanySheetsDiscoveryDestination = {
  exists: boolean;
  destinationRevision: number | null;
  campaignDispatchEnabled: boolean;
  agedDispatchEnabled: boolean;
};

export type CompanySheetsConfigContext = {
  connection: CompanySheetsConfigConnection | null;
  folderStatus: CompanySheetsDiscoveryView["clientFolderStatus"];
  folderDetail: string;
  spreadsheetId: string | null;
  spreadsheetInputInvalid: boolean;
  worksheetId: number | null;
  verification: CompanySheetsWorksheetReadSnapshot | null;
  discoveryDestination: CompanySheetsDiscoveryDestination | null;
};

export type CompanySheetsConfigReview = {
  connectionDetail: string;
  storageDetail: string;
  spreadsheetDetail: string;
  worksheetDetail: string;
  controlDetail: string;
  operationalDetail: string;
  blockers: string[];
  canSubmit: boolean;
  sessionVerified: boolean;
  activeDelivery: boolean;
  activeDeliveryWarning: string | null;
};

export type CompanySheetsConfigProgressStep = {
  id: "spreadsheet_recorded" | "worksheet_recorded" | "company_control_recorded" | "request_saved" | "awaiting_application";
  label: string;
  state: "complete" | "current" | "waiting";
  detail: string;
};

export type CompanySheetsConfigSaveView = CompanySheetsStoredRequest & {
  replayed: boolean;
  operationalDestination: CompanySheetsOperationalDestination;
};

export function parseCompanySpreadsheetRef(raw: unknown): { ok: true; spreadsheetId: string } | { ok: false; reason: "empty" | "invalid" } {
  if (typeof raw !== "string") return { ok: false, reason: "empty" };
  const value = raw.trim();
  if (!value) return { ok: false, reason: "empty" };
  if (value.includes("\0") || /[\u0000-\u001f\u007f]/.test(value)) return { ok: false, reason: "invalid" };
  if (looksLikeUrl(value)) {
    const fromUrl = extractIdFromSheetsUrl(value);
    if (!fromUrl) return { ok: false, reason: "invalid" };
    return { ok: true, spreadsheetId: fromUrl };
  }
  if (value.includes("/") || value.includes("?") || value.includes("#") || value.includes("\\")) {
    return { ok: false, reason: "invalid" };
  }
  if (!SPREADSHEET_ID_PATTERN.test(value)) return { ok: false, reason: "invalid" };
  return { ok: true, spreadsheetId: value };
}

export function parseCompanySheetsConfigHead(value: unknown): CompanySheetsConfigHead | null {
  const record = asRecord(value);
  if (!record || record.ok !== true || !boundaryClear(record)) return null;
  const clientAccountId = text(record.clientAccountId);
  const revision = revisionOf(record.revision);
  const operationalDestination = parseOperational(record.operationalDestination);
  if (!clientAccountId || revision === null || !operationalDestination) return null;
  const configuration = record.configuration === null ? null : parseStored(record.configuration);
  if (record.configuration !== null && !configuration) return null;
  return { clientAccountId, revision, operationalDestination, configuration };
}

export function parseCompanySheetsConfigSaveResult(value: unknown): CompanySheetsConfigSaveView | null {
  const record = asRecord(value);
  if (!record || record.ok !== true || record.status !== "stored" || !boundaryClear(record)) return null;
  if (typeof record.replayed !== "boolean") return null;
  const operationalDestination = parseOperational(record.operationalDestination);
  const stored = parseStored({
    requestId: record.requestId,
    revision: record.revision,
    spreadsheetId: record.spreadsheetId,
    worksheetId: record.worksheetId,
    spreadsheetTitle: record.spreadsheetTitle,
    worksheetTitle: record.worksheetTitle,
    controlBasis: record.controlBasis,
    controlCheckedAt: record.controlCheckedAt,
    expectedDestinationRevision: record.expectedDestinationRevision,
    createdAt: record.controlCheckedAt,
  });
  if (!stored || !operationalDestination) return null;
  return { ...stored, replayed: record.replayed, operationalDestination };
}

export function readCompanySheetsConfigError(value: unknown): string | null {
  const record = asRecord(value);
  if (!record || record.ok !== false || typeof record.error !== "string" || !ERROR_CODE.test(record.error)) return null;
  return record.error;
}

export function companySheetsConfigRequestErrorMessage(code: string): string {
  switch (code) {
    case "company_sheets_config_request_disabled":
    case "feature_disabled":
    case "FEATURE_DISABLED":
      return "Company Sheets configuration requests are turned off. Nothing was stored, and delivery was not changed.";
    case "destination_disabled":
      return "Company Sheets setup is turned off. The spreadsheet was not saved, and delivery was not changed.";
    case "google_not_connected":
      return "No company Google account is connected. This page does not connect Google. Nothing was stored.";
    case "google_reconnect_required":
      return "The company Google account needs to be reconnected. This page does not start that connection. Nothing was stored.";
    case "oauth_not_configured":
      return "Company Google sign-in is not configured. Nothing was stored.";
    case "approved_drive_unconfigured":
    case "approved_parent_unconfigured":
    case "destination_folder_unverified":
      return "Approved company storage is not available. Nothing was stored.";
    case "folder_unavailable":
    case "recorded_folder_unavailable":
    case "ambiguous_client_folder":
      return "The client folder is not available. A folder was not created, and nothing was stored.";
    case "not_company_controlled":
    case "outside_approved_parent":
    case "unapproved_shared_drive":
    case "not_approved_parent":
    case "folder_not_company_owned":
    case "insufficient_capability":
    case "shortcut_bypass":
    case "trashed_file":
      return `${companySheetsDiscoveryError(code)} Nothing was stored.`;
    case "spreadsheet_bound_to_other_client":
      return "That spreadsheet is already used by another client. Nothing was stored.";
    case "worksheet_unavailable":
      return "That worksheet is not on this spreadsheet. A worksheet from another spreadsheet was not used. Nothing was stored.";
    case "worksheet_not_grid":
      return "That worksheet is not a grid tab. Choose a grid worksheet by its id. Nothing was stored.";
    case "invalid_worksheet":
      return "That worksheet id cannot be saved. Nothing was stored.";
    case "invalid_spreadsheet_ref":
      return "Enter a spreadsheet id or a Google Sheets link. Nothing was stored.";
    case "spreadsheet_unavailable":
      return "The spreadsheet could not be found with the company account. Nothing was stored.";
    case "access_denied":
      return "Google denied permission for this file. Nothing was stored.";
    case "drive_scope_required":
    case "drive_file_scope_required":
    case "spreadsheets_scope_required":
      return "The company Google account is missing permission to read this spreadsheet. Nothing was stored.";
    case "ownership_unverified":
    case "ancestry_unavailable":
    case "ancestry_cycle":
    case "ancestry_limit":
      return "Company control could not be confirmed for this spreadsheet. Nothing was stored.";
    case "revision_conflict":
      return "The configuration request changed after this page was loaded. Reload it before saving again. Nothing new was stored.";
    case "destination_stale":
      return "The operational destination changed after this page was loaded. Reload it before saving again. The destination was not changed from this page.";
    case "request_id_reused":
      return "This request was already used with different details. Reload and reconcile it before starting another. Nothing new was stored.";
    case "destination_busy":
      return "The destination is busy. Retry uses the same request. Nothing was stored yet.";
    case "retryable":
      return "Google is unavailable right now. Retry uses the same request. Nothing on this page was marked stored.";
    case "provider_error":
      return "Google returned an unexpected response. Nothing on this page was marked stored.";
    case "forbidden":
      return "Portal access and observer access cannot store a Company Sheets configuration request. Nothing was stored.";
    case "client_not_found":
      return "This client was not found. Nothing was stored.";
    case "invalid_body":
      return "The configuration request was rejected. Check the spreadsheet and worksheet. Nothing was stored.";
    default:
      return "The configuration request was not stored. The operational destination was not changed.";
  }
}

export function buildCompanySheetsConfigSubmitBody(input: {
  requestId: string;
  head: CompanySheetsConfigHead;
  spreadsheetId: string;
  worksheetId: number | null;
}): CompanySheetsConfigSubmitBody | null {
  if (!UUID.test(input.requestId)) return null;
  if (!Number.isSafeInteger(input.head.revision) || input.head.revision < 0) return null;
  const parsed = parseCompanySpreadsheetRef(input.spreadsheetId);
  if (!parsed.ok) return null;
  if (!worksheetIdAllowed(input.worksheetId)) return null;
  const expectedDestinationRevision = expectedDestinationRevisionFrom(input.head.operationalDestination);
  if (expectedDestinationRevision === undefined) return null;
  return {
    requestId: input.requestId,
    expectedRevision: input.head.revision,
    expectedDestinationRevision,
    spreadsheetId: parsed.spreadsheetId,
    worksheetId: input.worksheetId as number,
  };
}

export function sameCompanySheetsConfigSubmitBody(
  left: CompanySheetsConfigSubmitBody,
  right: CompanySheetsConfigSubmitBody
): boolean {
  return JSON.stringify(canonicalBody(left)) === JSON.stringify(canonicalBody(right));
}

export function presentCompanySheetsConfigProgress(head: CompanySheetsConfigHead | null): CompanySheetsConfigProgressStep[] {
  const stored = head?.configuration ?? null;
  const spreadsheetDone = Boolean(stored && parseCompanySpreadsheetRef(stored.spreadsheetId).ok);
  const worksheetDone = Boolean(stored && worksheetIdAllowed(stored.worksheetId));
  const controlDone = Boolean(stored && CONTROL_BASES.has(stored.controlBasis));
  const saved = Boolean(stored);
  return [
    {
      id: "spreadsheet_recorded",
      label: "Spreadsheet recorded",
      state: spreadsheetDone ? "complete" : "current",
      detail: spreadsheetDone
        ? `Stored spreadsheet ${stored?.spreadsheetId}.`
        : "No spreadsheet is stored on the configuration request.",
    },
    {
      id: "worksheet_recorded",
      label: "Worksheet recorded",
      state: worksheetDone ? "complete" : spreadsheetDone ? "current" : "waiting",
      detail: worksheetDone
        ? `Stored worksheet id ${stored?.worksheetId}.`
        : "No worksheet id is stored on the configuration request.",
    },
    {
      id: "company_control_recorded",
      label: "Company control recorded",
      state: controlDone ? "complete" : worksheetDone ? "current" : "waiting",
      detail: controlDone
        ? `Stored control: ${controlBasisLabel(stored?.controlBasis)}. This is not a new verification.`
        : "No company-control result is stored on the configuration request.",
    },
    {
      id: "request_saved",
      label: "Configuration request saved",
      state: saved ? "complete" : "waiting",
      detail: saved
        ? `Stored request ${stored?.requestId} at request revision ${stored?.revision}. This is not an operational destination.`
        : "No configuration request is stored.",
    },
    {
      id: "awaiting_application",
      label: "Awaiting operational application",
      state: saved ? "current" : "waiting",
      detail: saved
        ? "The request is waiting for a separate operational step. Delivery stays unchanged, and the saved destination was not changed."
        : "Operational application stays unavailable until a configuration request is stored.",
    },
  ];
}

export function reviewCompanySheetsConfig(input: {
  context: CompanySheetsConfigContext;
  head: CompanySheetsConfigHead | null;
}): CompanySheetsConfigReview {
  const { context, head } = input;
  const connectionDetail = connectionCopy(context.connection);
  const storageDetail = storageCopy(context);
  const spreadsheetId = context.spreadsheetId;
  const verification = matchingVerification(context.verification, spreadsheetId);
  const foreignVerification = Boolean(
    context.verification && spreadsheetId && context.verification.spreadsheetId !== spreadsheetId
  );
  const worksheet = verification?.ok
    ? verification.worksheets.find((item) => item.worksheetId === context.worksheetId) ?? null
    : null;
  const sessionVerified = Boolean(
    verification?.ok &&
      isControlBasis(verification.controlBasis) &&
      worksheet &&
      worksheet.sheetType === "GRID"
  );
  const activeDelivery = deliveryActive(head, context.discoveryDestination);
  const spreadsheetDetail = spreadsheetCopy(context, verification, foreignVerification);
  const worksheetDetail = worksheetCopy(context.worksheetId, verification, foreignVerification, worksheet);
  const controlDetail = controlCopy(verification, sessionVerified);
  const operationalDetail = operationalCopy(head, context.discoveryDestination);
  const blockers: string[] = [];
  if (!context.connection) blockers.push(connectionDetail);
  else if (!context.connection.connected || context.connection.status === "disconnected") blockers.push(connectionDetail);
  else if (
    context.connection.reconnectRequired ||
    context.connection.status === "reconnect_required" ||
    context.connection.status === "error"
  ) {
    blockers.push(connectionDetail);
  }
  if (context.connection && !context.connection.sheetsSetupAvailable) blockers.push(connectionDetail);
  if (context.spreadsheetInputInvalid) blockers.push(spreadsheetDetail);
  if (!spreadsheetId) blockers.push("Choose a spreadsheet by its id or a Google Sheets link. Choosing one does not save it.");
  if (spreadsheetId && !parseCompanySpreadsheetRef(spreadsheetId).ok) {
    blockers.push("That spreadsheet id cannot be saved. Use the id from the Google Sheets link.");
  }
  if (foreignVerification) blockers.push("Worksheets from another spreadsheet are not a valid choice. Read the selected spreadsheet.");
  if (spreadsheetId && !verification) blockers.push("Read this spreadsheet before saving. An earlier read is not verification for this choice.");
  if (verification && !verification.ok) blockers.push(companySheetsConfigRequestErrorMessage(verification.code ?? "provider_error"));
  if (verification?.ok && !isControlBasis(verification.controlBasis)) {
    blockers.push("This spreadsheet is outside company-controlled storage. Nothing was stored.");
  }
  if (spreadsheetId && verification?.ok && context.worksheetId == null) {
    blockers.push("Choose a grid worksheet by its numeric id. The first worksheet is not selected automatically.");
  }
  if (verification?.ok && context.worksheetId != null && !worksheet) {
    blockers.push("That worksheet is not on this spreadsheet. A worksheet from another spreadsheet was not used.");
  }
  if (worksheet && worksheet.sheetType !== "GRID") blockers.push("That worksheet is not a grid tab. Choose a grid worksheet by its id.");
  if (!head) blockers.push("The configuration request has not been loaded. Reload it before saving.");
  if (head && !context.discoveryDestination) {
    blockers.push("The operational destination has not been read on this page. Reload it before saving.");
  }
  if (head && context.discoveryDestination && !destinationsAlign(head.operationalDestination, context.discoveryDestination)) {
    blockers.push("The operational destination on this page does not match the configuration request. Reload both before saving.");
  }
  return {
    connectionDetail,
    storageDetail,
    spreadsheetDetail,
    worksheetDetail,
    controlDetail,
    operationalDetail,
    blockers: unique(blockers),
    canSubmit: blockers.length === 0,
    sessionVerified,
    activeDelivery,
    activeDeliveryWarning: activeDelivery
      ? "An active destination is already delivering or ready to deliver. Saving this request does not change that destination, its dispatch switches, or lead delivery."
      : head?.operationalDestination.exists || context.discoveryDestination?.exists
        ? "A saved operational destination exists. Saving this request does not change it or turn delivery on."
        : null,
  };
}

export function formatCompanySheetsConfigTimestamp(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

export function companySheetsSubmitPayload(body: CompanySheetsConfigSubmitBody): CompanySheetsConfigSubmitBody {
  return canonicalBody(body);
}

function expectedDestinationRevisionFrom(operational: CompanySheetsOperationalDestination): number | null | undefined {
  if (!operational.exists) {
    return operational.destinationRevision === null ? null : undefined;
  }
  return operational.destinationRevision != null && operational.destinationRevision >= 1
    ? operational.destinationRevision
    : undefined;
}

function matchingVerification(
  verification: CompanySheetsWorksheetReadSnapshot | null,
  spreadsheetId: string | null
): CompanySheetsWorksheetReadSnapshot | null {
  if (!verification || !spreadsheetId || verification.spreadsheetId !== spreadsheetId) return null;
  return verification;
}

function destinationsAlign(
  operational: CompanySheetsOperationalDestination,
  discovery: CompanySheetsDiscoveryDestination
): boolean {
  return (
    operational.exists === discovery.exists &&
    operational.destinationRevision === discovery.destinationRevision &&
    operational.campaignDispatchEnabled === discovery.campaignDispatchEnabled &&
    operational.agedDispatchEnabled === discovery.agedDispatchEnabled
  );
}

function deliveryActive(
  head: CompanySheetsConfigHead | null,
  discovery: CompanySheetsDiscoveryDestination | null
): boolean {
  return Boolean(
    head?.operationalDestination.campaignDispatchEnabled ||
      head?.operationalDestination.agedDispatchEnabled ||
      discovery?.campaignDispatchEnabled ||
      discovery?.agedDispatchEnabled
  );
}

function connectionCopy(connection: CompanySheetsConfigConnection | null): string {
  if (!connection) return "The company Google connection has not been read.";
  if (!connection.sheetsSetupAvailable) {
    return "Company Sheets setup is turned off. Folders and worksheets stay unread, and a request cannot be saved.";
  }
  if (!connection.connected || connection.status === "disconnected") {
    return "No company Google account is connected. This page does not ask a client to connect Google.";
  }
  if (connection.reconnectRequired || connection.status === "reconnect_required" || connection.status === "error") {
    return "The company Google account needs to be reconnected. This page does not start that connection.";
  }
  const account = connection.googleEmail ?? "The company account";
  return `${account} is connected. Credentials are not shown.`;
}

function storageCopy(context: CompanySheetsConfigContext): string {
  const parent = context.connection?.approvedParentStored
    ? "Approved company storage is on file."
    : "Approved company storage has not been confirmed on this page.";
  if (context.folderStatus === "not_read") {
    return `${parent} The client folder has not been checked. Checking it does not create a folder or save a request.`;
  }
  return `${parent} ${context.folderDetail}`;
}

function spreadsheetCopy(
  context: CompanySheetsConfigContext,
  verification: CompanySheetsWorksheetReadSnapshot | null,
  foreign: boolean
): string {
  if (context.spreadsheetInputInvalid) return "Enter a spreadsheet id or a Google Sheets link. A link and its id are the same file.";
  if (!context.spreadsheetId) return "No spreadsheet is selected. Selecting one does not save it.";
  if (foreign) return `Spreadsheet ${context.spreadsheetId} is selected. The worksheet list is for a different spreadsheet and is not a choice.`;
  if (!verification) return `Spreadsheet ${context.spreadsheetId} is selected. It has not been read in this session.`;
  if (!verification.ok) return `Spreadsheet ${context.spreadsheetId} was read and was not accepted.`;
  const title = verification.title ? `${verification.title} (${context.spreadsheetId})` : context.spreadsheetId;
  return `${title} was read in this session. This selection is not saved yet.`;
}

function worksheetCopy(
  worksheetId: number | null,
  verification: CompanySheetsWorksheetReadSnapshot | null,
  foreign: boolean,
  worksheet: { worksheetId: number; title: string; sheetType: string | null } | null
): string {
  if (foreign) return "Choose a worksheet only after reading the selected spreadsheet.";
  if (worksheetId == null) return "No worksheet is selected. The first worksheet is not selected automatically.";
  if (!verification?.ok) return `Worksheet id ${worksheetId} is selected. Read this spreadsheet before it can be checked.`;
  if (!worksheet) return `Worksheet id ${worksheetId} is not on this spreadsheet.`;
  const kind = worksheet.sheetType === "GRID" ? "Grid tab" : "Not a grid tab";
  return `Worksheet id ${worksheet.worksheetId} (${worksheet.title}). ${kind}. This choice is not saved yet.`;
}

function controlCopy(verification: CompanySheetsWorksheetReadSnapshot | null, sessionVerified: boolean): string {
  if (!verification) return "Company control has not been read for this selection. A stored request is not verification.";
  if (!verification.ok) return companySheetsConfigRequestErrorMessage(verification.code ?? "ownership_unverified");
  if (!sessionVerified) return `This session read the spreadsheet. ${controlBasisLabel(verification.controlBasis)}.`;
  return `This session confirmed ${controlBasisLabel(verification.controlBasis).toLowerCase()}. That confirmation is only for this spreadsheet until the selection changes.`;
}

function operationalCopy(
  head: CompanySheetsConfigHead | null,
  discovery: CompanySheetsDiscoveryDestination | null
): string {
  const operational = head?.operationalDestination;
  if (!operational && !discovery) return "The operational destination has not been read.";
  const source = operational ?? null;
  if (source && !source.exists) return "No operational Company Sheets destination is saved. A configuration request does not create one.";
  if (source?.exists) {
    const dispatch = source.campaignDispatchEnabled || source.agedDispatchEnabled ? "Dispatch is on." : "Dispatch is off.";
    return `Operational destination revision ${source.destinationRevision}. ${dispatch} The configuration request does not change it.`;
  }
  if (discovery && !discovery.exists) return "No operational Company Sheets destination is saved on this page.";
  return `This page read operational destination revision ${discovery?.destinationRevision ?? "unknown"}.`;
}

function canonicalBody(body: CompanySheetsConfigSubmitBody): CompanySheetsConfigSubmitBody {
  const parsed = parseCompanySpreadsheetRef(body.spreadsheetId);
  return {
    requestId: body.requestId.trim(),
    expectedRevision: body.expectedRevision,
    expectedDestinationRevision: body.expectedDestinationRevision,
    spreadsheetId: parsed.ok ? parsed.spreadsheetId : body.spreadsheetId.trim(),
    worksheetId: body.worksheetId,
  };
}

function parseStored(value: unknown): CompanySheetsStoredRequest | null {
  const record = asRecord(value);
  if (!record) return null;
  const requestId = text(record.requestId);
  const revision = positiveInt(record.revision);
  const spreadsheet = text(record.spreadsheetId);
  const parsed = spreadsheet ? parseCompanySpreadsheetRef(spreadsheet) : null;
  const worksheetId = worksheetIdOf(record.worksheetId);
  const spreadsheetTitle = text(record.spreadsheetTitle);
  const worksheetTitle = text(record.worksheetTitle);
  const controlBasis = text(record.controlBasis);
  const controlCheckedAt = text(record.controlCheckedAt);
  const createdAt = text(record.createdAt);
  const expectedDestinationRevision =
    record.expectedDestinationRevision === null ? null : positiveInt(record.expectedDestinationRevision);
  if (record.expectedDestinationRevision !== null && expectedDestinationRevision == null) return null;
  if (
    !requestId ||
    !UUID.test(requestId) ||
    revision == null ||
    !parsed?.ok ||
    parsed.spreadsheetId !== spreadsheet ||
    worksheetId == null ||
    !spreadsheetTitle ||
    !worksheetTitle ||
    !controlBasis ||
    !controlCheckedAt ||
    !createdAt
  ) {
    return null;
  }
  return {
    requestId,
    revision,
    spreadsheetId: parsed.spreadsheetId,
    worksheetId,
    spreadsheetTitle,
    worksheetTitle,
    controlBasis,
    controlCheckedAt,
    expectedDestinationRevision,
    createdAt,
  };
}

function parseOperational(value: unknown): CompanySheetsOperationalDestination | null {
  const record = asRecord(value);
  if (!record || typeof record.exists !== "boolean") return null;
  if (typeof record.campaignDispatchEnabled !== "boolean" || typeof record.agedDispatchEnabled !== "boolean") return null;
  if (!record.exists) {
    if (record.destinationRevision !== null) return null;
    return {
      exists: false,
      destinationRevision: null,
      campaignDispatchEnabled: record.campaignDispatchEnabled,
      agedDispatchEnabled: record.agedDispatchEnabled,
    };
  }
  const destinationRevision = positiveInt(record.destinationRevision);
  if (destinationRevision == null) return null;
  return {
    exists: true,
    destinationRevision,
    campaignDispatchEnabled: record.campaignDispatchEnabled,
    agedDispatchEnabled: record.agedDispatchEnabled,
  };
}

function boundaryClear(record: Record<string, unknown>): boolean {
  return BOUNDARY_FLAGS.every((flag) => record[flag] === false);
}

function isControlBasis(value: string | null | undefined): value is CompanySheetsControlBasis {
  return Boolean(value && CONTROL_BASES.has(value));
}

function revisionOf(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function positiveInt(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1 ? value : null;
}

function worksheetIdOf(value: unknown): number | null {
  return worksheetIdAllowed(value) ? value : null;
}

function worksheetIdAllowed(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= WORKSHEET_MAX;
}

function looksLikeUrl(value: string): boolean {
  return /^[a-zA-Z][a-zA-Z+.-]*:/.test(value) || value.startsWith("//");
}

function extractIdFromSheetsUrl(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  if (url.hostname !== "docs.google.com") return null;
  const pathname = url.pathname;
  if (pathname.includes("..") || pathname.includes("//")) return null;
  if (pathname.toLowerCase().includes("%2e") || pathname.toLowerCase().includes("%2f")) return null;
  const match = pathname.match(PATH_ID_PATTERN);
  if (!match?.[1] || !SPREADSHEET_ID_PATTERN.test(match[1])) return null;
  return match[1];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
