"use client";

import { Button } from "@/components/ui/button";

export const SPREADSHEET_DELIVERY_CONFIRM_PHRASE = "MARK SPREADSHEET DELIVERED";

export type MarkSpreadsheetDeliveredDialogProps = {
  open: boolean;
  pending?: boolean;
  clientLabel: string;
  orderNumber: string;
  niche: string;
  bucketLabel: string;
  rowCount: number;
  onCancel: () => void;
  onConfirm: () => void;
};

export function MarkSpreadsheetDeliveredDialog({
  open,
  pending = false,
  clientLabel,
  orderNumber,
  niche,
  bucketLabel,
  rowCount,
  onCancel,
  onConfirm,
}: MarkSpreadsheetDeliveredDialogProps) {
  if (!open) return null;
  const leadWord = rowCount === 1 ? "Lead" : "Leads";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4"
      role="presentation"
      data-testid="mark-delivered-dialog-backdrop"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="mark-delivered-title"
        data-testid="mark-delivered-dialog"
        className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-5 shadow-xl"
      >
        <h2 id="mark-delivered-title" className="text-lg font-semibold text-slate-900">
          Approve &amp; Release
        </h2>
        <dl className="mt-3 grid gap-2 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-slate-500">Client</dt>
            <dd className="font-medium text-slate-900">{clientLabel}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-slate-500">Order</dt>
            <dd className="font-mono font-medium text-slate-900">{orderNumber}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-slate-500">Niche</dt>
            <dd className="font-medium text-slate-900">{niche}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-slate-500">Bucket</dt>
            <dd className="font-medium text-slate-900">{bucketLabel}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-slate-500">CSV rows</dt>
            <dd className="font-medium text-slate-900">{rowCount}</dd>
          </div>
        </dl>
        <p className="mt-4 text-sm text-amber-900">
          Approve &amp; Release makes this generated spreadsheet customer-accessible. It also
          records these identities as delivered to this buyer and excludes them from future orders
          for the same client. Internal download alone does not release the package.
        </p>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" disabled={pending} onClick={onCancel}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={pending}
            data-testid="confirm-delivery-button"
            onClick={onConfirm}
          >
            Approve &amp; Release — {rowCount} {leadWord}
          </Button>
        </div>
      </div>
    </div>
  );
}
