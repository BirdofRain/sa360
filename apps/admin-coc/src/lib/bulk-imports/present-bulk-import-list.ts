import type { BulkImportActionResult } from "@/lib/bulk-imports/action-results";

export type BulkImportListItem = {
  id: string;
  fileName: string;
  status: string;
  totalRows: number;
  validRows: number;
  deliveredRows: number;
  createdAt: string;
};

export type BulkImportListAvailability = "ok" | "empty" | "unavailable";

export type PresentedBulkImportList = {
  availability: BulkImportListAvailability;
  items: BulkImportListItem[];
  title: string | null;
  message: string | null;
};

function isAuthFailure(status: number, error?: string): boolean {
  return status === 401 || status === 403 || error === "unauthorized" || error === "forbidden";
}

function operatorSafeMessage(result: Extract<BulkImportActionResult<unknown>, { ok: false }>): string {
  const raw = result.message?.trim() || "";
  const looksHtml = raw.toLowerCase().startsWith("<!doctype") || raw.toLowerCase().startsWith("<html");
  if (looksHtml || raw === "Invalid JSON from admin API") {
    const statusPart = result.status > 0 ? ` (HTTP ${result.status})` : "";
    return `The SA360 API returned a non-JSON response${statusPart}. Verify the C.O.C. API base URL.`;
  }
  if (!raw) {
    return "Import history could not be loaded. Retry or check service health.";
  }
  return raw.length > 280 ? `${raw.slice(0, 280)}…` : raw;
}

export function readBulkImportListPayload(
  data: { items?: unknown } | null | undefined
): BulkImportActionResult<{ items: BulkImportListItem[] }> {
  if (!data || !Array.isArray(data.items)) {
    return {
      ok: false,
      status: 200,
      error: "invalid_list_payload",
      message: "Bulk import list response was missing items.",
    };
  }
  return { ok: true, data: { items: data.items as BulkImportListItem[] } };
}

export function presentBulkImportList(
  result: BulkImportActionResult<{ items: BulkImportListItem[] }>
): PresentedBulkImportList {
  if (!result.ok) {
    const auth = isAuthFailure(result.status, result.error);
    return {
      availability: "unavailable",
      items: [],
      title: auth
        ? "Unable to load bulk imports — authorization failed"
        : "Bulk imports unavailable",
      message: operatorSafeMessage(result),
    };
  }

  return {
    availability: result.data.items.length === 0 ? "empty" : "ok",
    items: result.data.items,
    title: null,
    message: null,
  };
}
