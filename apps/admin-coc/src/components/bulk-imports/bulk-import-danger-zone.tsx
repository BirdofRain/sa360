"use client";

import {
  BULK_IMPORT_CANCEL_CONFIRMATION,
  BULK_IMPORT_DELETE_CONFIRMATION,
  BULK_IMPORT_RESET_CONFIRMATION,
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

const RESET_TARGET_LABELS: Record<"mapping" | "destination" | "review", string> = {
  mapping: "Reset to mapping and clear normalized results",
  destination: "Reset to destination",
  review: "Reset to review",
};

const RESET_TARGET_IMPACT: Record<"mapping" | "destination" | "review", string> = {
  mapping:
    "Clears normalized Source Intake records, simulation results, and destination selection. Raw CSV rows are kept.",
  destination:
    "Clears normalized Source Intake records, simulation results, and destination selection. Mapping is kept.",
  review:
    "Clears simulation results only. Mapping, destination, and normalized rows are kept unless you reset further back.",
};

export function BulkImportDangerZone({ importId }: Props) {
  const router = useRouter();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mode, setMode] = useState<"delete" | "cancel" | "reset" | null>(null);
  const [resetTarget, setResetTarget] = useState<"mapping" | "destination" | "review">("mapping");
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

  if (!preview) return null;

  const requiredPhrase =
    mode === "cancel"
      ? BULK_IMPORT_CANCEL_CONFIRMATION
      : mode === "reset"
        ? BULK_IMPORT_RESET_CONFIRMATION
        : BULK_IMPORT_DELETE_CONFIRMATION;

  async function submit() {
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
    } else if (mode === "reset") {
      result = await resetBulkImportAction(importId, resetTarget, confirmation);
    } else {
      setLoading(false);
      return;
    }
    setLoading(false);
    if (!result?.ok) {
      setError(result?.message ?? "Action failed");
      return;
    }

    if (mode === "reset") {
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
      return;
    }

    setSuccess(mode === "cancel" ? "Import cancelled." : "Import reset.");
    setMode(null);
    setConfirmation("");
    dispatchBulkImportUpdated({ importId, reason: mode ?? "update" });
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
      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => setMode("reset")}>
          Restart / reset wizard
        </Button>
        {preview.canHardDelete ? (
          <Button variant="destructive" onClick={() => setMode("delete")}>
            Delete import
          </Button>
        ) : preview.canCancel ? (
          <Button variant="destructive" onClick={() => setMode("cancel")}>
            Cancel import
          </Button>
        ) : null}
      </div>

      <BulkImportConfirmDialog
        open={mode !== null}
        title={
          mode === "delete"
            ? "Delete import"
            : mode === "cancel"
              ? "Cancel import"
              : "Restart / reset wizard"
        }
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
          ) : mode === "cancel" ? (
            <p>Queued delivery will stop. Delivered rows and GHL writes are retained.</p>
          ) : mode === "reset" ? (
            <div className="space-y-3">
              <p>Choose how far back to reset this import in SA360. Nothing in GHL is modified.</p>
              <select
                className="w-full rounded border px-2 py-1 text-sm"
                value={resetTarget}
                onChange={(e) =>
                  setResetTarget(e.target.value as "mapping" | "destination" | "review")
                }
              >
                <option value="mapping">{RESET_TARGET_LABELS.mapping}</option>
                <option value="destination">{RESET_TARGET_LABELS.destination}</option>
                <option value="review">{RESET_TARGET_LABELS.review}</option>
              </select>
              <p className="text-muted-foreground">{RESET_TARGET_IMPACT[resetTarget]}</p>
            </div>
          ) : null
        }
        requiredPhrase={requiredPhrase}
        confirmLabel="Confirm"
        loading={loading}
        loadingLabel="Working…"
        error={error}
        confirmationValue={confirmation}
        onConfirmationChange={setConfirmation}
        destructive
        onCancel={() => {
          if (loading) return;
          setMode(null);
          setConfirmation("");
          setError(null);
        }}
        onConfirm={() => void submit()}
      />
    </div>
  );
}
