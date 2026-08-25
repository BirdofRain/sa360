import Link from "next/link";

import { SectionPanel } from "@/components/dashboard/section-panel";
import { formatRelativeTime } from "@/lib/client-portal/map-client-dashboard";
import { formatPortalDate } from "@/lib/client-portal/map-client-orders";
import {
  portalDeliveryStatusTone,
  type PortalLeadDetailView,
  type PortalLeadTimelineItem,
} from "@/lib/client-portal/map-client-leads";

import { PortalStatusPill } from "./portal-status-pill";

function Fact({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium text-slate-900">{value}</dd>
    </div>
  );
}

function DateLine({ label, iso }: { label: string; iso: string | null }) {
  const date = formatPortalDate(iso);
  if (!date || !iso) return null;
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-2 py-2">
      <span className="text-sm text-slate-600">{label}</span>
      <span className="text-sm text-slate-900">
        {date}
        <span className="ml-2 text-xs text-slate-400">{formatRelativeTime(iso)}</span>
      </span>
    </li>
  );
}

function formatStatusValue(value: string | null): string | null {
  if (!value) return null;
  return value.replace(/_/g, " ");
}

function hasAnyDate(lead: PortalLeadDetailView): boolean {
  return [lead.receivedAt, lead.deliveredAt, lead.approvedAt, lead.lastEventAt].some(
    (iso) => formatPortalDate(iso) !== null
  );
}

function timelineTone(status: PortalLeadTimelineItem["status"]): "good" | "warn" | "bad" | "neutral" {
  if (status === "complete") return "good";
  if (status === "failed") return "bad";
  if (status === "pending") return "warn";
  return "neutral";
}

function timelineStatusLabel(status: PortalLeadTimelineItem["status"]): string {
  switch (status) {
    case "complete":
      return "Complete";
    case "pending":
      return "Pending";
    case "failed":
      return "Failed";
    case "skipped":
      return "Skipped";
  }
}

export function PortalLeadDetail({ lead }: { lead: PortalLeadDetailView }) {
  const receivedAt = formatPortalDate(lead.receivedAt);
  const deliveredAt = formatPortalDate(lead.deliveredAt);
  const campaign = lead.campaign !== "—" ? lead.campaign : null;
  const sourceLabel = lead.sourceLabel !== "—" ? lead.sourceLabel : null;

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/portal/leads"
          className="inline-flex min-h-10 items-center text-sm font-medium text-slate-600 underline-offset-2 hover:text-slate-900 hover:underline"
        >
          Back to Leads
        </Link>
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Lead</p>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{lead.leadName}</h1>
            {deliveredAt ? (
              <p className="mt-1 text-sm text-slate-500">Delivered {deliveredAt}</p>
            ) : receivedAt ? (
              <p className="mt-1 text-sm text-slate-500">Received {receivedAt}</p>
            ) : null}
          </div>
          <PortalStatusPill
            label={lead.deliveryLabel}
            tone={portalDeliveryStatusTone(lead.deliveryStatus)}
          />
        </div>
      </div>

      <SectionPanel title="Contact">
        <dl className="grid gap-4 p-4 sm:grid-cols-2">
          <Fact label="Name" value={lead.leadName} />
          <Fact label="Phone" value={lead.phoneMasked} />
          <Fact label="Email" value={lead.emailMasked} />
          <Fact label="Appointment" value={formatStatusValue(lead.appointmentStatus)} />
          <Fact label="Outcome" value={formatStatusValue(lead.soldStatus)} />
          <Fact label="Delivered to" value={lead.matchedClient} />
        </dl>
        <p className="border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
          Contact details stay masked.
        </p>
      </SectionPanel>

      <SectionPanel title="Source">
        {campaign || sourceLabel || lead.funnelName || lead.adName ? (
          <dl className="grid gap-4 p-4 sm:grid-cols-2">
            <Fact label="Campaign" value={campaign} />
            <Fact label="Source" value={sourceLabel} />
            <Fact label="Funnel" value={lead.funnelName} />
            <Fact label="Ad" value={lead.adName} />
          </dl>
        ) : (
          <p className="p-4 text-sm text-slate-600">Source details are not available yet.</p>
        )}
      </SectionPanel>

      <SectionPanel title="Delivery">
        <dl className="grid gap-4 p-4 sm:grid-cols-2">
          <Fact label="Delivery status" value={lead.deliveryLabel} />
          <Fact label="Routing" value={lead.routingLabel} />
          <Fact
            label="Follow-up started"
            value={lead.workflowStarted === true ? "Yes" : lead.workflowStarted === false ? "No" : null}
          />
          <Fact label="Lifecycle" value={formatStatusValue(lead.lifecycleStage)} />
          <Fact label="Latest activity" value={formatStatusValue(lead.lastEvent)} />
        </dl>
        {lead.errorSummary || lead.warnings.length > 0 ? (
          <div className="space-y-2 border-t border-slate-100 px-4 py-3">
            {lead.errorSummary ? (
              <p className="text-sm text-amber-800">{lead.errorSummary}</p>
            ) : null}
            {lead.warnings.map((warning) => (
              <p key={warning} className="text-sm text-amber-800">
                {warning}
              </p>
            ))}
          </div>
        ) : null}
      </SectionPanel>

      {lead.timeline.length > 0 ? (
        <SectionPanel title="Activity">
          <ol className="divide-y divide-slate-100 px-4">
            {lead.timeline.map((item) => (
              <li key={`${item.milestone}-${item.at ?? item.status}`} className="py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-900">{item.milestoneLabel}</p>
                    {item.detail ? <p className="mt-0.5 text-xs text-slate-500">{item.detail}</p> : null}
                    {item.at && formatPortalDate(item.at) ? (
                      <p className="mt-1 text-xs text-slate-500">
                        {formatPortalDate(item.at)}
                        <span className="ml-2 text-slate-400">{formatRelativeTime(item.at)}</span>
                      </p>
                    ) : null}
                  </div>
                  <PortalStatusPill
                    label={timelineStatusLabel(item.status)}
                    tone={timelineTone(item.status)}
                  />
                </div>
              </li>
            ))}
          </ol>
        </SectionPanel>
      ) : null}

      {hasAnyDate(lead) ? (
        <SectionPanel title="Dates">
          <ul className="divide-y divide-slate-100 px-4">
            <DateLine label="Received" iso={lead.receivedAt} />
            <DateLine label="Approved" iso={lead.approvedAt} />
            <DateLine label="Delivered" iso={lead.deliveredAt} />
            <DateLine label="Latest activity" iso={lead.lastEventAt} />
          </ul>
        </SectionPanel>
      ) : null}
    </div>
  );
}
