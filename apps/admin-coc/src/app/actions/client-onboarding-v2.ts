"use server";

import { revalidatePath } from "next/cache";

import { requireAdminCocAdminSession } from "@/lib/admin-coc-session-guard";
import {
  bindCompanySheetsTab,
  fetchCompanySheetsDispatch,
  probeCompanySheetWrite,
  saveCompanySheetsDestination,
} from "@/lib/admin-api/company-google-sheets";
import {
  approveOnboardingTestWorksheet,
  browseResolvedOnboardingFolder,
  listOnboardingTestRuns,
  readOnboardingFailure,
} from "@/lib/admin-api/client-onboarding-v2";
import {
  listOnboardingSpreadsheets,
  loadOnboardingWorkflows,
  previewOnboardingNote,
  previewOnboardingSpreadsheet,
  previewOnboardingStoredLead,
  recordOnboardingActivationIntent,
  resolveOnboardingFolder,
  saveOnboardingDestination,
  saveOnboardingTestIdentity,
  saveOnboardingWorkflow,
  searchOnboardingDrive,
} from "@/lib/admin-api/client-onboarding-v2";
import type {
  OnboardingActionResult,
  OnboardingActivationIntent,
  OnboardingDestinationSave,
  OnboardingDriveSearch,
  OnboardingFolderResolve,
  OnboardingGhlMode,
  OnboardingCampaignBind,
  OnboardingNotePreview,
  OnboardingSheetPreview,
  OnboardingSheetsDestinationWrite,
  OnboardingSpreadsheetListItem,
  OnboardingTestIdentity,
  OnboardingTestRun,
  StoredTestRunView,
  OnboardingWorkflowMatch,
  OnboardingWorkflowSave,
} from "@/lib/clients/onboarding/types";
import {
  ACTIVATION_INTENT_CONFIRMATION,
  CLIENT_ONBOARDING_PATH_ID,
  validDriveQuery,
} from "@/lib/clients/onboarding/view";

function rejectClient(clientAccountId: string): OnboardingActionResult<never> | null {
  if (!CLIENT_ONBOARDING_PATH_ID.test(clientAccountId)) {
    return { ok: false, error: "client_not_found", status: 404 };
  }
  return null;
}

async function refuseActiveSheetsChange(
  clientAccountId: string
): Promise<OnboardingActionResult<never> | null> {
  const dispatch = await fetchCompanySheetsDispatch(clientAccountId);
  if (!dispatch.ok) return { ok: false, error: "dispatch_unknown", status: dispatch.status || 409 };
  const campaign = dispatch.data.campaignDispatchEnabled;
  const aged = dispatch.data.agedDispatchEnabled;
  if (typeof campaign !== "boolean" || typeof aged !== "boolean") {
    return { ok: false, error: "dispatch_unknown", status: 502 };
  }
  if (campaign || aged) return { ok: false, error: "active_destination_unchanged", status: 409 };
  return null;
}

function refresh(clientAccountId: string) {
  revalidatePath(`/clients/${clientAccountId}/onboarding`);
}

export async function searchOnboardingDriveAction(
  clientAccountId: string,
  input: { scope: "approved_parent" | "client_folder"; query: string }
): Promise<OnboardingActionResult<OnboardingDriveSearch>> {
  await requireAdminCocAdminSession();
  const rejected = rejectClient(clientAccountId);
  if (rejected) return rejected;
  if (input.scope !== "approved_parent" && input.scope !== "client_folder") {
    return { ok: false, error: "invalid_request", status: 400 };
  }
  if (!validDriveQuery(input.query)) return { ok: false, error: "invalid_request", status: 400 };
  return searchOnboardingDrive(clientAccountId, { scope: input.scope, query: input.query.trim() });
}

export async function resolveOnboardingFolderAction(
  clientAccountId: string,
  folder: string
): Promise<OnboardingActionResult<OnboardingFolderResolve>> {
  await requireAdminCocAdminSession();
  const rejected = rejectClient(clientAccountId);
  if (rejected) return rejected;
  const value = folder.trim();
  if (!value || value.length > 500) return { ok: false, error: "invalid_request", status: 400 };
  return resolveOnboardingFolder(clientAccountId, value);
}

export async function listOnboardingSpreadsheetsAction(
  clientAccountId: string
): Promise<OnboardingActionResult<OnboardingSpreadsheetListItem[]>> {
  await requireAdminCocAdminSession();
  const rejected = rejectClient(clientAccountId);
  if (rejected) return rejected;
  return listOnboardingSpreadsheets(clientAccountId);
}

export async function previewOnboardingSpreadsheetAction(
  clientAccountId: string,
  spreadsheetId: string
): Promise<OnboardingActionResult<OnboardingSheetPreview>> {
  await requireAdminCocAdminSession();
  const rejected = rejectClient(clientAccountId);
  if (rejected) return rejected;
  const id = spreadsheetId.trim();
  if (!id || id.length > 500) return { ok: false, error: "invalid_spreadsheet_ref", status: 400 };
  return previewOnboardingSpreadsheet(clientAccountId, id);
}

export async function browseResolvedOnboardingFolderAction(
  clientAccountId: string,
  folderId: string
): Promise<OnboardingActionResult<OnboardingSpreadsheetListItem[]>> {
  await requireAdminCocAdminSession();
  const rejected = rejectClient(clientAccountId);
  if (rejected) return rejected;
  const id = folderId.trim();
  if (!id) return { ok: false, error: "invalid_folder", status: 400 };
  return browseResolvedOnboardingFolder(clientAccountId, id);
}

export async function approveOnboardingTestWorksheetAction(
  clientAccountId: string,
  input: { spreadsheetId: string; worksheetId: number }
): Promise<OnboardingActionResult<{ worksheetId: number }>> {
  await requireAdminCocAdminSession();
  const rejected = rejectClient(clientAccountId);
  if (rejected) return rejected;
  const spreadsheetId = input.spreadsheetId.trim();
  if (!spreadsheetId || !Number.isInteger(input.worksheetId) || input.worksheetId < 0) {
    return { ok: false, error: "invalid_body", status: 400 };
  }
  return approveOnboardingTestWorksheet(clientAccountId, {
    requestId: crypto.randomUUID(),
    spreadsheetId,
    worksheetId: input.worksheetId,
  });
}

export async function probeOnboardingSheetWriteAction(
  clientAccountId: string,
  input: { spreadsheetId: string; worksheetId: number }
): Promise<OnboardingActionResult<{ canEdit: boolean | null }>> {
  await requireAdminCocAdminSession();
  const rejected = rejectClient(clientAccountId);
  if (rejected) return rejected;
  const spreadsheetId = input.spreadsheetId.trim();
  if (!spreadsheetId || !Number.isInteger(input.worksheetId) || input.worksheetId < 0) {
    return { ok: false, error: "invalid_body", status: 400 };
  }
  const probed = await probeCompanySheetWrite(clientAccountId, { spreadsheetId, worksheetId: input.worksheetId });
  if (!probed.ok) return { ok: false, ...readOnboardingFailure(probed.status, probed.body) };
  if (probed.data.permissionProbe !== true || probed.data.rowWritten !== false || probed.data.campaignDeliveryVerified !== false) {
    return { ok: false, error: "malformed_response", status: 502 };
  }
  return { ok: true, data: { canEdit: probed.data.canEdit } };
}

export async function listOnboardingTestRunsAction(
  clientAccountId: string
): Promise<OnboardingActionResult<StoredTestRunView[]>> {
  await requireAdminCocAdminSession();
  const rejected = rejectClient(clientAccountId);
  if (rejected) return rejected;
  return listOnboardingTestRuns(clientAccountId);
}

export async function saveOnboardingSheetsDestinationAction(
  clientAccountId: string,
  input: { spreadsheetId: string; worksheetId: number }
): Promise<OnboardingActionResult<OnboardingSheetsDestinationWrite>> {
  await requireAdminCocAdminSession();
  const rejected = rejectClient(clientAccountId);
  if (rejected) return rejected;
  const spreadsheetId = input.spreadsheetId.trim();
  if (!spreadsheetId || !Number.isInteger(input.worksheetId) || input.worksheetId < 0) {
    return { ok: false, error: "invalid_body", status: 400 };
  }
  const blocked = await refuseActiveSheetsChange(clientAccountId);
  if (blocked) return blocked;
  const saved = await saveCompanySheetsDestination(clientAccountId, {
    spreadsheetId,
    worksheetId: input.worksheetId,
  });
  if (!saved.ok) return { ok: false, ...readOnboardingFailure(saved.status, saved.body) };
  const destination = saved.data.destination;
  if (!destination?.spreadsheetId || typeof destination.worksheetId !== "number") {
    return { ok: false, error: "malformed_response", status: 502 };
  }
  refresh(clientAccountId);
  return {
    ok: true,
    data: {
      saved: true,
      bound: false,
      spreadsheetId: destination.spreadsheetId,
      worksheetId: destination.worksheetId,
      worksheetTitle: destination.worksheetTitle,
    },
  };
}

export async function bindOnboardingCampaignWorksheetAction(
  clientAccountId: string,
  input: { worksheetId: number }
): Promise<OnboardingActionResult<OnboardingCampaignBind>> {
  await requireAdminCocAdminSession();
  const rejected = rejectClient(clientAccountId);
  if (rejected) return rejected;
  if (!Number.isInteger(input.worksheetId) || input.worksheetId < 0) {
    return { ok: false, error: "invalid_body", status: 400 };
  }
  const blocked = await refuseActiveSheetsChange(clientAccountId);
  if (blocked) return blocked;
  const bound = await bindCompanySheetsTab(clientAccountId, {
    role: "campaign",
    worksheetId: input.worksheetId,
  });
  if (!bound.ok) return { ok: false, ...readOnboardingFailure(bound.status, bound.body) };
  if (typeof bound.data.destinationRevision !== "number") {
    return { ok: false, error: "malformed_response", status: 502 };
  }
  refresh(clientAccountId);
  return {
    ok: true,
    data: {
      saved: true,
      bound: true,
      worksheetId: input.worksheetId,
      destinationRevision: bound.data.destinationRevision,
    },
  };
}

export async function saveOnboardingDestinationAction(
  clientAccountId: string,
  input: {
    expectedRevision: number;
    sheetsSelected: boolean;
    ghlMode: OnboardingGhlMode;
    notesEnabled: boolean;
  }
): Promise<OnboardingActionResult<OnboardingDestinationSave>> {
  await requireAdminCocAdminSession();
  const rejected = rejectClient(clientAccountId);
  if (rejected) return rejected;
  const modes: OnboardingGhlMode[] = ["unset", "location_api", "inbound_webhook", "external_zapier"];
  if (!modes.includes(input.ghlMode)) return { ok: false, error: "invalid_body", status: 400 };
  if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 0) {
    return { ok: false, error: "profile_revision_unavailable", status: 409 };
  }
  const saved = await saveOnboardingDestination(clientAccountId, {
    requestId: crypto.randomUUID(),
    expectedRevision: input.expectedRevision,
    sheetsSelected: input.sheetsSelected,
    ghlMode: input.ghlMode,
    notesEnabled: input.ghlMode === "location_api" && input.notesEnabled,
  });
  if (saved.ok) refresh(clientAccountId);
  return saved;
}

export async function loadOnboardingWorkflowsAction(
  clientAccountId: string
): Promise<OnboardingActionResult<OnboardingWorkflowMatch>> {
  await requireAdminCocAdminSession();
  const rejected = rejectClient(clientAccountId);
  if (rejected) return rejected;
  return loadOnboardingWorkflows(clientAccountId);
}

export async function saveOnboardingWorkflowAction(
  clientAccountId: string,
  input: { expectedRevision: number; discoveredWorkflowId: string; discoveredName: string }
): Promise<OnboardingActionResult<OnboardingWorkflowSave>> {
  await requireAdminCocAdminSession();
  const rejected = rejectClient(clientAccountId);
  if (rejected) return rejected;
  if (!input.discoveredWorkflowId.trim() || !input.discoveredName.trim()) {
    return { ok: false, error: "invalid_body", status: 400 };
  }
  if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 0) {
    return { ok: false, error: "profile_revision_unavailable", status: 409 };
  }
  const saved = await saveOnboardingWorkflow(clientAccountId, {
    requestId: crypto.randomUUID(),
    expectedRevision: input.expectedRevision,
    discoveredWorkflowId: input.discoveredWorkflowId.trim(),
    discoveredName: input.discoveredName.trim(),
  });
  if (saved.ok) refresh(clientAccountId);
  return saved;
}

export async function previewOnboardingNoteAction(
  clientAccountId: string,
  sourceLeadEventId: string
): Promise<OnboardingActionResult<OnboardingNotePreview>> {
  await requireAdminCocAdminSession();
  const rejected = rejectClient(clientAccountId);
  if (rejected) return rejected;
  if (!sourceLeadEventId.trim()) return { ok: false, error: "invalid_body", status: 400 };
  return previewOnboardingNote(clientAccountId, sourceLeadEventId.trim());
}

export async function saveOnboardingTestIdentityAction(
  clientAccountId: string,
  input: { email: string; phoneE164: string }
): Promise<OnboardingActionResult<OnboardingTestIdentity>> {
  await requireAdminCocAdminSession();
  const rejected = rejectClient(clientAccountId);
  if (rejected) return rejected;
  const email = input.email.trim();
  const phoneE164 = input.phoneE164.trim();
  if (!email && !phoneE164) return { ok: false, error: "invalid_confirmation", status: 400 };
  const saved = await saveOnboardingTestIdentity(clientAccountId, {
    requestId: crypto.randomUUID(),
    email: email || null,
    phoneE164: phoneE164 || null,
  });
  if (saved.ok) refresh(clientAccountId);
  return saved;
}

export async function previewOnboardingStoredLeadAction(
  clientAccountId: string,
  input: { sourceLeadEventId: string; destinations: Array<"google_sheets" | "ghl_location_api"> }
): Promise<OnboardingActionResult<OnboardingTestRun>> {
  await requireAdminCocAdminSession();
  const rejected = rejectClient(clientAccountId);
  if (rejected) return rejected;
  const destinations = input.destinations.filter(
    (item) => item === "google_sheets" || item === "ghl_location_api"
  );
  if (!input.sourceLeadEventId.trim() || destinations.length === 0) {
    return { ok: false, error: "invalid_confirmation", status: 400 };
  }
  return previewOnboardingStoredLead(clientAccountId, {
    requestId: crypto.randomUUID(),
    sourceLeadEventId: input.sourceLeadEventId.trim(),
    destinations,
  });
}

export async function recordOnboardingActivationIntentAction(
  clientAccountId: string,
  input: { destination: "google_sheets_campaign" | "ghl_location_api"; confirmation: string }
): Promise<OnboardingActionResult<OnboardingActivationIntent>> {
  await requireAdminCocAdminSession();
  const rejected = rejectClient(clientAccountId);
  if (rejected) return rejected;
  if (input.confirmation !== ACTIVATION_INTENT_CONFIRMATION) {
    return { ok: false, error: "invalid_confirmation", status: 400 };
  }
  if (input.destination !== "google_sheets_campaign" && input.destination !== "ghl_location_api") {
    return { ok: false, error: "invalid_body", status: 400 };
  }
  const saved = await recordOnboardingActivationIntent(clientAccountId, {
    requestId: crypto.randomUUID(),
    destination: input.destination,
    confirmation: input.confirmation,
  });
  if (saved.ok) refresh(clientAccountId);
  return saved;
}
