"use client";

import { Fragment, useState } from "react";

export type SimulationRowResult = {
  rowId: string;
  rowNumber: number;
  leadName?: string | null;
  status: "simulated" | "failed";
  deliveryPlanCreated: boolean;
  adapterRunCreated: boolean;
  reason: string | null;
  errorCode: string | null;
  retryable: boolean;
  deliveryPlanId?: string | null;
  adapterRunId?: string | null;
  externalCallExecuted?: boolean;
  blockers?: string[];
  nextAction?: string | null;
  deliveryPlanStatus?: string | null;
  adapterSimulationDetail?: string | null;
  missingConfigFields?: string[];
};

function contextualFailureMessage(row: SimulationRowResult): string | null {
  if (row.status === "simulated") return null;
  const reason = row.reason?.toLowerCase() ?? "";
  const error = row.errorCode?.toLowerCase() ?? "";
  if (
    error === "destination_not_allowed" ||
    reason.includes("direct demo allowlist") ||
    reason.includes("direct delivery allowlist")
  ) {
    return "This destination is not permitted by the direct-demo path. Bulk-import simulation should use the selected destination instead.";
  }
  if (
    error === "routing_unmatched" ||
    error === "delivery_blocked" && reason.includes("routing rule")
  ) {
    return "Bulk imports use manual destination authority; a campaign routing rule should not be required for simulation.";
  }
  return null;
}

function formatReason(reason: string | null): string {
  if (!reason) return "Adapter simulation failed.";
  return reason.replace(/_/g, " ");
}

export function BulkImportSimulationResults({
  results,
  targetRowCount,
  simulatedRows,
  failedRows,
}: {
  results: SimulationRowResult[];
  targetRowCount?: number;
  simulatedRows?: number;
  failedRows?: number;
}) {
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  if (results.length === 0) return null;

  const attempted = targetRowCount ?? results.length;
  const succeeded = simulatedRows ?? results.filter((r) => r.status === "simulated").length;
  const failed = failedRows ?? results.filter((r) => r.status === "failed").length;

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="space-y-1">
        <h3 className="font-medium">Simulation results</h3>
        {succeeded > 0 ? (
          <p className="text-sm text-green-700">
            Simulation successful for {succeeded} row(s). No GHL contacts were created.
          </p>
        ) : null}
        {failed > 0 && succeeded === 0 ? (
          <p className="text-sm text-destructive">
            Simulation ran for {attempted} row(s), but all {failed} adapter simulation(s) failed.
            Review the reasons below.
          </p>
        ) : null}
        {failed > 0 && succeeded > 0 ? (
          <p className="text-sm text-amber-800">
            {failed} row(s) failed simulation. Review the reasons below.
          </p>
        ) : null}
      </div>
      <div className="overflow-x-auto rounded-md border">
        <table className="min-w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Row</th>
              <th className="px-3 py-2">Lead</th>
              <th className="px-3 py-2">Result</th>
              <th className="px-3 py-2">Failure code</th>
              <th className="px-3 py-2">Safe reason</th>
              <th className="px-3 py-2">Delivery plan</th>
              <th className="px-3 py-2">Adapter run</th>
              <th className="px-3 py-2">External write</th>
              <th className="px-3 py-2">Next action</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {results.map((row) => (
              <Fragment key={row.rowId}>
                <tr className="border-t">
                  <td className="px-3 py-2">{row.rowNumber}</td>
                  <td className="px-3 py-2">{row.leadName ?? "—"}</td>
                  <td className="px-3 py-2">
                    {row.status === "failed" ? "Simulation failed" : "Simulation passed"}
                  </td>
                  <td className="px-3 py-2 text-xs">{row.errorCode ?? "—"}</td>
                  <td className="px-3 py-2 text-xs">{formatReason(row.reason)}</td>
                  <td className="px-3 py-2 text-xs">{row.deliveryPlanId ?? (row.deliveryPlanCreated ? "Yes" : "No")}</td>
                  <td className="px-3 py-2 text-xs">{row.adapterRunId ?? (row.adapterRunCreated ? "Yes" : "No")}</td>
                  <td className="px-3 py-2">No</td>
                  <td className="px-3 py-2 text-xs">{row.nextAction ?? "—"}</td>
                  <td className="px-3 py-2">
                    {row.status === "failed" ? (
                      <button
                        type="button"
                        className="text-xs text-primary underline"
                        onClick={() =>
                          setExpandedRowId(expandedRowId === row.rowId ? null : row.rowId)
                        }
                      >
                        {expandedRowId === row.rowId ? "Hide" : "Details"}
                      </button>
                    ) : null}
                  </td>
                </tr>
                {expandedRowId === row.rowId ? (
                  <tr className="border-t bg-muted/20">
                    <td colSpan={10} className="px-3 py-2 text-xs space-y-1">
                      <p>
                        <strong>Error:</strong> {row.errorCode ?? "simulation_failed"}
                      </p>
                      <p>
                        <strong>Reason:</strong> {formatReason(row.reason)}
                      </p>
                      {contextualFailureMessage(row) ? (
                        <p className="text-amber-800">{contextualFailureMessage(row)}</p>
                      ) : null}
                      {row.blockers && row.blockers.length > 0 ? (
                        <p>
                          <strong>Blockers:</strong> {row.blockers.join(" · ")}
                        </p>
                      ) : null}
                      {row.missingConfigFields && row.missingConfigFields.length > 0 ? (
                        <p>
                          <strong>Missing config:</strong> {row.missingConfigFields.join(", ")}
                        </p>
                      ) : null}
                      {row.deliveryPlanStatus ? (
                        <p>
                          <strong>Delivery plan status:</strong> {row.deliveryPlanStatus}
                        </p>
                      ) : null}
                      {row.adapterSimulationDetail ? (
                        <p>
                          <strong>Adapter simulation:</strong> {row.adapterSimulationDetail}
                        </p>
                      ) : null}
                      <p className="text-muted-foreground">
                        No GHL contact or opportunity was created during simulation.
                      </p>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
