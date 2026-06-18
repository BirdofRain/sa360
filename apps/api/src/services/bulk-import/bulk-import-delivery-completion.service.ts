import {
  findBulkLeadImportById,
  listBulkLeadImportRows,
  updateBulkLeadImport,
} from "../../repositories/bulk-lead-import.repository.js";
import { mergeBulkImportWizardStepJson, asWizardStepJson } from "./bulk-import-wizard-metadata.service.js";

export type BulkImportWaveDeliverySummary = {
  status: "completed" | "partial_success" | "failed" | "delivery_running";
  delivered: number;
  failed: number;
  waiting: number;
  delivering: number;
  total: number;
};

export function summarizeApprovedWaveRows(
  rows: Array<{ id: string; deliveryStatus: string; deliveryAttempts?: number }>,
  approvedRowIds: string[]
): BulkImportWaveDeliverySummary {
  const waveRows =
    approvedRowIds.length > 0 ? rows.filter((r) => approvedRowIds.includes(r.id)) : rows;

  const delivered = waveRows.filter((r) => r.deliveryStatus === "delivered").length;
  const failed = waveRows.filter(
    (r) => r.deliveryStatus === "failed" && (r.deliveryAttempts ?? 0) > 0
  ).length;
  const delivering = waveRows.filter((r) => r.deliveryStatus === "delivering").length;
  const waiting = waveRows.filter((r) => r.deliveryStatus === "simulated").length;
  const total = waveRows.length;

  let status: BulkImportWaveDeliverySummary["status"] = "delivery_running";
  if (delivered === total && total > 0 && failed === 0 && delivering === 0 && waiting === 0) {
    status = "completed";
  } else if (delivered === 0 && failed > 0 && delivering === 0 && waiting === 0) {
    status = "failed";
  } else if (delivered > 0 && failed > 0 && delivering === 0 && waiting === 0) {
    status = "partial_success";
  } else if (delivered > 0 && failed === 0 && waiting === 0 && delivering === 0) {
    status = "completed";
  } else if (delivered > 0 && (failed > 0 || waiting > 0 || delivering > 0)) {
    status = waiting === 0 && delivering === 0 ? "partial_success" : "delivery_running";
  }

  return { status, delivered, failed, waiting, delivering, total };
}

export async function recalculateBulkImportDeliveryTotals(batchId: string) {
  const rows = await listBulkLeadImportRows(batchId);
  const deliveredRows = rows.filter((r) => r.deliveryStatus === "delivered").length;
  const failedRows = rows.filter(
    (r) => r.deliveryStatus === "failed" && (r.deliveryAttempts ?? 0) > 0
  ).length;
  return { deliveredRows, failedRows, rows };
}

export async function finalizeBulkImportDeliveryWave(
  batchId: string,
  opts?: { lastWorkerError?: string | null }
) {
  const batch = await findBulkLeadImportById(batchId);
  if (!batch) return null;

  const wizard = asWizardStepJson(batch.wizardStepJson);
  const approvedRowIds =
    ((wizard.deliveryMonitor as { approvedRowIds?: string[] } | undefined)?.approvedRowIds ??
      []) as string[];

  const { rows, deliveredRows, failedRows } = await recalculateBulkImportDeliveryTotals(batchId);
  const summary = summarizeApprovedWaveRows(rows, approvedRowIds);

  const update: Parameters<typeof updateBulkLeadImport>[1] = {
    deliveredRows,
    failedRows,
    wizardStepJson: mergeBulkImportWizardStepJson(batch.wizardStepJson, {
      deliveryMonitor: {
        ...(wizard.deliveryMonitor as object),
        lastActivityAt: new Date().toISOString(),
        lastWorkerError: opts?.lastWorkerError ?? null,
      },
    }),
  };

  if (summary.status === "completed") {
    update.status = "completed";
    update.completedAt = new Date();
    update.wizardStepJson = mergeBulkImportWizardStepJson(update.wizardStepJson, {
      step: "results",
    });
  } else if (summary.status === "partial_success") {
    update.status = "partial_success";
    update.completedAt = new Date();
    update.wizardStepJson = mergeBulkImportWizardStepJson(update.wizardStepJson, {
      step: "results",
    });
  } else if (summary.status === "failed") {
    update.status = "failed";
    update.completedAt = new Date();
  } else {
    update.status = "delivery_running";
  }

  await updateBulkLeadImport(batchId, update);
  return { summary, deliveredRows, failedRows };
}
