import Link from "next/link";

import { SectionPanel } from "@/components/dashboard/section-panel";
import { formatRelativeTime } from "@/lib/client-portal/map-client-dashboard";
import { formatPortalDate } from "@/lib/client-portal/map-client-orders";
import {
  portalDeliveryStatusTone,
  type PortalLeadDetailView,
  type PortalLeadTimelineItem,
} from "@/lib/client-portal/map-client-leads";
import {
  filterPortalCustomerWarnings,
  isPortalCustomerTimelineMilestone,
  isPortalInternalLeadDiagnostic,
  portalCustomerCampaign,
  portalCustomerErrorSummary,
  portalCustomerSourceLabel,
  portalCustomerState,
} from "@/lib/client-portal/portal-lead-customer";
import { portalLeadListPath, type PortalLeadListStatus } from "@/lib/client-portal/portal-lead-list-status";
import { formatPortalDisplayValue } from "@/lib/client-portal/portal-labels";

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

function customerTimeline(lead: PortalLeadDetailView): PortalLeadTimelineItem[] {
  return lead.timeline
    .filter((item) => isPortalCustomerTimelineMilestone(item.milestone))
    .map((item) =>
      item.detail && isPortalInternalLeadDiagnostic(item.detail) ? { ...item, detail: null } : item
    );
}

function hasCustomerDates(lead: PortalLeadDetailView): boolean {
  return [lead.receivedAt, lead.deliveredAt].some((iso) => formatPortalDate(iso) !== null);
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

export function PortalLeadDetail({
  lead,
  listStatus = "all",
}: {
  lead: PortalLeadDetailView;
  listStatus?: PortalLeadListStatus;
}) {
  const generatedAt = formatPortalDate(lead.receivedAt);
  const deliveredAt = formatPortalDate(lead.deliveredAt);
  const campaign = portalCustomerCampaign(lead.campaign);
  const sourceLabel = portalCustomerSourceLabel(lead.sourceLabel);
  const backHref = portalLeadListPath(listStatus);
  const errorNote = portalCustomerErrorSummary(lead.errorSummary);
  const notes = [...filterPortalCustomerWarnings(lead.warnings), ...(errorNote ? [errorNote] : [])];
  const timeline = customerTimeline(lead);
  const state = portalCustomerState(lead.state);
  const leadType = formatPortalDisplayValue(lead.leadType);
  const contactFacts = [
    lead.leadName,
    lead.phoneMasked,
    lead.emailMasked,
    state,
    lead.age,
    leadType,
    formatPortalDisplayValue(lead.appointmentStatus),
    formatPortalDisplayValue(lead.soldStatus),
    campaign,
    sourceLabel,
  ].some(Boolean);

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={backHref}
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
            ) : generatedAt ? (
              <p className="mt-1 text-sm text-slate-500">Generated {generatedAt}</p>
            ) : null}
          </div>
          <PortalStatusPill
            label={lead.deliveryLabel}
            tone={portalDeliveryStatusTone(lead.deliveryStatus)}
          />
        </div>
      </div>

      {contactFacts ? (
        <SectionPanel title="Lead details">
          <dl className="grid gap-4 p-4 sm:grid-cols-2">
            <Fact label="Name" value={lead.leadName} />
            <Fact label="Phone" value={lead.phoneMasked} />
            <Fact label="Email" value={lead.emailMasked} />
            <Fact label="State" value={state} />
            <Fact label="Age" value={lead.age} />
            <Fact label="Lead type" value={leadType} />
            <Fact label="Appointment" value={formatPortalDisplayValue(lead.appointmentStatus)} />
            <Fact label="Outcome" value={formatPortalDisplayValue(lead.soldStatus)} />
            <Fact label="Campaign" value={campaign} />
            <Fact label="Source" value={sourceLabel} />
          </dl>
          <p className="border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
            Contact details stay masked.
          </p>
        </SectionPanel>
      ) : null}

      {hasCustomerDates(lead) ? (
        <SectionPanel title="Dates">
          <ul className="divide-y divide-slate-100 px-4">
            <DateLine label="Generated" iso={lead.receivedAt} />
            <DateLine label="Delivered" iso={lead.deliveredAt} />
          </ul>
        </SectionPanel>
      ) : null}

      {timeline.length > 0 ? (
        <SectionPanel title="Activity">
          <ol className="divide-y divide-slate-100 px-4">
            {timeline.map((item) => (
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

      {notes.length > 0 ? (
        <SectionPanel title="Notes">
          <div className="space-y-2 px-4 py-3">
            {notes.map((note) => (
              <p key={note} className="text-sm text-slate-600">
                {note}
              </p>
            ))}
          </div>
        </SectionPanel>
      ) : null}
    </div>
  );
}
