import type { BulkImportWizardStep } from "./types";

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

export type ValidatedDestinationSavePayload = {
  batch: Record<string, unknown>;
  summary: Record<string, unknown>;
  rows: Record<string, unknown>[];
  nextStep: BulkImportWizardStep;
};

export type DestinationSaveValidationResult =
  | { ok: true; data: ValidatedDestinationSavePayload }
  | { ok: false; message: string; diagnostic?: Record<string, unknown> };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function validateDestinationSaveResponse(
  data: unknown
): DestinationSaveValidationResult {
  if (!isRecord(data)) {
    return {
      ok: false,
      message: "Destination save returned an empty response.",
      diagnostic: { receivedType: typeof data },
    };
  }

  const batch = data.batch;
  if (!isRecord(batch)) {
    return {
      ok: false,
      message: "Destination save response did not include a batch.",
      diagnostic: { hasBatch: false, nextStep: data.nextStep },
    };
  }

  const summary = isRecord(data.summary) ? data.summary : {};
  const rows = Array.isArray(batch.rows)
    ? batch.rows.filter(isRecord)
    : Array.isArray(data.rows)
      ? data.rows.filter(isRecord)
      : [];

  const rawNext = typeof data.nextStep === "string" ? data.nextStep.trim() : "";
  const nextStep = WIZARD_STEPS.has(rawNext as BulkImportWizardStep)
    ? (rawNext as BulkImportWizardStep)
    : "review";

  return {
    ok: true,
    data: {
      batch: { ...batch, rows },
      summary,
      rows,
      nextStep,
    },
  };
}
