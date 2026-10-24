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

export type CompanyDriveCapabilities = {
  /** Null when Google did not return the flag. That is not permission. */
  canEdit: boolean | null;
  canAddChildren: boolean | null;
};

export type CompanyDriveFile = {
  id: string;
  name: string;
  mimeType: string;
  ownedByMe: boolean;
  ownerEmails: string[];
  /** Set when the file lives in a shared drive. My Drive files omit it. */
  driveId: string | null;
  parents: string[];
  capabilities: CompanyDriveCapabilities;
  /** Null when Google did not return the flag. Shared-drive policy treats that as unusable. */
  trashed: boolean | null;
  /** Set when the file is a shortcut. The target is not a parent. */
  shortcutTargetId: string | null;
};

const DRIVE_FILE_FIELDS =
  "id,name,mimeType,ownedByMe,driveId,parents,trashed,shortcutDetails(targetId),owners(emailAddress),capabilities(canEdit,canAddChildren)";
const DRIVE_ID_PATTERN = /^[a-zA-Z0-9_-]{10,128}$/;

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
  const driveId = typeof record.driveId === "string" && record.driveId.trim() ? record.driveId.trim() : null;
  const parents = Array.isArray(record.parents)
    ? record.parents
        .filter((parent): parent is string => typeof parent === "string" && parent.trim().length > 0)
        .map((parent) => parent.trim())
    : [];
  const capabilitiesRecord = asRecord(record.capabilities);
  const shortcut = asRecord(record.shortcutDetails);
  const shortcutTargetId =
    typeof shortcut?.targetId === "string" && shortcut.targetId.trim() ? shortcut.targetId.trim() : null;
  return {
    id,
    name,
    mimeType,
    ownedByMe: record.ownedByMe === true,
    ownerEmails,
    driveId,
    parents,
    capabilities: {
      canEdit: capabilityFlag(capabilitiesRecord, "canEdit"),
      canAddChildren: capabilityFlag(capabilitiesRecord, "canAddChildren"),
    },
    trashed: record.trashed === true ? true : record.trashed === false ? false : null,
    shortcutTargetId,
  };
}

function capabilityFlag(record: Record<string, unknown> | null, key: string): boolean | null {
  if (!record || !Object.prototype.hasOwnProperty.call(record, key)) return null;
  return record[key] === true;
}

export function isSharedDriveFile(file: { driveId?: string | null }): boolean {
  return Boolean(file.driveId?.trim());
}

export function companyAccountOwnsDriveFile(
  file: Pick<CompanyDriveFile, "ownedByMe" | "ownerEmails"> & { driveId?: string | null },
  companyEmail: string | null | undefined
): boolean {
  if (isSharedDriveFile(file)) return false;
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
  const url = `${COMPANY_GOOGLE_DRIVE_FILES_URL}/${encodeURIComponent(fileId)}?fields=${encodeURIComponent(DRIVE_FILE_FIELDS)}&supportsAllDrives=true`;
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

function assertDriveParentId(parentId: string): void {
  if (!DRIVE_ID_PATTERN.test(parentId) || parentId === "root") {
    throw new Error("Company Drive create requires an explicit folder id.");
  }
}

function assertDriveCreateUrl(url: string): void {
  if (!url.startsWith(`${COMPANY_GOOGLE_DRIVE_FILES_URL}?`)) {
    throw new Error("Company Drive create refused a non-file URL.");
  }
  if (!url.includes("supportsAllDrives=true")) {
    throw new Error("Company Drive create requires supportsAllDrives=true.");
  }
  if (url.includes("sheets.googleapis.com")) {
    throw new Error("Company Drive client refused a Sheets URL.");
  }
}

/**
 * Creates a file directly in parentId. Callers must not retry this in My Drive
 * root when it fails.
 */
export async function createCompanyDriveFile(
  input: { name: string; mimeType: string; parentId: string; accessToken: string },
  fetchImpl: FetchLike = fetch
): Promise<{ ok: true; file: CompanyDriveFile } | { ok: false; reason: CompanyDriveHttpFailure }> {
  const parentId = input.parentId.trim();
  assertDriveParentId(parentId);
  const name = input.name.trim();
  const mimeType = input.mimeType.trim();
  if (!name || !mimeType) return { ok: false, reason: "invalid_request" };
  const url = `${COMPANY_GOOGLE_DRIVE_FILES_URL}?supportsAllDrives=true&fields=${encodeURIComponent("id,name,mimeType,parents,driveId")}`;
  assertDriveCreateUrl(url);
  let response: Response;
  try {
    response = await boundedFetch(fetchImpl, url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${input.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name, mimeType, parents: [parentId] }),
    });
  } catch {
    return { ok: false, reason: "network_error" };
  }
  const parsed = await readJson(response);
  if (!parsed.ok) return parsed;
  if (!response.ok) return { ok: false, reason: classify(response.status) };
  const file = parseCompanyDriveFile(parsed.json);
  if (!file) return { ok: false, reason: "malformed_response" };
  if (!file.parents.includes(parentId)) return { ok: false, reason: "malformed_response" };
  return { ok: true, file };
}

function escapeDriveQueryString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

const NAMED_CHILD_FOLDER_MIME = "application/vnd.google-apps.folder";
const NAMED_CHILD_SPREADSHEET_MIME = "application/vnd.google-apps.spreadsheet";

function assertNamedChildListUrl(url: string, parentId: string, mimeType: string, driveId: string | null): void {
  if (!url.startsWith(`${COMPANY_GOOGLE_DRIVE_FILES_URL}?`)) {
    throw new Error("Company Drive lookup refused a non-file URL.");
  }
  if (!url.includes("supportsAllDrives=true")) {
    throw new Error("Company Drive lookup requires supportsAllDrives=true.");
  }
  if (!url.includes("pageSize=10")) throw new Error("Company Drive lookup is page-capped.");
  if (!url.includes(encodeURIComponent(`'${parentId}' in parents`))) {
    throw new Error("Company Drive lookup must name the parent folder.");
  }
  if (!url.includes(encodeURIComponent(`mimeType = '${mimeType}'`))) {
    throw new Error("Company Drive lookup must name the file type.");
  }
  if (!url.includes(encodeURIComponent("trashed = false"))) {
    throw new Error("Company Drive lookup excludes trash.");
  }
  if (driveId) {
    if (!url.includes("includeItemsFromAllDrives=true")) {
      throw new Error("Company Drive lookup requires shared-drive flags.");
    }
    if (!url.includes("corpora=drive") || !url.includes(`driveId=${encodeURIComponent(driveId)}`)) {
      throw new Error("Company Drive lookup is limited to the approved drive.");
    }
    return;
  }
  if (url.includes("corpora=drive") || url.includes("driveId=")) {
    throw new Error("Company Drive My Drive lookup must not search a shared drive.");
  }
  if (!url.includes("corpora=user") || !url.includes("includeItemsFromAllDrives=false")) {
    throw new Error("Company Drive My Drive lookup stays in My Drive.");
  }
}

/**
 * One exact-name lookup under one parent. A matching name is not proof that
 * the name is unique: Drive allows duplicates, and a further page is ambiguous.
 * driveId null searches My Drive only. A shared-drive id searches that drive only.
 */
export async function findCompanyDriveNamedChild(
  input: { parentId: string; name: string; mimeType: string; driveId: string | null; accessToken: string },
  fetchImpl: FetchLike = fetch
): Promise<
  | { ok: true; files: CompanyDriveFile[] }
  | { ok: false; reason: CompanyDriveHttpFailure | "ambiguous"; files?: CompanyDriveFile[] }
> {
  const parentId = input.parentId.trim();
  const driveId = input.driveId?.trim() || null;
  const name = input.name.trim();
  const mimeType = input.mimeType.trim();
  assertDriveParentId(parentId);
  if (driveId) assertDriveParentId(driveId);
  if (!name || name.length > 200) return { ok: false, reason: "invalid_request" };
  if (mimeType !== NAMED_CHILD_FOLDER_MIME && mimeType !== NAMED_CHILD_SPREADSHEET_MIME) {
    return { ok: false, reason: "invalid_request" };
  }
  const query = [
    `'${escapeDriveQueryString(parentId)}' in parents`,
    `mimeType = '${mimeType}'`,
    `name = '${escapeDriveQueryString(name)}'`,
    "trashed = false",
  ].join(" and ");
  const url = driveId
    ? [
        `${COMPANY_GOOGLE_DRIVE_FILES_URL}?q=${encodeURIComponent(query)}`,
        "supportsAllDrives=true",
        "includeItemsFromAllDrives=true",
        "corpora=drive",
        `driveId=${encodeURIComponent(driveId)}`,
        "pageSize=10",
        `fields=${encodeURIComponent(`files(${DRIVE_FILE_FIELDS}),nextPageToken`)}`,
      ].join("&")
    : [
        `${COMPANY_GOOGLE_DRIVE_FILES_URL}?q=${encodeURIComponent(query)}`,
        "supportsAllDrives=true",
        "includeItemsFromAllDrives=false",
        "corpora=user",
        "pageSize=10",
        `fields=${encodeURIComponent(`files(${DRIVE_FILE_FIELDS}),nextPageToken`)}`,
      ].join("&");
  assertNamedChildListUrl(url, parentId, mimeType, driveId);
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
  const record = asRecord(parsed.json);
  if (!record || !Array.isArray(record.files)) return { ok: false, reason: "malformed_response" };
  const parsedFiles = parseNamedChildPage(record.files, { parentId, mimeType, name, driveId });
  if (!parsedFiles.ok) return parsedFiles;
  const truncated = typeof record.nextPageToken === "string" && record.nextPageToken.length > 0;
  if (truncated || parsedFiles.files.length > 1) {
    return { ok: false, reason: "ambiguous", files: parsedFiles.files };
  }
  return { ok: true, files: parsedFiles.files };
}

function parseNamedChildPage(
  items: unknown[],
  input: { parentId: string; mimeType: string; name: string; driveId: string | null }
): { ok: true; files: CompanyDriveFile[] } | { ok: false; reason: "malformed_response" } {
  const files: CompanyDriveFile[] = [];
  for (const item of items) {
    const file = parseCompanyDriveFile(item);
    if (!file || file.mimeType !== input.mimeType || file.name !== input.name || !file.parents.includes(input.parentId)) {
      return { ok: false, reason: "malformed_response" };
    }
    if (file.shortcutTargetId) return { ok: false, reason: "malformed_response" };
    if (input.driveId) {
      if (file.driveId !== input.driveId) return { ok: false, reason: "malformed_response" };
    } else if (file.driveId) {
      return { ok: false, reason: "malformed_response" };
    }
    if (file.trashed === true) continue;
    files.push(file);
  }
  return { ok: true, files };
}

const FOLDER_CHILD_PAGE_SIZE = 20;

function assertFolderChildListUrl(url: string, parentId: string, mimeType: string, driveId: string | null): void {
  if (!url.startsWith(`${COMPANY_GOOGLE_DRIVE_FILES_URL}?`)) {
    throw new Error("Company Drive folder list refused a non-file URL.");
  }
  if (!url.includes("supportsAllDrives=true") || !url.includes("pageSize=20")) {
    throw new Error("Company Drive folder list is page-capped.");
  }
  if (!url.includes(encodeURIComponent(`'${parentId}' in parents`))) {
    throw new Error("Company Drive folder list must name the parent folder.");
  }
  if (!url.includes(encodeURIComponent(`mimeType = '${mimeType}'`))) {
    throw new Error("Company Drive folder list must name the file type.");
  }
  if (!url.includes(encodeURIComponent("trashed = false"))) {
    throw new Error("Company Drive folder list excludes trash.");
  }
  if (driveId) {
    if (!url.includes("corpora=drive") || !url.includes(`driveId=${encodeURIComponent(driveId)}`)) {
      throw new Error("Company Drive folder list is limited to the approved drive.");
    }
    return;
  }
  if (url.includes("corpora=drive") || url.includes("driveId=")) {
    throw new Error("Company Drive My Drive list must not search a shared drive.");
  }
}

/**
 * One page of children of one type under one parent.
 * Trashed files are excluded. A shortcut or unreadable item is counted as skipped.
 */
export async function listCompanyDriveFolderChildren(
  input: {
    parentId: string;
    mimeType: string;
    driveId: string | null;
    accessToken: string;
    pageToken?: string | null;
  },
  fetchImpl: FetchLike = fetch
): Promise<
  | { ok: true; files: CompanyDriveFile[]; nextPageToken: string | null; skipped: number }
  | { ok: false; reason: CompanyDriveHttpFailure }
> {
  const parentId = input.parentId.trim();
  const driveId = input.driveId?.trim() || null;
  const mimeType = input.mimeType.trim();
  assertDriveParentId(parentId);
  if (driveId) assertDriveParentId(driveId);
  if (mimeType !== NAMED_CHILD_FOLDER_MIME && mimeType !== NAMED_CHILD_SPREADSHEET_MIME) {
    return { ok: false, reason: "invalid_request" };
  }
  const pageToken = input.pageToken?.trim() || "";
  if (pageToken && (pageToken.length > 512 || /[\u0000-\u001f\u007f]/.test(pageToken))) {
    return { ok: false, reason: "invalid_request" };
  }
  const query = [`'${escapeDriveQueryString(parentId)}' in parents`, `mimeType = '${mimeType}'`, "trashed = false"].join(
    " and "
  );
  const shared = [
    `${COMPANY_GOOGLE_DRIVE_FILES_URL}?q=${encodeURIComponent(query)}`,
    "supportsAllDrives=true",
    `pageSize=${FOLDER_CHILD_PAGE_SIZE}`,
    `fields=${encodeURIComponent(`files(${DRIVE_FILE_FIELDS}),nextPageToken`)}`,
    "orderBy=name",
  ];
  const url = (
    driveId
      ? [...shared, "includeItemsFromAllDrives=true", "corpora=drive", `driveId=${encodeURIComponent(driveId)}`]
      : [...shared, "includeItemsFromAllDrives=false", "corpora=user"]
  )
    .concat(pageToken ? [`pageToken=${encodeURIComponent(pageToken)}`] : [])
    .join("&");
  assertFolderChildListUrl(url, parentId, mimeType, driveId);
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
  const record = asRecord(parsed.json);
  if (!record || !Array.isArray(record.files)) return { ok: false, reason: "malformed_response" };
  const files: CompanyDriveFile[] = [];
  let skipped = 0;
  for (const item of record.files) {
    const file = parseCompanyDriveFile(item);
    if (!file || file.mimeType !== mimeType || !file.parents.includes(parentId) || file.shortcutTargetId) {
      skipped += 1;
      continue;
    }
    if (driveId ? file.driveId !== driveId : Boolean(file.driveId)) {
      skipped += 1;
      continue;
    }
    if (file.trashed !== false) {
      skipped += 1;
      continue;
    }
    files.push(file);
  }
  const nextPageToken = typeof record.nextPageToken === "string" && record.nextPageToken ? record.nextPageToken : null;
  return { ok: true, files, nextPageToken, skipped };
}

/**
 * One exact-name folder lookup under one parent in one drive. Not a browser.
 * A single match is not a uniqueness guarantee.
 */
export async function findCompanyDriveChildFolder(
  input: { parentId: string; name: string; driveId: string; accessToken: string },
  fetchImpl: FetchLike = fetch
): Promise<
  | { ok: true; files: CompanyDriveFile[] }
  | { ok: false; reason: CompanyDriveHttpFailure | "ambiguous_client_folder" }
> {
  const found = await findCompanyDriveNamedChild(
    {
      parentId: input.parentId,
      name: input.name,
      mimeType: NAMED_CHILD_FOLDER_MIME,
      driveId: input.driveId,
      accessToken: input.accessToken,
    },
    fetchImpl
  );
  if (found.ok) return { ok: true, files: found.files };
  if (found.reason === "ambiguous") return { ok: false, reason: "ambiguous_client_folder" };
  return { ok: false, reason: found.reason };
}
