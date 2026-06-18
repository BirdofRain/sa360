"use server";

import { revalidatePath } from "next/cache";
import type { BulkImportActionResult } from "@/lib/bulk-imports/action-results";
import { translateBulkImportApiError } from "@/lib/bulk-imports/action-results";
import {
  bulkAdminFetch,
  bulkAdminFetchResult,
  bulkAdminFetchText,
  bulkAdminRequestResult,
  uploadBulkImportCsvBody,
} from "@/lib/bulk-imports/admin-api";

export type BulkImportDetail = {
  batch: Record<string, unknown>;
  summary: Record<string, unknown>;
  deliveryMonitor?: Record<string, unknown> | null;
};

export type BulkImportLiveCanaryPreflight = {
  ready: boolean;
  destinationClientAccountId: string;
  destinationLocationIdGhl: string;
  oauthConnected: boolean;
  destinationReady: boolean;
  adapterMaxMode: string;
  effectiveRuntimeMode: string;
  clientAllowlisted: boolean;
  locationAllowlisted: boolean;
  explicitLiveAllowlistConfigured: boolean;
  cutoverApproved: boolean;
  internalApproval: string;
  workerConfigured: boolean;
  queueReachable: boolean;
  blockers: string[];
};

export type BulkImportDestinationOption = {
  clientAccountId: string;
  clientDisplayName: string;
  locationIdGhl: string;
  locationName: string;
  oauthStatus: string;
  readinessStatus: string;
  readyForSimulation: boolean;
  readyForDirectCanary: boolean;
  blockers: string[];
};

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

export async function fetchBulkImportDetail(
  id: string
): Promise<BulkImportActionResult<BulkImportDetail>> {
  return bulkAdminFetchResult<BulkImportDetail>(
    `/admin/v1/bulk-imports/${encodeURIComponent(id)}`
  );
}

export async function fetchBulkImportDestinationOptions(): Promise<
  BulkImportActionResult<{ items: BulkImportDestinationOption[] }>
> {
  return bulkAdminFetchResult<{ items: BulkImportDestinationOption[] }>(
    "/admin/v1/bulk-imports/destination-options"
  );
}

export async function saveBulkImportMappingAction(
  id: string,
  mapping: Record<string, string>,
  defaultValues?: Record<string, string>,
  options?: { templateName?: string; resetConfirmation?: string }
): Promise<
  BulkImportActionResult<{
    batch: Record<string, unknown>;
    mappingChanged?: boolean;
    resetPerformed?: boolean;
    nextStep?: string;
  }>
> {
  const result = await bulkAdminRequestResult<{
    batch: Record<string, unknown>;
    mappingChanged?: boolean;
    resetPerformed?: boolean;
    nextStep?: string;
  }>("POST", `/admin/v1/bulk-imports/${encodeURIComponent(id)}/mapping`, {
    mapping,
    defaultValues,
    templateName: options?.templateName,
    resetConfirmation: options?.resetConfirmation,
  });
  if (!result.ok) {
    return {
      ok: false,
      status: result.status,
      error: result.error,
      message: result.message,
      impact: result.impact,
    };
  }
  revalidatePath(`/source-intake/imports/${id}`);
  return result;
}

export async function setBulkImportDestinationAction(
  id: string,
  body: Record<string, unknown>
): Promise<
  BulkImportActionResult<{
    batch: Record<string, unknown>;
    summary: Record<string, unknown>;
    nextStep?: string;
  }>
> {
  const result = await bulkAdminRequestResult<{
    batch: Record<string, unknown>;
    summary: Record<string, unknown>;
    nextStep?: string;
  }>("POST", `/admin/v1/bulk-imports/${encodeURIComponent(id)}/destination`, body);
  if (result.ok) revalidatePath(`/source-intake/imports/${id}`);
  return result;
}

export async function normalizeBulkImportAction(
  id: string
): Promise<
  BulkImportActionResult<{
    batch: Record<string, unknown>;
    summary: Record<string, unknown>;
    nextStep?: string;
  }>
> {
  const result = await bulkAdminRequestResult<{
    batch: Record<string, unknown>;
    summary: Record<string, unknown>;
    nextStep?: string;
  }>("POST", `/admin/v1/bulk-imports/${encodeURIComponent(id)}/normalize`, {});
  if (result.ok) revalidatePath(`/source-intake/imports/${id}`);
  return result;
}

export async function simulateBulkImportAction(
  id: string,
  limit = 5
): Promise<
  BulkImportActionResult<{
    targetRowCount?: number;
    simulatedRows?: number;
    failedRows?: number;
    results?: unknown[];
    batch?: Record<string, unknown>;
    summary?: Record<string, unknown>;
    nextStep?: string;
  }>
> {
  const result = await bulkAdminRequestResult<{
    ok?: boolean;
    targetRowCount?: number;
    simulatedRows?: number;
    failedRows?: number;
    results?: unknown[];
    batch?: Record<string, unknown>;
    summary?: Record<string, unknown>;
    nextStep?: string;
    error?: string;
    message?: string;
  }>("POST", `/admin/v1/bulk-imports/${encodeURIComponent(id)}/simulate`, { limit });

  if (!result.ok) {
    return {
      ok: false,
      status: result.status,
      error: result.error,
      message: result.message,
      data: result.data,
      impact: result.impact,
    };
  }

  if (result.data.ok === false) {
    const apiBody = result.data;
    const error = apiBody.error ?? "no_eligible_rows_for_simulation";
    revalidatePath(`/source-intake/imports/${id}`);
    return {
      ok: false,
      status: 409,
      error,
      message:
        apiBody.message ??
        translateBulkImportApiError(error),
      data: {
        targetRowCount: apiBody.targetRowCount,
        simulatedRows: apiBody.simulatedRows,
        failedRows: apiBody.failedRows,
        results: apiBody.results,
        batch: apiBody.batch,
        summary: apiBody.summary,
        nextStep: apiBody.nextStep,
      },
    };
  }
  revalidatePath(`/source-intake/imports/${id}`);
  return { ok: true, data: result.data };
}

export async function fetchBulkImportLiveCanaryPreflight(
  id: string
): Promise<BulkImportActionResult<{ preflight: BulkImportLiveCanaryPreflight }>> {
  return bulkAdminFetchResult<{ preflight: BulkImportLiveCanaryPreflight }>(
    `/admin/v1/bulk-imports/${encodeURIComponent(id)}/live-canary-preflight`
  );
}

export async function fetchBulkImportDeliveryMonitor(
  id: string
): Promise<
  BulkImportActionResult<{
    monitor: Record<string, unknown>;
    workerDiagnostics: Record<string, unknown>;
  }>
> {
  return bulkAdminFetchResult<{
    monitor: Record<string, unknown>;
    workerDiagnostics: Record<string, unknown>;
  }>(`/admin/v1/bulk-imports/${encodeURIComponent(id)}/delivery-monitor`);
}

export async function approveBulkImportDeliveryAction(
  id: string,
  operatorConfirmationText: string,
  rowLimit?: number
): Promise<
  BulkImportActionResult<{
    approvedRowCount: number;
    batchId: string;
    queueJobs?: Array<{
      jobId: string;
      chunkIndex: number;
      rowCount: number;
      state: string;
    }>;
    batch?: Record<string, unknown>;
    summary?: Record<string, unknown>;
    nextStep?: string;
  }>
> {
  const result = await bulkAdminRequestResult<{
    approvedRowCount: number;
    batchId: string;
    queueJobs?: Array<{
      jobId: string;
      chunkIndex: number;
      rowCount: number;
      state: string;
    }>;
    batch?: Record<string, unknown>;
    summary?: Record<string, unknown>;
    nextStep?: string;
    blockers?: string[];
  }>("POST", `/admin/v1/bulk-imports/${encodeURIComponent(id)}/approve-delivery`, {
    operatorConfirmationText,
    rowLimit,
    mode: "live_canary",
  });
  if (!result.ok) revalidatePath(`/source-intake/imports/${id}`);
  if (result.ok) revalidatePath(`/source-intake/imports/${id}`);
  return result;
}

export async function fetchBulkImportDeletePreview(
  id: string
): Promise<BulkImportActionResult<{ preview: Record<string, unknown> }>> {
  return bulkAdminFetchResult<{ preview: Record<string, unknown> }>(
    `/admin/v1/bulk-imports/${encodeURIComponent(id)}/delete-preview`
  );
}

export async function deleteBulkImportAction(
  id: string,
  confirmationText: string
): Promise<BulkImportActionResult<{ deletedId: string }>> {
  const result = await bulkAdminRequestResult<{ deletedId: string }>(
    "DELETE",
    `/admin/v1/bulk-imports/${encodeURIComponent(id)}`,
    { confirmationText }
  );
  if (result.ok) revalidatePath("/source-intake/imports");
  return result;
}

export async function cancelBulkImportAction(
  id: string,
  confirmationText: string
): Promise<BulkImportActionResult<{ batchId: string }>> {
  const result = await bulkAdminRequestResult<{ batchId: string }>(
    "POST",
    `/admin/v1/bulk-imports/${encodeURIComponent(id)}/cancel`,
    { confirmationText }
  );
  if (result.ok) revalidatePath(`/source-intake/imports/${id}`);
  return result;
}

export async function resetBulkImportAction(
  id: string,
  target: "mapping" | "destination" | "review",
  confirmationText: string
): Promise<BulkImportActionResult<{ batchId: string; target: string }>> {
  const result = await bulkAdminRequestResult<{ batchId: string; target: string }>(
    "POST",
    `/admin/v1/bulk-imports/${encodeURIComponent(id)}/reset`,
    { target, confirmationText }
  );
  if (result.ok) revalidatePath(`/source-intake/imports/${id}`);
  return result;
}

export async function setBulkImportWizardStepAction(
  id: string,
  step: string
): Promise<BulkImportActionResult<{ batch: Record<string, unknown> }>> {
  const result = await bulkAdminRequestResult<{ batch: Record<string, unknown> }>(
    "POST",
    `/admin/v1/bulk-imports/${encodeURIComponent(id)}/wizard-step`,
    { step }
  );
  if (result.ok) revalidatePath(`/source-intake/imports/${id}`);
  return result;
}

export async function exportBulkImportResultsAction(
  id: string
): Promise<BulkImportActionResult<{ csv: string }>> {
  const result = await bulkAdminFetchText(
    `/admin/v1/bulk-imports/${encodeURIComponent(id)}/export-results`
  );
  if (!result.ok) return result;
  return { ok: true, data: { csv: result.data.text } };
}
