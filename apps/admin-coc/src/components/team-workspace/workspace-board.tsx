import Link from "next/link";

import { WarningBanner } from "@/components/dashboard/warning-banner";
import { SupportTicketInlineButton } from "@/components/support/SupportTicketLauncher";
import { isSupportTicketsEnabled } from "@/lib/support-tickets/config";
import { buildTeamWorkspaceTicketContext } from "@/lib/team-workspace/ticket-context";
import type { ClientOption, TeamWorkspaceClientView } from "@/lib/team-workspace/types";

import { ClientPicker } from "./client-picker";
import { StatusPill } from "./status-pill";
import { TeamWorkspaceIntro } from "./workspace-states";

export function TeamWorkspaceHome({ clients }: { clients: ClientOption[] }) {
  return (
    <div className="space-y-6">
      <TeamWorkspaceIntro />
      <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
        <ClientPicker clients={clients} />
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="text-base font-semibold text-slate-950">Choose a client</h2>
          <p className="mt-2 text-sm text-slate-600">
            Open a client to see the saved setup. The list is a read. This page does not create a client.
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
      </div>
    </div>
  );
}

export function TeamWorkspaceBoard({
  view,
  clients,
}: {
  view: TeamWorkspaceClientView;
  clients: ClientOption[];
}) {
  return (
    <div className="space-y-6">
      <TeamWorkspaceIntro />
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
                {step.id === "delivery_notifications" ? <NotificationChoice /> : null}
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

function NotificationChoice() {
  return (
    <fieldset disabled className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3">
      <legend className="px-1 text-xs font-medium text-slate-600">Client notification</legend>
      <label className="flex items-start gap-2 text-sm text-slate-800">
        <input
          type="checkbox"
          disabled
          defaultChecked={false}
          aria-label="Notify this client when a lead is successfully delivered"
        />
        <span>Notify this client when a lead is successfully delivered</span>
      </label>
      <p className="mt-2 text-xs text-slate-600">
        This choice is off. A verified recipient in Admin C.O.C. is required before it can be turned on.
      </p>
    </fieldset>
  );
}
