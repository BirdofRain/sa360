import type { Prisma } from "@prisma/client";
import { updateBulkLeadImport } from "../../repositories/bulk-lead-import.repository.js";
import { sanitizeCsvPreviewRows } from "./csv-import-parser.service.js";
import {
  listMissingRequiredMappings,
  suggestFieldMappings,
} from "./csv-import-mapping.service.js";
import type { ImportFieldMapping } from "./bulk-import.types.js";

export type BulkImportWizardStepJson = Record<string, unknown> & {
  step?: string;
  headers?: string[];
  suggestions?: unknown[];
  previewRows?: unknown[];
  missingRequired?: string[];
  mappingConfirmed?: boolean;
  mappingConfirmedAt?: string;
  mappingConfirmedBy?: string;
  mappingConflicts?: unknown[];
  destinationReadiness?: unknown;
  destinationClientDisplayName?: string;
  destinationLocationName?: string;
  summary?: unknown;
  simulationResults?: unknown[];
  approvedRowCount?: number;
  cancelled?: boolean;
};

const POST_UPLOAD_STATUSES = new Set([
  "ready_for_review",
  "ready_for_simulation",
  "simulation_running",
  "simulation_complete",
  "approved_for_delivery",
  "delivery_running",
  "partial_success",
  "completed",
  "failed",
  "paused",
]);

const LIVE_APPROVAL_STATUSES = new Set([
  "approved_for_delivery",
  "delivery_running",
  "partial_success",
  "completed",
]);

export function asWizardStepJson(value: unknown): BulkImportWizardStepJson {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return { ...(value as object) };
  }
  return {};
}

export function mergeBulkImportWizardStepJson(
  existing: unknown,
  patch: BulkImportWizardStepJson
): Prisma.InputJsonValue {
  return {
    ...asWizardStepJson(existing),
    ...patch,
  } as Prisma.InputJsonValue;
}

export function inferMappingConfirmed(batch: {
  wizardStepJson: unknown;
  mappingJson: unknown;
  status: string;
  destinationClientAccountId: string | null;
}): boolean {
  const meta = asWizardStepJson(batch.wizardStepJson);
  if (typeof meta.mappingConfirmed === "boolean") return meta.mappingConfirmed;
  const mapping = (batch.mappingJson ?? {}) as ImportFieldMapping;
  if (Object.keys(mapping).length === 0) return false;
  if (batch.destinationClientAccountId) return true;
  return POST_UPLOAD_STATUSES.has(batch.status);
}

export function extractHeadersFromRawRows(
  rows: Array<{ rowNumber: number; rawRowJson: unknown }>
): string[] {
  if (rows.length === 0) return [];
  const sorted = [...rows].sort((a, b) => a.rowNumber - b.rowNumber);
  const ordered: string[] = [];
  const seen = new Set<string>();
  for (const row of sorted) {
    const fields = row.rawRowJson as Record<string, string>;
    for (const key of Object.keys(fields)) {
      if (!seen.has(key)) {
        seen.add(key);
        ordered.push(key);
      }
    }
  }
  return ordered;
}

export type WizardMetadataRepairResult = {
  wizardStepJson: BulkImportWizardStepJson;
  repaired: boolean;
};

export function reconstructBulkImportWizardMetadata(input: {
  batch: {
    wizardStepJson: unknown;
    mappingJson: unknown;
    status: string;
    destinationClientAccountId: string | null;
    uploadedBy?: string | null;
  };
  rows: Array<{ rowNumber: number; rawRowJson: unknown }>;
}): WizardMetadataRepairResult {
  const existing = asWizardStepJson(input.batch.wizardStepJson);
  if (existing.headers?.length) {
    return { wizardStepJson: existing, repaired: false };
  }
  if (input.rows.length === 0) {
    return { wizardStepJson: existing, repaired: false };
  }

  const mapping = (input.batch.mappingJson ?? {}) as ImportFieldMapping;
  if (Object.keys(mapping).length === 0) {
    return { wizardStepJson: existing, repaired: false };
  }

  const headers = extractHeadersFromRawRows(input.rows);
  const suggestions = suggestFieldMappings(headers);
  const missingRequired = listMissingRequiredMappings(mapping);
  const previewRows = sanitizeCsvPreviewRows(
    input.rows.map((r) => ({
      rowNumber: r.rowNumber,
      fields: r.rawRowJson as Record<string, string>,
    })),
    20
  );
  const mappingConfirmed = inferMappingConfirmed(input.batch);

  return {
    wizardStepJson: {
      ...existing,
      headers,
      suggestions,
      previewRows,
      missingRequired,
      mappingConfirmed,
      ...(mappingConfirmed && !existing.mappingConfirmedAt
        ? {
            mappingConfirmedAt: new Date().toISOString(),
            mappingConfirmedBy: input.batch.uploadedBy ?? "metadata_repair",
          }
        : {}),
    },
    repaired: true,
  };
}

export async function repairBulkImportWizardMetadata(batchId: string): Promise<WizardMetadataRepairResult> {
  const { findBulkLeadImportWithRows } = await import("../../repositories/bulk-lead-import.repository.js");
  const batch = await findBulkLeadImportWithRows(batchId);
  if (!batch) throw new Error("not_found");

  const result = reconstructBulkImportWizardMetadata({
    batch,
    rows: batch.rows,
  });

  if (result.repaired) {
    await updateBulkLeadImport(batchId, {
      wizardStepJson: result.wizardStepJson as Prisma.InputJsonValue,
    });
  }

  return result;
}

export function batchHasLiveDeliveryApproval(batch: {
  status: string;
  approvedAt?: Date | null;
}): boolean {
  return Boolean(batch.approvedAt) || LIVE_APPROVAL_STATUSES.has(batch.status);
}

export function isRetryableSimulationFailureRow(
  row: {
    deliveryStatus: string;
    ghlContactId: string | null;
    ghlOpportunityId: string | null;
    deliveryAttempts: number;
    errorCode: string | null;
    errorSummary: string | null;
  },
  batch: { status: string; approvedAt?: Date | null }
): boolean {
  if (batchHasLiveDeliveryApproval(batch)) return false;
  if (row.deliveryAttempts > 0) return false;
  if (row.ghlContactId || row.ghlOpportunityId) return false;
  if (row.deliveryStatus !== "failed") return false;
  if (row.errorCode === "simulation_failed") return true;
  const summary = row.errorSummary?.toLowerCase() ?? "";
  return (
    summary.includes("simulation") ||
    summary === "destination_not_ready" ||
    summary === "delivery_plan_unavailable"
  );
}

export type SanitizedSimulationRowResult = {
  rowId: string;
  rowNumber: number;
  leadName?: string | null;
  status: "simulated" | "failed";
  deliveryPlanCreated: boolean;
  adapterRunCreated: boolean;
  reason: string | null;
  errorCode: string | null;
  retryable: boolean;
  deliveryPlanId?: string | null;
  adapterRunId?: string | null;
  externalCallExecuted: boolean;
  blockers?: string[];
  nextAction?: string | null;
  deliveryPlanStatus?: string | null;
  adapterSimulationDetail?: string | null;
  missingConfigFields?: string[];
};

export function sanitizeSimulationRowResult(input: {
  rowId: string;
  rowNumber: number;
  leadName?: string | null;
  ok: boolean;
  reason?: string;
  error?: string;
  deliveryPlanId?: string | null;
  adapterRunId?: string | null;
  blockers?: string[];
  nextAction?: string | null;
  deliveryPlanStatus?: string | null;
  adapterSimulationDetail?: string | null;
  missingConfigFields?: string[];
  externalCallExecuted?: boolean;
}): SanitizedSimulationRowResult {
  const reason = input.reason ?? input.error ?? null;
  return {
    rowId: input.rowId,
    rowNumber: input.rowNumber,
    leadName: input.leadName ?? null,
    status: input.ok ? "simulated" : "failed",
    deliveryPlanCreated: Boolean(input.deliveryPlanId),
    adapterRunCreated: Boolean(input.adapterRunId),
    reason: reason ? reason.slice(0, 500) : null,
    errorCode: input.ok ? null : "simulation_failed",
    retryable: !input.ok,
    deliveryPlanId: input.deliveryPlanId ?? null,
    adapterRunId: input.adapterRunId ?? null,
    externalCallExecuted: input.externalCallExecuted ?? false,
    blockers: input.blockers,
    nextAction: input.nextAction ?? null,
    deliveryPlanStatus: input.deliveryPlanStatus ?? null,
    adapterSimulationDetail: input.adapterSimulationDetail ?? null,
    missingConfigFields: input.missingConfigFields,
  };
}

export function isSimulationFailureDisplay(
  row: {
    deliveryStatus: string;
    errorCode?: string | null;
    deliveryAttempts?: number;
    ghlContactId?: string | null;
  },
  batchStatus: string
): boolean {
  if (batchHasLiveDeliveryApproval({ status: batchStatus })) return false;
  if ((row.deliveryAttempts ?? 0) > 0) return false;
  if (row.ghlContactId) return false;
  return row.deliveryStatus === "failed" && row.errorCode === "simulation_failed";
}
