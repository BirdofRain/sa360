import type { ReactNode } from "react";
import Link from "next/link";

import { WarningBanner } from "@/components/dashboard/warning-banner";
import { SupportTicketInlineButton } from "@/components/support/SupportTicketLauncher";
import { isSupportTicketsEnabled } from "@/lib/support-tickets/config";
import { buildTeamWorkspaceTicketContext } from "@/lib/team-workspace/ticket-context";
import type { ClientOption, TeamWorkspaceClientView } from "@/lib/team-workspace/types";

import { ClientPicker } from "./client-picker";
import { DeliveryNotificationChoice, type NotificationChoiceActions } from "./notification-choice";
import { StatusPill } from "./status-pill";
import { TeamWorkspaceIntro } from "./workspace-states";

export function TeamWorkspaceHome({ clients, start }: { clients: ClientOption[]; start?: ReactNode }) {
  return (
    <div className="space-y-6">
      <TeamWorkspaceIntro />
      <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
        <ClientPicker clients={clients} />
        <div className="space-y-4">
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="text-base font-semibold text-slate-950">Choose a client</h2>
          <p className="mt-2 text-sm text-slate-600">
            Pick a client to open guided setup, or create one. A new client starts in onboarding and does not turn on delivery.
          </p>
          <p className="mt-4">
            <Link href="/clients" className="text-sm font-medium text-sky-800 underline">
              Clients and subaccounts
            </Link>
          </p>
          <div className="mt-6">
            <ReportIssue />
          </div>
        </section>
        {start}
        </div>
      </div>
    </div>
  );
}

export function TeamWorkspaceBoard({
  view,
  clients,
  notificationActions,
  showIntro = true,
}: {
  view: TeamWorkspaceClientView;
  clients: ClientOption[];
  notificationActions: NotificationChoiceActions;
  showIntro?: boolean;
}) {
  return (
    <div className="space-y-6">
      {showIntro ? <TeamWorkspaceIntro /> : null}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-slate-950">{view.clientDisplayName}</h2>
          <p className="mt-1 text-sm text-slate-600">{view.setupLine}</p>
          <p className="mt-1 text-sm text-slate-600">
            {view.recordedCount} of 6 steps have saved information. None of them activate delivery.
          </p>
        </div>
        <ReportIssue clientAccountId={view.clientAccountId} receipts={view.receipts} />
      </div>
      {view.banner ? (
        <WarningBanner tone={view.banner.tone === "warn" ? "warn" : "info"} title={view.banner.title}>
          {view.banner.body}
          {view.showRetry ? (
            <>
              {" "}
              <a href={view.retryHref} className="font-medium underline">
                Try again
              </a>
            </>
          ) : null}
        </WarningBanner>
      ) : null}
      <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
        <ClientPicker clients={clients} activeId={view.clientAccountId} />
        <ol className="space-y-3">
          {view.steps.map((step, index) => {
            const ticket = buildTeamWorkspaceTicketContext({
              clientAccountId: view.clientAccountId,
              stepId: step.id,
              receipts: view.receipts,
            });
            return (
              <li
                key={step.id}
                data-step={step.id}
                data-status={step.status}
                className="rounded-xl border border-slate-200 bg-white p-4"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-medium text-slate-500">{index + 1}</span>
                  <h3 className="text-sm font-semibold text-slate-950">{step.title}</h3>
                  <StatusPill status={step.status} />
                </div>
                <p className="mt-2 text-sm text-slate-700">{step.summary}</p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-600">
                  {step.details.map((detail, detailIndex) => (
                    <li key={`${step.id}-${detailIndex}`}>{detail}</li>
                  ))}
                </ul>
                {step.id === "delivery_notifications" ? (
                  <DeliveryNotificationChoice
                    clientAccountId={view.clientAccountId}
                    preference={view.notification}
                    actions={notificationActions}
                  />
                ) : null}
                <div className="mt-3">
                  <SupportTicketInlineButton
                    label="Report issue"
                    initialCategory={ticket.category}
                    contextOverride={ticket.contextOverride}
                  />
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

function ReportIssue({
  clientAccountId,
  receipts,
}: {
  clientAccountId?: string;
  receipts?: TeamWorkspaceClientView["receipts"];
}) {
  if (!isSupportTicketsEnabled()) {
    return (
      <p className="text-sm text-slate-600">Report issue is unavailable until support tickets are enabled.</p>
    );
  }
  const ticket = buildTeamWorkspaceTicketContext({ clientAccountId, receipts });
  return (
    <SupportTicketInlineButton
      label="Report issue"
      initialCategory={ticket.category}
      contextOverride={ticket.contextOverride}
    />
  );
}

