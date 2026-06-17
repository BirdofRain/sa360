"use server";

import { revalidatePath } from "next/cache";
import {
  bulkAdminFetch,
  bulkAdminRequest,
  uploadBulkImportCsvBody,
} from "@/lib/bulk-imports/admin-api";

export async function uploadBulkImportCsv(input: {
  fileName: string;
  csvText: string;
  importLabel?: string;
}) {
  const result = await uploadBulkImportCsvBody(input);
  revalidatePath("/source-intake/imports");
  return result;
}

export async function fetchBulkImports() {
  return bulkAdminFetch<{ items: unknown[] }>("/admin/v1/bulk-imports");
}

export async function fetchBulkImportDetail(id: string) {
  return bulkAdminFetch<{ batch: unknown; summary: unknown }>(
    `/admin/v1/bulk-imports/${encodeURIComponent(id)}`
  );
}

export async function saveBulkImportMappingAction(
  id: string,
  mapping: Record<string, string>,
  defaultValues?: Record<string, string>
) {
  return bulkAdminRequest(
    "POST",
    `/admin/v1/bulk-imports/${encodeURIComponent(id)}/mapping`,
    { mapping, defaultValues }
  );
}

export async function setBulkImportDestinationAction(
  id: string,
  body: Record<string, unknown>
) {
  return bulkAdminRequest(
    "POST",
    `/admin/v1/bulk-imports/${encodeURIComponent(id)}/destination`,
    body
  );
}

export async function normalizeBulkImportAction(id: string) {
  return bulkAdminRequest(
    "POST",
    `/admin/v1/bulk-imports/${encodeURIComponent(id)}/normalize`,
    {}
  );
}

export async function simulateBulkImportAction(id: string, limit = 5) {
  return bulkAdminRequest(
    "POST",
    `/admin/v1/bulk-imports/${encodeURIComponent(id)}/simulate`,
    { limit }
  );
}

export async function approveBulkImportDeliveryAction(
  id: string,
  operatorConfirmationText: string,
  rowLimit?: number
) {
  return bulkAdminRequest(
    "POST",
    `/admin/v1/bulk-imports/${encodeURIComponent(id)}/approve-delivery`,
    { operatorConfirmationText, rowLimit, mode: "live_canary" }
  );
}
