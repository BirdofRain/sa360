import type { PrismaClient } from "@prisma/client";

import { isCustomWebhookDeliveryEnabled } from "../../lib/custom-webhook-env.js";
import { isDeliverySuccessNotifyEnabled } from "../../lib/delivery-success-notification-env.js";
import {
  sendTransactionalEmail,
  type SendTransactionalEmailInput,
  type SendTransactionalEmailResult,
} from "../../lib/transactional-email.js";
import {
  canonicalCompanySheetsDelivery,
  canonicalGhlDelivery,
  type CompanySheetsCanonicalInput,
  type GhlCanonicalInput,
  type GhlCanonicalStep,
} from "../delivery-success/canonical-delivery.js";
import { isPersistedLiveDestination } from "../ghl-destination-authorization.js";
import { parseSourceEnrichmentPolicyJson } from "../source-intake/source-enrichment.service.js";
import {
  DELIVERY_SUCCESS_NOTIFICATION_STATUS,
  claimDeliverySuccessNotification,
  deliverySuccessResendIdempotencyKey,
  isSourceLeadEligibleForClientNotification,
  recordDeliverySuccessNotification,
} from "./notification-claim.js";

/**
 * Per-client successful-delivery notification scanner.
 *
 * Runs only when SA360_DELIVERY_SUCCESS_NOTIFY_ENABLED is the exact string
 * "true". There is no production schedule in this module. It does not call
 * Google, GoHighLevel, Meta, Resend (unless the injected mailer does), or a
 * customer webhook, and it does not use the production GHL receipt helper,
 * the aged-order customer release notifier, or the support-ticket notifier.
 *
 * A custom webhook can be armed, but this baseline has no qualifying webhook
 * receipt. An armed webhook therefore qualifies nothing.
 */

const SHEETS_OPEN = new Set(["queued", "running", "retryable", "uncertain"]);
const GHL_OPEN_RUN = new Set(["executing"]);
const GHL_OPEN_OUTBOX = new Set(["uncertain", "executing"]);
const EMAIL_SUBJECT = "A lead was delivered";

export type DeliveryNotificationMailer = (
  input: SendTransactionalEmailInput
) => Promise<SendTransactionalEmailResult>;

export type ScanCanonicalDeliveryNotificationsResult = {
  enabled: boolean;
  queried: boolean;
  inserted: number;
  sent: number;
  failed: number;
  skipped: number;
  alreadySent: number;
  withheld: number;
};

type ArmedDestinations = {
  sheets: boolean;
  ghl: boolean;
  webhook: boolean;
};

type QualifiedLead = {
  sourceLeadEventId: string;
  completedAt: Date;
  sheetsJobId: string | null;
  ghlLiveRunId: string | null;
  customWebhookAttemptId: string | null;
};

type SheetsJob = {
  id: string;
  kind: string;
  status: string;
  clientAccountId: string;
  sourceLeadEventId: string | null;
  idempotencyKey: string;
  rowsWritten: number;
  appendStartedAt: Date | null;
  finishedAt: Date | null;
  rows: Array<{ jobId: string; status: string }>;
};

type SheetsIntent = {
  kind: string;
  clientAccountId: string;
  sourceLeadEventId: string | null;
  jobId: string | null;
  createdAt: Date;
};

type GhlRun = {
  id: string;
  mode: string;
  status: string;
  completedAt: Date | null;
  destinationClientAccountId: string;
  idempotencyKey: string;
  stepRuns: Array<{
    stepOrder: number;
    stepType: string;
    status: string;
    externalId: string | null;
    errorCode: string | null;
    responseRedactedJson: unknown;
  }>;
};

type GhlOutbox = {
  status: string;
  clientAccountId: string;
  sourceLeadEventId: string;
  externalCallExecuted: boolean;
  lastError: string | null;
  liveRunId: string | null;
};

export async function scanCanonicalDeliveryNotifications(input: {
  db: PrismaClient;
  env?: NodeJS.ProcessEnv;
  now?: Date;
  send?: DeliveryNotificationMailer;
}): Promise<ScanCanonicalDeliveryNotificationsResult> {
  const env = input.env ?? process.env;
  if (!isDeliverySuccessNotifyEnabled(env)) {
    return emptyResult(false);
  }

  const db = input.db;
  const now = input.now ?? new Date();
  const send = input.send ?? sendTransactionalEmail;
  const result = emptyResult(true);
  result.queried = true;

  const preferences = await db.clientDeliveryNotificationPreference.findMany({
    where: {
      enabled: true,
      channel: "email",
      recipientEmail: { not: null },
      recipientEmailVerifiedAt: { not: null },
      enabledAt: { not: null },
    },
  });

  for (const preference of preferences) {
    if (!singleMailbox(preference.recipientEmail) || !preference.enabledAt || !preference.recipientEmailVerifiedAt) {
      continue;
    }
    if (preference.clientAccountId.includes(":")) continue;
    await scanClient({
      db,
      env,
      now,
      send,
      result,
      clientAccountId: preference.clientAccountId,
      enabledAt: preference.enabledAt,
    });
  }

  return result;
}

async function scanClient(input: {
  db: PrismaClient;
  env: NodeJS.ProcessEnv;
  now: Date;
  send: DeliveryNotificationMailer;
  result: ScanCanonicalDeliveryNotificationsResult;
  clientAccountId: string;
  enabledAt: Date;
}): Promise<void> {
  const { db, clientAccountId } = input;
  const [sheetsDestination, ghlDestination, webhook, profile] = await Promise.all([
    db.companySheetsDestination.findUnique({
      where: { clientAccountId },
      select: {
        clientAccountId: true,
        campaignDispatchEnabled: true,
        campaignDispatchNotBefore: true,
      },
    }),
    db.clientGhlDestination.findUnique({ where: { clientAccountId } }),
    db.clientCustomWebhookDestination.findUnique({
      where: { clientAccountId },
      select: { enabled: true },
    }),
    db.clientOnboardingDestinationProfile.findUnique({
      where: { clientAccountId },
      select: { clientAccountId: true, notesEnabled: true },
    }),
  ]);

  const armed: ArmedDestinations = {
    sheets: Boolean(
      sheetsDestination?.campaignDispatchEnabled && sheetsDestination.campaignDispatchNotBefore
    ),
    ghl: isPersistedLiveDestination(ghlDestination, ghlDestination?.destinationSubaccountIdGhl),
    webhook: isCustomWebhookDeliveryEnabled(input.env) && webhook?.enabled === true,
  };
  if (!armed.sheets && !armed.ghl && !armed.webhook) return;
  // No qualifying custom-webhook receipt exists. An armed webhook cannot notify.
  if (armed.webhook) return;

  const [jobs, intents, runs, outboxes] = await Promise.all([
    armed.sheets
      ? db.companySheetsDeliveryJob.findMany({
          where: { clientAccountId },
          include: { rows: { select: { jobId: true, status: true } } },
        })
      : Promise.resolve([]),
    armed.sheets
      ? db.companySheetsDispatchIntent.findMany({
          where: { clientAccountId, kind: "campaign_lead" },
          select: {
            kind: true,
            clientAccountId: true,
            sourceLeadEventId: true,
            jobId: true,
            createdAt: true,
          },
        })
      : Promise.resolve([]),
    armed.ghl
      ? db.ghlLiveDeliveryRun.findMany({
          where: { destinationClientAccountId: clientAccountId },
          include: {
            stepRuns: {
              select: {
                stepOrder: true,
                stepType: true,
                status: true,
                externalId: true,
                errorCode: true,
                responseRedactedJson: true,
              },
            },
          },
        })
      : Promise.resolve([]),
    armed.ghl
      ? db.ghlAssociationDispatchOutbox.findMany({
          where: { clientAccountId },
          select: {
            status: true,
            clientAccountId: true,
            sourceLeadEventId: true,
            externalCallExecuted: true,
            lastError: true,
            liveRunId: true,
          },
        })
      : Promise.resolve([]),
  ]);

  const onboardingKeys = await loadOnboardingKeys(db, jobs, runs);
  const attemptIds = await loadOnboardingAttemptIds(db, runs);
  const qualified = qualifyLeads({
    armed,
    enabledAt: input.enabledAt,
    sheetsDestination,
    jobs,
    intents,
    ghlDestination,
    profile,
    runs,
    outboxes,
    onboardingKeys,
    attemptIds,
  });

  for (const lead of qualified) {
    await notifyQualifiedLead({ ...input, lead });
  }
}

async function notifyQualifiedLead(input: {
  db: PrismaClient;
  now: Date;
  send: DeliveryNotificationMailer;
  result: ScanCanonicalDeliveryNotificationsResult;
  clientAccountId: string;
  lead: QualifiedLead;
}): Promise<void> {
  const { db, lead, result, clientAccountId } = input;
  const recorded = await recordDeliverySuccessNotification(db, {
    clientAccountId,
    sourceLeadEventId: lead.sourceLeadEventId,
    sheetsJobId: lead.sheetsJobId,
    ghlLiveRunId: lead.ghlLiveRunId,
    customWebhookAttemptId: lead.customWebhookAttemptId,
  });
  if (recorded.inserted) result.inserted += 1;
  if (!evidenceStored(recorded, lead)) {
    result.withheld += 1;
    return;
  }

  const claim = await claimDeliverySuccessNotification(db, {
    idempotencyKey: recorded.idempotencyKey,
    now: input.now,
  });
  if (!claim.ok || !claim.claimed) {
    if (claim.ok && claim.outcome === "already_sent") result.alreadySent += 1;
    return;
  }

  const fresh = await db.clientDeliveryNotificationPreference.findUnique({
    where: { clientAccountId },
  });
  const recipient = singleMailbox(fresh?.recipientEmail);
  if (!fresh?.enabled || !recipient || !fresh.recipientEmailVerifiedAt || fresh.channel !== "email") {
    await markFromSending(db, claim.id, {
      status: DELIVERY_SUCCESS_NOTIFICATION_STATUS.skipped,
      skipReason: "recipient_not_verified",
      lastError: null,
    });
    result.skipped += 1;
    return;
  }

  const email = buildDeliverySuccessEmail();
  let sent: SendTransactionalEmailResult;
  try {
    sent = await input.send({
      to: recipient,
      subject: email.subject,
      text: email.text,
      idempotencyKey: deliverySuccessResendIdempotencyKey(recorded.idempotencyKey),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "send failed";
    sent = { ok: false, error: message };
  }

  if (sent.ok) {
    await markFromSending(db, claim.id, {
      status: DELIVERY_SUCCESS_NOTIFICATION_STATUS.sent,
      sentAt: input.now,
      providerMessageId: sent.id ?? null,
      lastError: null,
    });
    result.sent += 1;
    return;
  }
  if (sent.skipped) {
    await markFromSending(db, claim.id, {
      status: DELIVERY_SUCCESS_NOTIFICATION_STATUS.skipped,
      skipReason: "email_not_configured",
      lastError: sent.error.slice(0, 300),
    });
    result.skipped += 1;
    return;
  }
  await markFromSending(db, claim.id, {
    status: DELIVERY_SUCCESS_NOTIFICATION_STATUS.failed,
    lastError: sent.error.slice(0, 300),
  });
  result.failed += 1;
}

function qualifyLeads(input: {
  armed: ArmedDestinations;
  enabledAt: Date;
  sheetsDestination: {
    clientAccountId: string;
    campaignDispatchNotBefore: Date | null;
  } | null;
  jobs: SheetsJob[];
  intents: SheetsIntent[];
  ghlDestination: {
    clientAccountId: string;
    workflowStartRequired: boolean;
    opportunityCreationEnabled: boolean;
    destinationPipelineIdGhl: string | null;
    destinationPipelineStageIdGhl: string | null;
    sourceEnrichmentPolicyJson: unknown;
  } | null;
  profile: { clientAccountId: string; notesEnabled: boolean } | null;
  runs: GhlRun[];
  outboxes: GhlOutbox[];
  onboardingKeys: string[];
  attemptIds: Map<string, string>;
}): QualifiedLead[] {
  const leadIds = new Set<string>();
  if (input.armed.sheets) {
    for (const job of input.jobs) {
      const leadId = safeIdentity(job.sourceLeadEventId);
      if (leadId) leadIds.add(leadId);
    }
  }
  if (input.armed.ghl) {
    for (const outbox of input.outboxes) {
      const leadId = safeIdentity(outbox.sourceLeadEventId);
      if (leadId) leadIds.add(leadId);
    }
  }

  const qualified: QualifiedLead[] = [];
  for (const sourceLeadEventId of leadIds) {
    const lead = qualifyLead(sourceLeadEventId, input);
    if (lead) qualified.push(lead);
  }
  return qualified;
}

function qualifyLead(
  sourceLeadEventId: string,
  input: Parameters<typeof qualifyLeads>[0]
): QualifiedLead | null {
  let sheetsJobId: string | null = null;
  let ghlLiveRunId: string | null = null;
  const completions: number[] = [];

  if (input.armed.sheets) {
    const sheets = canonicalSheetsForLead(sourceLeadEventId, input);
    if (!sheets) return null;
    sheetsJobId = sheets.receiptId;
    completions.push(sheets.completedAtMs);
  }
  if (input.armed.ghl) {
    const ghl = canonicalGhlForLead(sourceLeadEventId, input);
    if (!ghl) return null;
    ghlLiveRunId = ghl.receiptId;
    completions.push(ghl.completedAtMs);
  }
  if (completions.length === 0) return null;
  const completedAt = new Date(Math.max(...completions));
  if (
    !isSourceLeadEligibleForClientNotification({
      enabled: true,
      enabledAt: input.enabledAt,
      completedAt,
    })
  ) {
    return null;
  }
  return {
    sourceLeadEventId,
    completedAt,
    sheetsJobId,
    ghlLiveRunId,
    customWebhookAttemptId: null,
  };
}

function canonicalSheetsForLead(
  sourceLeadEventId: string,
  input: Parameters<typeof qualifyLeads>[0]
): { receiptId: string; completedAtMs: number } | null {
  const jobs = input.jobs.filter((job) => safeIdentity(job.sourceLeadEventId) === sourceLeadEventId);
  if (jobs.length === 0 || jobs.some((job) => SHEETS_OPEN.has(job.status))) return null;
  const matches: Array<{ receiptId: string; completedAtMs: number }> = [];
  for (const job of jobs) {
    const verdict = canonicalCompanySheetsDelivery({
      evidence: "campaign_job",
      job: {
        id: job.id,
        kind: job.kind,
        status: job.status,
        clientAccountId: job.clientAccountId,
        sourceLeadEventId: job.sourceLeadEventId,
        idempotencyKey: job.idempotencyKey,
        rowsWritten: job.rowsWritten,
        appendStartedAt: job.appendStartedAt,
        finishedAt: job.finishedAt,
      },
      rows: job.rows,
      destination: input.sheetsDestination
        ? {
            clientAccountId: input.sheetsDestination.clientAccountId,
            campaignDispatchNotBefore: input.sheetsDestination.campaignDispatchNotBefore,
          }
        : null,
      intent: intentForJob(job, input.intents),
      spreadsheetDeliveredAt: null,
      onboardingTestAttemptKeys: input.onboardingKeys,
    } satisfies CompanySheetsCanonicalInput);
    const completedAtMs = verdict.canonical ? completionMs(verdict.at) : null;
    if (!verdict.canonical || !verdict.receiptId || completedAtMs == null) continue;
    matches.push({ receiptId: verdict.receiptId, completedAtMs });
  }
  matches.sort((a, b) => b.completedAtMs - a.completedAtMs || a.receiptId.localeCompare(b.receiptId));
  return matches[0] ?? null;
}

function canonicalGhlForLead(
  sourceLeadEventId: string,
  input: Parameters<typeof qualifyLeads>[0]
): { receiptId: string; completedAtMs: number } | null {
  if (!input.ghlDestination) return null;
  const leadOutboxes = input.outboxes.filter(
    (outbox) => safeIdentity(outbox.sourceLeadEventId) === sourceLeadEventId
  );
  if (leadOutboxes.some((outbox) => GHL_OPEN_OUTBOX.has(outbox.status))) return null;
  const runIds = new Set(leadOutboxes.map((outbox) => outbox.liveRunId).filter((id): id is string => Boolean(id)));
  const runs = input.runs.filter((run) => runIds.has(run.id) && run.mode === "ongoing_association");
  if (runs.some((run) => GHL_OPEN_RUN.has(run.status))) return null;

  const policy = parseSourceEnrichmentPolicyJson(input.ghlDestination.sourceEnrichmentPolicyJson);
  const opportunityConfigured =
    !policy.lalAiBot1VetWebform && input.ghlDestination.opportunityCreationEnabled === true;
  const matches: Array<{ receiptId: string; completedAtMs: number }> = [];
  for (const run of runs) {
    const outbox = leadOutboxes.find((item) => item.liveRunId === run.id) ?? null;
    const steps: GhlCanonicalStep[] = [...run.stepRuns]
      .sort((a, b) => a.stepOrder - b.stepOrder)
      .map((step) => ({
        stepType: step.stepType,
        status: step.status,
        externalId: step.externalId,
        errorCode: step.errorCode,
        responseRedactedJson: step.responseRedactedJson,
      }));
    const verdict = canonicalGhlDelivery({
      run: {
        id: run.id,
        mode: run.mode,
        status: run.status,
        completedAt: run.completedAt,
        destinationClientAccountId: run.destinationClientAccountId,
        idempotencyKey: run.idempotencyKey,
      },
      steps,
      destination: {
        clientAccountId: input.ghlDestination.clientAccountId,
        workflowStartRequired: input.ghlDestination.workflowStartRequired,
      },
      opportunityConfigured,
      intakeSummaryNotesEnabled: policy.intakeSummaryNotesEnabled === true,
      onboardingProfileNotesEnabled: input.profile?.notesEnabled ?? false,
      profile: input.profile
        ? { clientAccountId: input.profile.clientAccountId, notesEnabled: input.profile.notesEnabled }
        : null,
      outbox: outbox
        ? {
            status: outbox.status,
            clientAccountId: outbox.clientAccountId,
            sourceLeadEventId: outbox.sourceLeadEventId,
            externalCallExecuted: outbox.externalCallExecuted,
            lastError: outbox.lastError,
            liveRunId: outbox.liveRunId,
          }
        : null,
      onboardingTestAttemptId: input.attemptIds.get(run.idempotencyKey) ?? null,
      onboardingTestAttemptKeys: input.onboardingKeys,
    } satisfies GhlCanonicalInput);
    const completedAtMs = verdict.canonical ? completionMs(verdict.at) : null;
    if (!verdict.canonical || !verdict.receiptId || completedAtMs == null) continue;
    if (verdict.sourceLeadEventId !== sourceLeadEventId) continue;
    matches.push({ receiptId: verdict.receiptId, completedAtMs });
  }
  matches.sort((a, b) => b.completedAtMs - a.completedAtMs || a.receiptId.localeCompare(b.receiptId));
  return matches[0] ?? null;
}

function intentForJob(job: SheetsJob, intents: SheetsIntent[]) {
  const matches = intents.filter(
    (intent) =>
      intent.kind === "campaign_lead" &&
      intent.clientAccountId === job.clientAccountId &&
      safeIdentity(intent.sourceLeadEventId) === safeIdentity(job.sourceLeadEventId) &&
      (intent.jobId == null || intent.jobId === "" || intent.jobId === job.id)
  );
  const intent = matches.find((item) => item.jobId === job.id) ?? matches[0] ?? null;
  if (!intent) return null;
  return {
    kind: intent.kind,
    clientAccountId: intent.clientAccountId,
    sourceLeadEventId: intent.sourceLeadEventId,
    jobId: intent.jobId,
    createdAt: intent.createdAt,
  };
}

async function loadOnboardingKeys(db: PrismaClient, jobs: SheetsJob[], runs: GhlRun[]): Promise<string[]> {
  const candidates = new Set<string>();
  for (const job of jobs) candidates.add(job.idempotencyKey);
  for (const run of runs) {
    if (run.idempotencyKey) candidates.add(run.idempotencyKey);
    for (const step of run.stepRuns) collectIdempotencyKeys(step.responseRedactedJson, candidates);
  }
  const keys = [...candidates].filter((key) => key.trim().length > 0);
  if (keys.length === 0) return [];
  const rows = await db.clientOnboardingTestAttemptKey.findMany({
    where: { idempotencyKey: { in: keys } },
    select: { idempotencyKey: true },
  });
  return rows.map((row) => row.idempotencyKey);
}

async function loadOnboardingAttemptIds(db: PrismaClient, runs: GhlRun[]): Promise<Map<string, string>> {
  const keys = runs.map((run) => run.idempotencyKey).filter((key) => key.trim().length > 0);
  const ids = new Map<string, string>();
  if (keys.length === 0) return ids;
  const attempts = await db.clientOnboardingTestAttempt.findMany({
    where: { idempotencyKey: { in: keys } },
    select: { id: true, idempotencyKey: true },
  });
  for (const attempt of attempts) ids.set(attempt.idempotencyKey, attempt.id);
  return ids;
}

function collectIdempotencyKeys(value: unknown, into: Set<string>): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) collectIdempotencyKeys(item, into);
    return;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.idempotencyKey === "string" && record.idempotencyKey.trim()) {
    into.add(record.idempotencyKey.trim());
  }
  for (const nested of Object.values(record)) collectIdempotencyKeys(nested, into);
}

function evidenceStored(
  row: { sheetsJobId: string | null; ghlLiveRunId: string | null; customWebhookAttemptId: string | null },
  lead: QualifiedLead
): boolean {
  if (lead.sheetsJobId && row.sheetsJobId !== lead.sheetsJobId) return false;
  if (lead.ghlLiveRunId && row.ghlLiveRunId !== lead.ghlLiveRunId) return false;
  if (lead.customWebhookAttemptId && row.customWebhookAttemptId !== lead.customWebhookAttemptId) {
    return false;
  }
  return Boolean(lead.sheetsJobId || lead.ghlLiveRunId || lead.customWebhookAttemptId);
}

function buildDeliverySuccessEmail(): { subject: string; text: string } {
  return {
    subject: EMAIL_SUBJECT,
    text: [
      "A lead was successfully delivered.",
      "",
      "This notice is sent once after every armed destination has confirmed delivery.",
      "",
    ].join("\n"),
  };
}

function singleMailbox(value: string | null | undefined): string | null {
  if (!value) return null;
  const email = value.trim();
  if (!email || email !== email.toLowerCase()) return null;
  if (/[,;\s<>]/.test(email)) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

function safeIdentity(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes(":")) return null;
  return trimmed;
}

function completionMs(at: string | null): number | null {
  if (!at) return null;
  const ms = Date.parse(at);
  return Number.isNaN(ms) ? null : ms;
}

async function markFromSending(
  db: PrismaClient,
  id: string,
  data: {
    status: "sent" | "failed" | "skipped";
    sentAt?: Date;
    providerMessageId?: string | null;
    lastError?: string | null;
    skipReason?: string | null;
  }
): Promise<void> {
  await db.deliverySuccessNotification.updateMany({
    where: { id, status: DELIVERY_SUCCESS_NOTIFICATION_STATUS.sending },
    data,
  });
}

function emptyResult(enabled: boolean): ScanCanonicalDeliveryNotificationsResult {
  return {
    enabled,
    queried: false,
    inserted: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    alreadySent: 0,
    withheld: 0,
  };
}
