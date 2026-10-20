"use server";

import { revalidatePath } from "next/cache";

import { requireAdminCocAdminSession } from "@/lib/admin-coc-session-guard";
import {
  clearCompanyGoogleFolder,
  createCompanySpreadsheet,
  deleteCompanySheetsDestination,
  disconnectCompanyGoogle,
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
  shared_drive_unsupported: "Shared drives are not supported. Use a spreadsheet in the company My Drive.",
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
  clientAccountId: string
): Promise<CompanySheetsActionResult<CompanySheetsCreatedSpreadsheet>> {
  await requireAdminCocAdminSession();
  const res = await createCompanySpreadsheet(clientAccountId);
  if (!res.ok) return { ok: false, error: fail(res.body) };
  refresh(clientAccountId);
  return { ok: true, data: res.data.spreadsheet };
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

export async function deleteCompanySheetsDestinationAction(
  clientAccountId: string
): Promise<CompanySheetsActionResult<{ removed: true }>> {
  await requireAdminCocAdminSession();
  const res = await deleteCompanySheetsDestination(clientAccountId);
  if (!res.ok) return { ok: false, error: fail(res.body) };
  refresh(clientAccountId);
  return { ok: true, data: { removed: true } };
}
