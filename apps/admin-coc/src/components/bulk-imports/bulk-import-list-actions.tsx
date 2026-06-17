"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  BULK_IMPORT_CANCEL_CONFIRMATION,
  BULK_IMPORT_DELETE_CONFIRMATION,
  BULK_IMPORT_RESET_CONFIRMATION,
} from "@sa360/shared";
import {
  cancelBulkImportAction,
  deleteBulkImportAction,
  exportBulkImportResultsAction,
  resetBulkImportAction,
} from "@/app/actions/bulk-imports";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";

type Props = {
  importId: string;
  fileName: string;
  status: string;
  canHardDelete?: boolean;
  canCancel?: boolean;
};

export function BulkImportListActions({
  importId,
  fileName,
  status,
  canHardDelete,
  canCancel,
}: Props) {
  const router = useRouter();
  const [dialog, setDialog] = useState<"delete" | "cancel" | "reset" | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function runAction() {
    setError(null);
    if (dialog === "delete") {
      const result = await deleteBulkImportAction(importId, confirmation);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      router.push("/source-intake/imports?deleted=1");
      return;
    }
    if (dialog === "cancel") {
      const result = await cancelBulkImportAction(importId, confirmation);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setDialog(null);
      router.refresh();
      return;
    }
    if (dialog === "reset") {
      const result = await resetBulkImportAction(importId, "mapping", confirmation);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setDialog(null);
      router.push(`/source-intake/imports/${importId}`);
    }
  }

  async function handleExport() {
    const result = await exportBulkImportResultsAction(importId);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    const blob = new Blob([result.data.csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${fileName.replace(/\.csv$/i, "")}-results.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const phrase =
    dialog === "cancel"
      ? BULK_IMPORT_CANCEL_CONFIRMATION
      : dialog === "reset"
        ? BULK_IMPORT_RESET_CONFIRMATION
        : BULK_IMPORT_DELETE_CONFIRMATION;

  const showDelete = canHardDelete ?? ["uploaded", "mapping_required", "ready_for_review", "failed", "cancelled"].includes(status);
  const showCancel = canCancel ?? ["approved_for_delivery", "delivery_running", "paused", "partial_success"].includes(status);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="outline" size="sm" />}
        >
          Actions
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onClick={() => router.push(`/source-intake/imports/${importId}`)}
          >
            Open
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setDialog("reset")}>Restart</DropdownMenuItem>
          {showCancel ? (
            <DropdownMenuItem onClick={() => setDialog("cancel")}>Cancel</DropdownMenuItem>
          ) : null}
          {showDelete && !showCancel ? (
            <DropdownMenuItem onClick={() => setDialog("delete")}>Delete</DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onClick={() => void handleExport()}>Export results</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {dialog ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-lg border bg-background p-4 space-y-3">
            <p className="font-medium capitalize">{dialog} import</p>
            {dialog === "delete" ? (
              <p className="text-sm">
                This removes SA360 import records only. It does not delete anything from GHL.
              </p>
            ) : null}
            <p className="text-sm">Type {phrase}</p>
            <Input value={confirmation} onChange={(e) => setConfirmation(e.target.value)} />
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDialog(null)}>
                Close
              </Button>
              <Button
                variant="destructive"
                disabled={confirmation.trim() !== phrase}
                onClick={() => void runAction()}
              >
                Confirm
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
