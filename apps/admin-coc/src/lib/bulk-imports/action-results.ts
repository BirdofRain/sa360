export type BulkImportActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string; message: string };

const ERROR_MESSAGES: Record<string, string> = {
  simulation_required: "Run a successful simulation before approving delivery.",
  no_eligible_rows: "No successfully simulated eligible rows are available for delivery.",
  no_eligible_rows_for_simulation: "No eligible rows were available for simulation.",
  destination_not_ready: "The selected destination is no longer ready. Review its GHL configuration.",
  destination_not_ready_for_simulation:
    "The selected destination is not ready for simulation. Complete GHL configuration first.",
  oauth_not_connected: "The GHL location is not connected. Reconnect OAuth before continuing.",
  location_not_linked_to_client: "The selected location is not linked to this client account.",
  destination_not_found: "The selected client destination was not found.",
  confirmation_required: "Type the exact approval phrase to confirm delivery.",
  batch_paused: "This import batch is paused. Resume or review before approving.",
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
): { error: string; message: string } {
  try {
    const parsed = JSON.parse(body) as { error?: string; message?: string };
    const error = parsed.error ?? "api_error";
    return {
      error,
      message: translateBulkImportApiError(error, parsed.message ?? body),
    };
  } catch {
    return {
      error: "api_error",
      message: body.length > 280 ? `${body.slice(0, 280)}…` : body,
    };
  }
}
