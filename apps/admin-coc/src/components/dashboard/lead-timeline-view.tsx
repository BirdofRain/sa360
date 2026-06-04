"use client";

import Link from "next/link";

import type { AdminLeadTimelineResponse } from "@/lib/admin-api/types";
import { isInvalidWebhookRow } from "@/lib/webhook-monitor-utils";
import type { LeadTimelineFetchParams } from "@/lib/lead-timeline-query";
import { webhookOpenRequestUnavailableLabel } from "@/lib/lead-timeline-open-request";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

function formatTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function MilestoneLadder({
  milestones,
  missing,
}: {
  milestones: readonly string[];
  missing: string[];
}) {
  return (
    <ul className="flex flex-wrap gap-2">
      {milestones.map((m) => {
        const hit = !missing.includes(m);
        return (
          <li key={m}>
            <Badge variant={hit ? "outline" : "secondary"} className="font-mono text-[11px]">
              {hit ? "✓" : "○"} {m}
            </Badge>
          </li>
        );
      })}
    </ul>
  );
}

export function LeadTimelineView({
  data,
  anchor,
}: {
  data: AdminLeadTimelineResponse;
  anchor: LeadTimelineFetchParams;
}) {
  const { identity, currentState, timeline, missingMilestones, warnings } = data;
  const milestones = [
    "lead_created",
    "contact_replied",
    "appointment_set",
    "appointment_confirmed",
    "appointment_showed",
    "appointment_no_show",
    "sold",
    "policy_issued",
    "bad_number",
    "dnc",
    "dead_lead",
  ] as const;

  return (
    <div className="space-y-6">
      {warnings.length > 0 ? (
        <div className="rounded-md border border-amber-500/30 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:bg-amber-950/30 dark:text-amber-100">
          {warnings.map((w) => (
            <p key={w}>{w}</p>
          ))}
        </div>
      ) : null}

      <section className="grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-4">
          <h2 className="mb-2 text-sm font-semibold">Identity</h2>
          <dl className="grid grid-cols-[120px_1fr] gap-y-1 text-sm">
            <dt className="text-muted-foreground">Display name</dt>
            <dd>{identity.displayName ?? "—"}</dd>
            <dt className="text-muted-foreground">lead_uid</dt>
            <dd className="font-mono text-xs">{identity.leadUid ?? "—"}</dd>
            <dt className="text-muted-foreground">contact_id_ghl</dt>
            <dd className="font-mono text-xs">{identity.contactIdGhl ?? "—"}</dd>
            <dt className="text-muted-foreground">Phone</dt>
            <dd className="font-mono text-xs">{identity.phoneE164 ?? "—"}</dd>
            <dt className="text-muted-foreground">Email</dt>
            <dd className="text-xs">{identity.email ?? "—"}</dd>
            <dt className="text-muted-foreground">Client</dt>
            <dd className="font-mono text-xs">{identity.clientAccountId}</dd>
            <dt className="text-muted-foreground">Subaccount</dt>
            <dd className="font-mono text-xs">{identity.subaccountIdGhl ?? "—"}</dd>
          </dl>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <h2 className="mb-2 text-sm font-semibold">Current state (index)</h2>
          <dl className="grid grid-cols-[140px_1fr] gap-y-1 text-sm">
            <dt className="text-muted-foreground">lifecycle_stage</dt>
            <dd>{currentState.lifecycleStage ?? "—"}</dd>
            <dt className="text-muted-foreground">appointment_status</dt>
            <dd>{currentState.appointmentStatus ?? "—"}</dd>
            <dt className="text-muted-foreground">agent_disposition</dt>
            <dd>{currentState.agentDisposition ?? "—"}</dd>
            <dt className="text-muted-foreground">policy_status</dt>
            <dd>{currentState.policyStatus ?? "—"}</dd>
            <dt className="text-muted-foreground">ai_status</dt>
            <dd>{currentState.aiStatus ?? "—"}</dd>
            <dt className="text-muted-foreground">routing_status</dt>
            <dd>{currentState.routingStatus ?? "—"}</dd>
            <dt className="text-muted-foreground">last_seen_at</dt>
            <dd className="font-mono text-xs">{formatTime(currentState.lastSeenAt)}</dd>
          </dl>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold">Milestone ladder</h2>
        <MilestoneLadder milestones={milestones} missing={missingMilestones} />
        {missingMilestones.length > 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Missing: {missingMilestones.join(", ")}
          </p>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">All tracked milestones present in timeline.</p>
        )}
      </section>

      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold">Full timeline</h2>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Event</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Validity</TableHead>
                <TableHead>HTTP</TableHead>
                <TableHead>Summary</TableHead>
                <TableHead>Error</TableHead>
                <TableHead className="text-right">Webhook</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {timeline.map((row) => (
                <TableRow
                  key={`${row.sourceTable}:${row.id}`}
                  className={isInvalidWebhookRow(row.processingStatus) ? "bg-destructive/5" : undefined}
                >
                  <TableCell className="whitespace-nowrap font-mono text-xs tabular-nums">
                    {formatTime(row.receivedAt)}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{row.eventNameInternal ?? "—"}</TableCell>
                  <TableCell className="text-xs">{row.sourceTable}</TableCell>
                  <TableCell className="text-xs">{row.processingStatus}</TableCell>
                  <TableCell>
                    <Badge variant={row.validity === "invalid" ? "destructive" : "outline"}>
                      {row.validity}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{row.httpStatus ?? "—"}</TableCell>
                  <TableCell className="max-w-[200px] truncate text-xs">{row.summary ?? "—"}</TableCell>
                  <TableCell className="max-w-[200px] truncate text-xs text-destructive">
                    {row.errorSummary ?? "—"}
                  </TableCell>
                  <TableCell className="text-right text-xs">
                    {row.webhookLogId ? (
                      <Link
                        href={`/webhooks?open=${encodeURIComponent(row.webhookLogId)}`}
                        className="text-primary hover:underline"
                      >
                        Open request
                      </Link>
                    ) : webhookOpenRequestUnavailableLabel(row) ? (
                      <span className="text-muted-foreground">
                        {webhookOpenRequestUnavailableLabel(row)}
                      </span>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  );
}
