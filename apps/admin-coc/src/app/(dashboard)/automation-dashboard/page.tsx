import { Suspense } from "react";
import Link from "next/link";

import { AutomationDashboardFilters } from "@/components/automation/automation-dashboard-filters";
import { AutomationWorkflowFunnel } from "@/components/automation/automation-workflow-funnel";
import { EmptyState } from "@/components/dashboard/empty-state";
import { SectionPanel } from "@/components/dashboard/section-panel";
import { StatTile } from "@/components/dashboard/stat-tile";
import { WarningBanner } from "@/components/dashboard/warning-banner";
import {
  fetchAutomationAccounts,
  fetchAutomationAppointments,
  fetchAutomationDashboardSummary,
  fetchAutomationSignalHealth,
  fetchAutomationWorkflowProgression,
  isAdminApiConfigured,
} from "@/lib/admin-api/server";
import type {
  AutomationDashboardRange,
  AutomationHealthStatus,
} from "@/lib/admin-api/types";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

function firstParam(v: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(v) ? v[0] : v;
  return typeof raw === "string" && raw.trim() !== "" ? raw : undefined;
}

function parseRange(v: string | undefined): AutomationDashboardRange {
  if (v === "today" || v === "30d") return v;
  return "7d";
}

function healthTone(s: AutomationHealthStatus): "good" | "warn" | "bad" {
  if (s === "HEALTHY") return "good";
  if (s === "WARNING") return "warn";
  return "bad";
}

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

function FiltersFallback() {
  return (
    <div className="h-[88px] animate-pulse rounded-xl border border-slate-200 bg-white" />
  );
}

export default async function AutomationDashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const range = parseRange(firstParam(sp.range));
  const clientAccountId = firstParam(sp.clientAccountId);
  const query = { range, clientAccountId };
  const configured = isAdminApiConfigured();

  const [summaryRes, funnelRes, appointmentsRes, signalRes, accountsRes] = configured
    ? await Promise.all([
        fetchAutomationDashboardSummary(query),
        fetchAutomationWorkflowProgression(query),
        fetchAutomationAppointments(query),
        fetchAutomationSignalHealth(query),
        fetchAutomationAccounts(query),
      ])
    : [
        { data: null, error: "Admin API not configured" },
        { data: null, error: "Admin API not configured" },
        { data: null, error: "Admin API not configured" },
        { data: null, error: "Admin API not configured" },
        { data: null, error: "Admin API not configured" },
      ];

  const errors = [
    summaryRes.error,
    funnelRes.error,
    appointmentsRes.error,
    signalRes.error,
    accountsRes.error,
  ].filter(Boolean);
  const summary = summaryRes.data;
  const funnel = funnelRes.data;
  const appointments = appointmentsRes.data;
  const signal = signalRes.data;
  const accounts = accountsRes.data;

  const limitations = [
    ...(summary?.dataLimitations ?? []),
    ...(funnel?.dataLimitations ?? []),
    ...(appointments?.dataLimitations ?? []),
    ...(signal?.dataLimitations ?? []),
    ...(accounts?.dataLimitations ?? []),
  ];
  const uniqueLimitations = [...new Set(limitations)];

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          SA360 Automation Visibility
        </h1>
        <p className="text-sm text-slate-500">
          Workflow checkpoints, appointment activation, and signal health
        </p>
        {summary?.range ? (
          <p className="text-xs text-slate-400">
            Range {formatWhen(summary.range.from)} → {formatWhen(summary.range.to)}
            {clientAccountId ? ` · client ${clientAccountId}` : ""}
          </p>
        ) : null}
      </header>

      {!configured ? (
        <WarningBanner tone="warn" title="Admin API not configured">
          Set <code className="text-xs">NEXT_PUBLIC_SA360_API_BASE_URL</code> and{" "}
          <code className="text-xs">SA360_ADMIN_API_KEY</code> on admin-coc. See Settings.
        </WarningBanner>
      ) : null}

      {errors.length > 0 ? (
        <WarningBanner tone="err" title="Could not load some dashboard data">
          {errors[0]}
        </WarningBanner>
      ) : null}

      <Suspense fallback={<FiltersFallback />}>
        <AutomationDashboardFilters />
      </Suspense>

      {uniqueLimitations.length > 0 ? (
        <WarningBanner tone="info" title="Data limitations">
          <ul className="mt-1 list-inside list-disc">
            {uniqueLimitations.slice(0, 4).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </WarningBanner>
      ) : null}

      {summary ? (
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label="Leads received" value={summary.leadsReceived} />
          <StatTile label="First responses" value={summary.firstResponses} />
          <StatTile label="AI / bot engaged" value={summary.aiEngaged} hint="Synthflow requests" />
          <StatTile label="Appointments set" value={summary.appointmentsSet} tone="good" />
          <StatTile label="Reminders sent" value={summary.remindersSent} />
          <StatTile
            label="Human activation needed"
            value={summary.humanActivationNeeded}
            tone={summary.humanActivationNeeded > 0 ? "warn" : "neutral"}
          />
          <StatTile label="Webhook failures" value={summary.webhookFailures} tone="bad" />
          <StatTile label="Signal failures" value={summary.signalFailed} tone="bad" />
          <StatTile
            label="System health"
            value={summary.healthStatus}
            tone={healthTone(summary.healthStatus)}
            hint={`Last webhook ${formatWhen(summary.lastWebhookAt)}`}
          />
        </section>
      ) : (
        <EmptyState
          title="Summary unavailable"
          hint={configured ? "Check API errors above." : "Configure the admin API first."}
        />
      )}

      <SectionPanel title="Workflow progression funnel">
        {funnel?.checkpoints ? (
          <AutomationWorkflowFunnel checkpoints={funnel.checkpoints} />
        ) : (
          <EmptyState title="Funnel unavailable" />
        )}
      </SectionPanel>

      <SectionPanel title="Appointment activation board">
        {appointments?.rows && appointments.rows.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="border-b border-slate-100 bg-slate-50/80 text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Appointment</th>
                  <th className="px-4 py-2 font-medium">Contact</th>
                  <th className="px-4 py-2 font-medium">Agent</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Source</th>
                  <th className="px-4 py-2 font-medium">Activation</th>
                  <th className="px-4 py-2 font-medium">Last event</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {appointments.rows.map((row) => (
                  <tr key={row.eventId} className="hover:bg-slate-50/50">
                    <td className="px-4 py-2 text-slate-700">
                      {formatWhen(row.appointmentTime)}
                    </td>
                    <td className="px-4 py-2">
                      <div className="font-medium text-slate-800">
                        {row.contactName ?? row.leadUid ?? row.contactIdGhl ?? "—"}
                      </div>
                      <div className="text-xs text-slate-400">{row.phone ?? row.clientAccountId}</div>
                    </td>
                    <td className="px-4 py-2 text-slate-600">{row.assignedAgentName ?? "—"}</td>
                    <td className="px-4 py-2 text-slate-600">{row.appointmentStatus ?? "—"}</td>
                    <td className="px-4 py-2">
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-700">
                        {row.source}
                      </span>
                    </td>
                    <td className="px-4 py-2">
                      <span
                        className={cn(
                          "rounded px-1.5 py-0.5 text-xs font-medium",
                          row.activationStatus === "NEEDED"
                            ? "bg-amber-100 text-amber-800"
                            : row.activationStatus === "COMPLETED"
                              ? "bg-emerald-100 text-emerald-800"
                              : "bg-slate-100 text-slate-600"
                        )}
                      >
                        {row.activationStatus}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-xs text-slate-500">
                      {formatWhen(row.lastEventAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="No appointment rows in range"
            hint="Add GHL appointment_set and human_activation_needed workflows. See docs/ghl/sa360-automation-checkpoint-events.md"
          />
        )}
      </SectionPanel>

      <div className="grid gap-5 lg:grid-cols-2">
        <SectionPanel title="Signal health">
          {signal ? (
            <div className="space-y-4 p-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-xs text-slate-500">Signal sent</div>
                  <div className="text-lg font-medium">{signal.signalSent}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">Signal failed</div>
                  <div className="text-lg font-medium text-red-600">{signal.signalFailed}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">Webhook failures</div>
                  <div className="text-lg font-medium">{signal.webhookFailures}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">Duplicates / skipped</div>
                  <div className="text-lg font-medium">{signal.duplicatesOrSkipped}</div>
                </div>
              </div>
              <div>
                <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                  Lifecycle events (range)
                </h4>
                <ul className="max-h-40 space-y-1 overflow-y-auto text-xs">
                  {signal.eventsByInternalName.slice(0, 12).map((e) => (
                    <li key={e.eventNameInternal} className="flex justify-between gap-2">
                      <span className="font-mono text-slate-600">{e.eventNameInternal}</span>
                      <span className="text-slate-800">{e.count}</span>
                    </li>
                  ))}
                </ul>
              </div>
              {signal.failedWebhookLogs.length > 0 ? (
                <div>
                  <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                    Recent failed webhooks
                  </h4>
                  <ul className="max-h-48 space-y-2 overflow-y-auto text-xs">
                    {signal.failedWebhookLogs.slice(0, 8).map((log) => (
                      <li key={log.id} className="rounded border border-red-100 bg-red-50/50 p-2">
                        <div className="font-medium text-red-900">{log.processingStatus}</div>
                        <div className="text-slate-600">
                          {log.eventNameInternal ?? "—"} · {formatWhen(log.receivedAt)}
                        </div>
                        {log.errorSummary ? (
                          <div className="mt-1 text-slate-500">{log.errorSummary}</div>
                        ) : null}
                        <Link
                          href={`/webhooks?processingStatus=${encodeURIComponent(log.processingStatus)}`}
                          className="mt-1 inline-block text-blue-600 hover:underline"
                        >
                          Webhook monitor →
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : (
            <EmptyState title="Signal health unavailable" />
          )}
        </SectionPanel>

        <SectionPanel title="Account health">
          {accounts?.accounts && accounts.accounts.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead className="border-b border-slate-100 bg-slate-50/80 text-xs text-slate-500">
                  <tr>
                    <th className="px-4 py-2 font-medium">Client</th>
                    <th className="px-4 py-2 font-medium">Location</th>
                    <th className="px-4 py-2 font-medium">Leads today</th>
                    <th className="px-4 py-2 font-medium">Appts today</th>
                    <th className="px-4 py-2 font-medium">Health</th>
                    <th className="px-4 py-2 font-medium">Warnings</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {accounts.accounts.map((a) => (
                    <tr key={`${a.clientAccountId}:${a.locationId}`}>
                      <td className="px-4 py-2 font-mono text-xs">{a.clientAccountId}</td>
                      <td className="px-4 py-2 font-mono text-xs text-slate-500">
                        {a.locationId || "—"}
                      </td>
                      <td className="px-4 py-2">{a.leadsToday}</td>
                      <td className="px-4 py-2">{a.appointmentsToday}</td>
                      <td className="px-4 py-2">
                        <span
                          className={cn(
                            "rounded px-1.5 py-0.5 text-xs font-medium",
                            a.healthStatus === "HEALTHY"
                              ? "bg-emerald-100 text-emerald-800"
                              : a.healthStatus === "WARNING"
                                ? "bg-amber-100 text-amber-800"
                                : "bg-red-100 text-red-800"
                          )}
                        >
                          {a.healthStatus}
                        </span>
                      </td>
                      <td className="max-w-[200px] px-4 py-2 text-xs text-slate-500">
                        {a.warnings.length > 0 ? a.warnings.join("; ") : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              title="No accounts in webhook log"
              hint="Lifecycle webhooks with client_account_id will populate this table."
            />
          )}
        </SectionPanel>
      </div>

      <p className="text-xs text-slate-400">
        Checkpoint map:{" "}
        <Link href="/workflow" className="text-blue-600 hover:underline">
          Workflow map
        </Link>{" "}
        · GHL events: <code className="text-[11px]">docs/ghl/sa360-automation-checkpoint-events.md</code>
      </p>
    </div>
  );
}
