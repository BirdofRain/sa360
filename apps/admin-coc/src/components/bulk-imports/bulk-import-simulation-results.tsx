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
};

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
              <th className="px-3 py-2">#</th>
              <th className="px-3 py-2">Lead</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Delivery plan</th>
              <th className="px-3 py-2">Adapter run</th>
              <th className="px-3 py-2">Reason</th>
              <th className="px-3 py-2">Retryable</th>
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
                    {row.status === "failed" ? "Simulation failed" : "Simulated"}
                  </td>
                  <td className="px-3 py-2">{row.deliveryPlanCreated ? "Yes" : "No"}</td>
                  <td className="px-3 py-2">{row.adapterRunCreated ? "Yes" : "No"}</td>
                  <td className="px-3 py-2 text-xs">{formatReason(row.reason)}</td>
                  <td className="px-3 py-2">{row.retryable ? "Yes" : "No"}</td>
                  <td className="px-3 py-2">
                    {row.status === "failed" ? (
                      <button
                        type="button"
                        className="text-xs text-primary underline"
                        onClick={() =>
                          setExpandedRowId(expandedRowId === row.rowId ? null : row.rowId)
                        }
                      >
                        {expandedRowId === row.rowId ? "Hide" : "View simulation details"}
                      </button>
                    ) : null}
                  </td>
                </tr>
                {expandedRowId === row.rowId ? (
                  <tr className="border-t bg-muted/20">
                    <td colSpan={8} className="px-3 py-2 text-xs space-y-1">
                      <p>
                        <strong>Error code:</strong> {row.errorCode ?? "simulation_failed"}
                      </p>
                      <p>
                        <strong>Reason:</strong> {formatReason(row.reason)}
                      </p>
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
