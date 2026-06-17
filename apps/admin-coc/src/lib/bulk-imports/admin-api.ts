import {
  adminFetchJson,
  adminRequestJson,
  getAdminApiBaseUrl,
  getAdminApiKey,
  isAdminApiConfigured,
} from "@/lib/admin-api/server";
import { isBulkSourceImportsEnabled } from "@/lib/bulk-imports/config";
import {
  parseBulkImportApiFailure,
  type BulkImportActionResult,
} from "@/lib/bulk-imports/action-results";

type AdminFailure = { ok: false; status: number; body: string };

function assertBulkImportsEnabled(): void {
  if (!isBulkSourceImportsEnabled()) {
    throw new Error("Bulk imports feature is disabled");
  }
}

function assertAdminApiConfiguredForBulkImport(): void {
  if (!isAdminApiConfigured()) {
    throw new Error(
      "Admin API is not configured. Set NEXT_PUBLIC_SA360_API_BASE_URL (or NEXT_PUBLIC_API_BASE_URL) and SA360_ADMIN_API_KEY, ADMIN_API_KEY, or SA360_ADMIN_KEY for this Next.js app."
    );
  }
}

function inferContentType(body: string): string | undefined {
  const trimmed = body.trimStart();
  if (trimmed.startsWith("<!DOCTYPE") || trimmed.startsWith("<html")) return "text/html";
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return "application/json";
  return undefined;
}

function logBulkImportDiagnostic(path: string, status: number, body?: string): void {
  const baseUrl = getAdminApiBaseUrl();
  let apiHost: string | undefined;
  if (baseUrl) {
    try {
      apiHost = new URL(baseUrl).hostname;
    } catch {
      apiHost = "(invalid URL)";
    }
  }
  console.info("[bulk-import] API call", {
    apiHost: apiHost ?? "(not configured)",
    path,
    status,
    contentType: body !== undefined ? inferContentType(body) : "application/json",
  });
}

export function formatBulkImportAdminError(result: AdminFailure): string {
  const { status, body } = result;
  const trimmed = body.trimStart();
  const isHtml = trimmed.startsWith("<!DOCTYPE") || trimmed.startsWith("<html");
  const isInvalidJson = body === "Invalid JSON from admin API" || isHtml;

  if (isInvalidJson) {
    const statusPart = status > 0 ? ` (HTTP ${status})` : "";
    return `The SA360 API returned a non-JSON response${statusPart}. Verify the C.O.C. API base URL.`;
  }

  if (status === 0) return body;

  const snippet = body.length > 200 ? `${body.slice(0, 200)}…` : body;
  return `Bulk import API error (HTTP ${status}): ${snippet}`;
}

function throwOnAdminFailure(path: string, result: AdminFailure): never {
  logBulkImportDiagnostic(path, result.status, result.body);
  throw new Error(formatBulkImportAdminError(result));
}

export async function bulkAdminFetch<T>(path: string): Promise<T> {
  assertBulkImportsEnabled();
  assertAdminApiConfiguredForBulkImport();

  const result = await adminFetchJson<T>(path);
  if (!result.ok) {
    throwOnAdminFailure(path, result);
  }
  logBulkImportDiagnostic(path, 200);
  return result.data;
}

export async function bulkAdminRequest<T>(
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  body?: unknown
): Promise<T> {
  assertBulkImportsEnabled();
  assertAdminApiConfiguredForBulkImport();

  const result = await adminRequestJson<T>(method, path, body);
  if (!result.ok) {
    throwOnAdminFailure(path, result);
  }
  logBulkImportDiagnostic(path, 200);
  return result.data;
}

export async function bulkAdminRequestResult<T>(
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  body?: unknown
): Promise<BulkImportActionResult<T>> {
  assertBulkImportsEnabled();
  assertAdminApiConfiguredForBulkImport();

  const result = await adminRequestJson<T>(method, path, body);
  if (!result.ok) {
    logBulkImportDiagnostic(path, result.status, result.body);
    const parsed = parseBulkImportApiFailure(result.status, result.body);
    return { ok: false, status: result.status, ...parsed };
  }
  logBulkImportDiagnostic(path, 200);
  return { ok: true, data: result.data };
}

export async function bulkAdminFetchResult<T>(path: string): Promise<BulkImportActionResult<T>> {
  assertBulkImportsEnabled();
  assertAdminApiConfiguredForBulkImport();

  const result = await adminFetchJson<T>(path);
  if (!result.ok) {
    logBulkImportDiagnostic(path, result.status, result.body);
    const parsed = parseBulkImportApiFailure(result.status, result.body);
    return { ok: false, status: result.status, ...parsed };
  }
  logBulkImportDiagnostic(path, 200);
  return { ok: true, data: result.data };
}

export async function bulkAdminFetchText(path: string): Promise<BulkImportActionResult<{ text: string }>> {
  assertBulkImportsEnabled();
  assertAdminApiConfiguredForBulkImport();

  const baseUrl = getAdminApiBaseUrl();
  const apiKey = getAdminApiKey();
  if (!baseUrl || !apiKey) {
    return {
      ok: false,
      status: 0,
      error: "api_not_configured",
      message: "Admin API is not configured.",
    };
  }

  const url = `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
  try {
    const res = await fetch(url, {
      headers: {
        "x-sa360-admin-key": apiKey,
        Accept: "text/csv, text/plain, */*",
      },
      cache: "no-store",
    });
    const text = await res.text();
    if (!res.ok) {
      logBulkImportDiagnostic(path, res.status, text);
      const parsed = parseBulkImportApiFailure(res.status, text);
      return { ok: false, status: res.status, ...parsed };
    }
    logBulkImportDiagnostic(path, 200);
    return { ok: true, data: { text } };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, status: 0, error: "fetch_failed", message: msg };
  }
}

export async function uploadBulkImportCsvBody(input: {
  fileName: string;
  csvText: string;
  importLabel?: string;
}) {
  const body: { fileName: string; csvText: string; importLabel?: string } = {
    fileName: input.fileName,
    csvText: input.csvText,
  };
  const label = input.importLabel?.trim();
  if (label) body.importLabel = label;

  return bulkAdminRequest<{ batch: { id: string } }>(
    "POST",
    "/admin/v1/bulk-imports/upload",
    body
  );
}
