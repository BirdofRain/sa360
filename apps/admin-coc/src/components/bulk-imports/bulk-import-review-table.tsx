"use client";

import { Fragment, useMemo, useState } from "react";

export type NormalizationIssue = {
  path: string;
  code: string;
  message: string;
};

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
  duplicateCandidates?: Array<{
    detail?: string;
    originLabel?: string;
    severity?: string;
    deliveredToGhl?: boolean;
    previousBatchCancelled?: boolean;
    samePhone?: boolean;
    sameEmail?: boolean;
    sameSourceLeadId?: boolean;
    existingSourceLeadEventId?: string;
  }>;
  unmappedFieldCount: number;
  excluded: boolean;
  sourceLeadEventId?: string | null;
  sourceIntakeState?: "ready" | "missing" | "schema_failed" | "persistence_failed" | "not_applicable";
  normalizationIssues?: NormalizationIssue[];
  errorSummary?: string | null;
};

type RowFilter =
  | "all"
  | "eligible"
  | "identity_blocked"
  | "duplicate_review"
  | "mapping_required"
  | "excluded"
  | "normalization_failed";

function sourceIntakeLabel(state?: BulkImportReviewRow["sourceIntakeState"]): string {
  switch (state) {
    case "ready":
      return "Ready";
    case "missing":
      return "Missing";
    case "schema_failed":
      return "Schema failed";
    case "persistence_failed":
      return "Persistence failed";
    default:
      return "—";
  }
}

function isSimulationEligibleRow(row: BulkImportReviewRow): boolean {
  return (
    !row.excluded &&
    Boolean(row.sourceLeadEventId) &&
    (row.validationStatus === "eligible" || row.validationStatus === "ready_for_simulation") &&
    (row.deliveryStatus === "pending" ||
      row.deliveryStatus === "failed" ||
      row.deliveryStatus === "simulated")
  );
}

export function BulkImportReviewTable({ rows }: { rows: BulkImportReviewRow[] }) {
  const [filter, setFilter] = useState<RowFilter>("all");
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    switch (filter) {
      case "eligible":
        return rows.filter(isSimulationEligibleRow);
      case "identity_blocked":
        return rows.filter((r) => r.validationStatus === "identity_blocked");
      case "duplicate_review":
        return rows.filter((r) => r.validationStatus === "duplicate_review");
      case "mapping_required":
        return rows.filter((r) => r.validationStatus === "mapping_required");
      case "normalization_failed":
        return rows.filter((r) => r.validationStatus === "failed");
      case "excluded":
        return rows.filter((r) => r.excluded);
      default:
        return rows;
    }
  }, [filter, rows]);

  const eligibleCount = rows.filter(isSimulationEligibleRow).length;
  const missingSourceEventCount = rows.filter(
    (r) =>
      !r.excluded &&
      (r.validationStatus === "eligible" || r.validationStatus === "ready_for_simulation") &&
      !r.sourceLeadEventId
  ).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">{eligibleCount} row(s) eligible for simulation</p>
        {missingSourceEventCount > 0 ? (
          <p className="text-sm text-amber-800">
            {missingSourceEventCount} row(s) passed identity checks but do not have valid Source
            Intake records.
          </p>
        ) : null}
        <select
          className="rounded-md border bg-background px-2 py-1 text-sm"
          value={filter}
          onChange={(e) => setFilter(e.target.value as RowFilter)}
        >
          <option value="all">All rows</option>
          <option value="eligible">Eligible for simulation</option>
          <option value="identity_blocked">Identity blocked</option>
          <option value="duplicate_review">Duplicate review</option>
          <option value="mapping_required">Mapping required</option>
          <option value="normalization_failed">Normalization failed</option>
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
              <th className="px-3 py-2">Source Intake</th>
              <th className="px-3 py-2">Duplicate</th>
              <th className="px-3 py-2">Delivery</th>
              <th className="px-3 py-2">Blockers</th>
              <th className="px-3 py-2">Unmapped</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => {
              const expanded = expandedRowId === row.id;
              const hasIssueDetails = (row.normalizationIssues?.length ?? 0) > 0;
              return (
                <Fragment key={row.id}>
                  <tr className="border-t">
                    <td className="px-3 py-2">{row.rowNumber}</td>
                    <td className="px-3 py-2">{row.name ?? "—"}</td>
                    <td className="px-3 py-2 font-mono text-xs">{row.phone ?? "—"}</td>
                    <td className="px-3 py-2">{row.email ?? "—"}</td>
                    <td className="px-3 py-2">{row.validationStatus}</td>
                    <td className="px-3 py-2">
                      <div className="space-y-1">
                        <span>{sourceIntakeLabel(row.sourceIntakeState)}</span>
                        {row.sourceLeadEventId ? (
                          <p className="font-mono text-[10px] text-muted-foreground">
                            {row.sourceLeadEventId}
                          </p>
                        ) : null}
                        {hasIssueDetails ? (
                          <button
                            type="button"
                            className="text-xs text-primary underline"
                            onClick={() => setExpandedRowId(expanded ? null : row.id)}
                          >
                            {expanded ? "Hide details" : "Show schema details"}
                          </button>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-3 py-2">{row.duplicateStatus}</td>
                    <td className="px-3 py-2">{row.deliveryStatus}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {row.validationStatus === "duplicate_review" && row.duplicateCandidates?.length
                        ? row.duplicateCandidates.map((c) => c.detail ?? c.originLabel).join("; ")
                        : row.blockerReasons.length
                          ? row.blockerReasons.join("; ")
                          : row.errorSummary ?? "—"}
                    </td>
                    <td className="px-3 py-2">{row.unmappedFieldCount}</td>
                  </tr>
                  {expanded && hasIssueDetails ? (
                    <tr className="border-t bg-muted/20">
                      <td colSpan={10} className="px-3 py-2 text-xs">
                        <ul className="space-y-1">
                          {row.normalizationIssues?.map((issue) => (
                            <li key={`${issue.path}-${issue.code}`}>
                              <span className="font-mono">{issue.path}</span> ({issue.code}):{" "}
                              {issue.message}
                            </li>
                          ))}
                        </ul>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
