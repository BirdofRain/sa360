"use client";

import { buildGhlAppUrl, GHL_DEEP_LINK_PATHS } from "@/lib/ghl/deep-links";

export type BulkImportQueueJobSnapshot = {
  jobId: string;
  chunkIndex: number;
  rowCount: number;
  state: string;
  attemptsMade?: number;
  failedReason?: string | null;
  processedOn?: string | null;
  finishedOn?: string | null;
  delayUntil?: string | null;
};

export type BulkImportDeliveryMonitor = {
  batchId: string;
  batchStatus: string;
  approvedRowCount: number;
  approvedRowIds: string[];
  queueJobs: BulkImportQueueJobSnapshot[];
  rowsDelivering: number;
  rowsDelivered: number;
  rowsFailed: number;
  rowsWaiting: number;
  lastActivityAt: string | null;
  lastWorkerError: string | null;
  workerConfigured: boolean;
  queueReachable: boolean;
  queueStale: boolean;
  destinationClientAccountId: string | null;
  destinationLocationIdGhl: string | null;
  workflowStrategy: string | null;
};

export type BulkImportLiveDeliverySnapshot = {
  ghlContactId: string | null;
  ghlOpportunityId: string | null;
  destinationLocationIdGhl: string | null;
  contactAction: "created" | "updated" | null;
  ownerId: string | null;
  ownerName: string | null;
  tagsAdded: string[];
  workflowTriggerStrategy: string | null;
  workflowTriggerNote: string | null;
  liveRunId: string | null;
  deliveredAt: string | null;
};

function formatTimestamp(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function queueStateLabel(state: string): string {
  switch (state) {
    case "waiting":
      return "Waiting";
    case "delayed":
      return "Delayed";
    case "active":
      return "Active";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    case "missing":
      return "Missing";
    default:
      return state;
  }
}

export function BulkImportMonitorPanel({
  monitor,
  deliveredRows,
}: {
  monitor: BulkImportDeliveryMonitor | null;
  deliveredRows?: Array<{
    rowNumber: number;
    name: string | null;
    ghlContactId?: string | null;
    liveDelivery?: BulkImportLiveDeliverySnapshot | null;
  }>;
}) {
  if (!monitor) {
    return (
      <p className="text-sm text-muted-foreground">
        Delivery monitor data is not available yet. Refresh to load queue status.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 rounded-lg border bg-muted/20 p-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <p className="text-xs uppercase text-muted-foreground">Batch status</p>
          <p className="font-medium">{monitor.batchStatus}</p>
        </div>
        <div>
          <p className="text-xs uppercase text-muted-foreground">Approved rows</p>
          <p className="font-medium">{monitor.approvedRowCount}</p>
        </div>
        <div>
          <p className="text-xs uppercase text-muted-foreground">Rows delivering</p>
          <p className="font-medium">{monitor.rowsDelivering}</p>
        </div>
        <div>
          <p className="text-xs uppercase text-muted-foreground">Rows delivered</p>
          <p className="font-medium">{monitor.rowsDelivered}</p>
        </div>
        <div>
          <p className="text-xs uppercase text-muted-foreground">Rows failed</p>
          <p className="font-medium">{monitor.rowsFailed}</p>
        </div>
        <div>
          <p className="text-xs uppercase text-muted-foreground">Rows waiting</p>
          <p className="font-medium">{monitor.rowsWaiting}</p>
        </div>
        <div>
          <p className="text-xs uppercase text-muted-foreground">Last activity</p>
          <p className="font-medium">{formatTimestamp(monitor.lastActivityAt)}</p>
        </div>
        <div>
          <p className="text-xs uppercase text-muted-foreground">Worker configured</p>
          <p className="font-medium">{monitor.workerConfigured ? "Yes" : "No"}</p>
        </div>
      </div>

      {!monitor.workerConfigured ? (
        <p className="text-sm text-amber-800">
          Worker/API dispatch configuration is unavailable. Delivery jobs may remain queued.
        </p>
      ) : null}

      {!monitor.queueReachable ? (
        <p className="text-sm text-amber-800">Bulk import delivery queue is not reachable.</p>
      ) : null}

      {monitor.queueStale ? (
        <p className="text-sm text-amber-800">
          The delivery job is queued but has not been picked up by the worker.
        </p>
      ) : null}

      {monitor.lastWorkerError ? (
        <p className="text-sm text-destructive">
          <strong>Last worker error:</strong> {monitor.lastWorkerError}
        </p>
      ) : null}

      {monitor.queueJobs.length > 0 ? (
        <div className="overflow-x-auto rounded-md border">
          <table className="min-w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Job ID</th>
                <th className="px-3 py-2">Chunk</th>
                <th className="px-3 py-2">Rows</th>
                <th className="px-3 py-2">State</th>
                <th className="px-3 py-2">Attempts</th>
                <th className="px-3 py-2">Next retry</th>
                <th className="px-3 py-2">Worker error</th>
              </tr>
            </thead>
            <tbody>
              {monitor.queueJobs.map((job) => (
                <tr key={job.jobId} className="border-t">
                  <td className="px-3 py-2 font-mono text-xs">{job.jobId}</td>
                  <td className="px-3 py-2">{job.chunkIndex}</td>
                  <td className="px-3 py-2">{job.rowCount}</td>
                  <td className="px-3 py-2">{queueStateLabel(job.state)}</td>
                  <td className="px-3 py-2">{job.attemptsMade ?? "—"}</td>
                  <td className="px-3 py-2 text-xs">{formatTimestamp(job.delayUntil)}</td>
                  <td className="px-3 py-2 text-xs text-destructive">
                    {job.state === "failed" ? job.failedReason ?? "Delivery job failed." : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No queue jobs recorded for this approval wave.</p>
      )}

      {deliveredRows && deliveredRows.length > 0 ? (
        <div className="space-y-3">
          <h3 className="font-medium text-sm">Delivered GHL records</h3>
          {deliveredRows.map((row) => {
            const live = row.liveDelivery;
            const locationId =
              live?.destinationLocationIdGhl ?? monitor.destinationLocationIdGhl ?? null;
            const contactId = row.ghlContactId ?? live?.ghlContactId ?? null;
            const ghlHref =
              locationId && contactId
                ? buildGhlAppUrl(GHL_DEEP_LINK_PATHS.contact, {
                    locationId,
                    contactId,
                  })
                : null;

            return (
              <div key={row.rowNumber} className="rounded-md border p-3 text-sm space-y-1">
                <p>
                  <strong>Row {row.rowNumber}:</strong> {row.name ?? "—"}
                </p>
                <p>
                  <strong>GHL contact ID:</strong> {contactId ?? "—"}
                </p>
                <p>
                  <strong>Destination location:</strong> {locationId ?? "—"}
                </p>
                <p>
                  <strong>Contact:</strong>{" "}
                  {live?.contactAction === "updated" ? "Updated" : live?.contactAction === "created" ? "Created" : "—"}
                </p>
                <p>
                  <strong>Opportunity ID:</strong> {live?.ghlOpportunityId ?? "—"}
                </p>
                <p>
                  <strong>Owner:</strong>{" "}
                  {live?.ownerName ?? live?.ownerId ?? "—"}
                </p>
                <p>
                  <strong>Tags added:</strong>{" "}
                  {live?.tagsAdded?.length ? live.tagsAdded.join(", ") : "—"}
                </p>
                <p>
                  <strong>Workflow strategy:</strong> {live?.workflowTriggerStrategy ?? monitor.workflowStrategy ?? "—"}
                </p>
                {live?.workflowTriggerNote ? (
                  <p className="text-muted-foreground">{live.workflowTriggerNote}</p>
                ) : null}
                <p>
                  <strong>Live run ID:</strong> {live?.liveRunId ?? "—"}
                </p>
                <p>
                  <strong>Delivered at:</strong> {formatTimestamp(live?.deliveredAt)}
                </p>
                {ghlHref ? (
                  <p>
                    <a
                      href={ghlHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary underline"
                    >
                      Open in GHL
                    </a>
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
