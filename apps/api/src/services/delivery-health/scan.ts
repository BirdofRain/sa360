/**
 * Read-only Google Sheets delivery-health scan.
 *
 * Reads SourceLeadEvent, CompanySheetsDispatchIntent, CompanySheetsDeliveryJob,
 * CompanySheetsDeliveryRow, WebhookRequestLog, and RoutingDryRunDecision.
 * Writes DeliveryHealthIncident and DeliveryHealthMonitorHeartbeat only.
 * Sheets success is canonicalCompanySheetsDelivery. HTTP 200 is not a receipt.
 * The scan does not retry an append or change routing, delivery flags, or Google data.
 * Mail goes through sendTransactionalEmail when SA360_DELIVERY_HEALTH_NOTIFY_ENABLED
 * is the exact string true. Otherwise the scan is a dry run.
 */

import { Prisma, type PrismaClient } from "@prisma/client";
import { isCompanySheetsInternalPilotDecision } from "@sa360/shared";

import { logger } from "../../lib/logger.js";
import {
  sendTransactionalEmail,
  type SendTransactionalEmailInput,
  type SendTransactionalEmailResult,
} from "../../lib/transactional-email.js";
import { readDeliveryHealthConfig, type DeliveryHealthConfig } from "./config.js";
import { deliveryHealthEvidenceDocument, scrubDeliveryHealthText, type DeliveryHealthSubject } from "./evidence.js";
import {
  monitorFollowUp,
  monitorNoticeAlreadySent,
  monitorNoticeKey,
  readDeliveryHealthHeartbeat,
  recordDeliveryHealthHeartbeatFailure,
  recordDeliveryHealthHeartbeatStart,
  recordDeliveryHealthHeartbeatSuccess,
  recordDeliveryHealthMonitorNotice,
  type DeliveryHealthHeartbeatSnapshot,
} from "./heartbeat.js";
import {
  composeDeliveryHealthEmail,
  composeMonitorHeartbeatEmail,
  deliveryHealthMail,
  planDeliveryHealthNotice,
  type DeliveryHealthNoticePlan,
} from "./notify.js";
import {
  delayMonitoringSuppressed,
  evaluateDeliveryHealth,
  isDelayFailureClass,
  type DeliveryHealthFinding,
  type DeliveryHealthSeverity,
  type DeliveryHealthSnapshot,
} from "./rules.js";

const SCAN_CAP = 500;

type Mailer = (input: SendTransactionalEmailInput) => Promise<SendTransactionalEmailResult>;

export type DeliveryHealthRunResult = {
  ok: boolean;
  skipped?: "flag_off";
  queried: boolean;
  dryRun: boolean;
  pilotClients: number;
  pilotIdsRejected: number;
  findings: number;
  opened: number;
  updated: number;
  resolved: number;
  suppressedResolved: number;
  notified: number;
  notificationSkipped: string | null;
  failureClasses: string[];
  truncated: boolean;
  heartbeat: "ok" | "failed" | "stale" | "skipped";
  error?: "scan_failed" | "pilot_unconfigured";
};

export type DeliveryHealthLoader = (
  db: PrismaClient,
  config: DeliveryHealthConfig,
  now: Date
) => Promise<{ snapshot: DeliveryHealthSnapshot; truncated: boolean }>;

export type DeliveryHealthScanDeps = {
  db: PrismaClient;
  env?: NodeJS.ProcessEnv;
  now?: Date;
  send?: Mailer;
  loadSnapshot?: DeliveryHealthLoader;
};

type IncidentRow = {
  id: string;
  clientAccountId: string;
  failureClass: string;
  severity: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
  lastNotifiedAt: Date | null;
  lastNotificationKey: string | null;
  lastNotificationKind: string | null;
  lastNotifiedSeverity: string | null;
  acknowledgedAt: Date | null;
  affectedCount: number;
  evidenceJson: Prisma.JsonValue;
};

type NoticeWork = {
  incidentId: string;
  plan: DeliveryHealthNoticePlan;
  severity: DeliveryHealthSeverity;
  failureClass: string;
  clientAccountId: string;
  affectedCount: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
  closure: "cleared" | "suppressed" | null;
  subjects: DeliveryHealthSubject[];
  resolve: boolean;
};

const INCIDENT_SELECT = {
  id: true,
  clientAccountId: true,
  failureClass: true,
  severity: true,
  firstSeenAt: true,
  lastSeenAt: true,
  lastNotifiedAt: true,
  lastNotificationKey: true,
  lastNotificationKind: true,
  lastNotifiedSeverity: true,
  acknowledgedAt: true,
  affectedCount: true,
  evidenceJson: true,
} as const;

export async function runDeliveryHealthMonitor(deps: DeliveryHealthScanDeps): Promise<DeliveryHealthRunResult> {
  const env = deps.env ?? process.env;
  const config = readDeliveryHealthConfig(env);
  const now = deps.now ?? new Date();
  const send = deps.send ?? sendTransactionalEmail;
  if (!config.monitorEnabled) return emptyResult(config, "flag_off");

  let prior: DeliveryHealthHeartbeatSnapshot | null = null;
  try {
    prior = await readDeliveryHealthHeartbeat(deps.db);
    await recordDeliveryHealthHeartbeatStart(deps.db, now);
  } catch (err) {
    logger.error("delivery_health.heartbeat_failed", { error: scrubDeliveryHealthText(errorMessage(err), 240) });
    return { ...emptyResult(config), ok: false, heartbeat: "failed" };
  }

  try {
    if (config.pilotClientIds.length === 0) {
      const detail = "pilot_unconfigured";
      await recordDeliveryHealthHeartbeatFailure(deps.db, now, detail);
      try {
        await deliverMonitorNotice(deps.db, prior, "scanner_failed", detail, config, send, now);
      } catch {
        /* A mail failure must not hide the configuration failure. */
      }
      logger.error("delivery_health.scan_failed", { error: detail });
      return {
        ...emptyResult(config),
        ok: false,
        queried: false,
        heartbeat: "failed",
        error: "pilot_unconfigured",
      };
    }
    const loaded = await (deps.loadSnapshot ?? loadDeliveryHealthSnapshot)(deps.db, config, now);
    const findings = evaluateDeliveryHealth(loaded.snapshot, now);
    const persisted = await persistScan(deps.db, loaded.snapshot, findings, loaded.truncated, config, now);
    await recordDeliveryHealthHeartbeatSuccess(deps.db, now);
    const mailed = await deliverNotices(deps.db, persisted.notices, config, send, now);
    const followUp = monitorFollowUp({ prior, now, staleMs: config.staleMs, succeeded: true });
    if (followUp === "heartbeat_stale" || followUp === "recovered") {
      await deliverMonitorNotice(deps.db, prior, followUp, monitorDetail(followUp), config, send, now);
    }
    const result: DeliveryHealthRunResult = {
      ok: true,
      queried: config.pilotClientIds.length > 0,
      dryRun: !config.notifyEnabled,
      pilotClients: config.pilotClientIds.length,
      pilotIdsRejected: config.pilotIdsRejected,
      findings: findings.length,
      opened: persisted.opened,
      updated: persisted.updated,
      resolved: persisted.resolved + mailed.resolved,
      suppressedResolved: persisted.suppressedResolved + mailed.suppressedResolved,
      notified: mailed.notified,
      notificationSkipped: config.notifyEnabled ? mailed.skipped : "notify_disabled",
      failureClasses: [...new Set(findings.map((finding) => finding.failureClass))].sort(),
      truncated: loaded.truncated,
      heartbeat: followUp === "heartbeat_stale" ? "stale" : "ok",
    };
    logger.info("delivery_health.scan", {
      pilotClients: result.pilotClients,
      findings: result.findings,
      notified: result.notified,
      dryRun: result.dryRun,
      truncated: result.truncated,
    });
    return result;
  } catch (err) {
    const detail = scrubDeliveryHealthText(errorMessage(err), 240);
    try {
      await recordDeliveryHealthHeartbeatFailure(deps.db, now, detail);
    } catch {
      /* The scan result still reports failure when the heartbeat update cannot land. */
    }
    try {
      await deliverMonitorNotice(deps.db, prior, "scanner_failed", detail, config, send, now);
    } catch {
      /* A mail failure must not hide the scan failure. */
    }
    logger.error("delivery_health.scan_failed", { error: detail });
    return {
      ...emptyResult(config),
      ok: false,
      queried: true,
      heartbeat: "failed",
      error: "scan_failed",
    };
  }
}

export async function loadDeliveryHealthSnapshot(
  db: PrismaClient,
  config: DeliveryHealthConfig,
  now: Date
): Promise<{ snapshot: DeliveryHealthSnapshot; truncated: boolean }> {
  const lookback = new Date(now.getTime() - config.lookbackMs);
  const pilotIds = config.pilotClientIds;
  let truncated = false;

  const open = await db.deliveryHealthIncident.findMany({
    where: { clientAccountId: { in: pilotIds }, resolvedAt: null },
    select: { evidenceJson: true },
  });
  const extraLeadIds = [...new Set(open.flatMap((row) => subjectLeadIds(row.evidenceJson)))];
  const extraDecisionIds = [...new Set(open.flatMap((row) => subjectDecisionIds(row.evidenceJson)))];
  const extraWebhookIds = [...new Set(open.flatMap((row) => subjectWebhookIds(row.evidenceJson)))];

  const recentLeads = await db.sourceLeadEvent.findMany({
    where: { clientAccountIdResolved: { in: pilotIds }, receivedAt: { gte: lookback } },
    select: LEAD_SELECT,
    orderBy: { receivedAt: "desc" },
    take: SCAN_CAP + 1,
  });
  if (recentLeads.length > SCAN_CAP) truncated = true;
  const extraLeads =
    extraLeadIds.length === 0
      ? []
      : await db.sourceLeadEvent.findMany({
          where: { id: { in: extraLeadIds }, clientAccountIdResolved: { in: pilotIds } },
          select: LEAD_SELECT,
        });
  const leads = uniqueById([...recentLeads.slice(0, SCAN_CAP), ...extraLeads]).map(toLead);
  const leadIds = leads.map((lead) => lead.id);

  const [clients, destinations, intents, jobs] = await Promise.all([
    db.clientAccount.findMany({
      where: { clientAccountId: { in: pilotIds } },
      select: { clientAccountId: true, status: true },
    }),
    db.companySheetsDestination.findMany({
      where: { clientAccountId: { in: pilotIds } },
      select: {
        clientAccountId: true,
        campaignDispatchEnabled: true,
        campaignDispatchNotBefore: true,
      },
    }),
    leadIds.length === 0
      ? Promise.resolve([])
      : db.companySheetsDispatchIntent.findMany({
          where: { clientAccountId: { in: pilotIds }, kind: "campaign_lead", sourceLeadEventId: { in: leadIds } },
          select: INTENT_SELECT,
        }),
    leadIds.length === 0
      ? Promise.resolve([])
      : db.companySheetsDeliveryJob.findMany({
          where: { clientAccountId: { in: pilotIds }, sourceLeadEventId: { in: leadIds } },
          select: JOB_SELECT,
        }),
  ]);

  const productionJobIds = jobs.filter((job) => job.kind === "lead").map((job) => job.id);
  const idempotencyKeys = jobs.map((job) => job.idempotencyKey);
  const [rows, testKeys] = await Promise.all([
    productionJobIds.length === 0
      ? Promise.resolve([])
      : db.companySheetsDeliveryRow.findMany({
          where: { jobId: { in: productionJobIds } },
          select: { jobId: true, status: true },
        }),
    idempotencyKeys.length === 0
      ? Promise.resolve([])
      : db.clientOnboardingTestAttemptKey.findMany({
          where: { idempotencyKey: { in: idempotencyKeys } },
          select: { idempotencyKey: true },
        }),
  ]);

  const decisions = await db.routingDryRunDecision.findMany({
    where: { destinationClientAccountId: { in: pilotIds }, matched: true, createdAt: { gte: lookback } },
    select: DECISION_SELECT,
    orderBy: { createdAt: "desc" },
    take: SCAN_CAP + 1,
  });
  if (decisions.length > SCAN_CAP) truncated = true;
  const extraDecisions =
    extraDecisionIds.length === 0
      ? []
      : await db.routingDryRunDecision.findMany({
          where: { id: { in: extraDecisionIds }, destinationClientAccountId: { in: pilotIds } },
          select: DECISION_SELECT,
        });
  const decisionPage = uniqueById([...decisions.slice(0, SCAN_CAP), ...extraDecisions]);
  const decisionIds = decisionPage.map((decision) => decision.id);

  const recentWebhooks =
    decisionIds.length === 0
      ? []
      : await db.webhookRequestLog.findMany({
          where: {
            clientAccountId: { in: pilotIds },
            receivedAt: { gte: lookback },
            routingDryRunDecisionId: { in: decisionIds },
          },
          select: WEBHOOK_SELECT,
          orderBy: { receivedAt: "desc" },
          take: SCAN_CAP + 1,
        });
  if (recentWebhooks.length > SCAN_CAP) truncated = true;
  const extraWebhooks =
    extraWebhookIds.length === 0
      ? []
      : await db.webhookRequestLog.findMany({
          where: { id: { in: extraWebhookIds }, clientAccountId: { in: pilotIds } },
          select: WEBHOOK_SELECT,
        });
  const webhooks = uniqueById([...recentWebhooks.slice(0, SCAN_CAP), ...extraWebhooks]);

  const webhookEventIds = webhooks.flatMap((row) => (row.sourceLeadEventId ? [row.sourceLeadEventId] : []));
  const [linkedEvents, webhookEvents] = await Promise.all([
    decisionIds.length === 0
      ? Promise.resolve([])
      : db.sourceLeadEvent.findMany({
          where: { routingDryRunDecisionId: { in: decisionIds } },
          select: { id: true, routingDryRunDecisionId: true },
        }),
    webhookEventIds.length === 0
      ? Promise.resolve([])
      : db.sourceLeadEvent.findMany({
          where: { id: { in: webhookEventIds } },
          select: { id: true },
        }),
  ]);
  const linkedDecisions = new Set(
    linkedEvents.flatMap((row) => (row.routingDryRunDecisionId ? [row.routingDryRunDecisionId] : []))
  );
  const existingEventIds = new Set(webhookEvents.map((row) => row.id));

  const destinationByClient = new Map(destinations.map((row) => [row.clientAccountId, row]));
  const decisionById = new Map(decisionPage.map((row) => [row.id, row]));
  const intake = webhooks.flatMap((webhook) => {
    const decisionId = webhook.routingDryRunDecisionId;
    if (!decisionId || !webhook.clientAccountId) return [];
    const decision = decisionById.get(decisionId);
    if (!decision || decision.destinationClientAccountId !== webhook.clientAccountId) return [];
    return [
      {
        clientAccountId: webhook.clientAccountId,
        routingDryRunDecisionId: decisionId,
        webhookRequestLogId: webhook.id,
        processingStatus: webhook.processingStatus,
        httpStatus: webhook.httpStatus,
        completedAt: webhook.completedAt,
        sourceEventExists:
          linkedDecisions.has(decisionId) ||
          (webhook.sourceLeadEventId != null && existingEventIds.has(webhook.sourceLeadEventId)),
        syntheticPilot: isCompanySheetsInternalPilotDecision(decision),
        matched: decision.matched,
      },
    ];
  });

  return {
    truncated,
    snapshot: {
      clients: clients.map((client) => ({
        clientAccountId: client.clientAccountId,
        status: client.status,
        destination: destinationByClient.get(client.clientAccountId) ?? null,
      })),
      leads,
      intents,
      jobs,
      rows,
      onboardingTestAttemptKeys: testKeys.map((row) => row.idempotencyKey),
      intake,
    },
  };
}

async function persistScan(
  db: PrismaClient,
  snapshot: DeliveryHealthSnapshot,
  findings: DeliveryHealthFinding[],
  truncated: boolean,
  config: DeliveryHealthConfig,
  now: Date
): Promise<{ opened: number; updated: number; resolved: number; suppressedResolved: number; notices: NoticeWork[] }> {
  const open = await db.deliveryHealthIncident.findMany({
    where: { clientAccountId: { in: config.pilotClientIds }, resolvedAt: null },
    select: INCIDENT_SELECT,
  });
  const clients = new Map(snapshot.clients.map((client) => [client.clientAccountId, client]));
  const observedIntake = new Set(snapshot.intake.map((candidate) => candidate.routingDryRunDecisionId));
  const findingKeys = new Set(findings.map((finding) => `${finding.clientAccountId}|${finding.failureClass}`));
  let opened = 0;
  let updated = 0;
  let resolved = 0;
  let suppressedResolved = 0;
  const notices: NoticeWork[] = [];

  for (const finding of findings) {
    const saved = await upsertFinding(db, finding, now);
    if (saved.created) opened += 1;
    else updated += 1;
    const plan = planDeliveryHealthNotice({
      incidentId: saved.row.id,
      severity: finding.severity,
      now,
      cooldownMs: config.cooldownMs,
      phase: "open",
      closure: "cleared",
      previous: noticeState(saved.row),
    });
    if (!plan) continue;
    const evidence = deliveryHealthEvidenceDocument(finding.subjects, finding.affectedCount);
    notices.push({
      incidentId: saved.row.id,
      plan,
      severity: finding.severity,
      failureClass: finding.failureClass,
      clientAccountId: finding.clientAccountId,
      affectedCount: finding.affectedCount,
      firstSeenAt: saved.row.firstSeenAt,
      lastSeenAt: now,
      closure: null,
      subjects: evidence.subjects,
      resolve: false,
    });
  }

  if (!truncated) {
    for (const row of open) {
      if (findingKeys.has(`${row.clientAccountId}|${row.failureClass}`)) continue;
      if (!missingIntakeObserved(row, observedIntake)) continue;
      const closure =
        isDelayFailureClass(row.failureClass) && delayMonitoringSuppressed(clients.get(row.clientAccountId))
          ? "suppressed"
          : "cleared";
      const severity = row.severity === "critical" ? "critical" : "warning";
      const plan = planDeliveryHealthNotice({
        incidentId: row.id,
        severity,
        now,
        cooldownMs: config.cooldownMs,
        phase: "resolved",
        closure,
        previous: noticeState(row),
      });
      if (!config.notifyEnabled || !plan) {
        await markResolved(db, row.id, now, null);
        resolved += 1;
        if (closure === "suppressed") suppressedResolved += 1;
        continue;
      }
      const evidence = deliveryHealthEvidenceDocument(subjectsFromEvidence(row.evidenceJson), row.affectedCount);
      notices.push({
        incidentId: row.id,
        plan,
        severity,
        failureClass: row.failureClass,
        clientAccountId: row.clientAccountId,
        affectedCount: row.affectedCount,
        firstSeenAt: row.firstSeenAt,
        lastSeenAt: row.lastSeenAt,
        closure,
        subjects: evidence.subjects,
        resolve: true,
      });
    }
  }

  return { opened, updated, resolved, suppressedResolved, notices };
}

async function deliverNotices(
  db: PrismaClient,
  notices: NoticeWork[],
  config: DeliveryHealthConfig,
  send: Mailer,
  now: Date
): Promise<{ notified: number; skipped: string | null; resolved: number; suppressedResolved: number }> {
  if (!config.notifyEnabled) {
    let resolved = 0;
    let suppressedResolved = 0;
    for (const notice of notices) {
      if (!notice.resolve) continue;
      await markResolved(db, notice.incidentId, now, null);
      resolved += 1;
      if (notice.closure === "suppressed") suppressedResolved += 1;
    }
    return { notified: 0, skipped: "notify_disabled", resolved, suppressedResolved };
  }
  if (notices.length === 0) return { notified: 0, skipped: null, resolved: 0, suppressedResolved: 0 };
  if (config.recipients.length === 0) {
    return { notified: 0, skipped: "recipients_missing", resolved: 0, suppressedResolved: 0 };
  }
  let notified = 0;
  let resolved = 0;
  let suppressedResolved = 0;
  let skipped: string | null = null;
  for (const notice of notices) {
    await db.deliveryHealthIncident.update({
      where: { id: notice.incidentId },
      data: { lastNotificationKey: notice.plan.key, lastNotificationKind: notice.plan.kind },
    });
    const email = composeDeliveryHealthEmail({
      kind: notice.plan.kind,
      severity: notice.severity,
      failureClass: notice.failureClass,
      clientAccountId: notice.clientAccountId,
      affectedCount: notice.affectedCount,
      firstSeenAt: notice.firstSeenAt,
      lastSeenAt: notice.lastSeenAt,
      closure: notice.closure,
      subjects: notice.subjects,
    });
    const mailed = await send(
      deliveryHealthMail({
        to: config.recipients,
        subject: email.subject,
        text: email.text,
        idempotencyKey: notice.plan.key,
      })
    );
    if (!mailed.ok) {
      skipped = mailed.skipped ? "email_not_configured" : "send_failed";
      continue;
    }
    notified += 1;
    if (notice.resolve) {
      await markResolved(db, notice.incidentId, now, { ...notice.plan, severity: notice.severity });
      resolved += 1;
      if (notice.closure === "suppressed") suppressedResolved += 1;
    } else {
      await db.deliveryHealthIncident.update({
        where: { id: notice.incidentId },
        data: {
          lastNotifiedAt: now,
          lastNotificationKind: notice.plan.kind,
          lastNotificationKey: notice.plan.key,
          lastNotifiedSeverity: notice.severity,
        },
      });
    }
  }
  return { notified, skipped, resolved, suppressedResolved };
}

async function deliverMonitorNotice(
  db: PrismaClient,
  prior: DeliveryHealthHeartbeatSnapshot | null,
  reason: "scanner_failed" | "heartbeat_stale" | "recovered",
  detail: string,
  config: DeliveryHealthConfig,
  send: Mailer,
  now: Date
): Promise<void> {
  if (!config.notifyEnabled || config.recipients.length === 0) return;
  const key = monitorNoticeKey({ reason, now, cooldownMs: config.cooldownMs, prior });
  const current = (await readDeliveryHealthHeartbeat(db)) ?? prior;
  if (monitorNoticeAlreadySent(current, key)) return;
  const email = composeMonitorHeartbeatEmail({
    reason,
    consecutiveFailures: reason === "scanner_failed" ? (prior?.consecutiveFailures ?? 0) + 1 : (prior?.consecutiveFailures ?? 0),
    detail,
  });
  const mailed = await send(
    deliveryHealthMail({
      to: config.recipients,
      subject: email.subject,
      text: email.text,
      idempotencyKey: key,
    })
  );
  if (!mailed.ok) return;
  await recordDeliveryHealthMonitorNotice(db, { key, notifiedAt: now });
}

async function upsertFinding(
  db: PrismaClient,
  finding: DeliveryHealthFinding,
  now: Date
): Promise<{ row: IncidentRow; created: boolean }> {
  const evidence = deliveryHealthEvidenceDocument(finding.subjects, finding.affectedCount);
  const existing = await db.deliveryHealthIncident.findFirst({
    where: { clientAccountId: finding.clientAccountId, failureClass: finding.failureClass, resolvedAt: null },
    select: INCIDENT_SELECT,
  });
  if (!existing) {
    try {
      const created = await db.deliveryHealthIncident.create({
        data: {
          clientAccountId: finding.clientAccountId,
          failureClass: finding.failureClass,
          severity: finding.severity,
          status: "open",
          firstSeenAt: now,
          lastSeenAt: now,
          affectedCount: finding.affectedCount,
          evidenceJson: evidence,
        },
        select: INCIDENT_SELECT,
      });
      return { row: created, created: true };
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      const raced = await db.deliveryHealthIncident.findFirst({
        where: { clientAccountId: finding.clientAccountId, failureClass: finding.failureClass, resolvedAt: null },
        select: INCIDENT_SELECT,
      });
      if (!raced) throw err;
      return { row: await updateFinding(db, raced, finding, evidence, now), created: false };
    }
  }
  return { row: await updateFinding(db, existing, finding, evidence, now), created: false };
}

async function updateFinding(
  db: PrismaClient,
  existing: IncidentRow,
  finding: DeliveryHealthFinding,
  evidence: { affectedCount: number; subjects: DeliveryHealthSubject[] },
  now: Date
): Promise<IncidentRow> {
  return db.deliveryHealthIncident.update({
    where: { id: existing.id },
    data: {
      severity: finding.severity,
      status: existing.acknowledgedAt ? "acknowledged" : "open",
      lastSeenAt: now,
      affectedCount: finding.affectedCount,
      evidenceJson: evidence,
    },
    select: INCIDENT_SELECT,
  });
}

async function markResolved(
  db: PrismaClient,
  id: string,
  now: Date,
  notice: (DeliveryHealthNoticePlan & { severity: DeliveryHealthSeverity }) | null
): Promise<void> {
  await db.deliveryHealthIncident.updateMany({
    where: { id, resolvedAt: null },
    data: {
      status: "resolved",
      resolvedAt: now,
      lastSeenAt: now,
      ...(notice
        ? {
            lastNotifiedAt: now,
            lastNotificationKind: notice.kind,
            lastNotificationKey: notice.key,
            lastNotifiedSeverity: notice.severity,
          }
        : {}),
    },
  });
}

function noticeState(row: IncidentRow) {
  return {
    lastNotifiedAt: row.lastNotifiedAt,
    lastNotificationKey: row.lastNotificationKey,
    lastNotificationKind: row.lastNotificationKind,
    lastNotifiedSeverity: row.lastNotifiedSeverity,
    acknowledgedAt: row.acknowledgedAt,
  };
}

function subjectsFromEvidence(value: Prisma.JsonValue): DeliveryHealthSubject[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const subjects = (value as { subjects?: unknown }).subjects;
  if (!Array.isArray(subjects)) return [];
  return subjects.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    return [
      {
        sourceLeadEventId: typeof record.sourceLeadEventId === "string" ? record.sourceLeadEventId : null,
        dispatchIntentId: typeof record.dispatchIntentId === "string" ? record.dispatchIntentId : null,
        jobId: typeof record.jobId === "string" ? record.jobId : null,
        jobStatus: typeof record.jobStatus === "string" ? record.jobStatus : null,
        code: typeof record.code === "string" ? record.code : null,
        routingDryRunDecisionId: typeof record.routingDryRunDecisionId === "string" ? record.routingDryRunDecisionId : null,
        webhookRequestLogId: typeof record.webhookRequestLogId === "string" ? record.webhookRequestLogId : null,
      },
    ];
  });
}

function subjectLeadIds(value: Prisma.JsonValue): string[] {
  return subjectsFromEvidence(value).flatMap((subject) => (subject.sourceLeadEventId ? [subject.sourceLeadEventId] : []));
}

function subjectDecisionIds(value: Prisma.JsonValue): string[] {
  return subjectsFromEvidence(value).flatMap((subject) =>
    subject.routingDryRunDecisionId ? [subject.routingDryRunDecisionId] : []
  );
}

function subjectWebhookIds(value: Prisma.JsonValue): string[] {
  return subjectsFromEvidence(value).flatMap((subject) => (subject.webhookRequestLogId ? [subject.webhookRequestLogId] : []));
}

/** Aging out of the lookback is not recovery. Resolve missing intake only after this scan reloaded it. */
function missingIntakeObserved(row: IncidentRow, observedDecisions: Set<string>): boolean {
  if (row.failureClass !== "missing_intake") return true;
  const decisionIds = subjectDecisionIds(row.evidenceJson);
  return decisionIds.length > 0 && decisionIds.every((id) => observedDecisions.has(id));
}

function emptySnapshot(): DeliveryHealthSnapshot {
  return { clients: [], leads: [], intents: [], jobs: [], rows: [], onboardingTestAttemptKeys: [], intake: [] };
}

function emptyResult(config: DeliveryHealthConfig, skipped?: "flag_off"): DeliveryHealthRunResult {
  return {
    ok: true,
    skipped,
    queried: false,
    dryRun: true,
    pilotClients: config.pilotClientIds.length,
    pilotIdsRejected: config.pilotIdsRejected,
    findings: 0,
    opened: 0,
    updated: 0,
    resolved: 0,
    suppressedResolved: 0,
    notified: 0,
    notificationSkipped: skipped === "flag_off" || !config.notifyEnabled ? "notify_disabled" : null,
    failureClasses: [],
    truncated: false,
    heartbeat: skipped === "flag_off" ? "skipped" : "ok",
  };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "scan_failed";
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

function uniqueById<T extends { id: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row);
  }
  return out;
}

function monitorDetail(reason: "heartbeat_stale" | "recovered"): string {
  if (reason === "recovered") return "The scanner completed after a failed or stale heartbeat.";
  return "The previous scanner heartbeat is older than the stale window. This run completed.";
}

const LEAD_SELECT = {
  id: true,
  clientAccountIdResolved: true,
  status: true,
  routedAt: true,
  receivedAt: true,
  sourceRouteKey: true,
  cleanupStatus: true,
  enrichmentMetadataJson: true,
} as const;

const INTENT_SELECT = {
  id: true,
  clientAccountId: true,
  sourceLeadEventId: true,
  kind: true,
  status: true,
  reason: true,
  lastError: true,
  jobId: true,
  createdAt: true,
} as const;

const JOB_SELECT = {
  id: true,
  kind: true,
  status: true,
  clientAccountId: true,
  sourceLeadEventId: true,
  idempotencyKey: true,
  rowsWritten: true,
  appendStartedAt: true,
  finishedAt: true,
  lastError: true,
  uncertainReason: true,
  createdAt: true,
} as const;

const DECISION_SELECT = {
  id: true,
  destinationClientAccountId: true,
  matched: true,
  attributionSnapshot: true,
} as const;

const WEBHOOK_SELECT = {
  id: true,
  clientAccountId: true,
  routingDryRunDecisionId: true,
  sourceLeadEventId: true,
  processingStatus: true,
  httpStatus: true,
  completedAt: true,
} as const;

function toLead(row: {
  id: string;
  clientAccountIdResolved: string | null;
  status: string;
  routedAt: Date | null;
  receivedAt: Date;
  sourceRouteKey: string | null;
  cleanupStatus: string | null;
  enrichmentMetadataJson: Prisma.JsonValue;
}) {
  return {
    id: row.id,
    clientAccountId: row.clientAccountIdResolved ?? "",
    status: row.status,
    routedAt: row.routedAt,
    receivedAt: row.receivedAt,
    sourceRouteKey: row.sourceRouteKey,
    cleanupStatus: row.cleanupStatus,
    enrichmentMetadataJson: row.enrichmentMetadataJson,
  };
}
