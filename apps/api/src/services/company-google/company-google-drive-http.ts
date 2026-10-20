import {
  COMPANY_GOOGLE_DRIVE_FILES_URL,
} from "../../lib/company-google-sheets-env.js";
import { GOOGLE_SHEETS_HTTP_TIMEOUT_MS } from "../../lib/google-sheets-env.js";

export type CompanyDriveHttpFailure =
  | "unauthorized"
  | "access_denied"
  | "not_found"
  | "invalid_request"
  | "rate_limited"
  | "server_error"
  | "network_error"
  | "malformed_response";

export type CompanyDriveFile = {
  id: string;
  name: string;
  mimeType: string;
  ownedByMe: boolean;
  ownerEmails: string[];
};

type FetchLike = typeof fetch;

function assertDriveFileUrl(url: string): void {
  if (!url.startsWith(`${COMPANY_GOOGLE_DRIVE_FILES_URL}/`)) {
    throw new Error("Company Drive client refused a non-file URL.");
  }
  if (url.includes("/files?")) {
    throw new Error("Company Drive client does not list files.");
  }
  if (url.includes("sheets.googleapis.com")) {
    throw new Error("Company Drive client refused a Sheets URL.");
  }
}

async function boundedFetch(fetchImpl: FetchLike, url: string, init: RequestInit): Promise<Response> {
  return fetchImpl(url, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(GOOGLE_SHEETS_HTTP_TIMEOUT_MS),
  });
}

function classify(status: number): CompanyDriveHttpFailure {
  if (status === 401) return "unauthorized";
  if (status === 403) return "access_denied";
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "server_error";
  if (status === 400) return "invalid_request";
  return "malformed_response";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function parseCompanyDriveFile(json: unknown, expectedId?: string): CompanyDriveFile | null {
  const record = asRecord(json);
  if (!record) return null;
  const id = typeof record.id === "string" ? record.id.trim() : "";
  const name = typeof record.name === "string" ? record.name.trim() : "";
  const mimeType = typeof record.mimeType === "string" ? record.mimeType.trim() : "";
  if (!id || !name || !mimeType) return null;
  if (expectedId && id !== expectedId) return null;
  const ownerEmails = Array.isArray(record.owners)
    ? record.owners
        .map((owner) => asRecord(owner)?.emailAddress)
        .filter((email): email is string => typeof email === "string" && email.trim().length > 0)
        .map((email) => email.trim().toLowerCase())
    : [];
  return {
    id,
    name,
    mimeType,
    ownedByMe: record.ownedByMe === true,
    ownerEmails,
  };
}

export function companyAccountOwnsDriveFile(
  file: Pick<CompanyDriveFile, "ownedByMe" | "ownerEmails">,
  companyEmail: string | null | undefined
): boolean {
  if (file.ownedByMe) return true;
  const email = companyEmail?.trim().toLowerCase() ?? "";
  if (!email) return false;
  return file.ownerEmails.includes(email);
}

async function readJson(
  response: Response
): Promise<{ ok: true; json: unknown } | { ok: false; reason: CompanyDriveHttpFailure }> {
  try {
    return { ok: true, json: await response.json() };
  } catch {
    return { ok: false, reason: "malformed_response" };
  }
}

export async function getCompanyDriveFile(
  input: { fileId: string; accessToken: string },
  fetchImpl: FetchLike = fetch
): Promise<{ ok: true; file: CompanyDriveFile } | { ok: false; reason: CompanyDriveHttpFailure }> {
  const fileId = input.fileId.trim();
  const url = `${COMPANY_GOOGLE_DRIVE_FILES_URL}/${encodeURIComponent(fileId)}?fields=${encodeURIComponent("id,name,mimeType,ownedByMe,owners(emailAddress)")}&supportsAllDrives=false`;
  assertDriveFileUrl(url);
  let response: Response;
  try {
    response = await boundedFetch(fetchImpl, url, {
      method: "GET",
      headers: { Accept: "application/json", Authorization: `Bearer ${input.accessToken}` },
    });
  } catch {
    return { ok: false, reason: "network_error" };
  }
  const parsed = await readJson(response);
  if (!parsed.ok) return parsed;
  if (!response.ok) return { ok: false, reason: classify(response.status) };
  const file = parseCompanyDriveFile(parsed.json, fileId);
  if (!file) return { ok: false, reason: "malformed_response" };
  return { ok: true, file };
}

/**
 * One parent update. Does not create a file and does not retry after an unknown outcome.
 */
export async function moveCompanyDriveFileToFolder(
  input: { fileId: string; folderId: string; accessToken: string },
  fetchImpl: FetchLike = fetch
): Promise<{ ok: true } | { ok: false; reason: CompanyDriveHttpFailure }> {
  const fileId = input.fileId.trim();
  const folderId = input.folderId.trim();
  const url = `${COMPANY_GOOGLE_DRIVE_FILES_URL}/${encodeURIComponent(fileId)}?addParents=${encodeURIComponent(folderId)}&removeParents=root&fields=id,parents`;
  assertDriveFileUrl(url);
  let response: Response;
  try {
    response = await boundedFetch(fetchImpl, url, {
      method: "PATCH",
      headers: { Accept: "application/json", Authorization: `Bearer ${input.accessToken}` },
    });
  } catch {
    return { ok: false, reason: "network_error" };
  }
  if (response.ok) return { ok: true };
  return { ok: false, reason: classify(response.status) };
}
