import { findSourceLeadEventById, updateSourceLeadEvent } from "../../repositories/source-lead-event.repository.js";
import { updateBulkLeadImportRow } from "../../repositories/bulk-lead-import.repository.js";
import { approveSourceLeadDelivery } from "../source-intake/source-lead-delivery.service.js";
import { SOURCE_LEAD_APPROVE_DELIVERY_CONFIRMATION } from "../source-intake/source-intake.types.js";

export async function simulateBulkImportRowDelivery(sourceLeadEventId: string) {
  const result = await approveSourceLeadDelivery({
    sourceLeadEventId,
    mode: "simulate",
    operatorConfirmationText: SOURCE_LEAD_APPROVE_DELIVERY_CONFIRMATION,
    approvedBy: "bulk_import_simulation",
  });

  if (!result.ok) {
    return { ok: false as const, reason: result.reason, error: result.error };
  }

  return {
    ok: true as const,
    summary: result.summary,
    deliveryPlanId: result.deliveryPlanId,
    adapterRunId: result.adapterRunId,
  };
}

export async function deliverBulkImportRow(
  sourceLeadEventId: string,
  bulkImportRowId: string,
  approvedBy?: string
) {
  const event = await findSourceLeadEventById(sourceLeadEventId);
  if (!event) return { ok: false as const, reason: "event_not_found" };
  if (event.status === "delivered") {
    return { ok: true as const, skipped: true, reason: "already_delivered" };
  }

  const result = await approveSourceLeadDelivery({
    sourceLeadEventId,
    mode: "live_canary",
    operatorConfirmationText: SOURCE_LEAD_APPROVE_DELIVERY_CONFIRMATION,
    confirmLiveDeliveryRisk: true,
    approvedBy: approvedBy ?? "bulk_import_delivery",
  });

  if (!result.ok) {
    await updateBulkLeadImportRow(bulkImportRowId, {
      deliveryStatus: "failed",
      errorSummary: result.reason,
      deliveryAttempts: { increment: 1 },
      lastDeliveryAt: new Date(),
    });
    return { ok: false as const, reason: result.reason, error: result.error };
  }

  const contactId =
    result.ok && "adapterRunId" in result
      ? ((result as { contactIdGhl?: string }).contactIdGhl ?? null)
      : null;

  await updateBulkLeadImportRow(bulkImportRowId, {
    deliveryStatus: "delivered",
    ghlContactId: contactId,
    deliveryAttempts: { increment: 1 },
    lastDeliveryAt: new Date(),
    errorSummary: null,
  });

  await updateSourceLeadEvent(sourceLeadEventId, {
    status: "delivered",
    deliveredAt: new Date(),
    deliveryResultJson: result as object,
  });

  return { ok: true as const, result };
}

export async function processBulkImportDeliveryChunk(input: {
  batchId: string;
  rowIds: string[];
  approvedBy?: string;
}) {
  const { findBulkLeadImportById, updateBulkLeadImport } = await import(
    "../../repositories/bulk-lead-import.repository.js"
  );
  const batch = await findBulkLeadImportById(input.batchId);
  if (!batch) throw new Error("batch_not_found");
  if (batch.status === "paused") return { ok: false, reason: "paused" };

  await updateBulkLeadImport(input.batchId, {
    status: "delivery_running",
    startedAt: batch.startedAt ?? new Date(),
  });

  let delivered = 0;
  let failed = 0;

  for (const rowId of input.rowIds) {
    const { listBulkLeadImportRows } = await import("../../repositories/bulk-lead-import.repository.js");
    const rows = await listBulkLeadImportRows(input.batchId);
    const row = rows.find((r) => r.id === rowId);
    if (!row?.sourceLeadEventId || row.excluded) continue;

    await updateBulkLeadImportRow(rowId, { deliveryStatus: "delivering" });
    const result = await deliverBulkImportRow(
      row.sourceLeadEventId,
      rowId,
      input.approvedBy
    );
    if (result.ok) delivered++;
    else failed++;
  }

  await updateBulkLeadImport(input.batchId, {
    deliveredRows: { increment: delivered },
    failedRows: { increment: failed },
    status: failed > 0 && delivered === 0 ? "failed" : delivered > 0 ? "partial_success" : "delivery_running",
    completedAt: undefined,
  });

  return { ok: true, delivered, failed };
}
