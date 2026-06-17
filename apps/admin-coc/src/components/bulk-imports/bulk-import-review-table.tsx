"use client";

import { useMemo, useState } from "react";

export type BulkImportReviewRow = {
  id: string;
  rowNumber: number;
  name: string | null;
  phone: string | null;
  email: string | null;
  validationStatus: string;
  duplicateStatus: string;
  deliveryStatus: string;
  blockerReasons: string[];
  unmappedFieldCount: number;
  excluded: boolean;
};

type RowFilter =
  | "all"
  | "eligible"
  | "identity_blocked"
  | "duplicate_review"
  | "mapping_required"
  | "excluded";

export function BulkImportReviewTable({ rows }: { rows: BulkImportReviewRow[] }) {
  const [filter, setFilter] = useState<RowFilter>("all");

  const filtered = useMemo(() => {
    switch (filter) {
      case "eligible":
        return rows.filter(
          (r) => r.validationStatus === "eligible" || r.validationStatus === "ready_for_simulation"
        );
      case "identity_blocked":
        return rows.filter((r) => r.validationStatus === "identity_blocked");
      case "duplicate_review":
        return rows.filter((r) => r.validationStatus === "duplicate_review");
      case "mapping_required":
        return rows.filter((r) => r.validationStatus === "mapping_required");
      case "excluded":
        return rows.filter((r) => r.excluded);
      default:
        return rows;
    }
  }, [filter, rows]);

  const eligibleCount = rows.filter(
    (r) =>
      !r.excluded &&
      (r.validationStatus === "eligible" || r.validationStatus === "ready_for_simulation")
  ).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">{eligibleCount} row(s) eligible for simulation</p>
        <select
          className="rounded-md border bg-background px-2 py-1 text-sm"
          value={filter}
          onChange={(e) => setFilter(e.target.value as RowFilter)}
        >
          <option value="all">All rows</option>
          <option value="eligible">Eligible</option>
          <option value="identity_blocked">Identity blocked</option>
          <option value="duplicate_review">Duplicate review</option>
          <option value="mapping_required">Mapping required</option>
          <option value="excluded">Excluded</option>
        </select>
      </div>
      <div className="overflow-x-auto rounded-lg border">
        <table className="min-w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2">#</th>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Phone</th>
              <th className="px-3 py-2">Email</th>
              <th className="px-3 py-2">Validation</th>
              <th className="px-3 py-2">Duplicate</th>
              <th className="px-3 py-2">Delivery</th>
              <th className="px-3 py-2">Blockers</th>
              <th className="px-3 py-2">Unmapped</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <tr key={row.id} className="border-t">
                <td className="px-3 py-2">{row.rowNumber}</td>
                <td className="px-3 py-2">{row.name ?? "—"}</td>
                <td className="px-3 py-2 font-mono text-xs">{row.phone ?? "—"}</td>
                <td className="px-3 py-2">{row.email ?? "—"}</td>
                <td className="px-3 py-2">{row.validationStatus}</td>
                <td className="px-3 py-2">{row.duplicateStatus}</td>
                <td className="px-3 py-2">{row.deliveryStatus}</td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {row.blockerReasons.length ? row.blockerReasons.join("; ") : "—"}
                </td>
                <td className="px-3 py-2">{row.unmappedFieldCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
