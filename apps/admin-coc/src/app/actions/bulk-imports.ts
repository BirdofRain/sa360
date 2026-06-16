"use server";

import { revalidatePath } from "next/cache";
import { isBulkSourceImportsEnabled } from "@/lib/bulk-imports/config";

const API_BASE = process.env.SA360_API_BASE_URL ?? "http://127.0.0.1:3001";
const ADMIN_KEY = process.env.ADMIN_API_KEY ?? "";

async function adminFetch<T>(path: string, init?: RequestInit): Promise<T> {
  if (!isBulkSourceImportsEnabled()) {
    throw new Error("Bulk imports feature is disabled");
  }
  const res = await fetch(`${API_BASE}/admin/v1${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-sa360-admin-key": ADMIN_KEY,
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function uploadBulkImportCsv(input: {
  fileName: string;
  csvText: string;
  importLabel?: string;
}) {
  const result = await adminFetch<{ batch: { id: string } }>("/bulk-imports/upload", {
    method: "POST",
    body: JSON.stringify(input),
  });
  revalidatePath("/source-intake/imports");
  return result;
}

export async function fetchBulkImports() {
  return adminFetch<{ items: unknown[] }>("/bulk-imports");
}

export async function fetchBulkImportDetail(id: string) {
  return adminFetch<{ batch: unknown; summary: unknown }>(`/bulk-imports/${id}`);
}

export async function saveBulkImportMappingAction(
  id: string,
  mapping: Record<string, string>,
  defaultValues?: Record<string, string>
) {
  return adminFetch(`/bulk-imports/${id}/mapping`, {
    method: "POST",
    body: JSON.stringify({ mapping, defaultValues }),
  });
}

export async function setBulkImportDestinationAction(
  id: string,
  body: Record<string, unknown>
) {
  return adminFetch(`/bulk-imports/${id}/destination`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function normalizeBulkImportAction(id: string) {
  return adminFetch(`/bulk-imports/${id}/normalize`, { method: "POST", body: "{}" });
}

export async function simulateBulkImportAction(id: string, limit = 5) {
  return adminFetch(`/bulk-imports/${id}/simulate`, {
    method: "POST",
    body: JSON.stringify({ limit }),
  });
}

export async function approveBulkImportDeliveryAction(
  id: string,
  operatorConfirmationText: string,
  rowLimit?: number
) {
  return adminFetch(`/bulk-imports/${id}/approve-delivery`, {
    method: "POST",
    body: JSON.stringify({ operatorConfirmationText, rowLimit, mode: "live_canary" }),
  });
}
