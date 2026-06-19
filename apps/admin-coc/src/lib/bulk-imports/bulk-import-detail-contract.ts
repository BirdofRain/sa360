import type { BulkImportWizardStep } from "./types";
import type { BulkImportReviewRow } from "@/components/bulk-imports/bulk-import-review-table";

const WIZARD_STEPS = new Set<BulkImportWizardStep>([
  "upload",
  "map",
  "destination",
  "review",
  "simulate",
  "approve",
  "monitor",
  "results",
]);

export type BulkImportReviewRowDto = BulkImportReviewRow;

export type BulkImportBatchDto = {
  id: string;
  fileName: string;
  status: string;
  mappingJson: Record<string, unknown>;
  defaultValuesJson: Record<string, unknown>;
  importOptionsJson: Record<string, unknown> | null;
  wizardStepJson: Record<string, unknown>;
  destinationClientAccountId: string | null;
  destinationLocationIdGhl: string | null;
  updatedAt: string;
  rows: BulkImportReviewRowDto[];
  [key: string]: unknown;
};

export type BulkImportSummaryDto = Record<string, unknown>;

export type BulkImportDetailDto = {
  batch: BulkImportBatchDto;
  summary: BulkImportSummaryDto;
  deliveryMonitor: Record<string, unknown> | null;
  nextStep?: BulkImportWizardStep;
};

export type BulkImportMutationResponseDto = BulkImportDetailDto & {
  nextStep?: BulkImportWizardStep;
  results?: unknown[];
  targetRowCount?: number;
  simulatedRows?: number;
  failedRows?: number;
};

export type BulkImportDetailValidationResult =
  | { ok: true; data: BulkImportDetailDto }
  | {
      ok: false;
      message: string;
      correlationId: string;
      diagnostic: Record<string, unknown>;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function isRawDatabaseRow(row: Record<string, unknown>): boolean {
  return (
    ("blockerReasonsJson" in row || "rawRowJson" in row) &&
    !Array.isArray(row.blockerReasons)
  );
}

export function normalizeBulkImportReviewRow(
  input: Record<string, unknown>
): BulkImportReviewRowDto {
  return {
    id: String(input.id ?? ""),
    rowNumber: Number(input.rowNumber ?? 0),
    name: typeof input.name === "string" ? input.name : null,
    phone: typeof input.phone === "string" ? input.phone : null,
    email: typeof input.email === "string" ? input.email : null,
    validationStatus: String(input.validationStatus ?? "pending"),
    duplicateStatus: String(input.duplicateStatus ?? "none"),
    deliveryStatus: String(input.deliveryStatus ?? "pending"),
    blockerReasons: asStringArray(input.blockerReasons),
    duplicateCandidates: Array.isArray(input.duplicateCandidates)
      ? (input.duplicateCandidates as BulkImportReviewRowDto["duplicateCandidates"])
      : [],
    unmappedFieldCount: Number(input.unmappedFieldCount ?? 0),
    excluded: Boolean(input.excluded),
    sourceLeadEventId:
      typeof input.sourceLeadEventId === "string" ? input.sourceLeadEventId : null,
    sourceIntakeState: input.sourceIntakeState as BulkImportReviewRowDto["sourceIntakeState"],
    normalizationIssues: Array.isArray(input.normalizationIssues)
      ? (input.normalizationIssues as BulkImportReviewRowDto["normalizationIssues"])
      : [],
    errorSummary: typeof input.errorSummary === "string" ? input.errorSummary : null,
    errorCode: typeof input.errorCode === "string" ? input.errorCode : null,
    simulationFailure: Boolean(input.simulationFailure),
    deliveryStatusLabel:
      typeof input.deliveryStatusLabel === "string" ? input.deliveryStatusLabel : undefined,
    deliveryAttempts:
      typeof input.deliveryAttempts === "number" ? input.deliveryAttempts : undefined,
  };
}

function createCorrelationId(): string {
  return `bi-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function validateBulkImportDetailDto(
  input: unknown,
  options?: { requireRows?: boolean }
): BulkImportDetailValidationResult {
  const correlationId = createCorrelationId();
  if (!isRecord(input)) {
    return {
      ok: false,
      message:
        "The action completed, but the returned batch detail was incomplete. Reload this import to continue.",
      correlationId,
      diagnostic: { receivedType: typeof input },
    };
  }

  const batch = input.batch;
  if (!isRecord(batch)) {
    return {
      ok: false,
      message:
        "The action completed, but the returned batch detail was incomplete. Reload this import to continue.",
      correlationId,
      diagnostic: { hasBatch: false },
    };
  }

  const rawRows = Array.isArray(batch.rows) ? batch.rows : [];
  if (options?.requireRows !== false && rawRows.length === 0 && batch.status === "ready_for_review") {
    // allow empty only when batch truly has zero parsed rows
  }

  const invalidRawRows = rawRows.filter(
    (row) => isRecord(row) && isRawDatabaseRow(row)
  );
  if (invalidRawRows.length > 0) {
    return {
      ok: false,
      message:
        "The action completed, but the returned batch detail was incomplete. Reload this import to continue.",
      correlationId,
      diagnostic: {
        invalidRawRowCount: invalidRawRows.length,
        firstInvalidRowKeys: isRecord(invalidRawRows[0])
          ? Object.keys(invalidRawRows[0]).slice(0, 12)
          : [],
      },
    };
  }

  const rows = rawRows
    .filter(isRecord)
    .map((row) => normalizeBulkImportReviewRow(row));

  const summary = isRecord(input.summary) ? input.summary : {};
  const rawNext =
    typeof input.nextStep === "string"
      ? input.nextStep.trim()
      : typeof batch.nextStep === "string"
        ? String(batch.nextStep).trim()
        : "";
  const nextStep = WIZARD_STEPS.has(rawNext as BulkImportWizardStep)
    ? (rawNext as BulkImportWizardStep)
    : undefined;

  const presentedBatch: BulkImportBatchDto = {
    ...batch,
    id: String(batch.id ?? ""),
    fileName: String(batch.fileName ?? ""),
    status: String(batch.status ?? ""),
    mappingJson: isRecord(batch.mappingJson) ? batch.mappingJson : {},
    defaultValuesJson: isRecord(batch.defaultValuesJson) ? batch.defaultValuesJson : {},
    importOptionsJson:
      batch.importOptionsJson == null
        ? null
        : isRecord(batch.importOptionsJson)
          ? batch.importOptionsJson
          : {},
    wizardStepJson: isRecord(batch.wizardStepJson) ? batch.wizardStepJson : {},
    destinationClientAccountId:
      typeof batch.destinationClientAccountId === "string"
        ? batch.destinationClientAccountId
        : null,
    destinationLocationIdGhl:
      typeof batch.destinationLocationIdGhl === "string"
        ? batch.destinationLocationIdGhl
        : null,
    updatedAt: String(batch.updatedAt ?? ""),
    rows,
  };

  return {
    ok: true,
    data: {
      batch: presentedBatch,
      summary,
      deliveryMonitor: isRecord(input.deliveryMonitor)
        ? input.deliveryMonitor
        : null,
      nextStep,
    },
  };
}

export function validateBulkImportMutationResponse(
  input: unknown,
  options?: { requireRows?: boolean }
): BulkImportDetailValidationResult {
  return validateBulkImportDetailDto(input, options);
}

export type BulkImportTransitionDebugInfo = {
  action: string;
  importId: string;
  nextStep?: string;
  batchStatus: string;
  rowCount: number;
  firstRowKeys: string[];
  schemaValid: boolean;
  missingRequiredProperties: string[];
};

export function buildBulkImportTransitionDebugInfo(input: {
  action: string;
  importId: string;
  payload: unknown;
  validation: BulkImportDetailValidationResult;
}): BulkImportTransitionDebugInfo {
  const batch = isRecord(input.payload) && isRecord(input.payload.batch) ? input.payload.batch : {};
  const rows = Array.isArray(batch.rows) ? batch.rows : [];
  const firstRow = isRecord(rows[0]) ? rows[0] : {};
  const missingRequiredProperties: string[] = [];
  if (!Array.isArray(batch.rows)) missingRequiredProperties.push("batch.rows");
  if (isRecord(firstRow) && isRawDatabaseRow(firstRow)) {
    missingRequiredProperties.push("batch.rows[].blockerReasons");
  }

  return {
    action: input.action,
    importId: input.importId,
    nextStep:
      input.validation.ok && input.validation.data.nextStep
        ? input.validation.data.nextStep
        : isRecord(input.payload) && typeof input.payload.nextStep === "string"
          ? input.payload.nextStep
          : undefined,
    batchStatus: String(batch.status ?? ""),
    rowCount: rows.length,
    firstRowKeys: Object.keys(firstRow).slice(0, 12),
    schemaValid: input.validation.ok,
    missingRequiredProperties,
  };
}

export function isBulkImportTransitionDebugEnabled(): boolean {
  return process.env.NEXT_PUBLIC_BULK_IMPORT_TRANSITION_DEBUG === "1";
}

export function expectMutationResponseMatchesDetailContract(
  mutation: BulkImportDetailDto,
  detail: BulkImportDetailDto
) {
  assertBulkImportDetailShape(mutation);
  assertBulkImportDetailShape(detail);
  if (mutation.batch.rows.length !== detail.batch.rows.length) {
    throw new Error("mutation and detail row counts differ");
  }
  if (mutation.batch.status !== detail.batch.status) {
    throw new Error("mutation and detail batch status differ");
  }
}

function assertBulkImportDetailShape(detail: BulkImportDetailDto) {
  if (!Array.isArray(detail.batch.rows)) {
    throw new Error("batch.rows must be an array");
  }
  for (const row of detail.batch.rows) {
    if (!Array.isArray(row.blockerReasons)) {
      throw new Error("row.blockerReasons must be an array");
    }
    if (!Array.isArray(row.duplicateCandidates)) {
      throw new Error("row.duplicateCandidates must be an array");
    }
    if (!Array.isArray(row.normalizationIssues)) {
      throw new Error("row.normalizationIssues must be an array");
    }
  }
}
