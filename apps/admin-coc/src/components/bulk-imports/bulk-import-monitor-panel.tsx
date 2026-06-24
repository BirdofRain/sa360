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
  workerJobState?: string;
  deliveryOutcome?: string;
  rowFailureSummaries?: Array<{
    rowNumber: number;
    rowId: string;
    errorCode: string | null;
    errorSummary: string;
    operatorMessage: string;
  }>;
  preGhlFailureBanner?: string | null;
};

export type BulkImportLiveDeliverySnapshot = {
  ghlContactId: string | null;
  ghlOpportunityId: string | null;
  destinationLocationIdGhl: string | null;
  contactAction: "created" | "updated" | null;
  contactDisplayName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  ownerId: string | null;
  ownerName: string | null;
  tagsAdded: string[];
  fieldsStampedSummary?: string | null;
  workflowTriggerStrategy: string | null;
  workflowTriggerNote: string | null;
  liveRunId: string | null;
  adapterStatus?: string | null;
  deliveredAt: string | null;
  adapterDetailsRedacted?: Record<string, unknown> | null;
};

function formatTimestamp(value: string | null | undefined): string {
  if (!value) return "Not returned by adapter";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function formatAdapterField(value: string | null | undefined): string {
  if (value && value.trim()) return value.trim();
  return "Not returned by adapter";
}

function formatTags(tags: string[] | undefined): string {
  if (tags && tags.length > 0) return tags.join(", ");
  return "Not returned by adapter";
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

function deliveryOutcomeLabel(outcome: string | undefined): string {
  switch (outcome) {
    case "delivered":
      return "Delivered";
    case "failed":
      return "Failed";
    case "partial":
      return "Partial success";
    case "running":
      return "Running";
    case "pending":
      return "Pending";
    default:
      return outcome ?? "—";
  }
}

function workerJobStateLabel(state: string | undefined): string {
  switch (state) {
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    case "active":
      return "Active";
    case "queued":
      return "Queued";
    case "none":
      return "None";
    default:
      return state ?? "—";
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

  const queueJobs = Array.isArray(monitor.queueJobs) ? monitor.queueJobs : [];
  const deliveredRowList = Array.isArray(deliveredRows) ? deliveredRows : [];

  return (
    <div className="space-y-4">
      {monitor.preGhlFailureBanner ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <strong>{monitor.preGhlFailureBanner}</strong>
        </p>
      ) : null}

      {monitor.workerJobState === "completed" &&
      (monitor.deliveryOutcome === "failed" || monitor.rowsFailed > 0) ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          Worker job state: <strong>{workerJobStateLabel(monitor.workerJobState)}</strong> — delivery
          outcome: <strong>{deliveryOutcomeLabel(monitor.deliveryOutcome)}</strong>. The queue job
          finished processing, but one or more rows did not reach GHL.
        </p>
      ) : null}

      <div className="grid gap-3 rounded-lg border bg-muted/20 p-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <p className="text-xs uppercase text-muted-foreground">Batch status</p>
          <p className="font-medium">{monitor.batchStatus}</p>
        </div>
        <div>
          <p className="text-xs uppercase text-muted-foreground">Worker job state</p>
          <p className="font-medium">{workerJobStateLabel(monitor.workerJobState)}</p>
        </div>
        <div>
          <p className="text-xs uppercase text-muted-foreground">Delivery outcome</p>
          <p className="font-medium">{deliveryOutcomeLabel(monitor.deliveryOutcome)}</p>
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

      {monitor.rowFailureSummaries && monitor.rowFailureSummaries.length > 0 ? (
        <div className="rounded-md border p-3 text-sm space-y-1">
          <p className="font-medium">Row delivery failures</p>
          {monitor.rowFailureSummaries.map((row) => (
            <p key={row.rowId}>
              Row {row.rowNumber}: {row.operatorMessage}
            </p>
          ))}
        </div>
      ) : null}

      {queueJobs.length > 0 ? (
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
              {queueJobs.map((job) => (
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

      {deliveredRowList.length > 0 ? (
        <div className="space-y-3">
          <h3 className="font-medium text-sm">Delivered GHL records</h3>
          {deliveredRowList.map((row) => {
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
            const contactLabel =
              live?.contactAction === "updated"
                ? "Updated"
                : live?.contactAction === "created"
                  ? "Created"
                  : formatAdapterField(null);
            const ownerLabel =
              live?.ownerName?.trim() || live?.ownerId?.trim() || formatAdapterField(null);

            return (
              <div
                key={row.rowNumber}
                className="rounded-md border border-green-200 bg-green-50/60 p-4 text-sm space-y-2"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">
                    Row {row.rowNumber}: {row.name ?? "—"}
                  </p>
                  <span className="rounded-full bg-green-700 px-2 py-0.5 text-xs font-medium text-white">
                    Delivered
                  </span>
                </div>
                <p>
                  <strong>GHL contact ID:</strong> {formatAdapterField(contactId)}
                </p>
                <p>
                  <strong>Contact:</strong>{" "}
                  {formatAdapterField(live?.contactDisplayName ?? row.name)}{" "}
                  {live?.contactEmail ? `· ${live.contactEmail}` : ""}
                  {live?.contactPhone ? ` · ${live.contactPhone}` : ""}
                  {contactLabel !== "Not returned by adapter" ? ` (${contactLabel})` : ""}
                </p>
                <p>
                  <strong>Opportunity ID:</strong>{" "}
                  {formatAdapterField(live?.ghlOpportunityId ?? null)}
                </p>
                <p>
                  <strong>Destination location:</strong> {formatAdapterField(locationId)}
                </p>
                <p>
                  <strong>Owner:</strong> {ownerLabel}
                </p>
                <p>
                  <strong>Tags added:</strong> {formatTags(live?.tagsAdded)}
                </p>
                {live?.fieldsStampedSummary ? (
                  <p>
                    <strong>Fields stamped:</strong> {live.fieldsStampedSummary}
                  </p>
                ) : null}
                <p>
                  <strong>Workflow strategy:</strong>{" "}
                  {formatAdapterField(live?.workflowTriggerStrategy ?? monitor.workflowStrategy)}
                </p>
                {live?.workflowTriggerNote ? (
                  <p className="text-muted-foreground">{live.workflowTriggerNote}</p>
                ) : null}
                <p>
                  <strong>Live run ID:</strong> {formatAdapterField(live?.liveRunId ?? null)}
                </p>
                <p>
                  <strong>Adapter status:</strong>{" "}
                  {formatAdapterField(live?.adapterStatus ?? null)}
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
                {live?.adapterDetailsRedacted ? (
                  <details className="rounded border bg-background/80 p-2">
                    <summary className="cursor-pointer font-medium">Adapter details</summary>
                    <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all text-xs">
                      {JSON.stringify(live.adapterDetailsRedacted, null, 2)}
                    </pre>
                  </details>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
