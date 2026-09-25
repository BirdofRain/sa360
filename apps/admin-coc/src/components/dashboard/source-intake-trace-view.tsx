import type { ReactNode } from "react";

import type { AdminSourceIntakeTrace } from "@/lib/admin-api/types";
import { formatDiagnosticTimestamp } from "@/lib/diagnostic-timestamp";

function TimestampValue({ iso }: { iso: string | null | undefined }) {
  const formatted = formatDiagnosticTimestamp(iso);
  if (!formatted.utc) return <span>—</span>;
  return (
    <span>
      {formatted.display}
      <span className="mt-0.5 block font-mono text-[10px] text-muted-foreground">{formatted.utc}</span>
    </span>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-mono text-xs break-all">{children}</dd>
    </>
  );
}

export function SourceIntakeTraceView({ trace }: { trace: AdminSourceIntakeTrace }) {
  const event = trace.sourceLeadEvent;
  const webhook = trace.webhookRequestLog;
  const funnel = trace.sourceFunnel;
  const item = trace.inventoryItem;
  const tracking = trace.inventoryTracking;

  return (
    <section className="space-y-4 rounded-lg border border-border bg-card p-4">
      <div>
        <h2 className="text-sm font-semibold">Source intake trace</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Read-only correlation for a normalized source lead. Client-scoped GHL timeline rules are
          unchanged. This view omits payloads, names, phones, and emails. Timestamps are UTC.
        </p>
      </div>
      <dl className="grid grid-cols-[180px_1fr] gap-y-2 text-sm">
        <Row label="Destination client">
          {trace.hasDestinationClient ? trace.destinationClientAccountId : "none"}
        </Row>
        <Row label="sourceLeadId">{event?.sourceLeadId ?? "—"}</Row>
        <Row label="sourceLeadUid">{event?.sourceLeadUid ?? webhook?.normalizedLeadUid ?? "—"}</Row>
        <Row label="Source event">{event?.id ?? "—"}</Row>
        <Row label="Event status">{event?.status ?? "—"}</Row>
        <Row label="Webhook log">{webhook?.id ?? "—"}</Row>
        <Row label="Webhook source">{webhook?.source ?? "—"}</Row>
        <Row label="Webhook status">{webhook?.processingStatus ?? "—"}</Row>
        <Row label="Received at">
          <TimestampValue iso={event?.receivedAt ?? webhook?.receivedAt} />
        </Row>
        <Row label="Source funnel">{funnel ? `${funnel.id} · ${funnel.associationStatus}` : "none"}</Row>
        <Row label="Funnel niche">{funnel?.nicheKey ?? "—"}</Row>
        <Row label="Inventory tracking">{tracking.label}</Row>
        <Row label="Tracking outcome">{tracking.outcome ?? tracking.diagnostic}</Row>
        <Row label="Tracking detail">{tracking.detail ?? "—"}</Row>
        <Row label="Inventory item">{item?.id ?? tracking.inventoryItemId ?? "none"}</Row>
        <Row label="Inventory status">{item?.status ?? "—"}</Row>
        <Row label="Generated at">
          <TimestampValue iso={item?.generatedAt} />
        </Row>
        <Row label="Other source event">
          {item?.onOtherSourceEvent ? "yes" : "no"}
        </Row>
        <Row label="Related events">{trace.relatedSourceEventIds.join(", ") || "—"}</Row>
      </dl>
    </section>
  );
}
