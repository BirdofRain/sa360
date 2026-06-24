"use client";

import { Button } from "@/components/ui/button";
import type { BulkImportReviewRow } from "@/components/bulk-imports/bulk-import-review-table";
import {
  nextUndeliveredCanaryRowId,
  resolveBulkImportCanaryRowStatus,
} from "@/lib/bulk-imports/bulk-import-canary-row-selection";

type RowCheck = {
  rowId: string;
  rowNumber: number;
  matched: boolean;
  reason?: string;
};

type Props = {
  rows: BulkImportReviewRow[];
  rowChecks: RowCheck[];
  selectedRowIds: string[];
  maxSelectable: number;
  onSelectedRowIdsChange: (rowIds: string[]) => void;
};

function statusLabel(status: ReturnType<typeof resolveBulkImportCanaryRowStatus>): string {
  switch (status) {
    case "delivered":
      return "Delivered";
    case "failed_retryable":
      return "Failed (retryable pre-GHL)";
    case "failed_blocked":
      return "Failed (manual review required)";
    case "unmatched":
      return "Routing unmatched";
    case "selectable":
      return "Ready for canary";
    default:
      return "Not eligible";
  }
}

export function BulkImportCanaryRowSelector({
  rows,
  rowChecks,
  selectedRowIds,
  maxSelectable,
  onSelectedRowIdsChange,
}: Props) {
  const checkByRowId = new Map(rowChecks.map((check) => [check.rowId, check]));
  const sortedRows = [...rows].sort((a, b) => a.rowNumber - b.rowNumber);
  const selectedSet = new Set(selectedRowIds);

  function toggleRow(row: BulkImportReviewRow) {
    const check = checkByRowId.get(row.id);
    const status = resolveBulkImportCanaryRowStatus(row, check?.matched);
    if (status !== "selectable" && status !== "failed_retryable") return;

    if (maxSelectable <= 1) {
      onSelectedRowIdsChange([row.id]);
      return;
    }

    if (selectedSet.has(row.id)) {
      onSelectedRowIdsChange(selectedRowIds.filter((id) => id !== row.id));
      return;
    }
    if (selectedRowIds.length >= maxSelectable) return;
    onSelectedRowIdsChange([...selectedRowIds, row.id]);
  }

  const selectedRows = sortedRows.filter((row) => selectedSet.has(row.id));
  const remainingCount = sortedRows.filter((row) => {
    const check = checkByRowId.get(row.id);
    const status = resolveBulkImportCanaryRowStatus(row, check?.matched);
    return (status === "selectable" || status === "failed_retryable") && !selectedSet.has(row.id);
  }).length;

  return (
    <div className="space-y-3 rounded-lg border p-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">Select row(s) for live canary</p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              const nextId = nextUndeliveredCanaryRowId(rows, rowChecks, selectedRowIds[0] ?? null);
              if (nextId) onSelectedRowIdsChange([nextId]);
            }}
          >
            Select next undelivered row
          </Button>
        </div>
      </div>
      <p className="text-muted-foreground">
        Wave max: {maxSelectable} row{maxSelectable === 1 ? "" : "s"}. Selected:{" "}
        {selectedRowIds.length}. Remaining undelivered: {remainingCount}.
      </p>
      {selectedRows.length > 0 ? (
        <div className="rounded-md border bg-muted/20 p-3 space-y-1">
          <p className="font-medium">Selected for canary</p>
          {selectedRows.map((row) => (
            <p key={row.id}>
              Row {row.rowNumber}: {row.name ?? "—"}
              {row.phone ? ` · ${row.phone}` : ""}
              {row.email ? ` · ${row.email}` : ""}
            </p>
          ))}
        </div>
      ) : null}
      <div className="overflow-x-auto rounded-md border">
        <table className="min-w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Select</th>
              <th className="px-3 py-2">Row</th>
              <th className="px-3 py-2">Lead</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Routing</th>
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row) => {
              const check = checkByRowId.get(row.id);
              const status = resolveBulkImportCanaryRowStatus(row, check?.matched);
              const selectable = status === "selectable" || status === "failed_retryable";
              const inputType = maxSelectable <= 1 ? "radio" : "checkbox";
              return (
                <tr key={row.id} className="border-t">
                  <td className="px-3 py-2">
                    <input
                      type={inputType}
                      name="canary-row-selection"
                      checked={selectedSet.has(row.id)}
                      disabled={!selectable}
                      onChange={() => toggleRow(row)}
                    />
                  </td>
                  <td className="px-3 py-2">{row.rowNumber}</td>
                  <td className="px-3 py-2">
                    {row.name ?? "—"}
                    {row.phone ? <span className="block text-xs text-muted-foreground">{row.phone}</span> : null}
                  </td>
                  <td className="px-3 py-2">{statusLabel(status)}</td>
                  <td className="px-3 py-2 text-xs">
                    {check?.matched
                      ? "Matched"
                      : check
                        ? check.reason ?? "Unmatched"
                        : selectable
                          ? "—"
                          : "N/A"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
