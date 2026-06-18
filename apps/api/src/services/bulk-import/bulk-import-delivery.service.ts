import { findSourceLeadEventById, updateSourceLeadEvent } from "../../repositories/source-lead-event.repository.js";
import { updateBulkLeadImportRow } from "../../repositories/bulk-lead-import.repository.js";
import { approveSourceLeadDelivery } from "../source-intake/source-lead-delivery.service.js";
import { SOURCE_LEAD_APPROVE_DELIVERY_CONFIRMATION } from "../source-intake/source-intake.types.js";
import { simulateBulkImportResolvedDestination } from "./bulk-import-simulation.service.js";
import {
  isDirectDemoDestinationAllowed,
  isDirectLiveDeliveryEnvConfigured,
} from "../../lib/direct-demo-delivery-config.js";
import { warmEffectiveDeliveryAdapterMode } from "../delivery-runtime-mode.service.js";
import { finalizeBulkImportDeliveryWave } from "./bulk-import-delivery-completion.service.js";

export async function simulateBulkImportRowDelivery(sourceLeadEventId: string) {
  const event = await findSourceLeadEventById(sourceLeadEventId);
  if (!event?.bulkImportId) {
    return { ok: false as const, reason: "not_bulk_import", error: "not_bulk_import" };
  }

  const result = await simulateBulkImportResolvedDestination(sourceLeadEventId);
  if (!result.ok) {
    return {
      ok: false as const,
      reason: result.reason,
      error: result.error,
      deliveryPlanId: result.deliveryPlanId,
      adapterRunId: result.adapterRunId,
      blockers: result.blockers,
      nextAction: result.nextAction,
      deliveryPlanStatus: result.deliveryPlanStatus,
      adapterSimulationDetail: result.adapterSimulationDetail,
      missingConfigFields: result.missingConfigFields,
      externalCallExecuted: false as const,
    };
  }

  return {
    ok: true as const,
    summary: result.summary,
    deliveryPlanId: result.deliveryPlanId,
    adapterRunId: result.adapterRunId,
    blockers: result.blockers,
    nextAction: result.nextAction,
    deliveryPlanStatus: result.deliveryPlanStatus,
    adapterSimulationDetail: result.adapterSimulationDetail,
    missingConfigFields: result.missingConfigFields,
    externalCallExecuted: false as const,
  };
}

export type BulkImportDeliveryContext = {
  destinationClientAccountId: string;
  destinationLocationIdGhl: string;
};

export async function validateLiveDeliveryDestination(
  event: NonNullable<Awaited<ReturnType<typeof findSourceLeadEventById>>>,
  batchContext: BulkImportDeliveryContext
): Promise<{ ok: true } | { ok: false; reason: string; error: string }> {
  const batchClient = batchContext.destinationClientAccountId.trim();
  const batchLocation = batchContext.destinationLocationIdGhl.trim();
  const eventClient = event.clientAccountIdResolved?.trim() ?? "";
  const eventLocation = event.destinationLocationIdResolved?.trim() ?? "";

  if (eventClient !== batchClient || eventLocation !== batchLocation) {
    return {
      ok: false,
      error: "destination_mismatch",
      reason:
        "Source lead destination does not match the bulk import batch destination.",
    };
  }

  if (!isDirectDemoDestinationAllowed(batchClient, batchLocation)) {
    return {
      ok: false,
      error: "destination_not_allowed",
      reason: "Destination is not on the live delivery allowlist.",
    };
  }

  if (!isDirectLiveDeliveryEnvConfigured()) {
    return {
      ok: false,
      error: "live_allowlist_missing",
      reason: "Explicit live-delivery environment allowlist is missing.",
    };
  }

  const runtime = await warmEffectiveDeliveryAdapterMode();
  if (!runtime.canRunLiveCanary || runtime.effectiveMode !== "live_canary") {
    return {
      ok: false,
      error: "live_runtime_disabled",
      reason: runtime.reason || "Effective runtime mode is not live_canary.",
    };
  }

  return { ok: true };
}

export async function deliverBulkImportRow(
  sourceLeadEventId: string,
  bulkImportRowId: string,
  batchContext: BulkImportDeliveryContext,
  approvedBy?: string
) {
  const event = await findSourceLeadEventById(sourceLeadEventId);
  if (!event) return { ok: false as const, reason: "event_not_found", error: "event_not_found" };

  if (event.status === "delivered") {
    return { ok: true as const, skipped: true, reason: "already_delivered" };
  }

  const destinationCheck = await validateLiveDeliveryDestination(event, batchContext);
  if (!destinationCheck.ok) {
    await updateBulkLeadImportRow(bulkImportRowId, {
      deliveryStatus: "failed",
      errorCode: destinationCheck.error,
      errorSummary: destinationCheck.reason,
      deliveryAttempts: { increment: 1 },
      lastDeliveryAt: new Date(),
    });
    return {
      ok: false as const,
      reason: destinationCheck.reason,
      error: destinationCheck.error,
    };
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
      errorCode: result.error ?? "live_delivery_failed",
      errorSummary: result.reason,
      deliveryAttempts: { increment: 1 },
      lastDeliveryAt: new Date(),
    });
    return { ok: false as const, reason: result.reason, error: result.error };
  }

  const delivery = result as {
    contactIdGhl?: string | null;
    opportunityIdGhl?: string | null;
    liveRunId?: string | null;
    externalCallExecuted?: boolean;
  };

  await updateBulkLeadImportRow(bulkImportRowId, {
    deliveryStatus: "delivered",
    ghlContactId: delivery.contactIdGhl ?? null,
    ghlOpportunityId: delivery.opportunityIdGhl ?? null,
    deliveryAttempts: { increment: 1 },
    lastDeliveryAt: new Date(),
    errorSummary: null,
    errorCode: null,
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
  chunkIndex?: number;
  jobId?: string;
}) {
  const { findBulkLeadImportById, listBulkLeadImportRows } = await import(
    "../../repositories/bulk-lead-import.repository.js"
  );
  const batch = await findBulkLeadImportById(input.batchId);
  if (!batch) throw new Error("batch_not_found");
  if (batch.status === "paused") return { ok: false, reason: "paused" };
  if (batch.status === "cancelled") return { ok: false, reason: "cancelled" };

  if (!batch.destinationClientAccountId || !batch.destinationLocationIdGhl) {
    throw new Error("destination_not_ready");
  }

  const batchContext: BulkImportDeliveryContext = {
    destinationClientAccountId: batch.destinationClientAccountId,
    destinationLocationIdGhl: batch.destinationLocationIdGhl,
  };

  const { updateBulkLeadImport } = await import("../../repositories/bulk-lead-import.repository.js");
  await updateBulkLeadImport(input.batchId, {
    status: "delivery_running",
    startedAt: batch.startedAt ?? new Date(),
  });

  const allRows = await listBulkLeadImportRows(input.batchId);
  let chunkDelivered = 0;
  let chunkFailed = 0;

  for (const rowId of input.rowIds) {
    const row = allRows.find((r) => r.id === rowId);
    if (!row?.sourceLeadEventId || row.excluded) continue;
    if (row.deliveryStatus === "cancelled") continue;
    if (row.deliveryStatus === "delivered") {
      chunkDelivered++;
      continue;
    }

    await updateBulkLeadImportRow(rowId, { deliveryStatus: "delivering" });
    const result = await deliverBulkImportRow(
      row.sourceLeadEventId,
      rowId,
      batchContext,
      input.approvedBy
    );
    if (result.ok) chunkDelivered++;
    else chunkFailed++;
  }

  const finalized = await finalizeBulkImportDeliveryWave(input.batchId);

  return {
    ok: true,
    delivered: chunkDelivered,
    failed: chunkFailed,
    batchStatus: finalized?.summary.status ?? "delivery_running",
    jobId: input.jobId ?? null,
    chunkIndex: input.chunkIndex ?? null,
  };
}
