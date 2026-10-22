"use server";

import { revalidatePath } from "next/cache";

import { requireAdminCocAdminSession } from "@/lib/admin-coc-session-guard";
import {
  clearCompanyGoogleFolder,
  createCompanySpreadsheet,
  bindCompanySheetsTab,
  resolveCompanyClientFolder,
  createCompanySheetsTab,
  deleteCompanySheetsDestination,
  disconnectCompanyGoogle,
  inspectCompanySheetsTabs,
  resolveCompanySpreadsheet,
  saveCompanyGoogleFolder,
  saveCompanySheetsDestination,
  startCompanyGoogleOAuth,
  testCompanySpreadsheetAccess,
  type CompanySheetsCreatedSpreadsheet,
  type CompanySheetsDestinationView,
  type CompanySheetsResolvedSpreadsheet,
} from "@/lib/admin-api/company-google-sheets";

export type CompanySheetsActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

const OPERATOR_ERRORS: Record<string, string> = {
  oauth_disabled:
    "Company Google connection is off. Set SA360_COMPANY_GOOGLE_OAUTH_ENABLED before connecting.",
  destination_disabled:
    "Spreadsheet setup is off. Set SA360_COMPANY_GOOGLE_SHEETS_ENABLED before changing a destination.",
  oauth_not_configured: "Company Google OAuth client settings are missing.",
  google_not_connected: "Connect the Life Agent Launch Google account first.",
  google_reconnect_required: "The company Google connection needs to be reconnected.",
  not_company_controlled: "That spreadsheet is readable but not controlled by the company Google account.",
  shared_drive_unsupported: "That shared drive is not the approved company drive.",
  approved_drive_unconfigured: "Shared-drive storage is not configured. This is not a missing file.",
  approved_parent_unconfigured: "No approved parent folder is configured. Files are not created in Drive root.",
  unapproved_shared_drive: "That file is in a different shared drive from the approved company drive.",
  outside_approved_parent: "That file is not inside the approved company parent folder.",
  insufficient_capability: "The company account can see that file but cannot perform this operation.",
  ancestry_unavailable: "The folder path could not be verified. The file itself was not reported missing.",
  ancestry_cycle: "The folder path loops, so it cannot prove the file is under the approved parent.",
  ancestry_limit: "The folder path is too deep to verify against the approved parent.",
  trashed_file: "That file is in the trash, so it is not an approved destination.",
  shortcut_bypass: "Shortcuts cannot be used to satisfy the approved parent folder.",
  not_approved_parent: "The company folder must be the configured approved parent, not a client subfolder.",
  folder_unavailable: "That folder was not found or is not visible to the company account.",
  ambiguous_client_folder: "More than one client folder has that name under the approved parent. The name is not unique.",
  ambiguous_spreadsheet: "More than one spreadsheet has that name in the approved folder. Nothing else was created.",
  child_lookup_unsupported: "The current Google scopes cannot look up an existing client folder. Nothing was created.",
  create_placement_failed: "Google refused to create the file in the approved folder. Nothing was created in Drive root.",
  drive_file_scope_required: "The company Google account is missing the Drive file scope required to create files.",
  ownership_unverified: "Company ownership could not be verified for that spreadsheet.",
  drive_scope_required: "The company Google account is missing Drive metadata access.",
  spreadsheet_bound_to_other_client: "That spreadsheet is already bound to another client.",
  create_outcome_unknown: "Google did not confirm the new spreadsheet. It was not saved and was not retried.",
};

function fail(body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: string };
    if (typeof parsed.error === "string" && parsed.error.trim()) {
      return OPERATOR_ERRORS[parsed.error] ?? parsed.error;
    }
  } catch {
    // Fall through to the raw body.
  }
  return body.slice(0, 300) || "Request failed";
}

function refresh(clientAccountId: string) {
  revalidatePath(`/clients/${clientAccountId}/google-sheets`);
  revalidatePath(`/clients/${clientAccountId}`);
}

export async function startCompanyGoogleOAuthAction(
  clientAccountId: string
): Promise<CompanySheetsActionResult<{ authorizeUrl: string }>> {
  await requireAdminCocAdminSession();
  const returnTo = `/clients/${clientAccountId}/google-sheets`;
  const res = await startCompanyGoogleOAuth(returnTo);
  if (!res.ok) return { ok: false, error: fail(res.body) };
  return { ok: true, data: { authorizeUrl: res.data.authorizeUrl } };
}

export async function disconnectCompanyGoogleAction(
  clientAccountId: string
): Promise<CompanySheetsActionResult<{ disconnected: true }>> {
  await requireAdminCocAdminSession();
  const res = await disconnectCompanyGoogle();
  if (!res.ok) return { ok: false, error: fail(res.body) };
  refresh(clientAccountId);
  return { ok: true, data: { disconnected: true } };
}

export async function saveCompanyGoogleFolderAction(
  clientAccountId: string,
  folder: string
): Promise<CompanySheetsActionResult<{ saved: true }>> {
  await requireAdminCocAdminSession();
  const res = await saveCompanyGoogleFolder(folder);
  if (!res.ok) return { ok: false, error: fail(res.body) };
  refresh(clientAccountId);
  return { ok: true, data: { saved: true } };
}

export async function clearCompanyGoogleFolderAction(
  clientAccountId: string
): Promise<CompanySheetsActionResult<{ cleared: true }>> {
  await requireAdminCocAdminSession();
  const res = await clearCompanyGoogleFolder();
  if (!res.ok) return { ok: false, error: fail(res.body) };
  refresh(clientAccountId);
  return { ok: true, data: { cleared: true } };
}

export async function resolveCompanySpreadsheetAction(
  clientAccountId: string,
  spreadsheet: string
): Promise<CompanySheetsActionResult<CompanySheetsResolvedSpreadsheet>> {
  await requireAdminCocAdminSession();
  const res = await resolveCompanySpreadsheet(clientAccountId, spreadsheet);
  if (!res.ok) return { ok: false, error: fail(res.body) };
  return { ok: true, data: res.data.spreadsheet };
}

export async function createCompanySpreadsheetAction(
  clientAccountId: string,
  folderId?: string
): Promise<CompanySheetsActionResult<CompanySheetsCreatedSpreadsheet>> {
  await requireAdminCocAdminSession();
  const res = await createCompanySpreadsheet(clientAccountId, undefined, folderId);
  if (!res.ok) return { ok: false, error: fail(res.body) };
  refresh(clientAccountId);
  return { ok: true, data: res.data.spreadsheet };
}

export async function resolveCompanyClientFolderAction(
  clientAccountId: string,
  folder: string
): Promise<CompanySheetsActionResult<{ folderId: string; title: string }>> {
  await requireAdminCocAdminSession();
  const res = await resolveCompanyClientFolder(clientAccountId, folder);
  if (!res.ok) return { ok: false, error: fail(res.body) };
  return { ok: true, data: { folderId: res.data.folder.folderId, title: res.data.folder.title } };
}

export async function testCompanySpreadsheetAction(
  clientAccountId: string,
  input: { spreadsheetId: string; worksheetId: number }
): Promise<CompanySheetsActionResult<{ readOnlyAccess: true; writePermissionVerified: false }>> {
  await requireAdminCocAdminSession();
  const res = await testCompanySpreadsheetAccess(clientAccountId, input);
  if (!res.ok) return { ok: false, error: fail(res.body) };
  refresh(clientAccountId);
  return {
    ok: true,
    data: { readOnlyAccess: true, writePermissionVerified: false },
  };
}

export async function saveCompanySheetsDestinationAction(
  clientAccountId: string,
  input: { spreadsheetId: string; worksheetId: number; intendedRecipientEmail?: string }
): Promise<CompanySheetsActionResult<CompanySheetsDestinationView>> {
  await requireAdminCocAdminSession();
  const res = await saveCompanySheetsDestination(clientAccountId, input);
  if (!res.ok) return { ok: false, error: fail(res.body) };
  refresh(clientAccountId);
  return { ok: true, data: res.data.destination };
}

export async function inspectCompanySheetsTabsAction(
  clientAccountId: string,
  exportPackageId?: string
): Promise<CompanySheetsActionResult<{ googleMutations: 0 }>> {
  await requireAdminCocAdminSession();
  const res = await inspectCompanySheetsTabs(clientAccountId, exportPackageId);
  if (!res.ok) return { ok: false, error: fail(res.body) };
  refresh(clientAccountId);
  return { ok: true, data: { googleMutations: 0 } };
}

export async function bindCompanySheetsTabAction(
  clientAccountId: string,
  input: {
    role: "campaign" | "aged" | "canary";
    worksheetId: number;
    exportPackageId?: string;
    schemaVersion?: string;
  }
): Promise<CompanySheetsActionResult<{ destinationRevision: number }>> {
  await requireAdminCocAdminSession();
  const res = await bindCompanySheetsTab(clientAccountId, input);
  if (!res.ok) return { ok: false, error: fail(res.body) };
  refresh(clientAccountId);
  return { ok: true, data: { destinationRevision: res.data.destinationRevision } };
}

export async function createCompanySheetsTabAction(
  clientAccountId: string,
  input: { role: "campaign" | "aged" | "canary"; exportPackageId?: string; schemaVersion?: string }
): Promise<CompanySheetsActionResult<{ valuesWritten: false }>> {
  await requireAdminCocAdminSession();
  const res = await createCompanySheetsTab(clientAccountId, input);
  if (!res.ok) return { ok: false, error: fail(res.body) };
  refresh(clientAccountId);
  return { ok: true, data: { valuesWritten: false } };
}

export async function deleteCompanySheetsDestinationAction(
  clientAccountId: string
): Promise<CompanySheetsActionResult<{ removed: true }>> {
  await requireAdminCocAdminSession();
  const res = await deleteCompanySheetsDestination(clientAccountId);
  if (!res.ok) return { ok: false, error: fail(res.body) };
  refresh(clientAccountId);
  return { ok: true, data: { removed: true } };
}
