export const BULK_IMPORT_UPDATED_EVENT = "sa360:bulk-import-updated";

export type BulkImportUpdatedDetail = {
  importId: string;
  reason: string;
  requestedStep?: string;
};

export function dispatchBulkImportUpdated(detail: BulkImportUpdatedDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(BULK_IMPORT_UPDATED_EVENT, { detail }));
}

export function resetTargetToWizardStep(
  target: "mapping" | "destination" | "review"
): "map" | "destination" | "review" {
  if (target === "mapping") return "map";
  return target;
}
