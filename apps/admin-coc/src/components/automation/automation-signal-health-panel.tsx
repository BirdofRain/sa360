import Link from "next/link";

import { EmptyState } from "@/components/dashboard/empty-state";
import { WarningBanner } from "@/components/dashboard/warning-banner";
import type { PresentedAutomationSignalHealth } from "@/lib/automation/present-signal-health";

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

function formatCount(value: number | null): string {
  return value == null ? "—" : String(value);
}

export function AutomationSignalHealthPanel({
  signal,
}: {
  signal: PresentedAutomationSignalHealth;
}) {
  return (
    <div className="space-y-4 p-4 text-sm">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="text-xs text-slate-500">Signal sent</div>
          <div className="text-lg font-medium">{formatCount(signal.signalSent)}</div>
        </div>
        <div>
          <div className="text-xs text-slate-500">Signal failed</div>
          <div className="text-lg font-medium text-red-600">{formatCount(signal.signalFailed)}</div>
        </div>
        <div>
          <div className="text-xs text-slate-500">Webhook failures</div>
          <div className="text-lg font-medium">{formatCount(signal.webhookFailures)}</div>
        </div>
        <div>
          <div className="text-xs text-slate-500">Duplicates / skipped</div>
          <div className="text-lg font-medium">{formatCount(signal.duplicatesOrSkipped)}</div>
        </div>
      </div>
      <div>
        <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
          Lifecycle events (range)
        </h4>
        {signal.eventsAvailability === "unavailable" ? (
          <WarningBanner tone="warn" title="Lifecycle events unavailable">
            The signal-health payload omitted <code>eventsByInternalName</code>. Counters above may
            still be usable.
          </WarningBanner>
        ) : signal.eventsByInternalName.length === 0 ? (
          <EmptyState
            title="No lifecycle events in range"
            hint="The API returned an empty events list."
            className="py-6"
          />
        ) : (
          <ul className="max-h-40 space-y-1 overflow-y-auto text-xs">
            {signal.eventsByInternalName.slice(0, 12).map((e, index) => (
              <li
                key={`${e.eventNameInternal ?? "event"}:${index}`}
                className="flex justify-between gap-2"
              >
                <span className="font-mono text-slate-600">{e.eventNameInternal ?? "—"}</span>
                <span className="text-slate-800">{e.count}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {signal.failedWebhookLogsAvailability === "unavailable" ? (
        <WarningBanner tone="warn" title="Failed webhook log unavailable">
          The signal-health payload omitted <code>failedWebhookLogs</code>.
        </WarningBanner>
      ) : signal.failedWebhookLogs.length > 0 ? (
        <div>
          <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
            Recent failed webhooks
          </h4>
          <ul className="max-h-48 space-y-2 overflow-y-auto text-xs">
            {signal.failedWebhookLogs.slice(0, 8).map((log, index) => (
              <li
                key={log.id || `failed-log-${index}`}
                className="rounded border border-red-100 bg-red-50/50 p-2"
              >
                <div className="font-medium text-red-900">{log.processingStatus}</div>
                <div className="text-slate-600">
                  {log.eventNameInternal ?? "—"} · {formatWhen(log.receivedAt)}
                </div>
                {log.errorSummary ? (
                  <div className="mt-1 text-slate-500">{log.errorSummary}</div>
                ) : null}
                {log.processingStatus ? (
                  <Link
                    href={`/webhooks?processingStatus=${encodeURIComponent(log.processingStatus)}`}
                    className="mt-1 inline-block text-blue-600 hover:underline"
                  >
                    Webhook monitor →
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
