"use client";

import { BULK_IMPORT_RESET_CONFIRMATION } from "@sa360/shared";
import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type BulkImportConfirmDialogProps = {
  open: boolean;
  title: string;
  description: React.ReactNode;
  details?: React.ReactNode;
  requiredPhrase?: string;
  confirmLabel: string;
  cancelLabel?: string;
  loading?: boolean;
  loadingLabel?: string;
  error?: string | null;
  confirmationValue: string;
  onConfirmationChange: (value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
  destructive?: boolean;
};

export function BulkImportConfirmDialog({
  open,
  title,
  description,
  details,
  requiredPhrase,
  confirmLabel,
  cancelLabel = "Cancel",
  loading = false,
  loadingLabel = "Working…",
  error,
  confirmationValue,
  onConfirmationChange,
  onConfirm,
  onCancel,
  destructive = false,
}: BulkImportConfirmDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const confirmationInputRef = useRef<HTMLInputElement>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const lastFocusedRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);
  const prevOpenRef = useRef(false);
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;

  const phraseRequired = Boolean(requiredPhrase);
  const phraseValid =
    !phraseRequired || confirmationValue.trim() === requiredPhrase?.trim();
  const phraseMismatch =
    phraseRequired &&
    confirmationValue.trim().length > 0 &&
    confirmationValue.trim() !== requiredPhrase?.trim();

  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false;
      return;
    }
    if (wasOpenRef.current) return;
    wasOpenRef.current = true;
    lastFocusedRef.current = document.activeElement as HTMLElement | null;
    if (phraseRequired) {
      confirmationInputRef.current?.focus();
    } else {
      confirmButtonRef.current?.focus();
    }
  }, [open, phraseRequired]);

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
        onCancelRef.current();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, loading]);

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
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !loading) onCancel();
      }}
    >
      <div className="absolute inset-0 bg-black/40" aria-hidden />
      <div
        id={`bulk-import-dialog-${titleId}`}
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
            {title}
          </h2>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3 text-sm">
          <div id={descriptionId}>{description}</div>
          {details ? <div className="rounded-md border bg-muted/20 p-3 space-y-1">{details}</div> : null}
          {requiredPhrase ? (
            <div className="space-y-2">
              <p>
                Type{" "}
                <code className="rounded bg-muted px-1 py-0.5 text-xs break-all">
                  {requiredPhrase}
                </code>{" "}
                to confirm (case-sensitive).
              </p>
              <Input
                ref={confirmationInputRef}
                data-testid="bulk-import-confirm-phrase"
                className="w-full"
                type="text"
                value={confirmationValue}
                disabled={loading}
                onChange={(e) => onConfirmationChange(e.target.value)}
                onKeyDown={handleConfirmationKeyDown}
                placeholder={requiredPhrase}
              />
              {phraseMismatch ? (
                <p className="text-destructive text-xs">Confirmation phrase does not match.</p>
              ) : null}
            </div>
          ) : null}
          {error ? <p className="text-destructive break-words">{error}</p> : null}
        </div>
        <div className="flex flex-wrap justify-end gap-2 border-t px-4 py-3">
          <Button type="button" variant="outline" disabled={loading} onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button
            ref={confirmButtonRef}
            type="button"
            variant={destructive ? "destructive" : "default"}
            disabled={loading || (phraseRequired && !phraseValid)}
            onClick={onConfirm}
          >
            {loading ? loadingLabel : confirmLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body
  );
}

export { BULK_IMPORT_RESET_CONFIRMATION };
