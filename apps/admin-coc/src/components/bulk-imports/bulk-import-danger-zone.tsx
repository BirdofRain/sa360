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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

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

const RESET_SUCCESS_LABEL: Record<"mapping" | "destination" | "review", string> = {
  mapping: "Import reset to Mapping.",
  destination: "Import reset to Destination.",
  review: "Import reset to Review.",
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
      setSuccess(RESET_SUCCESS_LABEL[resetTarget]);
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
          Restart / reset
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

      {mode ? (
        <div className="space-y-3 rounded border p-3">
          {mode === "delete" ? (
            <>
              <p className="text-sm font-medium">Delete import</p>
              <ul className="text-sm list-disc pl-5 space-y-1">
                <li>File: {preview.fileName}</li>
                <li>Batch ID: {preview.batchId}</li>
                <li>Total rows: {preview.totalRows}</li>
                <li>SourceLeadEvents to remove: {preview.sourceLeadEventsToRemove}</li>
                <li>Simulation artifacts to remove: {preview.simulationArtifactsToRemove}</li>
                <li>Delivered rows: {preview.deliveredRows}</li>
              </ul>
              <p className="text-sm">
                This removes SA360 import records only. It does not delete anything from GHL.
              </p>
              <p className="text-sm">Type {BULK_IMPORT_DELETE_CONFIRMATION}</p>
            </>
          ) : null}
          {mode === "cancel" ? (
            <>
              <p className="text-sm font-medium">Cancel import</p>
              <p className="text-sm">
                Queued delivery will stop. Delivered rows and GHL writes are retained.
              </p>
              <p className="text-sm">Type {BULK_IMPORT_CANCEL_CONFIRMATION}</p>
            </>
          ) : null}
          {mode === "reset" ? (
            <>
              <p className="text-sm font-medium">Reset import wizard</p>
              <select
                className="rounded border px-2 py-1 text-sm"
                value={resetTarget}
                onChange={(e) =>
                  setResetTarget(e.target.value as "mapping" | "destination" | "review")
                }
              >
                <option value="mapping">Reset to mapping</option>
                <option value="destination">Reset to destination</option>
                <option value="review">Reset to review</option>
              </select>
              <p className="text-sm">Type {BULK_IMPORT_RESET_CONFIRMATION}</p>
            </>
          ) : null}
          <Input value={confirmation} onChange={(e) => setConfirmation(e.target.value)} />
          <div className="flex gap-2">
            <Button
              variant="destructive"
              disabled={loading || confirmation.trim() !== requiredPhrase}
              onClick={() => void submit()}
            >
              Confirm
            </Button>
            <Button variant="outline" onClick={() => setMode(null)}>
              Close
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
