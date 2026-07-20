"use client";

import {
  Cable,
  MessageSquare,
  Phone,
  ShieldCheck,
  Webhook,
  Workflow,
} from "lucide-react";

import {
  DESTINATION_TYPE_LABEL,
  formatLeadsPerDay,
  formatPercent,
} from "@/lib/front-office/pipeline-studio/display";
import type { PipelineStudioLocalState } from "@/lib/front-office/pipeline-studio/use-pipeline-studio-state";
import type {
  DestinationType,
  PipelineStudioConnector,
  PipelineStudioDestination,
  PipelineStudioRules,
} from "@/lib/front-office/pipeline-studio/types";
import { cn } from "@/lib/utils";

const DEST_ICON: Record<DestinationType, typeof Workflow> = {
  crm: Workflow,
  power_dialer: Phone,
  auto_follow_up: MessageSquare,
};

const CONNECTOR_ICON: Record<string, typeof Cable> = {
  sms: MessageSquare,
  webhook: Webhook,
  custom_api: Cable,
};

function ruleRows(rules: PipelineStudioRules) {
  return [
    { title: "Lead Caps", summary: `Max ${rules.dailyCap} leads / agent / day` },
    {
      title: "Speed to Lead",
      summary: `Target < ${rules.speedToLeadTargetSeconds}s`,
    },
    { title: "Working Hours", summary: rules.workingHours },
    { title: "Time Zones", summary: rules.timezoneBehavior },
    {
      title: "Compliance Guardrails",
      summary: rules.complianceGuardrailSummary,
    },
    {
      title: "Failover Paths",
      summary: rules.failoverEnabled ? "Enabled" : "Disabled",
    },
  ];
}

export function FoDestinationPanel({
  destinations,
  connectors,
  rules,
  state,
}: {
  destinations: PipelineStudioDestination[];
  connectors: PipelineStudioConnector[];
  rules: PipelineStudioRules;
  state: PipelineStudioLocalState;
}) {
  const rows = ruleRows(rules);
  const canModify = state.capabilities.canModifyDestinations;

  return (
    <aside className="flex min-h-0 flex-col gap-2.5 lg:w-[300px] lg:shrink-0 xl:w-[320px]">
      <section className="ps-card flex min-h-0 flex-1 flex-col overflow-hidden lg:max-h-[520px]">
        <div className="border-b border-[var(--ps-border)] px-2.5 pt-2">
          <p className="text-xs font-semibold text-[var(--ps-text)]">
            Pipeline Configuration
          </p>
          <div
            className="mt-2 flex gap-1"
            role="tablist"
            aria-label="Configuration sections"
          >
            {(
              [
                ["destinations", "Destinations"],
                ["rules", "Rules"],
                ["settings", "Settings"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={state.configTab === id}
                onClick={() => state.setConfigTab(id)}
                className={cn(
                  "ps-focus-ring rounded-t-md px-2.5 py-1.5 text-xs transition-colors",
                  state.configTab === id
                    ? "border-b-2 border-[var(--ps-blue)] text-[var(--ps-blue)]"
                    : "text-[var(--ps-muted)] hover:text-[var(--ps-text)]"
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 space-y-1.5 overflow-y-auto p-2.5" role="tabpanel">
          {state.configTab === "destinations"
            ? destinations.map((dest) => {
                const Icon = DEST_ICON[dest.type];
                const rateTone =
                  dest.successRate >= 0.9
                    ? "text-[var(--ps-green)]"
                    : dest.successRate >= 0.3
                      ? "text-amber-300"
                      : "text-rose-300";
                return (
                  <div
                    key={dest.id}
                    className={cn(
                      "rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg-elevated)] px-2.5 py-2",
                      dest.enabled && "ps-card-active"
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="rounded-md bg-[var(--ps-blue)]/10 p-1.5 text-[var(--ps-blue)]">
                          <Icon className="size-3.5" aria-hidden />
                        </span>
                        <div>
                          <p className="text-sm font-medium">{dest.name}</p>
                          <p className="text-[11px] text-[var(--ps-muted)]">
                            {DESTINATION_TYPE_LABEL[dest.type]}
                          </p>
                          <p className="text-[11px] text-[var(--ps-muted)]">
                            Success:{" "}
                            <span className={rateTone}>
                              {formatPercent(dest.successRate)}
                            </span>
                            {" · "}
                            Vol: {formatLeadsPerDay(dest.recentVolume)}
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={dest.enabled}
                        disabled={!canModify}
                        aria-label={`${dest.name} ${dest.enabled ? "enabled" : "disabled"} (local preview)`}
                        onClick={() => state.toggleDestination(dest.id)}
                        className={cn(
                          "ps-focus-ring relative h-6 w-10 shrink-0 rounded-full transition-colors",
                          dest.enabled ? "bg-[var(--ps-blue)]" : "bg-slate-600",
                          !canModify && "opacity-50"
                        )}
                      >
                        <span
                          className={cn(
                            "absolute top-0.5 size-5 rounded-full bg-white transition-transform",
                            dest.enabled ? "left-[18px]" : "left-0.5"
                          )}
                        />
                      </button>
                    </div>
                  </div>
                );
              })
            : null}

          {state.configTab === "rules" ? (
            <ul className="space-y-2">
              {rows.map((rule) => (
                <li
                  key={rule.title}
                  className="rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg-elevated)] px-3 py-2.5"
                >
                  <div className="flex items-center gap-2">
                    <ShieldCheck
                      className="size-3.5 text-[var(--ps-green)]"
                      aria-hidden
                    />
                    <p className="text-sm font-medium">{rule.title}</p>
                  </div>
                  <p className="mt-1 text-xs text-[var(--ps-muted)]">
                    {rule.summary}
                  </p>
                </li>
              ))}
            </ul>
          ) : null}

          {state.configTab === "settings" ? (
            <div className="rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg-elevated)] px-3 py-3 text-xs text-[var(--ps-muted)]">
              <p className="font-medium text-[var(--ps-text)]">Preview settings</p>
              <p className="mt-1.5 leading-relaxed">
                Publish, save, and validate are disabled in this fixture slice.
                Destination toggles update local browser state only.
              </p>
            </div>
          ) : null}
        </div>
      </section>

      <section className="ps-card p-2.5">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--ps-muted)]">
          Connectors
        </p>
        <p className="mt-0.5 text-[10px] text-[var(--ps-muted)]">
          Drag-and-drop disabled in preview
        </p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {connectors.map((c) => {
            const Icon = CONNECTOR_ICON[c.kind] ?? Cable;
            return (
              <div
                key={c.id}
                className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-[var(--ps-border)] bg-[var(--ps-bg-elevated)] px-2 py-1 text-[11px] text-[var(--ps-muted)]"
              >
                <Icon className="size-3.5" aria-hidden />
                {c.label}
              </div>
            );
          })}
        </div>
      </section>

      <section className="ps-card p-2.5" aria-label="Routing and delivery rules">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--ps-muted)]">
          Routing &amp; Delivery Rules
        </p>
        <ul className="mt-1.5 space-y-1">
          {rows.slice(0, 4).map((rule) => (
            <li
              key={`summary-${rule.title}`}
              className="flex items-start justify-between gap-2 text-[11px]"
            >
              <span className="text-[var(--ps-text)]">{rule.title}</span>
              <span className="max-w-[55%] shrink-0 truncate text-right text-[var(--ps-muted)]">
                {rule.summary.split("·")[0]?.trim() ?? rule.summary}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </aside>
  );
}
