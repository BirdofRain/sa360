import "server-only";

import { fetchAdminSourceLeadDetail } from "./server";
import { adminRequestJson } from "./server";
import { listCompanyClientSpreadsheets } from "./company-google-sheets";
import { noteEventFromSourceLead } from "../clients/onboarding/view";
import type {
  OnboardingActionResult,
  OnboardingActivationIntent,
  OnboardingDestinationSave,
  OnboardingDriveItem,
  OnboardingDriveSearch,
  OnboardingFolderResolve,
  OnboardingGhlMode,
  OnboardingNotePreview,
  OnboardingSheetPreview,
  OnboardingSpreadsheetListItem,
  OnboardingSummary,
  OnboardingTestIdentity,
  OnboardingTestPreviewSheet,
  OnboardingTestRun,
  StoredTestRunView,
  OnboardingWorkflowMatch,
  OnboardingWorkflowSave,
  ColumnMapAssignment,
  ColumnMapDobAge,
  ColumnMapDraftPreview,
  ColumnMapRecord,
  ColumnMapSavePublishResult,
  SheetsTargetSave,
} from "../clients/onboarding/types";

const ERROR_CODE = /^[a-z0-9_]{1,80}$/;

function clientPath(clientAccountId: string, suffix: string): string {
  return `/admin/v1/clients/${encodeURIComponent(clientAccountId)}/onboarding${suffix}`;
}

export function readOnboardingFailure(
  status: number,
  body: string
): { error: string; status: number; detail?: string } {
  try {
    const parsed = JSON.parse(body) as { error?: unknown; detail?: unknown };
    if (typeof parsed.error === "string" && ERROR_CODE.test(parsed.error)) {
      const detail = typeof parsed.detail === "string" && parsed.detail.length > 0 && parsed.detail.length <= 500 ? parsed.detail : undefined;
      return { error: parsed.error, status, ...(detail ? { detail } : {}) };
    }
  } catch {
    // Non-JSON bodies stay a generic code so tokens and HTML are not shown.
  }
  if (status === 401) return { error: "unauthorized", status };
  if (status === 403) return { error: "forbidden", status };
  if (status === 404) return { error: "not_found", status };
  return { error: "request_failed", status };
}

async function request<T>(
  method: "GET" | "POST" | "PUT" | "PATCH",
  path: string,
  body: unknown,
  project: (data: unknown) => T | null
): Promise<OnboardingActionResult<T>> {
  const res = await adminRequestJson<unknown>(method, path, body);
  if (!res.ok) {
    const failure = readOnboardingFailure(res.status, res.body);
    return { ok: false, ...failure };
  }
  const data = project(res.data);
  if (!data) return { ok: false, error: "malformed_response", status: 502 };
  return { ok: true, data };
}

export function fetchOnboardingSummary(
  clientAccountId: string
): Promise<OnboardingActionResult<OnboardingSummary>> {
  return request("GET", clientPath(clientAccountId, ""), undefined, projectSummary);
}

export function searchOnboardingDrive(
  clientAccountId: string,
  input: { scope: "approved_parent" | "client_folder"; query: string }
): Promise<OnboardingActionResult<OnboardingDriveSearch>> {
  return request("POST", clientPath(clientAccountId, "/drive/search"), input, projectDriveSearch);
}

export function resolveOnboardingFolder(
  clientAccountId: string,
  folder: string
): Promise<OnboardingActionResult<OnboardingFolderResolve>> {
  return request(
    "POST",
    clientPath(clientAccountId, "/drive/resolve"),
    { folder },
    projectFolderResolve
  );
}

export function browseResolvedOnboardingFolder(
  clientAccountId: string,
  folderId: string
): Promise<OnboardingActionResult<OnboardingSpreadsheetListItem[]>> {
  return request("POST", clientPath(clientAccountId, "/drive/spreadsheets"), { folderId }, (data) => {
    const record = asRecord(data);
    if (!record || record.ok !== true || record.saved !== false || record.linked !== false) return null;
    const spreadsheets = Array.isArray(record.spreadsheets) ? record.spreadsheets : [];
    return spreadsheets
      .map((item) => {
        const row = asRecord(item);
        if (!row || typeof row.spreadsheetId !== "string" || typeof row.title !== "string") return null;
        return {
          spreadsheetId: row.spreadsheetId,
          title: row.title,
          url: typeof row.url === "string" ? row.url : "",
        };
      })
      .filter((item) => item !== null);
  });
}

export async function listOnboardingSpreadsheets(
  clientAccountId: string
): Promise<OnboardingActionResult<OnboardingSpreadsheetListItem[]>> {
  const res = await listCompanyClientSpreadsheets(clientAccountId);
  if (!res.ok) {
    const failure = readOnboardingFailure(res.status, res.body);
    return { ok: false, ...failure };
  }
  const spreadsheets = Array.isArray(res.data.spreadsheets) ? res.data.spreadsheets : [];
  return {
    ok: true,
    data: spreadsheets.map((item) => ({
      spreadsheetId: item.spreadsheetId,
      title: item.title,
      url: item.url,
    })),
  };
}

export function previewOnboardingSpreadsheet(
  clientAccountId: string,
  spreadsheetId: string
): Promise<OnboardingActionResult<OnboardingSheetPreview>> {
  return request(
    "POST",
    clientPath(clientAccountId, "/sheets/preview"),
    { spreadsheetId, purpose: "campaign" },
    projectSheetPreview
  );
}

export function saveOnboardingDestination(
  clientAccountId: string,
  input: {
    requestId: string;
    expectedRevision: number;
    sheetsSelected: boolean;
    ghlMode: OnboardingGhlMode;
    notesEnabled: boolean;
  }
): Promise<OnboardingActionResult<OnboardingDestinationSave>> {
  return request("PUT", clientPath(clientAccountId, "/destination"), input, projectDestinationSave);
}

export async function loadOnboardingWorkflows(
  clientAccountId: string
): Promise<OnboardingActionResult<OnboardingWorkflowMatch>> {
  const res = await adminRequestJson<unknown>("GET", clientPath(clientAccountId, "/ghl-workflows"));
  if (!res.ok) {
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(res.body);
    } catch {
      parsed = null;
    }
    const projected = projectWorkflow(parsed, readOnboardingFailure(res.status, res.body).error);
    if (projected && projected.workflowMatch !== "workflow_not_found") {
      return { ok: true, data: projected };
    }
    if (projected?.error === "workflow_not_found" || projected?.error === "workflow_ambiguous") {
      return { ok: true, data: projected };
    }
    return { ok: false, ...readOnboardingFailure(res.status, res.body) };
  }
  const projected = projectWorkflow(res.data, null);
  if (!projected) return { ok: false, error: "malformed_response", status: 502 };
  return { ok: true, data: projected };
}

export function saveOnboardingWorkflow(
  clientAccountId: string,
  input: {
    requestId: string;
    expectedRevision: number;
    discoveredWorkflowId: string;
    discoveredName: string;
  }
): Promise<OnboardingActionResult<OnboardingWorkflowSave>> {
  return request("PUT", clientPath(clientAccountId, "/ghl-workflow"), input, projectWorkflowSave);
}

export async function previewOnboardingNote(
  clientAccountId: string,
  sourceLeadEventId: string
): Promise<OnboardingActionResult<OnboardingNotePreview>> {
  const detail = await fetchAdminSourceLeadDetail(sourceLeadEventId);
  if (detail.error || !detail.item) {
    return { ok: false, error: "event_not_found", status: 404 };
  }
  const owners = [detail.item.destinationClientAccountId, detail.item.sourceClientAccountId].filter(
    (value): value is string => Boolean(value)
  );
  if (owners.length > 0 && !owners.includes(clientAccountId)) {
    return { ok: false, error: "event_not_client_owned", status: 403 };
  }
  const event = noteEventFromSourceLead(detail.item);
  return request(
    "POST",
    clientPath(clientAccountId, "/ghl-note-preview"),
    { event, testRunId: null, noteOverflow: "refuse" },
    projectNote
  );
}

export function saveOnboardingTestIdentity(
  clientAccountId: string,
  input: { requestId: string; email: string | null; phoneE164: string | null }
): Promise<OnboardingActionResult<OnboardingTestIdentity>> {
  return request("PUT", clientPath(clientAccountId, "/test-identities"), input, (data) => {
    const record = asRecord(data);
    if (!record || record.ok !== true) return null;
    return {
      email: input.email,
      phoneE164: input.phoneE164,
      persisted: record.persisted === true,
    };
  });
}

const CONFIRM_ONE_CUSTOM_SHEETS_ROW = "DELIVER ONE CUSTOM SHEETS TEST ROW";

export function deliverCapturedSheetsTest(
  clientAccountId: string,
  input: { requestId: string; sourceLeadEventId: string }
): Promise<OnboardingActionResult<OnboardingTestRun>> {
  return request(
    "POST",
    clientPath(clientAccountId, "/test-runs"),
    {
      requestId: input.requestId,
      kind: "captured_event_delivery",
      sourceLeadEventId: input.sourceLeadEventId,
      destinations: ["google_sheets"],
      execute: true,
      confirmation: CONFIRM_ONE_CUSTOM_SHEETS_ROW,
      isolation: { mode: "verified_test_identity", sheetsContract: "custom_campaign_map" },
    },
    projectTestRun
  );
}

export function previewOnboardingStoredLead(
  clientAccountId: string,
  input: {
    requestId: string;
    sourceLeadEventId: string;
    destinations: Array<"google_sheets" | "ghl_location_api">;
  }
): Promise<OnboardingActionResult<OnboardingTestRun>> {
  return request(
    "POST",
    clientPath(clientAccountId, "/test-runs"),
    {
      requestId: input.requestId,
      kind: "captured_event_replay",
      sourceLeadEventId: input.sourceLeadEventId,
      destinations: input.destinations,
      execute: false,
    },
    projectTestRun
  );
}

export function approveOnboardingTestWorksheet(
  clientAccountId: string,
  input: { requestId: string; spreadsheetId: string; worksheetId: number }
): Promise<OnboardingActionResult<{ worksheetId: number }>> {
  return request(
    "PUT",
    clientPath(clientAccountId, "/test-worksheet"),
    {
      requestId: input.requestId,
      spreadsheetId: input.spreadsheetId,
      worksheetId: input.worksheetId,
    },
    (data) => {
      const record = asRecord(data);
      if (!record || record.ok !== true || record.createdWorksheet !== false || record.productionBindingChanged !== false) {
        return null;
      }
      if (typeof record.worksheetId !== "number") return null;
      return { worksheetId: record.worksheetId };
    }
  );
}

export function listOnboardingTestRuns(
  clientAccountId: string
): Promise<OnboardingActionResult<StoredTestRunView[]>> {
  return request("GET", clientPath(clientAccountId, "/test-runs"), undefined, (data) => {
    const record = asRecord(data);
    if (!record || record.ok !== true || record.resendAuthorized !== false) return null;
    if (!Array.isArray(record.runs)) return null;
    return record.runs
      .map((item) => {
        const row = asRecord(item);
        if (!row || typeof row.id !== "string") return null;
        return {
          id: row.id,
          kind: typeof row.kind === "string" ? row.kind : "preview",
          status: typeof row.status === "string" ? row.status : "unknown",
          sourceLeadEventId: typeof row.sourceLeadEventId === "string" ? row.sourceLeadEventId : null,
          attempts: projectAttempts(row.attempts),
          sheet: projectPreviewSheet(row.sheet),
          noteBody: typeof row.noteBody === "string" ? row.noteBody : null,
          noteContract: typeof row.noteContract === "string" ? row.noteContract : null,
          qaEvidence: asRecord(row.qaEvidence)
            ? {
                status: typeof asRecord(row.qaEvidence)?.status === "string" ? String(asRecord(row.qaEvidence)?.status) : "not_recoverable",
                fullQaCompletenessAsserted: asRecord(row.qaEvidence)?.fullQaCompletenessAsserted === true,
                discardedDuplicateCount:
                  typeof asRecord(row.qaEvidence)?.discardedDuplicateCount === "number"
                    ? Number(asRecord(row.qaEvidence)?.discardedDuplicateCount)
                    : 0,
              }
            : null,
          resendAuthorized: false as const,
          reconcileObservation: typeof row.reconcileObservation === "string" ? row.reconcileObservation : null,
        };
      })
      .filter((item) => item !== null);
  });
}

export function recordOnboardingActivationIntent(
  clientAccountId: string,
  input: {
    requestId: string;
    destination: "google_sheets_campaign" | "ghl_location_api";
    confirmation: string;
  }
): Promise<OnboardingActionResult<OnboardingActivationIntent>> {
  return request(
    "POST",
    clientPath(clientAccountId, "/activation-intent"),
    {
      requestId: input.requestId,
      destination: input.destination,
      confirmation: input.confirmation,
      expectedReceiptIds: [],
    },
    projectIntent
  );
}

function projectSummary(data: unknown): OnboardingSummary | null {
  const record = asRecord(data);
  if (!record || record.ok !== true || record.contractVersion !== "client_onboarding_v2") return null;
  const client = asRecord(record.client);
  const sheets = asRecord(record.sheets);
  const ghl = asRecord(record.ghl);
  const setup = asRecord(record.setupRequest);
  const zapier = asRecord(record.externalZapier);
  if (!client || !sheets || !ghl || !setup || !zapier) return null;
  if (typeof client.clientAccountId !== "string" || typeof client.clientDisplayName !== "string") return null;
  return record as unknown as OnboardingSummary;
}

function projectDriveSearch(data: unknown): OnboardingDriveSearch | null {
  const record = asRecord(data);
  if (!record || record.ok !== true || record.saved !== false) return null;
  const company = asRecord(record.companyFolder);
  return {
    saved: false,
    items: driveItems(record.items),
    suggestions: driveItems(record.suggestions),
    nameMatch: record.nameMatch === "unique" || record.nameMatch === "ambiguous" ? record.nameMatch : "none",
    selectedFolderId: null,
    companyFolder:
      company && typeof company.folderId === "string" && company.folderId
        ? { folderId: company.folderId, title: typeof company.title === "string" ? company.title : null }
        : null,
    nextPageToken: typeof record.nextPageToken === "string" ? record.nextPageToken : null,
  };
}

function projectFolderResolve(data: unknown): OnboardingFolderResolve | null {
  const record = asRecord(data);
  const folder = asRecord(record?.folder);
  if (!record || record.ok !== true || record.saved !== false || !folder) return null;
  if (typeof folder.folderId !== "string" || typeof folder.title !== "string") return null;
  const next = asRecord(record.next);
  return {
    saved: false,
    linked: false,
    folder: {
      folderId: folder.folderId,
      title: folder.title,
      driveId: typeof folder.driveId === "string" ? folder.driveId : null,
      basis: typeof folder.basis === "string" ? folder.basis : "",
    },
    next:
      next?.action === "browse_spreadsheets" &&
      next.method === "POST" &&
      typeof next.path === "string" &&
      next.savesFolder === false &&
      next.savesDestination === false
        ? {
            action: "browse_spreadsheets",
            method: "POST",
            path: next.path,
            savesFolder: false,
            savesDestination: false,
          }
        : undefined,
  };
}

function projectSheetPreview(data: unknown): OnboardingSheetPreview | null {
  const record = asRecord(data);
  if (!record || record.ok !== true || record.saved !== false) return null;
  if (typeof record.spreadsheetId !== "string") return null;
  const worksheets = Array.isArray(record.worksheets) ? record.worksheets : [];
  return {
    saved: false,
    spreadsheetId: record.spreadsheetId,
    spreadsheetTitle: typeof record.spreadsheetTitle === "string" ? record.spreadsheetTitle : "",
    recommendation: projectRecommendation(record.recommendation),
    selection: projectSelection(record.selection),
    worksheets: worksheets.map(projectWorksheet).filter((item) => item !== null),
  };
}

function projectDestinationSave(data: unknown): OnboardingDestinationSave | null {
  const record = asRecord(data);
  if (!record || record.ok !== true || typeof record.revision !== "number") return null;
  if (record.deliverySwitchChanged !== false || record.liveActivationPerformedByOnboarding !== false) return null;
  return {
    revision: record.revision,
    notesEnabled: record.notesEnabled === true,
    notesContractVersion: typeof record.notesContractVersion === "string" ? record.notesContractVersion : null,
    ghlMode: typeof record.ghlMode === "string" ? record.ghlMode : "unset",
    sheetsSelected: record.sheetsSelected === true,
    deliveryEnabled: record.deliveryEnabled === true,
    campaignDispatchEnabled: record.campaignDispatchEnabled === true,
    deliverySwitchChanged: false,
    liveActivationPerformedByOnboarding: false,
  };
}

function projectWorkflow(data: unknown, fallbackError: string | null): OnboardingWorkflowMatch | null {
  const record = asRecord(data);
  if (!record) return null;
  const matches = Array.isArray(record.matches)
    ? record.matches
        .map((item) => {
          const row = asRecord(item);
          if (!row || typeof row.id !== "string" || typeof row.name !== "string") return null;
          return { id: row.id, name: row.name };
        })
        .filter((item) => item !== null)
    : [];
  return {
    workflowMatch: typeof record.workflowMatch === "string" ? record.workflowMatch : "workflow_not_found",
    workflowId: typeof record.workflowId === "string" ? record.workflowId : null,
    workflowName: typeof record.workflowName === "string" ? record.workflowName : null,
    matches,
    discoveryWired: record.discoveryWired === true,
    createdWorkflow: false,
    createdCustomField: false,
    error: typeof record.error === "string" ? record.error : fallbackError,
  };
}

function projectWorkflowSave(data: unknown): OnboardingWorkflowSave | null {
  const record = asRecord(data);
  if (!record || record.ok !== true) return null;
  const destination = asRecord(record.destination);
  return {
    persisted: record.persisted === true,
    workflowId: typeof record.workflowId === "string" ? record.workflowId : null,
    workflowName: typeof record.workflowName === "string" ? record.workflowName : null,
    deliveryEnabled: typeof destination?.deliveryEnabled === "boolean" ? destination.deliveryEnabled : null,
    clientCutoverApproved:
      typeof destination?.clientCutoverApproved === "boolean" ? destination.clientCutoverApproved : null,
    workflowTriggerMode:
      typeof destination?.workflowTriggerMode === "string" ? destination.workflowTriggerMode : null,
    revision: typeof record.revision === "number" ? record.revision : null,
    createdWorkflow: false,
    createdCustomField: false,
  };
}

function projectNote(data: unknown): OnboardingNotePreview | null {
  const record = asRecord(data);
  const note = asRecord(record?.note);
  const calls = asRecord(record?.externalCalls);
  if (!record || record.ok !== true || record.posted !== false || !note) return null;
  if (calls?.ghl !== false || calls?.sheets !== false || calls?.providerWebhook !== false) return null;
  const evidence = asRecord(record.qaEvidence);
  return {
    posted: false,
    contractVersion: typeof note.contractVersion === "string" ? note.contractVersion : null,
    title: typeof note.title === "string" ? note.title : null,
    body: typeof note.body === "string" ? note.body : typeof note.preview === "string" ? note.preview : null,
    status: typeof note.status === "string" ? note.status : null,
    keptAnswerCount: typeof note.keptAnswerCount === "number" ? note.keptAnswerCount : null,
    qaEvidence: evidence
      ? {
          status: typeof evidence.status === "string" ? evidence.status : "not_recoverable",
          fullQaCompletenessAsserted: evidence.fullQaCompletenessAsserted === true,
          discardedDuplicateCount:
            typeof evidence.discardedDuplicateCount === "number" ? evidence.discardedDuplicateCount : 0,
        }
      : null,
    externalCalls: { ghl: false, providerWebhook: false, sheets: false },
  };
}

function projectTestRun(data: unknown): OnboardingTestRun | null {
  const record = asRecord(data);
  if (!record || record.ok !== true) return null;
  if (record.sourceDeliverySatisfied !== false || record.downstreamExecuted !== false) return null;
  if (record.resendAuthorized !== false) return null;
  const preview = asRecord(record.preview);
  const calls = asRecord(record.externalCalls);
  return {
    testRunId: typeof record.testRunId === "string" ? record.testRunId : null,
    status: typeof record.status === "string" ? record.status : null,
    kind: typeof record.kind === "string" ? record.kind : null,
    persisted: record.persisted === true,
    warningCodes: stringList(record.warningCodes),
    attempts: projectAttempts(record.attempts),
    sheet: projectPreviewSheet(preview?.sheet),
    noteBodySha256: typeof preview?.noteBodySha256 === "string" ? preview.noteBodySha256 : null,
    noteContract: typeof preview?.noteContract === "string" ? preview.noteContract : null,
    externalCalls: {
      providerWebhook: calls?.providerWebhook === true,
      sheets: calls?.sheets === true,
      ghl: calls?.ghl === true,
    },
    effects: projectCapturedEffects(record.effects),
    sourceDeliverySatisfied: false,
    downstreamExecuted: false,
    resendAuthorized: false,
    appendStartedAtCleared: false,
    locksCleared: false,
  };
}

function projectCapturedEffects(value: unknown): OnboardingTestRun["effects"] {
  const effects = asRecord(value);
  if (!effects) return null;
  return {
    inventoryAffected: effects.inventoryAffected === true,
    billingAffected: effects.billingAffected === true,
    deliveryEnabled: effects.deliveryEnabled === true,
    cutoffChanged: effects.cutoffChanged === true,
    duplicate: effects.duplicate === true,
  };
}

function projectIntent(data: unknown): OnboardingActivationIntent | null {
  const record = asRecord(data);
  if (!record || record.ok !== true || record.activatesDelivery !== false) return null;
  if (record.liveActivationPerformedByOnboarding !== false) return null;
  if (typeof record.id !== "string" || typeof record.status !== "string") return null;
  return {
    id: record.id,
    status: record.status,
    activatesDelivery: false,
    liveActivationPerformedByOnboarding: false,
  };
}

function projectRecommendation(value: unknown): OnboardingSheetPreview["recommendation"] {
  const record = asRecord(value);
  if (!record || record.classification !== "v3_exact_header" || record.fastPath !== true) return null;
  if (typeof record.worksheetId !== "number" || typeof record.title !== "string") return null;
  if (record.selected !== false || record.bound !== false || record.requiresExplicitSelection !== true) return null;
  return {
    worksheetId: record.worksheetId,
    title: record.title,
    classification: "v3_exact_header",
    fastPath: true,
    selected: false,
    bound: false,
    existingBinding: record.existingBinding === true,
    requiresExplicitSelection: true,
  };
}

function projectSelection(value: unknown): OnboardingSheetPreview["selection"] {
  const record = asRecord(value);
  if (!record) return null;
  if (record.applied !== false || record.bound !== false) return null;
  return {
    worksheetTitle: typeof record.worksheetTitle === "string" ? record.worksheetTitle : null,
    worksheetId: typeof record.worksheetId === "number" ? record.worksheetId : null,
    applied: false,
    bound: false,
  };
}

function projectWorksheet(value: unknown): OnboardingSheetPreview["worksheets"][number] | null {
  const record = asRecord(value);
  if (!record || typeof record.worksheetId !== "number" || typeof record.title !== "string") return null;
  return {
    worksheetId: record.worksheetId,
    title: record.title,
    grid: record.grid === true,
    header: stringList(record.header),
    headerColumnCount: typeof record.headerColumnCount === "number" ? record.headerColumnCount : stringList(record.header).length,
    historicalDataRows:
      record.historicalDataRows === "has_rows" || record.historicalDataRows === "truncated"
        ? record.historicalDataRows
        : "empty",
    historicalDataRowCount:
      typeof record.historicalDataRowCount === "number" ? record.historicalDataRowCount : undefined,
    classification: typeof record.classification === "string" ? record.classification : "incompatible",
    fastPath: record.fastPath === true,
    deliveryEligible: record.deliveryEligible === true,
    requiresExplicitSelection: record.requiresExplicitSelection === true,
    headerDrift: record.headerDrift === true,
    reasons: stringList(record.reasons),
  };
}

function projectPreviewSheet(value: unknown): OnboardingTestPreviewSheet | null {
  const record = asRecord(value);
  if (!record) return null;
  return {
    worksheetTitle: typeof record.worksheetTitle === "string" ? record.worksheetTitle : null,
    worksheetRole: typeof record.worksheetRole === "string" ? record.worksheetRole : null,
    schemaVersion: typeof record.schemaVersion === "string" ? record.schemaVersion : null,
    header: Array.isArray(record.header) ? stringList(record.header) : null,
    values: Array.isArray(record.values) ? stringList(record.values) : null,
    valuesSha256: typeof record.valuesSha256 === "string" ? record.valuesSha256 : null,
    deliveryRowId: typeof record.deliveryRowId === "string" ? record.deliveryRowId : null,
    sourceLeadEventId: typeof record.sourceLeadEventId === "string" ? record.sourceLeadEventId : null,
  };
}

function projectAttempts(value: unknown): OnboardingTestRun["attempts"] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const record = asRecord(item);
      if (!record || typeof record.destination !== "string") return null;
      return {
        id: typeof record.id === "string" ? record.id : record.destination,
        destination: record.destination,
        status: typeof record.status === "string" ? record.status : "unknown",
        proves: stringList(record.proves),
        doesNotProve: stringList(record.doesNotProve),
        externalCallExecuted: record.externalCallExecuted === true,
        downstreamExecuted: false as const,
        detail: typeof record.detail === "string" ? record.detail : null,
      };
    })
    .filter((item) => item !== null);
}

function driveKind(value: unknown): OnboardingDriveItem["kind"] {
  if (value === "folder" || value === "spreadsheet" || value === "shortcut") return value;
  return "shortcut";
}

function driveItems(value: unknown): OnboardingDriveItem[] {
  if (!Array.isArray(value)) return [];
  const items: OnboardingDriveItem[] = [];
  for (const item of value) {
    const record = asRecord(item);
    if (!record || typeof record.id !== "string" || typeof record.title !== "string") continue;
    const kind = driveKind(record.kind);
    items.push({
      id: record.id,
      title: record.title,
      kind,
      trashed: record.trashed === true,
      shortcut: record.shortcut === true || kind === "shortcut",
      selectable: record.selectable === true,
      reason: typeof record.reason === "string" ? record.reason : null,
      location: typeof record.location === "string" ? record.location : null,
    });
  }
  return items;
}

export function saveOnboardingSheetsTarget(
  clientAccountId: string,
  input: { requestId: string; spreadsheetId: string; worksheetId: number }
): Promise<OnboardingActionResult<SheetsTargetSave>> {
  return request("PUT", clientPath(clientAccountId, "/sheets-target"), input, projectSheetsTarget);
}

export function createOnboardingColumnMap(
  clientAccountId: string,
  input: {
    requestId: string;
    spreadsheetId: string;
    worksheetId: number;
    sourceScope: "shared";
    baseSchemaVersion: "legacy_custom";
  }
): Promise<OnboardingActionResult<ColumnMapRecord>> {
  return request("POST", clientPath(clientAccountId, "/column-maps"), input, projectColumnMap);
}

export function updateOnboardingColumnMap(
  clientAccountId: string,
  mapId: string,
  input: { requestId: string; expectedRevision: number; assignments: unknown[] }
): Promise<OnboardingActionResult<ColumnMapRecord>> {
  return request("PATCH", clientPath(clientAccountId, `/column-maps/${encodeURIComponent(mapId)}`), input, projectColumnMap);
}

export function listOnboardingColumnMaps(clientAccountId: string): Promise<OnboardingActionResult<ColumnMapRecord[]>> {
  return request("GET", clientPath(clientAccountId, "/column-maps"), undefined, (value) => {
    const record = asRecord(value);
    if (!record || record.ok !== true || !Array.isArray(record.maps)) return null;
    return record.maps.flatMap((item) => {
      const projected = projectColumnMap({ map: item });
      return projected ? [projected] : [];
    });
  });
}

export function saveAndPublishOnboardingColumnMap(
  clientAccountId: string,
  mapId: string,
  input: { requestId: string; expectedRevision: number; assignments: unknown[] }
): Promise<ColumnMapSavePublishResult> {
  return requestColumnMapWrite(
    "POST",
    clientPath(clientAccountId, `/column-maps/${encodeURIComponent(mapId)}/save-and-publish`),
    input
  );
}

export function previewOnboardingColumnMap(
  clientAccountId: string,
  mapId: string,
  input: { expectedRevision: number; assignments: unknown[]; previewToken: string }
): Promise<OnboardingActionResult<ColumnMapDraftPreview>> {
  return request("POST", clientPath(clientAccountId, `/column-maps/${encodeURIComponent(mapId)}/preview`), input, projectColumnMapPreview);
}

async function requestColumnMapWrite(
  method: "POST",
  path: string,
  body: unknown
): Promise<ColumnMapSavePublishResult> {
  const res = await adminRequestJson<unknown>(method, path, body);
  if (!res.ok) {
    const failure = readOnboardingFailure(res.status, res.body);
    const map = projectColumnMap(readJson(res.body));
    return { ok: false, ...failure, published: false, deliveryEnabled: false, ...(map ? { map } : {}) };
  }
  const data = projectColumnMap(res.data);
  if (!data) return { ok: false, error: "malformed_response", status: 502, published: false, deliveryEnabled: false };
  const record = asRecord(res.data);
  if (record?.published !== true || record.deliveryEnabled !== false) {
    return { ok: false, error: "malformed_response", status: 502, published: false, deliveryEnabled: false };
  }
  return { ok: true, data, published: true, deliveryEnabled: false };
}

export function publishOnboardingColumnMap(
  clientAccountId: string,
  mapId: string,
  input: { requestId: string; expectedRevision: number }
): Promise<OnboardingActionResult<ColumnMapRecord>> {
  return request("POST", clientPath(clientAccountId, `/column-maps/${encodeURIComponent(mapId)}/publish`), input, projectColumnMap);
}

function projectSheetsTarget(value: unknown): SheetsTargetSave | null {
  const record = asRecord(value);
  if (!record || typeof record.spreadsheetId !== "string" || typeof record.worksheetId !== "number") return null;
  return {
    spreadsheetId: record.spreadsheetId,
    worksheetId: record.worksheetId,
    worksheetTitle: typeof record.worksheetTitle === "string" ? record.worksheetTitle : "",
    headerFingerprint: typeof record.headerFingerprint === "string" ? record.headerFingerprint : "",
    schemaVersion: typeof record.schemaVersion === "string" ? record.schemaVersion : null,
    setupState: typeof record.setupState === "string" ? record.setupState : "",
    campaignDispatchEnabled: false,
    campaignDispatchNotBefore: typeof record.campaignDispatchNotBefore === "string" ? record.campaignDispatchNotBefore : null,
    headerRewritten: false,
    readinessEvidenceInvalidated: record.readinessEvidenceInvalidated === true,
  };
}

function projectColumnMap(value: unknown): ColumnMapRecord | null {
  const root = asRecord(value);
  const record = asRecord(root?.map);
  if (!record || typeof record.id !== "string" || typeof record.spreadsheetId !== "string") return null;
  if (typeof record.worksheetId !== "number" || typeof record.revision !== "number") return null;
  const assignments = Array.isArray(record.assignments) ? record.assignments.flatMap((item) => {
    const column = asRecord(item);
    if (!column || typeof column.sheetHeader !== "string" || typeof column.columnIndex !== "number") return [];
    const decision = column.decision;
    const transform = column.transform;
    if (decision !== "mapped" && decision !== "unmapped" && decision !== "ambiguous") return [];
    if (transform !== "passthrough" && transform !== "trim" && transform !== "date_america_new_york" && transform !== "blank") {
      return [];
    }
    const targetRecord = asRecord(column.target);
    const target =
      targetRecord && typeof targetRecord.header === "string" && typeof targetRecord.sourceField === "string"
        ? { kind: "v3_column" as const, header: targetRecord.header, sourceField: targetRecord.sourceField }
        : null;
    return [
      {
        sheetHeader: column.sheetHeader,
        columnIndex: column.columnIndex,
        formula: column.formula === true,
        target,
        transform: transform as ColumnMapAssignment["transform"],
        decision: decision as ColumnMapAssignment["decision"],
        explicit: column.explicit === true,
        code: typeof column.code === "string" ? column.code : null,
      },
    ];
  }) : [];
  return {
    id: record.id,
    revision: record.revision,
    mapVersion: typeof record.mapVersion === "number" ? record.mapVersion : 1,
    status: typeof record.status === "string" ? record.status : "draft",
    sourceScope: typeof record.sourceScope === "string" ? record.sourceScope : "shared",
    baseSchemaVersion: typeof record.baseSchemaVersion === "string" ? record.baseSchemaVersion : "legacy_custom",
    spreadsheetId: record.spreadsheetId,
    worksheetId: record.worksheetId,
    worksheetTitle: typeof record.worksheetTitle === "string" ? record.worksheetTitle : null,
    headerFingerprint: typeof record.headerFingerprint === "string" ? record.headerFingerprint : "",
    headerSnapshot: stringList(record.headerSnapshot),
    assignments,
    issues: Array.isArray(record.issues)
      ? record.issues.flatMap((item) => {
          const issue = asRecord(item);
          if (!issue || typeof issue.message !== "string" || typeof issue.code !== "string") return [];
          return [{ columnIndex: typeof issue.columnIndex === "number" ? issue.columnIndex : 0, sheetHeader: typeof issue.sheetHeader === "string" ? issue.sheetHeader : "", code: issue.code, message: issue.message }];
        })
      : [],
    preview: Array.isArray(record.preview)
      ? record.preview.flatMap((item) => {
          const cell = asRecord(item);
          if (!cell || typeof cell.sheetHeader !== "string") return [];
          return [{ sheetHeader: cell.sheetHeader, value: typeof cell.value === "string" ? cell.value : "" }];
        })
      : [],
    targets: Array.isArray(record.targets)
      ? record.targets.flatMap((item) => {
          const target = asRecord(item);
          if (!target || typeof target.header !== "string" || typeof target.sourceField !== "string") return [];
          return [{ header: target.header, sourceField: target.sourceField }];
        })
      : [],
    append: {
      behavior: "new_row_only",
      headerRow: "not_rewritten",
      existingRows: "not_rewritten",
      formulaColumns: "omitted_when_header_or_row2_starts_with_equals",
    },
  };
}

function projectColumnMapPreview(value: unknown): ColumnMapDraftPreview | null {
  const root = asRecord(value);
  const preview = asRecord(root?.preview);
  if (!preview || typeof preview.mapId !== "string" || typeof preview.revision !== "number") return null;
  if (preview.deliveryEnabled !== false || preview.sendsRow !== false) return null;
  if (preview.configuration !== "draft" && preview.configuration !== "published_map") return null;
  const cells: ColumnMapDraftPreview["cells"] = Array.isArray(preview.cells)
    ? preview.cells.flatMap((item) => {
        const cell = asRecord(item);
        const reason = previewCellReason(cell?.reason);
        if (!cell || typeof cell.sheetHeader !== "string" || typeof cell.columnIndex !== "number" || reason === undefined) return [];
        return [
          {
            columnIndex: cell.columnIndex,
            sheetHeader: cell.sheetHeader,
            canonicalField: typeof cell.canonicalField === "string" ? cell.canonicalField : null,
            receivedAnswer: typeof cell.receivedAnswer === "string" ? cell.receivedAnswer : "",
            outputValue: typeof cell.outputValue === "string" ? cell.outputValue : "",
            reason,
          },
        ];
      })
    : [];
  const available = preview.available === true;
  const sheet = projectDraftPreviewSheet(preview.sheet, available, cells.length);
  if (available && !sheet) return null;
  return {
    configuration: preview.configuration,
    deliveryEnabled: false,
    sendsRow: false,
    available,
    emptyReason: typeof preview.emptyReason === "string" ? preview.emptyReason : null,
    sourceLeadEventId: typeof preview.sourceLeadEventId === "string" ? preview.sourceLeadEventId : null,
    receivedAt: typeof preview.receivedAt === "string" ? preview.receivedAt : null,
    mapId: preview.mapId,
    revision: preview.revision,
    spreadsheetId: typeof preview.spreadsheetId === "string" ? preview.spreadsheetId : "",
    worksheetId: typeof preview.worksheetId === "number" ? preview.worksheetId : 0,
    headerFingerprint: typeof preview.headerFingerprint === "string" ? preview.headerFingerprint : "",
    schemaVersion: typeof preview.schemaVersion === "string" ? preview.schemaVersion : "",
    boundSchemaVersion: typeof preview.boundSchemaVersion === "string" ? preview.boundSchemaVersion : null,
    previewToken: typeof preview.previewToken === "string" ? preview.previewToken : "",
    cells: sheet ? cells.map((cell, index) => ({ ...cell, outputValue: sheet.values[index] ?? "" })) : cells,
    warnings: stringList(preview.warnings),
    sheet,
  };
}

function projectDraftPreviewSheet(
  value: unknown,
  available: boolean,
  cellCount: number
): ColumnMapDraftPreview["sheet"] | null {
  if (!available) return null;
  const sheet = asRecord(value);
  const dobAge = projectDobAge(sheet?.dobAge);
  const header = stringList(sheet?.header);
  const values = stringList(sheet?.values);
  if (!sheet || !dobAge || header.length !== values.length || values.length !== cellCount) return null;
  return { header, values, dobAge };
}

const PREVIEW_CELL_REASONS = ["missing", "invalid", "unmapped", "blank_header", "formula_omitted", "ambiguous"] as const;

function previewCellReason(value: unknown): ColumnMapDraftPreview["cells"][number]["reason"] | undefined {
  if (value === null) return null;
  if (typeof value === "string" && (PREVIEW_CELL_REASONS as readonly string[]).includes(value)) {
    return value as ColumnMapDraftPreview["cells"][number]["reason"];
  }
  return undefined;
}

function projectDobAge(value: unknown): ColumnMapDobAge | null {
  const record = asRecord(value);
  if (!record || typeof record.conflict !== "boolean") return null;
  if (record.referenceRule !== "submitted_at_utc_date_else_received_at_utc_date") return null;
  const ageProvenance = record.ageProvenance;
  if (ageProvenance !== "supplied" && ageProvenance !== "derived_from_date_of_birth" && ageProvenance !== "missing") return null;
  const dateOfBirthProvenance = record.dateOfBirthProvenance;
  if (dateOfBirthProvenance !== "supplied" && dateOfBirthProvenance !== "missing") return null;
  const text = (key: string) => (typeof record[key] === "string" ? record[key] : null);
  const age = text("age");
  const dateOfBirth = text("dateOfBirth");
  const dateOfBirthSheet = text("dateOfBirthSheet");
  const derivedAge = text("derivedAge");
  const referenceDate = text("referenceDate");
  if (age == null || dateOfBirth == null || dateOfBirthSheet == null || derivedAge == null || referenceDate == null) return null;
  return {
    age,
    dateOfBirth,
    dateOfBirthSheet,
    ageProvenance,
    dateOfBirthProvenance,
    derivedAge,
    referenceDate,
    referenceRule: "submitted_at_utc_date_else_received_at_utc_date",
    conflict: record.conflict,
    ageUnavailableReason:
      record.ageUnavailableReason === "no_valid_reference" || record.ageUnavailableReason === "future_date_of_birth"
        ? record.ageUnavailableReason
        : null,
  };
}

function readJson(body: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return null;
  }
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}
