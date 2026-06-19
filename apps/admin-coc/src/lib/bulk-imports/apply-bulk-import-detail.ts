import type { BulkImportReviewRow } from "@/components/bulk-imports/bulk-import-review-table";
import type { BulkImportDeliveryMonitor } from "@/components/bulk-imports/bulk-import-monitor-panel";
import {
  buildBulkImportTransitionDebugInfo,
  isBulkImportTransitionDebugEnabled,
  normalizeBulkImportReviewRow,
  validateBulkImportMutationResponse,
  type BulkImportDetailDto,
  type BulkImportDetailValidationResult,
} from "./bulk-import-detail-contract";

export type ApplyBulkImportDetailResult =
  | { ok: true; data: BulkImportDetailDto }
  | {
      ok: false;
      message: string;
      correlationId: string;
      diagnostic: Record<string, unknown>;
    };

export function applyValidatedBulkImportDetail(
  input: unknown,
  options?: { action?: string; importId?: string; requireRows?: boolean }
): ApplyBulkImportDetailResult {
  const validation = validateBulkImportMutationResponse(input, {
    requireRows: options?.requireRows,
  });

  if (
    options?.action &&
    options.importId &&
    isBulkImportTransitionDebugEnabled()
  ) {
    console.info(
      "[bulk-import-transition]",
      buildBulkImportTransitionDebugInfo({
        action: options.action,
        importId: options.importId,
        payload: input,
        validation,
      })
    );
  }

  if (!validation.ok) {
    return validation;
  }

  return validation;
}

export function detailRowsToReviewRows(
  rows: BulkImportDetailDto["batch"]["rows"]
): BulkImportReviewRow[] {
  return rows.map((row) => normalizeBulkImportReviewRow(row as Record<string, unknown>));
}

export function extractDeliveryMonitor(
  detail: BulkImportDetailDto
): BulkImportDeliveryMonitor | null {
  return (detail.deliveryMonitor as BulkImportDeliveryMonitor | null) ?? null;
}

export type { BulkImportDetailValidationResult };
