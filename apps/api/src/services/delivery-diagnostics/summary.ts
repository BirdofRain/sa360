/**
 * Delivery diagnostics summary: source intake, Sheets, GHL, and infrastructure
 * for one bounded window. Each section reads in its own read-only transaction,
 * so a section that times out reports `available: false` and the others still
 * return. Nothing here writes, enqueues, or calls a provider.
 */

import type { PrismaClient } from "@prisma/client";
import type { Redis } from "ioredis";

import { readDeliveryHealthConfig } from "../delivery-health/config.js";
import { evaluateDeliveryHealth } from "../delivery-health/rules.js";
import { loadDeliveryHealthSnapshot } from "../delivery-health/scan.js";
import { loadGhlHealth, type GhlHealth } from "./ghl-health.js";
import { loadInfrastructureHealth, type InfrastructureHealth, type QueueReader } from "./infra-health.js";
import { loadIntakeHealth, type IntakeHealth } from "./intake-health.js";
import { withReadOnlyDb } from "./read-only.js";
import { loadSheetsHealth, resolveCampaignLeadIds, type SheetsHealth } from "./sheets-health.js";
import { sanitizeCode } from "./sanitize.js";
import { resolveDiagnosticWindow, type DiagnosticWindowKey } from "./window.js";

export type Section<T> = ({ available: true } & T) | { available: false; error: string };

export type MonitorPreview = {
  note: string;
  lookbackHours: number;
  findings: Array<{ failureClass: string; severity: string; affectedCount: number }>;
};

export type AttentionEntry = {
  section: "intake" | "sheets" | "ghl" | "infrastructure";
  severity: "critical" | "warning" | "info";
  kind: string;
  count: number | null;
};

export type DeliveryDiagnosticsSummary = {
  generatedAt: string;
  window: { key: DiagnosticWindowKey; from: string; to: string; hours: number };
  filters: { clientAccountId: string | null; campaignId: string | null };
  readOnly: true;
  intake: Section<{ data: IntakeHealth }>;
  sheets: Section<{ data: SheetsHealth; monitorPreview: MonitorPreview | null }>;
  ghl: Section<{ data: GhlHealth }>;
  infrastructure: Section<{ data: InfrastructureHealth }>;
  attention: AttentionEntry[];
  coverage: string[];
};

export type SummaryDeps = {
  db: PrismaClient;
  redis: Pick<Redis, "ping">;
  readQueue: QueueReader;
  env?: NodeJS.ProcessEnv;
  now?: Date;
};

export const COVERAGE_STATEMENTS = [
  "Intake counts come from SA360's own tables. They show what SA360 received, not independently verified totals from LeadCapture, Zapier, Meta, or any other source. No source reports its own totals into SA360, so a lead that never reached SA360 is invisible here.",
  "Sheets success is a succeeded campaign job with written rows and a finish time. A 200 from the drain or from Google is not counted.",
  "GHL delivery is classified from the stored run and step receipts. Contact delivery, the required workflow, and optional operations are reported separately. A skipped optional step is never counted as a failed contact delivery.",
  "No live LeadConnector read is made. Whether a contact, opportunity, or workflow enrollment exists in GoHighLevel is not checked here. Only SA360's stored receipts are used.",
  "Shadow, disabled, not approved, and inventory-held deliveries are reported as intentional non-delivery and expected holds, not failures.",
  "Worker liveness is inferred from the latest completed repeatable drain job per queue. The worker writes no heartbeat of its own.",
  "Per-section evaluation is capped. A section marked truncated describes the most recent rows only.",
] as const;

function failure(err: unknown): { available: false; error: string } {
  return { available: false, error: sanitizeCode(err instanceof Error ? err.message : null) ?? "section_failed" };
}

export function buildAttention(input: {
  intake: DeliveryDiagnosticsSummary["intake"];
  sheets: DeliveryDiagnosticsSummary["sheets"];
  ghl: DeliveryDiagnosticsSummary["ghl"];
  infrastructure: DeliveryDiagnosticsSummary["infrastructure"];
}): AttentionEntry[] {
  const out: AttentionEntry[] = [];
  const push = (entry: AttentionEntry) => {
    if (entry.count == null || entry.count > 0) out.push(entry);
  };
  const { intake, sheets, ghl, infrastructure } = input;

  if (!infrastructure.available) {
    push({ section: "infrastructure", severity: "critical", kind: "infrastructure_unreadable", count: null });
  } else {
    const infra = infrastructure.data;
    if (!infra.postgres.ok) push({ section: "infrastructure", severity: "critical", kind: "postgres_unavailable", count: null });
    if (!infra.valkey.ok) push({ section: "infrastructure", severity: "critical", kind: "valkey_unavailable", count: null });
    if (infra.worker.status === "stale") push({ section: "infrastructure", severity: "critical", kind: "worker_drain_stale", count: null });
    if (infra.worker.status === "unknown") push({ section: "infrastructure", severity: "warning", kind: "worker_status_unknown", count: null });
    for (const queue of infra.queues) {
      if (!queue.available) push({ section: "infrastructure", severity: "warning", kind: `queue_unreadable:${queue.queue}`, count: null });
      push({ section: "infrastructure", severity: "warning", kind: `queue_stalled_candidates:${queue.queue}`, count: queue.stalledCandidates });
    }
  }
  if (!ghl.available) {
    push({ section: "ghl", severity: "warning", kind: "ghl_section_unreadable", count: null });
  } else {
    const flow = ghl.data.windowFlow;
    if (flow.truncated) {
      push({ section: "ghl", severity: "warning", kind: "ghl_evaluation_truncated", count: flow.intendedDeliveries - flow.evaluated });
    }
    const by = flow.byClass;
    push({ section: "ghl", severity: "critical", kind: "terminal_required_step_failure", count: by.terminal_required_step_failure ?? 0 });
    push({ section: "ghl", severity: "critical", kind: "required_workflow_incomplete", count: by.contact_delivered_required_workflow_incomplete ?? 0 });
    push({ section: "ghl", severity: "critical", kind: "contact_not_verified", count: by.contact_not_verified ?? 0 });
    push({ section: "ghl", severity: "critical", kind: "held_uncertain", count: by.held_uncertain ?? 0 });
    push({ section: "ghl", severity: "warning", kind: "pending_overdue", count: by.pending_overdue ?? 0 });
    push({ section: "ghl", severity: "warning", kind: "held_stale_executing", count: by.held_stale_executing ?? 0 });
    push({ section: "ghl", severity: "warning", kind: "retryable_failure", count: by.retryable_failure ?? 0 });
    push({ section: "ghl", severity: "warning", kind: "settled_without_run_unexplained", count: by.settled_without_run_unexplained ?? 0 });
    push({ section: "ghl", severity: "info", kind: "workflow_requirement_unrecorded", count: by.contact_delivered_workflow_requirement_unrecorded ?? 0 });
    push({ section: "ghl", severity: "info", kind: "optional_warnings", count: by.delivered_optional_warnings ?? 0 });
  }
  if (!sheets.available) {
    push({ section: "sheets", severity: "warning", kind: "sheets_section_unreadable", count: null });
  } else {
    const data = sheets.data;
    if (data.receipts.truncated) push({ section: "sheets", severity: "warning", kind: "sheets_receipts_truncated", count: null });
    push({ section: "sheets", severity: "critical", kind: "succeeded_job_missing_durable_rows", count: data.receipts.missingProof });
    push({ section: "sheets", severity: "critical", kind: "uncertain_job", count: data.openWork.uncertainJobs });
    push({ section: "sheets", severity: "warning", kind: "retryable_job", count: data.openWork.retryableJobs });
    const age = data.openWork.oldestPendingIntentAgeSeconds;
    if (age != null && age > 15 * 60) push({ section: "sheets", severity: "warning", kind: "stale_pending_intent", count: data.openWork.pendingIntents });
  }
  if (!intake.available) push({ section: "intake", severity: "warning", kind: "intake_section_unreadable", count: null });
  else push({ section: "intake", severity: "warning", kind: "intake_delivery_failed", count: intake.data.totals.deliveryFailed });

  return out;
}

export async function loadDeliveryDiagnosticsSummary(
  deps: SummaryDeps,
  query: { window: DiagnosticWindowKey; clientAccountId?: string; campaignId?: string }
): Promise<DeliveryDiagnosticsSummary> {
  const env = deps.env ?? process.env;
  const now = deps.now ?? new Date();
  const window = resolveDiagnosticWindow(query.window, now);
  const clientAccountId = query.clientAccountId ?? null;
  const campaignId = query.campaignId ?? null;

  let campaignLeadIds: { ids: string[] | null; capped: boolean } = { ids: null, capped: false };
  let campaignError: string | null = null;
  try {
    campaignLeadIds = await withReadOnlyDb(deps.db, (tx) =>
      resolveCampaignLeadIds(tx, { window, clientAccountId, campaignId })
    );
  } catch (err) {
    campaignError = failure(err).error;
  }

  const guarded = async <T>(work: () => Promise<T>): Promise<Section<{ data: T }>> => {
    if (campaignError) return { available: false, error: campaignError };
    try {
      return { available: true, data: await work() };
    } catch (err) {
      return failure(err);
    }
  };

  const intake = await guarded(() =>
    withReadOnlyDb(deps.db, (tx) => loadIntakeHealth(tx, { window, clientAccountId, campaignId }))
  );
  const sheetsBase = await guarded(() =>
    withReadOnlyDb(deps.db, async (tx) => {
      const data = await loadSheetsHealth(tx, { window, now, clientAccountId, campaignId, campaignLeadIds });
      let monitorPreview: MonitorPreview | null = null;
      if (clientAccountId) {
        const config = {
          ...readDeliveryHealthConfig(env),
          pilotClientIds: [clientAccountId],
          lookbackMs: window.to.getTime() - window.from.getTime(),
        };
        const loaded = await loadDeliveryHealthSnapshot(tx, config, now);
        const findings = evaluateDeliveryHealth(loaded.snapshot, now);
        monitorPreview = {
          note: "Evaluated with the existing monitor rules for this window. Nothing was stored, notified, or enabled. Covers company Sheets delivery only.",
          lookbackHours: window.hours,
          findings: findings.map((finding) => ({
            failureClass: finding.failureClass,
            severity: finding.severity,
            affectedCount: finding.affectedCount,
          })),
        };
      }
      return { sheets: data, monitorPreview };
    })
  );
  const sheets: DeliveryDiagnosticsSummary["sheets"] = sheetsBase.available
    ? { available: true, data: sheetsBase.data.sheets, monitorPreview: sheetsBase.data.monitorPreview }
    : sheetsBase;
  const ghl = await guarded(() =>
    withReadOnlyDb(deps.db, (tx) => loadGhlHealth(tx, { window, now, clientAccountId, campaignLeadIds }))
  );
  let infrastructure: DeliveryDiagnosticsSummary["infrastructure"];
  try {
    infrastructure = {
      available: true,
      data: await withReadOnlyDb(deps.db, (tx) =>
        loadInfrastructureHealth(tx, { now, env, redis: deps.redis, readQueue: deps.readQueue })
      ),
    };
  } catch (err) {
    infrastructure = failure(err);
  }

  return {
    generatedAt: now.toISOString(),
    window: { key: window.key, from: window.from.toISOString(), to: window.to.toISOString(), hours: window.hours },
    filters: { clientAccountId, campaignId },
    readOnly: true,
    intake,
    sheets,
    ghl,
    infrastructure,
    attention: buildAttention({ intake, sheets, ghl, infrastructure }),
    coverage: [...COVERAGE_STATEMENTS],
  };
}
