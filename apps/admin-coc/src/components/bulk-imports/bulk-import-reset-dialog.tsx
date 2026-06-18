"use client";

import { BULK_IMPORT_RESET_CONFIRMATION } from "@sa360/shared";
import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type BulkImportResetTarget = "mapping" | "destination" | "review";

export const RESET_TARGET_LABELS: Record<BulkImportResetTarget, string> = {
  mapping: "Reset to mapping and clear normalized results",
  destination: "Reset to destination",
  review: "Reset to review",
};

export const RESET_TARGET_IMPACT: Record<BulkImportResetTarget, string> = {
  mapping:
    "Clears normalized Source Intake records, simulation results, and destination selection. Raw CSV rows are kept.",
  destination:
    "Clears normalized Source Intake records, simulation results, and destination selection. Mapping is kept.",
  review:
    "Clears simulation results only. Mapping, destination, and normalized rows are kept unless you reset further back.",
};

export type BulkImportResetDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  importId: string;
  resetTarget: BulkImportResetTarget;
  onResetTargetChange: (target: BulkImportResetTarget) => void;
  confirmation: string;
  onConfirmationChange: (value: string) => void;
  loading: boolean;
  error: string | null;
  onConfirm: () => void;
};

export function BulkImportResetDialog({
  open,
  onOpenChange,
  importId,
  resetTarget,
  onResetTargetChange,
  confirmation,
  onConfirmationChange,
  loading,
  error,
  onConfirm,
}: BulkImportResetDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const confirmationInputRef = useRef<HTMLInputElement>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const lastFocusedRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);
  const prevOpenRef = useRef(false);
  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;

  const phraseValid = confirmation.trim() === BULK_IMPORT_RESET_CONFIRMATION;
  const phraseMismatch =
    confirmation.trim().length > 0 && confirmation.trim() !== BULK_IMPORT_RESET_CONFIRMATION;

  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false;
      return;
    }
    if (wasOpenRef.current) return;
    wasOpenRef.current = true;
    lastFocusedRef.current = document.activeElement as HTMLElement | null;
    confirmationInputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (prevOpenRef.current && !open) {
      lastFocusedRef.current?.focus();
      lastFocusedRef.current = null;
    }
    prevOpenRef.current = open;
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !loading) {
        event.preventDefault();
        onOpenChangeRef.current(false);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, loading]);

  function handleResetTargetChange(nextTarget: BulkImportResetTarget) {
    onResetTargetChange(nextTarget);
    onConfirmationChange("");
  }

  function handleConfirmationKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (!loading && phraseValid) {
      onConfirm();
    }
  }

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="presentation"
      data-testid="bulk-import-reset-dialog"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !loading) onOpenChange(false);
      }}
    >
      <div className="absolute inset-0 bg-black/40" aria-hidden />
      <div
        data-import-id={importId}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="relative z-10 flex w-full flex-col rounded-lg border bg-background shadow-lg"
        style={{
          width: "min(640px, calc(100vw - 32px))",
          maxHeight: "calc(100vh - 48px)",
        }}
      >
        <div className="border-b px-4 py-3">
          <h2 id={titleId} className="text-lg font-semibold break-words">
            Restart / reset wizard
          </h2>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3 text-sm">
          <div id={descriptionId} className="space-y-3">
            <p>Choose how far back to reset this import in SA360. Nothing in GHL is modified.</p>
            <select
              data-testid="bulk-import-reset-target"
              className="w-full rounded border px-2 py-1 text-sm"
              value={resetTarget}
              disabled={loading}
              onChange={(e) =>
                handleResetTargetChange(e.target.value as BulkImportResetTarget)
              }
            >
              <option value="mapping">{RESET_TARGET_LABELS.mapping}</option>
              <option value="destination">{RESET_TARGET_LABELS.destination}</option>
              <option value="review">{RESET_TARGET_LABELS.review}</option>
            </select>
            <p className="text-muted-foreground break-words">{RESET_TARGET_IMPACT[resetTarget]}</p>
          </div>
          <div className="space-y-2">
            <p>
              Type{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs break-all">
                {BULK_IMPORT_RESET_CONFIRMATION}
              </code>{" "}
              to confirm (case-sensitive).
            </p>
            <Input
              ref={confirmationInputRef}
              data-testid="bulk-import-reset-confirmation"
              className="w-full"
              type="text"
              value={confirmation}
              disabled={loading}
              onChange={(e) => onConfirmationChange(e.target.value)}
              onKeyDown={handleConfirmationKeyDown}
              placeholder={BULK_IMPORT_RESET_CONFIRMATION}
            />
            {phraseMismatch ? (
              <p className="text-destructive text-xs">Confirmation phrase does not match.</p>
            ) : null}
          </div>
          {error ? <p className="text-destructive break-words">{error}</p> : null}
        </div>
        <div className="flex flex-wrap justify-end gap-2 border-t px-4 py-3">
          <Button
            type="button"
            variant="outline"
            disabled={loading}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            ref={confirmButtonRef}
            type="button"
            variant="destructive"
            disabled={loading || !phraseValid}
            onClick={onConfirm}
          >
            {loading ? "Resetting…" : "Confirm"}
          </Button>
        </div>
      </div>
    </div>,
    document.body
  );
}
