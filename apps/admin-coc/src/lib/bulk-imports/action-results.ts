export type BulkImportActionResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      status: number;
      error: string;
      message: string;
      data?: unknown;
      impact?: Record<string, unknown>;
    };

const ERROR_MESSAGES: Record<string, string> = {
  simulation_required: "Run a successful simulation before approving delivery.",
  no_eligible_rows: "No successfully simulated eligible rows are available for delivery.",
  no_eligible_rows_for_simulation: "No eligible rows were available for simulation.",
  normalization_incomplete:
    "Eligible identities are missing normalized Source Intake records. Repair or rerun normalization.",
  mapping_confirmation_required:
    "Review and confirm the CSV field mapping before normalization.",
  all_simulations_failed:
    "Simulation failed for all attempted rows. Review the reasons below.",
  mapping_change_requires_reset:
    "Saving these mapping changes requires rebuilding normalized Source Intake records.",
  destination_not_ready: "The selected destination is no longer ready. Review its GHL configuration.",
  destination_not_ready_for_simulation:
    "The selected destination is not ready for simulation. Complete GHL configuration first.",
  oauth_not_connected: "The GHL location is not connected. Reconnect OAuth before continuing.",
  location_not_linked_to_client: "The selected location is not linked to this client account.",
  destination_identity_mismatch:
    "The selected GHL location is linked to a different client account than the one you entered.",
  ghl_connection_not_found: "No GHL OAuth connection exists for the selected location.",
  destination_not_found: "The selected client destination was not found.",
  confirmation_required: "Type the exact approval phrase to confirm delivery.",
  batch_paused: "This import batch is paused. Resume or review before approving.",
  live_canary_preflight_failed: "Live canary preflight failed. Resolve the blockers below before approving.",
  initial_canary_guard_failed:
    "Initial bulk-import live canary requirements were not met. Review the blockers below.",
  queue_enqueue_failed: "Delivery jobs could not be enqueued. Simulation results were preserved.",
  feature_disabled: "Bulk imports are disabled in this environment.",
  delete_confirmation_required: "Type the exact confirmation phrase to continue.",
  bulk_import_not_found: "Bulk import batch was not found.",
  bulk_import_has_delivered_rows: "Delivered rows cannot be removed. Cancel the import instead.",
  bulk_import_delivery_active: "Delivery is active for this batch. Cancel instead of deleting.",
  bulk_import_not_safely_deletable: "This batch cannot be hard-deleted in its current state.",
  bulk_import_already_cancelled: "This import batch is already cancelled.",
  mapping_conflict: "Resolve duplicate canonical mappings before saving.",
  invalid_custom_attribute_key: "Custom attribute key is invalid or reserved.",
};

export function translateBulkImportApiError(error: string, fallback?: string): string {
  return ERROR_MESSAGES[error] ?? fallback ?? `Bulk import request failed (${error}).`;
}

export function parseBulkImportApiFailure(
  status: number,
  body: string
): {
  error: string;
  message: string;
  data?: Record<string, unknown>;
  impact?: Record<string, unknown>;
} {
  try {
    const parsed = JSON.parse(body) as {
      error?: string;
      message?: string;
      blockers?: string[];
      targetRowCount?: number;
      simulatedRows?: number;
      failedRows?: number;
      results?: unknown[];
      batch?: Record<string, unknown>;
      summary?: Record<string, unknown>;
      nextStep?: string;
      mappingChanged?: boolean;
      resetRequired?: boolean;
      sourceLeadEventsToRemove?: number;
      simulationArtifactsToRemove?: number;
      deliveredRows?: number;
      destinationWillBePreserved?: boolean;
      changeSummary?: Record<string, unknown>;
    };
    const error = parsed.error ?? "api_error";
    const impact =
      error === "mapping_change_requires_reset"
        ? {
            mappingChanged: parsed.mappingChanged,
            resetRequired: parsed.resetRequired,
            sourceLeadEventsToRemove: parsed.sourceLeadEventsToRemove,
            simulationArtifactsToRemove: parsed.simulationArtifactsToRemove,
            deliveredRows: parsed.deliveredRows,
            destinationWillBePreserved: parsed.destinationWillBePreserved,
            changeSummary: parsed.changeSummary,
          }
        : undefined;
    const failureData =
      error === "all_simulations_failed" ||
      parsed.results ||
      parsed.batch ||
      parsed.summary ||
      parsed.nextStep
        ? {
            targetRowCount: parsed.targetRowCount,
            simulatedRows: parsed.simulatedRows,
            failedRows: parsed.failedRows,
            results: parsed.results,
            batch: parsed.batch,
            summary: parsed.summary,
            nextStep: parsed.nextStep,
          }
        : undefined;
    return {
      error,
      message:
        parsed.blockers?.length
          ? `${translateBulkImportApiError(error, parsed.message ?? body)} ${parsed.blockers.join(" ")}`
          : translateBulkImportApiError(error, parsed.message ?? body),
      data: failureData,
      impact,
    };
  } catch {
    return {
      error: "api_error",
      message: body.length > 280 ? `${body.slice(0, 280)}…` : body,
    };
  }
}
