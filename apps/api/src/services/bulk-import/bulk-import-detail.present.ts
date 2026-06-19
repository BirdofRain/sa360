import type { getBulkImportDetail } from "./bulk-lead-import.service.js";

export type BulkImportDetailPayload = NonNullable<Awaited<ReturnType<typeof getBulkImportDetail>>>;

export type PresentedBulkImportReviewRow = BulkImportDetailPayload["rows"][number];

export type PresentedBulkImportBatch = {
  id: string;
  fileName: string;
  importLabel: string | null;
  status: string;
  totalRows: number;
  validRows: number;
  deliveredRows: number;
  failedRows: number;
  destinationClientAccountId: string | null;
  destinationLocationIdGhl: string | null;
  createdAt: string;
  updatedAt: string;
  mappingJson: Record<string, unknown>;
  defaultValuesJson: Record<string, unknown>;
  importOptionsJson: Record<string, unknown> | null;
  wizardStepJson: Record<string, unknown>;
  rows: PresentedBulkImportReviewRow[];
};

export type BulkImportDetailDto = {
  batch: PresentedBulkImportBatch;
  summary: BulkImportDetailPayload["summary"];
  deliveryMonitor: BulkImportDetailPayload["deliveryMonitor"] | null;
  nextStep?: string;
};

type BatchListSource = {
  id: string;
  fileName: string;
  importLabel: string | null;
  status: string;
  totalRows: number;
  validRows: number;
  deliveredRows: number;
  failedRows: number;
  destinationClientAccountId: string | null;
  destinationLocationIdGhl: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  mappingJson?: unknown;
  defaultValuesJson?: unknown;
  importOptionsJson?: unknown;
  wizardStepJson?: unknown;
};

export function presentBatchListItem(row: BatchListSource) {
  return {
    id: row.id,
    fileName: row.fileName,
    importLabel: row.importLabel,
    status: row.status,
    totalRows: row.totalRows,
    validRows: row.validRows,
    deliveredRows: row.deliveredRows,
    failedRows: row.failedRows,
    destinationClientAccountId: row.destinationClientAccountId,
    destinationLocationIdGhl: row.destinationLocationIdGhl,
    createdAt:
      typeof row.createdAt === "string" ? row.createdAt : row.createdAt.toISOString(),
    updatedAt:
      typeof row.updatedAt === "string" ? row.updatedAt : row.updatedAt.toISOString(),
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Canonical detail DTO for GET detail and all wizard mutation responses. */
export function presentBulkImportDetailResponse(
  detail: BulkImportDetailPayload,
  options?: { nextStep?: string }
): BulkImportDetailDto {
  const batch = detail.batch;
  return {
    batch: {
      ...presentBatchListItem(batch),
      mappingJson: asRecord(batch.mappingJson),
      defaultValuesJson: asRecord(batch.defaultValuesJson),
      importOptionsJson:
        batch.importOptionsJson == null ? null : asRecord(batch.importOptionsJson),
      wizardStepJson: asRecord(batch.wizardStepJson),
      rows: detail.rows,
    },
    summary: detail.summary,
    deliveryMonitor: detail.deliveryMonitor ?? null,
    ...(options?.nextStep ? { nextStep: options.nextStep } : {}),
  };
}
