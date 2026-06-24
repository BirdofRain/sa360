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
import {
  postAdminApproveSourceIntakeCutover,
  postAdminApproveSourceIntakeLiveCanary,
} from "@/lib/admin-api/server";

export type BulkImportCanaryApprovalSources = {
  cutoverApprovalSource: "ClientGhlDestination";
  cutoverApprovalRecordId: string | null;
  clientCutoverApproved: boolean;
  internalApprovalSource:
    | "BulkLeadImport.importOptionsJson"
    | "ClientGhlDestination"
    | "none";
  internalApprovalRecordId: string | null;
  internalApprovalStatus: string;
  internalApprovalSatisfied: boolean;
  batchInternalApprovalStatus: string;
  clientDestinationInternalApprovalStatus: string;
  routingRuleCutoverApproved: boolean | null;
  routingRuleInternalApprovalStatus: string | null;
  routingRuleInternalApprovalMismatch: boolean;
  deliveryConfigReadyForDirectCanary: boolean;
  configReadyButCutoverPending: boolean;
  destinationClientIdMismatch: string | null;
};

export type BulkImportActiveRoutingRuleSummary = {
  id: string;
  masterClientAccountId: string;
  matchType: string;
  matchField: string;
  matchValue: string | null;
  destinationClientAccountId: string;
  destinationSubaccountIdGhl: string;
  nicheKey?: string | null;
  productType?: string | null;
  sourcePlatform?: string | null;
  active?: boolean;
};

export type BulkImportRowRoutingCheck = {
  rowId: string;
  rowNumber: number;
  matched: boolean;
  matchedRuleId: string | null;
  reason: string;
  attribution: {
    campaignId?: string;
    adsetId?: string;
    adId?: string;
    utmCampaign?: string;
    formId?: string;
  };
};

export type BulkImportLiveCanaryRoutingMatch = {
  liveDeliveryRequiresRoutingRuleMatch: true;
  routingMasterClientAccountId: string;
  activeRules: BulkImportActiveRoutingRuleSummary[];
  rowChecks: BulkImportRowRoutingCheck[];
  eligibleRowCount: number;
  matchedRowCount: number;
  unmatchedRowCount: number;
  allEligibleRowsMatch: boolean;
};

export type BulkImportLiveCanaryPreflight = {
  ready: boolean;
  batchId: string;
  deliveryWaveId: string | null;
  destinationClientAccountId: string;
  destinationLocationIdGhl: string;
  expectedDemoClientAccountId: string;
  oauthConnected: boolean;
  destinationReady: boolean;
  adapterMaxMode: string;
  effectiveRuntimeMode: string;
  clientAllowlisted: boolean;
  locationAllowlisted: boolean;
  liveCanaryClientMatch: boolean;
  explicitLiveAllowlistConfigured: boolean;
  cutoverApproved: boolean;
  internalApproval: string;
  internalApprovalSatisfied: boolean;
  envAllowlistedCutoverPending: boolean;
  workerConfigured: boolean;
  queueReachable: boolean;
  approvalSources: BulkImportCanaryApprovalSources;
  routingMatch: BulkImportLiveCanaryRoutingMatch | null;
  blockers: string[];
};

export type BulkImportDetail = {
  batch: Record<string, unknown>;
  summary: Record<string, unknown>;
  deliveryMonitor?: Record<string, unknown> | null;
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
  isInitialCanaryTarget: boolean;
  canRunLiveCanary: boolean;
  liveCanaryBlockers: string[];
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
  const result = await bulkAdminFetchResult<{ items: BulkImportDestinationOption[] }>(
    "/admin/v1/bulk-imports/destination-options"
  );
  if (!result.ok) return result;
  const { normalizeBulkImportDestinationOptions } = await import("@sa360/shared");
  return {
    ok: true,
    data: {
      items: normalizeBulkImportDestinationOptions(result.data.items),
    },
  };
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
    mappingConfirmed?: boolean;
    confirmationChanged?: boolean;
    resetPerformed?: boolean;
    nextStep?: string;
  }>
> {
  const result = await bulkAdminRequestResult<{
    batch: Record<string, unknown>;
    mappingChanged?: boolean;
    mappingConfirmed?: boolean;
    confirmationChanged?: boolean;
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
  id: string,
  opts?: { rowLimit?: number; selectedRowIds?: string[]; forRowSelection?: boolean }
): Promise<BulkImportActionResult<{ preflight: BulkImportLiveCanaryPreflight }>> {
  const params = new URLSearchParams();
  if (typeof opts?.rowLimit === "number" && Number.isFinite(opts.rowLimit)) {
    params.set("rowLimit", String(Math.floor(opts.rowLimit)));
  }
  if (opts?.selectedRowIds?.length) {
    params.set("selectedRowIds", opts.selectedRowIds.join(","));
  }
  if (opts?.forRowSelection) {
    params.set("forRowSelection", "true");
  }
  const query = params.toString() ? `?${params.toString()}` : "";
  return bulkAdminFetchResult<{ preflight: BulkImportLiveCanaryPreflight }>(
    `/admin/v1/bulk-imports/${encodeURIComponent(id)}/live-canary-preflight${query}`
  );
}

export async function approveSourceIntakeLiveCanaryAction(
  clientAccountId: string,
  importId?: string
): Promise<
  BulkImportActionResult<{
    clientAccountId: string;
    destinationLocationIdGhl: string;
    clientCutoverApproved: boolean;
    internalApprovalStatus: string;
  }>
> {
  const res = await postAdminApproveSourceIntakeLiveCanary(clientAccountId);
  if (!res.data?.ok || !res.data.approval) {
    return {
      ok: false,
      status: 400,
      error: res.data?.code ?? "approve_failed",
      message: res.error ?? res.data?.error ?? "Failed to approve Source Intake live canary.",
    };
  }
  if (importId) {
    revalidatePath(`/source-intake/imports/${importId}`);
  }
  revalidatePath(`/clients/${clientAccountId}`);
  return {
    ok: true,
    data: {
      clientAccountId: res.data.approval.clientAccountId,
      destinationLocationIdGhl: res.data.approval.destinationLocationIdGhl,
      clientCutoverApproved: res.data.approval.clientCutoverApproved,
      internalApprovalStatus: res.data.approval.internalApprovalStatus,
    },
  };
}

export async function approveSourceIntakeClientCutoverAction(
  clientAccountId: string,
  importId?: string
): Promise<
  BulkImportActionResult<{
    clientAccountId: string;
    destinationLocationIdGhl: string;
    clientCutoverApproved: boolean;
    clientGhlDestinationId: string;
  }>
> {
  const res = await postAdminApproveSourceIntakeCutover(clientAccountId);
  if (!res.data?.ok || !res.data.approval) {
    return {
      ok: false,
      status: 400,
      error: res.data?.code ?? "approve_failed",
      message: res.error ?? res.data?.error ?? "Failed to grant client cutover approval.",
    };
  }
  if (importId) revalidatePath(`/source-intake/imports/${importId}`);
  revalidatePath(`/clients/${clientAccountId}`);
  return {
    ok: true,
    data: {
      clientAccountId: res.data.approval.clientAccountId,
      destinationLocationIdGhl: res.data.approval.destinationLocationIdGhl,
      clientCutoverApproved: res.data.approval.clientCutoverApproved,
      clientGhlDestinationId: res.data.approval.clientGhlDestinationId,
    },
  };
}

export async function approveSourceIntakeBatchInternalReviewAction(
  importId: string,
  rowLimit: number
): Promise<
  BulkImportActionResult<{
    batchId: string;
    destinationClientAccountId: string;
    internalApprovalStatus: "approved";
    internalApprovalSource: "ClientGhlDestination";
    clientGhlDestinationId: string;
  }>
> {
  const result = await bulkAdminRequestResult<{
    ok: boolean;
    approval?: {
      batchId: string;
      destinationClientAccountId: string;
      internalApprovalStatus: "approved";
      internalApprovalSource: "ClientGhlDestination";
      clientGhlDestinationId: string;
    };
    error?: string;
    code?: string;
  }>("POST", `/admin/v1/bulk-imports/${encodeURIComponent(importId)}/approve-internal-review`, {
    rowLimit,
  });
  if (!result.ok) {
    return {
      ok: false,
      status: result.status,
      error: result.error ?? "approve_failed",
      message: result.message ?? "Failed to approve internal review for this import canary.",
    };
  }
  if (!result.data?.approval) {
    return {
      ok: false,
      status: 400,
      error: result.data?.code ?? "approve_failed",
      message:
        result.data?.error ??
        "Failed to approve internal review for this import canary.",
    };
  }
  revalidatePath(`/source-intake/imports/${importId}`);
  return { ok: true, data: result.data.approval };
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
  rowLimit?: number,
  selectedRowIds?: string[]
): Promise<
  BulkImportActionResult<{
    approvedRowCount: number;
    batchId: string;
    selectedRowIds?: string[];
    selectedRowNumbers?: number[];
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
    selectedRowIds?: string[];
    selectedRowNumbers?: number[];
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
    selectedRowIds,
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
  target: "mapping" | "destination" | "review" | "simulation",
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
