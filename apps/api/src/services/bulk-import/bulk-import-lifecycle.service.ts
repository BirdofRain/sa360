import type { BulkLeadImportStatus } from "@prisma/client";
import {
  BULK_IMPORT_CANCEL_CONFIRMATION,
  BULK_IMPORT_DELETE_CONFIRMATION,
  BULK_IMPORT_RESET_CONFIRMATION,
} from "@sa360/shared";
import { prisma } from "../../lib/db.js";
import {
  findBulkLeadImportById,
  findBulkLeadImportWithRows,
  updateBulkLeadImport,
} from "../../repositories/bulk-lead-import.repository.js";
import { deleteSourceLeadEventsByBulkImportId } from "../../repositories/source-lead-event.repository.js";
import { listMissingRequiredMappings } from "./csv-import-mapping.service.js";
import type { ImportFieldMapping } from "./bulk-import.types.js";

const SAFE_DELETE_STATUSES = new Set<BulkLeadImportStatus>([
  "uploaded",
  "parsing",
  "mapping_required",
  "ready_for_review",
  "ready_for_simulation",
  "simulation_running",
  "simulation_complete",
  "failed",
  "cancelled",
]);

export type BulkImportResetTarget = "mapping" | "destination" | "review";

export async function assertBulkImportHasNoDeliveredRows(batchId: string) {
  const batch = await findBulkLeadImportWithRows(batchId);
  if (!batch) throw new Error("bulk_import_not_found");

  const delivered = batch.rows.some(
    (r) => r.deliveryStatus === "delivered" || Boolean(r.ghlContactId?.trim())
  );
  if (delivered) throw new Error("bulk_import_has_delivered_rows");
  return batch;
}

async function assertNoActiveDelivery(batchId: string) {
  const { hasActiveBulkImportDeliveryJobs } = await import("./bulk-import-queue.service.js");
  if (await hasActiveBulkImportDeliveryJobs(batchId)) {
    throw new Error("bulk_import_delivery_active");
  }
}

async function removeWaitingJobs(batchId: string) {
  const { removeWaitingBulkImportDeliveryJobs } = await import("./bulk-import-queue.service.js");
  return removeWaitingBulkImportDeliveryJobs(batchId);
}

export async function deleteBulkImportBatch(
  batchId: string,
  confirmationText: string
): Promise<{ ok: true; deletedId: string; sourceLeadEventsRemoved: number }> {
  if (confirmationText.trim() !== BULK_IMPORT_DELETE_CONFIRMATION) {
    throw new Error("delete_confirmation_required");
  }

  const batch = await findBulkLeadImportWithRows(batchId);
  if (!batch) throw new Error("bulk_import_not_found");
  if (batch.status === "cancelled") throw new Error("bulk_import_already_cancelled");

  const hasDelivered = batch.rows.some(
    (r) => r.deliveryStatus === "delivered" || Boolean(r.ghlContactId?.trim())
  );
  if (hasDelivered) throw new Error("bulk_import_has_delivered_rows");

  if (!SAFE_DELETE_STATUSES.has(batch.status)) {
    throw new Error("bulk_import_not_safely_deletable");
  }

  await assertNoActiveDelivery(batchId);
  await removeWaitingJobs(batchId);

  const sourceLeadEventsRemoved = await prisma.$transaction(async (tx) => {
    const current = await tx.bulkLeadImport.findUnique({ where: { id: batchId } });
    if (!current) throw new Error("bulk_import_not_found");
    if (!SAFE_DELETE_STATUSES.has(current.status)) {
      throw new Error("bulk_import_not_safely_deletable");
    }

    const removed = await deleteSourceLeadEventsByBulkImportId(batchId, tx);
    await tx.bulkLeadImport.delete({ where: { id: batchId } });
    return removed;
  });

  return { ok: true, deletedId: batchId, sourceLeadEventsRemoved };
}

export async function cancelBulkImportBatch(
  batchId: string,
  confirmationText: string
): Promise<{ ok: true; batchId: string; cancelledRows: number }> {
  if (confirmationText.trim() !== BULK_IMPORT_CANCEL_CONFIRMATION) {
    throw new Error("delete_confirmation_required");
  }

  const batch = await findBulkLeadImportWithRows(batchId);
  if (!batch) throw new Error("bulk_import_not_found");
  if (batch.status === "cancelled") throw new Error("bulk_import_already_cancelled");

  await removeWaitingJobs(batchId);

  let cancelledRows = 0;
  await prisma.$transaction(async (tx) => {
    const current = await tx.bulkLeadImport.findUnique({ where: { id: batchId } });
    if (!current) throw new Error("bulk_import_not_found");
    if (current.status === "cancelled") throw new Error("bulk_import_already_cancelled");

    const updateResult = await tx.bulkLeadImportRow.updateMany({
      where: {
        bulkImportId: batchId,
        deliveryStatus: { notIn: ["delivered"] },
      },
      data: {
        deliveryStatus: "cancelled",
      },
    });
    cancelledRows = updateResult.count;

    await tx.bulkLeadImport.update({
      where: { id: batchId },
      data: {
        status: "cancelled",
        pausedAt: new Date(),
        completedAt: new Date(),
        wizardStepJson: {
          step: "results",
          cancelled: true,
        },
      },
    });
  });

  return { ok: true, batchId, cancelledRows };
}

async function clearNormalizationState(batchId: string, opts?: { clearDestination?: boolean }) {
  await prisma.bulkLeadImportRow.updateMany({
    where: { bulkImportId: batchId },
    data: {
      sourceLeadId: null,
      sourceLeadIdGenerated: false,
      normalizedPhone: null,
      normalizedEmail: null,
      sourceLeadEventId: null,
      validationStatus: "pending",
      duplicateStatus: "none",
      deliveryStatus: "pending",
      errorSummary: null,
      blockerReasonsJson: [],
      duplicateCandidatesJson: [],
      ghlContactId: null,
      ghlOpportunityId: null,
      deliveryAttempts: 0,
      lastDeliveryAt: null,
    },
  });

  await updateBulkLeadImport(batchId, {
    validRows: 0,
    blockedRows: 0,
    duplicateRows: 0,
    reviewRows: 0,
    simulatedRows: 0,
    deliveredRows: 0,
    failedRows: 0,
    status: opts?.clearDestination ? "mapping_required" : "ready_for_review",
    ...(opts?.clearDestination
      ? {
          destinationClientAccountId: null,
          destinationLocationIdGhl: null,
        }
      : {}),
  });
}

export async function resetBulkImportBatch(
  batchId: string,
  target: BulkImportResetTarget,
  confirmationText: string
): Promise<{ ok: true; batchId: string; target: BulkImportResetTarget }> {
  if (confirmationText.trim() !== BULK_IMPORT_RESET_CONFIRMATION) {
    throw new Error("delete_confirmation_required");
  }

  await assertBulkImportHasNoDeliveredRows(batchId);
  await assertNoActiveDelivery(batchId);
  await removeWaitingJobs(batchId);

  await prisma.$transaction(async (tx) => {
    const current = await tx.bulkLeadImport.findUnique({ where: { id: batchId } });
    if (!current) throw new Error("bulk_import_not_found");
    if (current.status === "cancelled") throw new Error("bulk_import_already_cancelled");

    await deleteSourceLeadEventsByBulkImportId(batchId, tx);
  });

  if (target === "mapping") {
    await clearNormalizationState(batchId, { clearDestination: true });
    const current = await findBulkLeadImportById(batchId);
    const mapping = (current?.mappingJson ?? {}) as ImportFieldMapping;
    const missingRequired = listMissingRequiredMappings(mapping);
    await updateBulkLeadImport(batchId, {
      wizardStepJson: {
        ...((current?.wizardStepJson as object) ?? {}),
        step: "map",
        missingRequired,
      },
      status: "mapping_required",
    });
  } else if (target === "destination") {
    await clearNormalizationState(batchId, { clearDestination: true });
    const current = await findBulkLeadImportById(batchId);
    await updateBulkLeadImport(batchId, {
      wizardStepJson: {
        ...((current?.wizardStepJson as object) ?? {}),
        step: "destination",
      },
      status: "ready_for_review",
    });
  } else {
    await prisma.bulkLeadImportRow.updateMany({
      where: {
        bulkImportId: batchId,
        deliveryStatus: { in: ["simulated", "pending"] },
      },
      data: {
        deliveryStatus: "pending",
      },
    });
    await updateBulkLeadImport(batchId, {
      simulatedRows: 0,
      status: "ready_for_review",
      wizardStepJson: {
        ...((await findBulkLeadImportById(batchId))?.wizardStepJson as object) ?? {},
        step: "review",
      },
    });
  }

  return { ok: true, batchId, target };
}

export async function setBulkImportWizardStep(batchId: string, step: string) {
  const batch = await findBulkLeadImportById(batchId);
  if (!batch) throw new Error("bulk_import_not_found");
  if (batch.status === "cancelled") throw new Error("bulk_import_already_cancelled");

  return updateBulkLeadImport(batchId, {
    wizardStepJson: {
      ...(batch.wizardStepJson as object),
      step,
    },
  });
}

export async function getBulkImportDeletePreview(batchId: string) {
  const batch = await findBulkLeadImportWithRows(batchId);
  if (!batch) throw new Error("bulk_import_not_found");

  const sourceLeadEventIds = batch.rows
    .map((r) => r.sourceLeadEventId)
    .filter((id): id is string => Boolean(id));
  const deliveredRows = batch.rows.filter((r) => r.deliveryStatus === "delivered").length;
  const canHardDelete =
    SAFE_DELETE_STATUSES.has(batch.status) &&
    deliveredRows === 0 &&
    !batch.rows.some((r) => r.ghlContactId);

  return {
    batchId: batch.id,
    fileName: batch.fileName,
    status: batch.status,
    totalRows: batch.totalRows,
    sourceLeadEventsToRemove: sourceLeadEventIds.length,
    simulationArtifactsToRemove: batch.simulatedRows ?? 0,
    deliveredRows,
    canHardDelete,
    canCancel: !canHardDelete && batch.status !== "cancelled",
  };
}
