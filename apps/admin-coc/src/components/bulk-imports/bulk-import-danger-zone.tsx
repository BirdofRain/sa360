"use client";

import {
  BULK_IMPORT_CANCEL_CONFIRMATION,
  BULK_IMPORT_DELETE_CONFIRMATION,
} from "@sa360/shared";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  cancelBulkImportAction,
  deleteBulkImportAction,
  fetchBulkImportDeletePreview,
  resetBulkImportAction,
} from "@/app/actions/bulk-imports";
import {
  BULK_IMPORT_UPDATED_EVENT,
  dispatchBulkImportUpdated,
  resetTargetToWizardStep,
} from "@/lib/bulk-imports/bulk-import-events";
import { BulkImportConfirmDialog } from "@/components/bulk-imports/bulk-import-confirm-dialog";
import {
  BulkImportResetDialog,
  RESET_TARGET_LABELS,
  type BulkImportResetTarget,
} from "@/components/bulk-imports/bulk-import-reset-dialog";
import { Button } from "@/components/ui/button";

type Preview = {
  fileName: string;
  batchId: string;
  totalRows: number;
  sourceLeadEventsToRemove: number;
  simulationArtifactsToRemove: number;
  deliveredRows: number;
  canHardDelete: boolean;
  canCancel: boolean;
  status: string;
};

type Props = {
  importId: string;
};

export function BulkImportDangerZone({ importId }: Props) {
  const router = useRouter();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mode, setMode] = useState<"delete" | "cancel" | "reset" | null>(null);
  const [resetTarget, setResetTarget] = useState<BulkImportResetTarget>("mapping");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const loadPreview = useCallback(async () => {
    const result = await fetchBulkImportDeletePreview(importId);
    if (result.ok) setPreview(result.data.preview as Preview);
  }, [importId]);

  useEffect(() => {
    void loadPreview();
  }, [loadPreview]);

  useEffect(() => {
    function onUpdated(event: Event) {
      const detail = (event as CustomEvent<{ importId: string }>).detail;
      if (detail.importId === importId) void loadPreview();
    }
    window.addEventListener(BULK_IMPORT_UPDATED_EVENT, onUpdated);
    return () => window.removeEventListener(BULK_IMPORT_UPDATED_EVENT, onUpdated);
  }, [importId, loadPreview]);

  const closeDialog = useCallback(() => {
    if (loading) return;
    setMode(null);
    setConfirmation("");
    setError(null);
  }, [loading]);

  const closeResetDialog = useCallback(
    (open: boolean) => {
      if (open || loading) return;
      setMode(null);
      setConfirmation("");
      setError(null);
    },
    [loading]
  );

  if (!preview) return null;

  const requiredPhrase =
    mode === "cancel" ? BULK_IMPORT_CANCEL_CONFIRMATION : BULK_IMPORT_DELETE_CONFIRMATION;

  async function submitDeleteOrCancel() {
    setLoading(true);
    setError(null);
    setSuccess(null);
    let result;
    if (mode === "delete") {
      result = await deleteBulkImportAction(importId, confirmation);
      if (result.ok) {
        router.push("/source-intake/imports?deleted=1");
        return;
      }
    } else if (mode === "cancel") {
      result = await cancelBulkImportAction(importId, confirmation);
    } else {
      setLoading(false);
      return;
    }
    setLoading(false);
    if (!result?.ok) {
      setError(result?.message ?? "Action failed");
      return;
    }

    setSuccess(mode === "cancel" ? "Import cancelled." : "Import reset.");
    setMode(null);
    setConfirmation("");
    dispatchBulkImportUpdated({ importId, reason: mode ?? "update" });
    router.refresh();
    await loadPreview();
  }

  async function submitReset() {
    setLoading(true);
    setError(null);
    setSuccess(null);
    const result = await resetBulkImportAction(importId, resetTarget, confirmation);
    setLoading(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }

    const wizardStep = resetTargetToWizardStep(resetTarget);
    dispatchBulkImportUpdated({
      importId,
      reason: "reset",
      requestedStep: wizardStep,
    });
    setSuccess(RESET_TARGET_LABELS[resetTarget] + " Completed.");
    setMode(null);
    setConfirmation("");
    router.push(`/source-intake/imports/${importId}?step=${wizardStep}`);
    router.refresh();
    await loadPreview();
  }

  return (
    <div className="rounded-lg border border-destructive/40 p-4 space-y-4">
      <h2 className="text-lg font-semibold text-destructive">Danger zone</h2>
      <p className="text-sm text-muted-foreground">
        Cleanup actions affect SA360 import records only. Nothing in GHL is deleted or modified.
      </p>
      {success ? <p className="text-sm text-green-700">{success}</p> : null}
      {error && mode === null ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={() => setMode("reset")}>
          Restart / reset wizard
        </Button>
        {preview.canHardDelete ? (
          <Button type="button" variant="destructive" onClick={() => setMode("delete")}>
            Delete import
          </Button>
        ) : preview.canCancel ? (
          <Button type="button" variant="destructive" onClick={() => setMode("cancel")}>
            Cancel import
          </Button>
        ) : null}
      </div>

      <BulkImportResetDialog
        open={mode === "reset"}
        onOpenChange={closeResetDialog}
        importId={importId}
        resetTarget={resetTarget}
        onResetTargetChange={setResetTarget}
        confirmation={confirmation}
        onConfirmationChange={setConfirmation}
        loading={loading}
        error={error}
        onConfirm={() => void submitReset()}
      />

      <BulkImportConfirmDialog
        open={mode === "delete" || mode === "cancel"}
        title={mode === "delete" ? "Delete import" : "Cancel import"}
        description={
          mode === "delete" ? (
            <div className="space-y-2">
              <p>This removes SA360 import records only. It does not delete anything from GHL.</p>
              <ul className="list-disc pl-5 space-y-1">
                <li>File: {preview.fileName}</li>
                <li>Batch ID: {preview.batchId}</li>
                <li>Total rows: {preview.totalRows}</li>
                <li>SourceLeadEvents to remove: {preview.sourceLeadEventsToRemove}</li>
                <li>Simulation artifacts to remove: {preview.simulationArtifactsToRemove}</li>
                <li>Delivered rows: {preview.deliveredRows}</li>
              </ul>
            </div>
          ) : (
            <p>Queued delivery will stop. Delivered rows and GHL writes are retained.</p>
          )
        }
        requiredPhrase={requiredPhrase}
        confirmLabel="Confirm"
        loading={loading}
        loadingLabel="Working…"
        error={error}
        confirmationValue={confirmation}
        onConfirmationChange={setConfirmation}
        destructive
        onCancel={closeDialog}
        onConfirm={() => void submitDeleteOrCancel()}
      />
    </div>
  );
}
