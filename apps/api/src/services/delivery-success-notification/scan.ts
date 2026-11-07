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
  type NotificationDb,
} from "./notification-claim.js";

/**
 * Per-client successful-delivery notification scanner.
 *
 * Runs only when SA360_DELIVERY_SUCCESS_NOTIFY_ENABLED is the exact string
 * "true". There is no production schedule in this module. It does not call
 * Google, GoHighLevel, Meta, or a customer webhook, and it does not use the
 * production GHL receipt helper, the aged-order customer release notifier,
 * or the support-ticket notifier.
 *
 * A walk reads one indexed page at a time. The cursor resumes that walk. It
 * is not an eligibility clock and it is not stored. Omitting the cursor
 * starts again at the first enabled client, so a later walk still sees a
 * lead that qualified after the previous walk. enabledAt remains the only
 * eligibility clock.
 *
 * The decision locks the preference and destination rows and re-reads them.
 * That transaction commits before the receipt row is written and before any
 * email call. A unique receipt conflict cannot be repaired inside the open
 * transaction, so the merged claim primitive writes the row immediately
 * after the commit. A second read then repeats the preference, recipient,
 * enabledAt, and armed-destination checks. Email is never sent inside a
 * database transaction.
 *
 * A custom webhook can be armed, but this baseline has no qualifying webhook
 * receipt. An armed webhook therefore qualifies nothing.
 */

const SHEETS_OPEN = new Set(["queued", "running", "retryable", "uncertain"]);
const GHL_OPEN_RUN = new Set(["executing"]);
const GHL_OPEN_OUTBOX = new Set(["uncertain", "executing"]);
const EMAIL_SUBJECT = "A lead was delivered";
const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;
const PAGE_GUARD = 100_000;

export type DeliveryNotificationMailer = (
  input: SendTransactionalEmailInput
) => Promise<SendTransactionalEmailResult>;

export type DeliveryNotificationScanHook = (context: {
  clientAccountId: string;
  sourceLeadEventId: string;
  completedAt: Date;
  recipientEmail: string;
}) => Promise<void>;

export type ScanCanonicalDeliveryNotificationsResult = {
  enabled: boolean;
  queried: boolean;
  inserted: number;
  sent: number;
  failed: number;
  skipped: number;
  alreadySent: number;
  withheld: number;
  done: boolean;
  cursor: string | null;
  pages: number;
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

type LeadVerdict =
  | { state: "ready"; lead: QualifiedLead }
  | { state: "before_enabled_at"; lead: QualifiedLead }
  | { state: "not_ready" };

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

type PreferenceSnapshot = {
  enabled: boolean;
  channel: string;
  recipientEmail: string | null;
  recipientEmailVerifiedAt: Date | null;
  enabledAt: Date | null;
};

type SheetsDestinationRow = {
  clientAccountId: string;
  campaignDispatchEnabled: boolean;
  campaignDispatchNotBefore: Date | null;
};

type GhlDestinationRow = {
  clientAccountId: string;
  workflowStartRequired: boolean;
  opportunityCreationEnabled: boolean;
  destinationPipelineIdGhl: string | null;
  destinationPipelineStageIdGhl: string | null;
  sourceEnrichmentPolicyJson: unknown;
  deliveryEnabled: boolean;
  deliveryMode: string;
  clientCutoverApproved: boolean;
  internalApprovalStatus: string;
  destinationSubaccountIdGhl: string;
};

type ProfileRow = { clientAccountId: string; notesEnabled: boolean };

type ClientSettings = {
  preference: PreferenceSnapshot;
  armed: ArmedDestinations;
  sheetsDestination: SheetsDestinationRow | null;
  ghlDestination: GhlDestinationRow | null;
  profile: ProfileRow | null;
};

type CursorState = {
  v: 1;
  afterClientId: string | null;
  clientAccountId: string | null;
  sheetsDone: boolean;
  sheetsCreatedAt: string | null;
  sheetsId: string | null;
  ghlDone: boolean;
  ghlStartedAt: string | null;
  ghlId: string | null;
};

type SendAuthorization = {
  id: string;
  idempotencyKey: string;
  recipientEmail: string;
  completedAt: Date;
  lead: QualifiedLead;
};

type ConfirmResult =
  | { ok: true; recipientEmail: string }
  | { ok: false; permanent: boolean; reason: string };

export async function scanCanonicalDeliveryNotifications(input: {
  db: PrismaClient;
  env?: NodeJS.ProcessEnv;
  now?: Date;
  send?: DeliveryNotificationMailer;
  beforeSend?: DeliveryNotificationScanHook;
  /** Resume one walk. Omit it to start from the first enabled client. */
  cursor?: string | null;
  /** Indexed rows read for one channel page. */
  pageSize?: number;
  /** Stop after this many pages and return a cursor. Omit it to finish the walk. */
  maxPages?: number;
  /** Limit this walk to one client. The unscoped walk still visits every enabled client. */
  clientAccountId?: string;
}): Promise<ScanCanonicalDeliveryNotificationsResult> {
  const env = input.env ?? process.env;
  if (!isDeliverySuccessNotifyEnabled(env)) {
    return emptyResult(false);
  }

  const db = input.db;
  const now = input.now ?? new Date();
  const send = input.send ?? sendTransactionalEmail;
  const pageSize = normalizePageSize(input.pageSize);
  const result = emptyResult(true);
  result.queried = true;
  let state = input.cursor ? decodeCursor(input.cursor) : initialCursor();
  if (
    input.clientAccountId &&
    state.clientAccountId &&
    state.clientAccountId !== input.clientAccountId
  ) {
    throw new Error("Delivery notification scan cursor does not match clientAccountId.");
  }
  const seen = new Set<string>();

  while (input.maxPages == null || result.pages < input.maxPages) {
    if (result.pages >= PAGE_GUARD) {
      throw new Error("Delivery notification scan exceeded its page guard.");
    }
    const before = encodeCursor(state);
    const step = await scanOnePage({
      db,
      env,
      now,
      send,
      beforeSend: input.beforeSend,
      pageSize,
      scope: input.clientAccountId?.trim() || null,
      state,
      result,
      seen,
    });
    result.pages += 1;
    if (step.done) {
      result.done = true;
      result.cursor = null;
      return result;
    }
    const after = encodeCursor(step.state);
    if (after === before) {
      throw new Error("Delivery notification scan cursor did not advance.");
    }
    state = step.state;
  }

  result.done = false;
  result.cursor = encodeCursor(state);
  return result;
}

async function scanOnePage(input: {
  db: PrismaClient;
  env: NodeJS.ProcessEnv;
  now: Date;
  send: DeliveryNotificationMailer;
  beforeSend?: DeliveryNotificationScanHook;
  pageSize: number;
  scope: string | null;
  state: CursorState;
  result: ScanCanonicalDeliveryNotificationsResult;
  seen: Set<string>;
}): Promise<{ done: true } | { done: false; state: CursorState }> {
  let state = input.state;
  if (!state.clientAccountId) {
    const next = await nextPreference(input.db, state.afterClientId, input.scope);
    if (!next) return { done: true };
    const recipient = singleMailbox(next.recipientEmail);
    if (!recipient || !next.enabledAt || !next.recipientEmailVerifiedAt || next.clientAccountId.includes(":")) {
      return { done: false, state: finishClient(state, next.clientAccountId) };
    }
    const settings = await loadSettings(input.db, input.env, next.clientAccountId);
    if (!settings || (!settings.armed.sheets && !settings.armed.ghl)) {
      return { done: false, state: finishClient(state, next.clientAccountId) };
    }
    if (settings.armed.webhook) {
      return { done: false, state: finishClient(state, next.clientAccountId) };
    }
    state = {
      ...initialCursor(),
      afterClientId: state.afterClientId,
      clientAccountId: next.clientAccountId,
      sheetsDone: !settings.armed.sheets,
      ghlDone: !settings.armed.ghl,
    };
  }

  const clientAccountId = state.clientAccountId;
  if (!clientAccountId) return { done: true };
  const preference = await input.db.clientDeliveryNotificationPreference.findUnique({
    where: { clientAccountId },
  });
  if (
    !preference?.enabled ||
    preference.channel !== "email" ||
    !preference.enabledAt ||
    !singleMailbox(preference.recipientEmail) ||
    !preference.recipientEmailVerifiedAt
  ) {
    return { done: false, state: finishClient(state, clientAccountId) };
  }

  const settings = await loadSettings(input.db, input.env, clientAccountId);
  if (!settings || (!settings.armed.sheets && !settings.armed.ghl)) {
    return { done: false, state: finishClient(state, clientAccountId) };
  }
  if (settings.armed.webhook) {
    return { done: false, state: finishClient(state, clientAccountId) };
  }

  if (settings.armed.sheets && !state.sheetsDone) {
    const page = await pageSheets(input.db, clientAccountId, state, input.pageSize);
    await considerLeads({
      ...input,
      clientAccountId,
      leadIds: leadIdsFrom(page.map((row) => row.sourceLeadEventId)),
      settings,
      enabledAt: preference.enabledAt,
    });
    const sheetsDone = page.length < input.pageSize;
    const last = page.at(-1);
    state = {
      ...state,
      sheetsDone,
      sheetsCreatedAt: last ? asDate(last.createdAt).toISOString() : state.sheetsCreatedAt,
      sheetsId: last?.id ?? state.sheetsId,
    };
  } else if (settings.armed.ghl && !state.ghlDone) {
    const page = await pageGhl(input.db, clientAccountId, state, input.pageSize);
    const outboxes = await outboxesForRuns(
      input.db,
      clientAccountId,
      page.map((row) => row.id)
    );
    await considerLeads({
      ...input,
      clientAccountId,
      leadIds: leadIdsFrom(outboxes.map((row) => row.sourceLeadEventId)),
      settings,
      enabledAt: preference.enabledAt,
    });
    const ghlDone = page.length < input.pageSize;
    const last = page.at(-1);
    state = {
      ...state,
      ghlDone,
      ghlStartedAt: last ? asDate(last.startedAt).toISOString() : state.ghlStartedAt,
      ghlId: last?.id ?? state.ghlId,
    };
  }

  if (state.sheetsDone && state.ghlDone && state.clientAccountId) {
    const finished = finishClient(state, state.clientAccountId);
    if (input.scope && finished.afterClientId === input.scope) return { done: true };
    return { done: false, state: finished };
  }
  return { done: false, state };
}

async function considerLeads(input: {
  db: PrismaClient;
  env: NodeJS.ProcessEnv;
  now: Date;
  send: DeliveryNotificationMailer;
  beforeSend?: DeliveryNotificationScanHook;
  result: ScanCanonicalDeliveryNotificationsResult;
  seen: Set<string>;
  clientAccountId: string;
  leadIds: string[];
  settings: ClientSettings;
  enabledAt: Date;
}): Promise<void> {
  const pendingIds = input.leadIds.filter((leadId) => !input.seen.has(seenKey(input.clientAccountId, leadId)));
  if (pendingIds.length === 0) return;
  const terminal = await input.db.deliverySuccessNotification.findMany({
    where: {
      clientAccountId: input.clientAccountId,
      sourceLeadEventId: { in: pendingIds },
      status: {
        in: [DELIVERY_SUCCESS_NOTIFICATION_STATUS.sent, DELIVERY_SUCCESS_NOTIFICATION_STATUS.skipped],
      },
    },
    select: { sourceLeadEventId: true, status: true },
  });
  const sent = new Set(
    terminal
      .filter((row) => row.status === DELIVERY_SUCCESS_NOTIFICATION_STATUS.sent)
      .map((row) => row.sourceLeadEventId)
  );
  const skipped = new Set(
    terminal
      .filter((row) => row.status === DELIVERY_SUCCESS_NOTIFICATION_STATUS.skipped)
      .map((row) => row.sourceLeadEventId)
  );
  const openIds = pendingIds.filter((leadId) => !sent.has(leadId) && !skipped.has(leadId));
  for (const leadId of pendingIds) {
    if (sent.has(leadId)) {
      input.seen.add(seenKey(input.clientAccountId, leadId));
      input.result.alreadySent += 1;
    }
  }
  if (openIds.length === 0) return;
  const evidence = await loadEvidence(input.db, input.clientAccountId, openIds, input.settings.armed);
  for (const leadId of openIds) {
    const verdict = classifyLead(leadId, {
      armed: input.settings.armed,
      enabledAt: input.enabledAt,
      preferenceEnabled: true,
      sheetsDestination: input.settings.sheetsDestination,
      jobs: evidence.jobs,
      intents: evidence.intents,
      ghlDestination: input.settings.ghlDestination,
      profile: input.settings.profile,
      runs: evidence.runs,
      outboxes: evidence.outboxes,
      onboardingKeys: evidence.onboardingKeys,
      attemptIds: evidence.attemptIds,
    });
    if (verdict.state === "before_enabled_at") {
      input.seen.add(seenKey(input.clientAccountId, leadId));
      if (await closeOpenNotification(input.db, input.clientAccountId, leadId, "enabled_at_advanced")) {
        input.result.skipped += 1;
      }
      continue;
    }
    if (verdict.state !== "ready") continue;
    input.seen.add(seenKey(input.clientAccountId, verdict.lead.sourceLeadEventId));
    await notifyQualifiedLead({
      db: input.db,
      env: input.env,
      now: input.now,
      send: input.send,
      beforeSend: input.beforeSend,
      result: input.result,
      clientAccountId: input.clientAccountId,
      lead: verdict.lead,
    });
  }
}

async function notifyQualifiedLead(input: {
  db: PrismaClient;
  env: NodeJS.ProcessEnv;
  now: Date;
  send: DeliveryNotificationMailer;
  beforeSend?: DeliveryNotificationScanHook;
  result: ScanCanonicalDeliveryNotificationsResult;
  clientAccountId: string;
  lead: QualifiedLead;
}): Promise<void> {
  const decision = await input.db.$transaction(
    async (tx) => decideNotification(tx, input.clientAccountId, input.env, input.lead),
    { maxWait: 5_000, timeout: 15_000 }
  );
  if (decision.action === "skipped") {
    input.result.skipped += 1;
    return;
  }
  if (decision.action !== "ready") {
    input.result.withheld += 1;
    return;
  }

  // The merged claim primitive fills a conflicting row in a follow-up statement.
  // A unique violation inside this interactive transaction aborts the whole
  // transaction, so the insert runs only after the locked decision commits.
  const recorded = await recordDeliverySuccessNotification(input.db, {
    clientAccountId: input.clientAccountId,
    sourceLeadEventId: decision.lead.sourceLeadEventId,
    sheetsJobId: decision.lead.sheetsJobId,
    ghlLiveRunId: decision.lead.ghlLiveRunId,
    customWebhookAttemptId: decision.lead.customWebhookAttemptId,
  });
  if (recorded.inserted) input.result.inserted += 1;
  if (recorded.status === DELIVERY_SUCCESS_NOTIFICATION_STATUS.sent) {
    input.result.alreadySent += 1;
    return;
  }
  if (recorded.status === DELIVERY_SUCCESS_NOTIFICATION_STATUS.skipped) {
    input.result.skipped += 1;
    return;
  }
  if (!evidenceStored(recorded, decision.lead)) {
    input.result.withheld += 1;
    return;
  }
  if (
    recorded.status !== DELIVERY_SUCCESS_NOTIFICATION_STATUS.pending &&
    recorded.status !== DELIVERY_SUCCESS_NOTIFICATION_STATUS.failed
  ) {
    input.result.withheld += 1;
    return;
  }
  const auth: SendAuthorization = {
    id: recorded.id,
    idempotencyKey: recorded.idempotencyKey,
    recipientEmail: decision.recipientEmail,
    completedAt: decision.lead.completedAt,
    lead: decision.lead,
  };

  if (input.beforeSend) {
    await input.beforeSend({
      clientAccountId: input.clientAccountId,
      sourceLeadEventId: input.lead.sourceLeadEventId,
      completedAt: auth.completedAt,
      recipientEmail: auth.recipientEmail,
    });
  }

  const gate = await confirmSend(input.db, input.env, input.clientAccountId, auth);
  if (!gate.ok) {
    await applyGate(input.db, input.result, auth, gate, false);
    return;
  }

  const claim = await claimDeliverySuccessNotification(input.db, {
    idempotencyKey: auth.idempotencyKey,
    now: input.now,
  });
  if (!claim.ok || !claim.claimed) {
    if (claim.ok && claim.outcome === "already_sent") input.result.alreadySent += 1;
    return;
  }

  const gateAfterClaim = await confirmSend(input.db, input.env, input.clientAccountId, auth);
  if (!gateAfterClaim.ok) {
    await applyGate(input.db, input.result, auth, gateAfterClaim, true);
    return;
  }

  const email = buildDeliverySuccessEmail();
  let sent: SendTransactionalEmailResult;
  try {
    sent = await input.send({
      to: gateAfterClaim.recipientEmail,
      subject: email.subject,
      text: email.text,
      idempotencyKey: deliverySuccessResendIdempotencyKey(auth.idempotencyKey),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "send failed";
    sent = { ok: false, error: message };
  }

  if (sent.ok) {
    await markFromSending(input.db, auth.id, {
      status: DELIVERY_SUCCESS_NOTIFICATION_STATUS.sent,
      sentAt: input.now,
      providerMessageId: sent.id ?? null,
      lastError: null,
    });
    input.result.sent += 1;
    return;
  }
  if (sent.skipped) {
    await markFromSending(input.db, auth.id, {
      status: DELIVERY_SUCCESS_NOTIFICATION_STATUS.skipped,
      skipReason: "email_not_configured",
      lastError: sent.error.slice(0, 300),
    });
    input.result.skipped += 1;
    return;
  }
  await markFromSending(input.db, auth.id, {
    status: DELIVERY_SUCCESS_NOTIFICATION_STATUS.failed,
    lastError: sent.error.slice(0, 300),
  });
  input.result.failed += 1;
}

async function decideNotification(
  db: NotificationDb,
  clientAccountId: string,
  env: NodeJS.ProcessEnv,
  expected: QualifiedLead
): Promise<
  | { action: "ready"; recipientEmail: string; lead: QualifiedLead }
  | { action: "skipped" | "withhold" }
> {
  await lockClientRows(db, clientAccountId);
  const settings = await loadSettings(db, env, clientAccountId);
  const recipient = singleMailbox(settings?.preference.recipientEmail);
  const enabledAt = settings?.preference.enabledAt ?? null;
  if (
    !settings ||
    !settings.preference.enabled ||
    settings.preference.channel !== "email" ||
    !recipient ||
    !settings.preference.recipientEmailVerifiedAt ||
    !enabledAt
  ) {
    const closed = await closeOpenNotification(db, clientAccountId, expected.sourceLeadEventId, "preference_disabled");
    return { action: closed ? "skipped" : "withhold" };
  }
  if (!settings.armed.sheets && !settings.armed.ghl) return { action: "withhold" };
  if (settings.armed.webhook) return { action: "withhold" };

  const evidence = await loadEvidence(db, clientAccountId, [expected.sourceLeadEventId], settings.armed);
  const verdict = classifyLead(expected.sourceLeadEventId, {
    armed: settings.armed,
    enabledAt,
    preferenceEnabled: true,
    sheetsDestination: settings.sheetsDestination,
    jobs: evidence.jobs,
    intents: evidence.intents,
    ghlDestination: settings.ghlDestination,
    profile: settings.profile,
    runs: evidence.runs,
    outboxes: evidence.outboxes,
    onboardingKeys: evidence.onboardingKeys,
    attemptIds: evidence.attemptIds,
  });
  if (verdict.state === "before_enabled_at") {
    const closed = await closeOpenNotification(db, clientAccountId, expected.sourceLeadEventId, "enabled_at_advanced");
    return { action: closed ? "skipped" : "withhold" };
  }
  if (verdict.state !== "ready") return { action: "withhold" };
  return { action: "ready", recipientEmail: recipient, lead: verdict.lead };
}

async function confirmSend(
  db: NotificationDb,
  env: NodeJS.ProcessEnv,
  clientAccountId: string,
  auth: SendAuthorization
): Promise<ConfirmResult> {
  if (!isDeliverySuccessNotifyEnabled(env)) return { ok: false, permanent: false, reason: "flag" };
  const row = await db.deliverySuccessNotification.findUnique({
    where: { id: auth.id },
    select: {
      status: true,
      sheetsJobId: true,
      ghlLiveRunId: true,
      customWebhookAttemptId: true,
    },
  });
  if (!row) return { ok: false, permanent: false, reason: "missing" };
  if (row.status === DELIVERY_SUCCESS_NOTIFICATION_STATUS.sent) {
    return { ok: false, permanent: false, reason: "sent" };
  }
  if (row.status === DELIVERY_SUCCESS_NOTIFICATION_STATUS.skipped) {
    return { ok: false, permanent: false, reason: "skipped" };
  }
  const settings = await loadSettings(db, env, clientAccountId);
  const recipient = singleMailbox(settings?.preference.recipientEmail);
  if (
    !settings ||
    !settings.preference.enabled ||
    settings.preference.channel !== "email" ||
    !recipient ||
    !settings.preference.recipientEmailVerifiedAt ||
    !settings.preference.enabledAt
  ) {
    return { ok: false, permanent: true, reason: "preference_disabled" };
  }
  if (recipient !== auth.recipientEmail) return { ok: false, permanent: true, reason: "recipient_changed" };
  if (
    !isSourceLeadEligibleForClientNotification({
      enabled: true,
      enabledAt: settings.preference.enabledAt,
      completedAt: auth.completedAt,
    })
  ) {
    return { ok: false, permanent: true, reason: "enabled_at_advanced" };
  }
  if (!settings.armed.sheets && !settings.armed.ghl) return { ok: false, permanent: false, reason: "unarmed" };
  if (settings.armed.webhook) return { ok: false, permanent: false, reason: "webhook_armed" };

  const evidence = await loadEvidence(db, clientAccountId, [auth.lead.sourceLeadEventId], settings.armed);
  const verdict = classifyLead(auth.lead.sourceLeadEventId, {
    armed: settings.armed,
    enabledAt: settings.preference.enabledAt,
    preferenceEnabled: true,
    sheetsDestination: settings.sheetsDestination,
    jobs: evidence.jobs,
    intents: evidence.intents,
    ghlDestination: settings.ghlDestination,
    profile: settings.profile,
    runs: evidence.runs,
    outboxes: evidence.outboxes,
    onboardingKeys: evidence.onboardingKeys,
    attemptIds: evidence.attemptIds,
  });
  if (verdict.state === "before_enabled_at") {
    return { ok: false, permanent: true, reason: "enabled_at_advanced" };
  }
  if (verdict.state !== "ready" || !evidenceStored(row, verdict.lead)) {
    return { ok: false, permanent: false, reason: "not_ready" };
  }
  return { ok: true, recipientEmail: recipient };
}

async function applyGate(
  db: PrismaClient,
  result: ScanCanonicalDeliveryNotificationsResult,
  auth: SendAuthorization,
  gate: Extract<ConfirmResult, { ok: false }>,
  claimed: boolean
): Promise<void> {
  if (gate.reason === "sent") {
    result.alreadySent += 1;
    return;
  }
  if (gate.reason === "skipped") return;
  if (!gate.permanent) {
    if (claimed) await releaseClaim(db, auth.id);
    result.withheld += 1;
    return;
  }
  if (claimed) {
    await markFromSending(db, auth.id, {
      status: DELIVERY_SUCCESS_NOTIFICATION_STATUS.skipped,
      skipReason: gate.reason,
      lastError: null,
    });
  } else {
    await db.deliverySuccessNotification.updateMany({
      where: {
        id: auth.id,
        status: {
          in: [DELIVERY_SUCCESS_NOTIFICATION_STATUS.pending, DELIVERY_SUCCESS_NOTIFICATION_STATUS.failed],
        },
      },
      data: {
        status: DELIVERY_SUCCESS_NOTIFICATION_STATUS.skipped,
        skipReason: gate.reason,
      },
    });
  }
  result.skipped += 1;
}

async function loadSettings(
  db: NotificationDb,
  env: NodeJS.ProcessEnv,
  clientAccountId: string
): Promise<ClientSettings | null> {
  const [preference, sheetsDestination, ghlDestination, webhook, profile] = await Promise.all([
    db.clientDeliveryNotificationPreference.findUnique({ where: { clientAccountId } }),
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
  if (!preference) return null;
  return {
    preference,
    sheetsDestination,
    ghlDestination,
    profile,
    armed: {
      sheets: Boolean(sheetsDestination?.campaignDispatchEnabled && sheetsDestination.campaignDispatchNotBefore),
      ghl: isPersistedLiveDestination(ghlDestination, ghlDestination?.destinationSubaccountIdGhl),
      webhook: isCustomWebhookDeliveryEnabled(env) && webhook?.enabled === true,
    },
  };
}

async function loadEvidence(
  db: NotificationDb,
  clientAccountId: string,
  leadIds: string[],
  armed: ArmedDestinations
): Promise<{
  jobs: SheetsJob[];
  intents: SheetsIntent[];
  runs: GhlRun[];
  outboxes: GhlOutbox[];
  onboardingKeys: string[];
  attemptIds: Map<string, string>;
}> {
  const empty = {
    jobs: [],
    intents: [],
    runs: [],
    outboxes: [],
    onboardingKeys: [],
    attemptIds: new Map<string, string>(),
  };
  if (leadIds.length === 0) return empty;
  const [jobs, intents, outboxes] = await Promise.all([
    armed.sheets
      ? db.companySheetsDeliveryJob.findMany({
          where: { clientAccountId, sourceLeadEventId: { in: leadIds } },
          select: {
            id: true,
            kind: true,
            status: true,
            clientAccountId: true,
            sourceLeadEventId: true,
            idempotencyKey: true,
            rowsWritten: true,
            appendStartedAt: true,
            finishedAt: true,
            rows: { select: { jobId: true, status: true } },
          },
        })
      : Promise.resolve([]),
    armed.sheets
      ? db.companySheetsDispatchIntent.findMany({
          where: { clientAccountId, kind: "campaign_lead", sourceLeadEventId: { in: leadIds } },
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
      ? db.ghlAssociationDispatchOutbox.findMany({
          where: { clientAccountId, sourceLeadEventId: { in: leadIds } },
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
  const runIds = [...new Set(outboxes.flatMap((row) => (row.liveRunId ? [row.liveRunId] : [])))];
  const runs =
    armed.ghl && runIds.length > 0
      ? await db.ghlLiveDeliveryRun.findMany({
          where: { id: { in: runIds }, destinationClientAccountId: clientAccountId, mode: "ongoing_association" },
          select: {
            id: true,
            mode: true,
            status: true,
            completedAt: true,
            destinationClientAccountId: true,
            idempotencyKey: true,
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
      : [];
  const onboardingKeys = await loadOnboardingKeys(db, jobs, runs);
  const attemptIds = await loadOnboardingAttemptIds(db, runs);
  return { jobs, intents, runs, outboxes, onboardingKeys, attemptIds };
}

async function pageSheets(
  db: PrismaClient,
  clientAccountId: string,
  state: CursorState,
  pageSize: number
): Promise<Array<{ id: string; createdAt: Date; sourceLeadEventId: string | null }>> {
  if (!state.sheetsCreatedAt || !state.sheetsId) {
    return db.$queryRaw`
      SELECT "id", "createdAt", "sourceLeadEventId"
      FROM "CompanySheetsDeliveryJob"
      WHERE "clientAccountId" = ${clientAccountId}
      ORDER BY "createdAt" ASC, "id" ASC
      LIMIT ${pageSize}
    `;
  }
  const createdAt = new Date(state.sheetsCreatedAt);
  return db.$queryRaw`
    SELECT "id", "createdAt", "sourceLeadEventId"
    FROM "CompanySheetsDeliveryJob"
    WHERE "clientAccountId" = ${clientAccountId}
      AND ("createdAt" > ${createdAt} OR ("createdAt" = ${createdAt} AND "id" > ${state.sheetsId}))
    ORDER BY "createdAt" ASC, "id" ASC
    LIMIT ${pageSize}
  `;
}

async function pageGhl(
  db: PrismaClient,
  clientAccountId: string,
  state: CursorState,
  pageSize: number
): Promise<Array<{ id: string; startedAt: Date }>> {
  if (!state.ghlStartedAt || !state.ghlId) {
    return db.$queryRaw`
      SELECT "id", "startedAt"
      FROM "GhlLiveDeliveryRun"
      WHERE "destinationClientAccountId" = ${clientAccountId}
        AND "mode" = 'ongoing_association'
      ORDER BY "startedAt" ASC, "id" ASC
      LIMIT ${pageSize}
    `;
  }
  const startedAt = new Date(state.ghlStartedAt);
  return db.$queryRaw`
    SELECT "id", "startedAt"
    FROM "GhlLiveDeliveryRun"
    WHERE "destinationClientAccountId" = ${clientAccountId}
      AND "mode" = 'ongoing_association'
      AND ("startedAt" > ${startedAt} OR ("startedAt" = ${startedAt} AND "id" > ${state.ghlId}))
    ORDER BY "startedAt" ASC, "id" ASC
    LIMIT ${pageSize}
  `;
}

async function outboxesForRuns(
  db: PrismaClient,
  clientAccountId: string,
  runIds: string[]
): Promise<Array<{ sourceLeadEventId: string }>> {
  if (runIds.length === 0) return [];
  return db.ghlAssociationDispatchOutbox.findMany({
    where: { clientAccountId, liveRunId: { in: runIds } },
    select: { sourceLeadEventId: true },
  });
}

async function nextPreference(db: PrismaClient, afterClientId: string | null, scope: string | null) {
  if (scope && afterClientId === scope) return null;
  return db.clientDeliveryNotificationPreference.findFirst({
    where: {
      enabled: true,
      channel: "email",
      recipientEmail: { not: null },
      recipientEmailVerifiedAt: { not: null },
      enabledAt: { not: null },
      ...(scope ? { clientAccountId: scope } : afterClientId ? { clientAccountId: { gt: afterClientId } } : {}),
    },
    orderBy: { clientAccountId: "asc" },
  });
}

async function lockClientRows(db: NotificationDb, clientAccountId: string): Promise<void> {
  await db.$queryRaw`
    SELECT "clientAccountId" FROM "ClientDeliveryNotificationPreference"
    WHERE "clientAccountId" = ${clientAccountId}
    FOR UPDATE
  `;
  await db.$queryRaw`
    SELECT "clientAccountId" FROM "CompanySheetsDestination"
    WHERE "clientAccountId" = ${clientAccountId}
    FOR UPDATE
  `;
  await db.$queryRaw`
    SELECT "clientAccountId" FROM "ClientGhlDestination"
    WHERE "clientAccountId" = ${clientAccountId}
    FOR UPDATE
  `;
  await db.$queryRaw`
    SELECT "clientAccountId" FROM "ClientCustomWebhookDestination"
    WHERE "clientAccountId" = ${clientAccountId}
    FOR UPDATE
  `;
}

function classifyLead(
  sourceLeadEventId: string,
  input: {
    armed: ArmedDestinations;
    enabledAt: Date;
    preferenceEnabled: boolean;
    sheetsDestination: SheetsDestinationRow | null;
    jobs: SheetsJob[];
    intents: SheetsIntent[];
    ghlDestination: GhlDestinationRow | null;
    profile: ProfileRow | null;
    runs: GhlRun[];
    outboxes: GhlOutbox[];
    onboardingKeys: string[];
    attemptIds: Map<string, string>;
  }
): LeadVerdict {
  let sheetsJobId: string | null = null;
  let ghlLiveRunId: string | null = null;
  const completions: number[] = [];

  if (input.armed.sheets) {
    const sheets = canonicalSheetsForLead(sourceLeadEventId, input);
    if (!sheets) return { state: "not_ready" };
    sheetsJobId = sheets.receiptId;
    completions.push(sheets.completedAtMs);
  }
  if (input.armed.ghl) {
    const ghl = canonicalGhlForLead(sourceLeadEventId, input);
    if (!ghl) return { state: "not_ready" };
    ghlLiveRunId = ghl.receiptId;
    completions.push(ghl.completedAtMs);
  }
  if (completions.length === 0) return { state: "not_ready" };
  const completedAt = new Date(Math.max(...completions));
  const lead = {
    sourceLeadEventId,
    completedAt,
    sheetsJobId,
    ghlLiveRunId,
    customWebhookAttemptId: null,
  };
  if (
    !input.preferenceEnabled ||
    !isSourceLeadEligibleForClientNotification({
      enabled: true,
      enabledAt: input.enabledAt,
      completedAt,
    })
  ) {
    return { state: "before_enabled_at", lead };
  }
  return { state: "ready", lead };
}

function canonicalSheetsForLead(
  sourceLeadEventId: string,
  input: Parameters<typeof classifyLead>[1]
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
  input: Parameters<typeof classifyLead>[1]
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

async function loadOnboardingKeys(db: NotificationDb, jobs: SheetsJob[], runs: GhlRun[]): Promise<string[]> {
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

async function loadOnboardingAttemptIds(db: NotificationDb, runs: GhlRun[]): Promise<Map<string, string>> {
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
  db: NotificationDb,
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

async function releaseClaim(db: NotificationDb, id: string): Promise<void> {
  await db.deliverySuccessNotification.updateMany({
    where: { id, status: DELIVERY_SUCCESS_NOTIFICATION_STATUS.sending },
    data: { status: DELIVERY_SUCCESS_NOTIFICATION_STATUS.pending },
  });
}

async function closeOpenNotification(
  db: NotificationDb,
  clientAccountId: string,
  sourceLeadEventId: string,
  skipReason: string
): Promise<boolean> {
  const updated = await db.deliverySuccessNotification.updateMany({
    where: {
      clientAccountId,
      sourceLeadEventId,
      status: {
        in: [DELIVERY_SUCCESS_NOTIFICATION_STATUS.pending, DELIVERY_SUCCESS_NOTIFICATION_STATUS.failed],
      },
    },
    data: { status: DELIVERY_SUCCESS_NOTIFICATION_STATUS.skipped, skipReason },
  });
  return updated.count > 0;
}

function leadIdsFrom(values: Array<string | null>): string[] {
  const ids = new Set<string>();
  for (const value of values) {
    const leadId = safeIdentity(value);
    if (leadId) ids.add(leadId);
  }
  return [...ids];
}

function seenKey(clientAccountId: string, sourceLeadEventId: string): string {
  return `${clientAccountId}\n${sourceLeadEventId}`;
}

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function initialCursor(): CursorState {
  return {
    v: 1,
    afterClientId: null,
    clientAccountId: null,
    sheetsDone: false,
    sheetsCreatedAt: null,
    sheetsId: null,
    ghlDone: false,
    ghlStartedAt: null,
    ghlId: null,
  };
}

function finishClient(state: CursorState, clientAccountId: string): CursorState {
  return { ...initialCursor(), afterClientId: clientAccountId };
}

function normalizePageSize(pageSize: number | undefined): number {
  if (!Number.isInteger(pageSize)) return DEFAULT_PAGE_SIZE;
  return Math.min(MAX_PAGE_SIZE, Math.max(1, pageSize ?? DEFAULT_PAGE_SIZE));
}

function encodeCursor(state: CursorState): string {
  return Buffer.from(JSON.stringify(state), "utf8").toString("base64url");
}

function decodeCursor(cursor: string): CursorState {
  let parsed: Partial<CursorState>;
  try {
    parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Partial<CursorState>;
  } catch {
    throw new Error("Delivery notification scan cursor is invalid.");
  }
  if (parsed.v !== 1 || typeof parsed.sheetsDone !== "boolean" || typeof parsed.ghlDone !== "boolean") {
    throw new Error("Delivery notification scan cursor is invalid.");
  }
  return {
    v: 1,
    afterClientId: parsed.afterClientId ?? null,
    clientAccountId: parsed.clientAccountId ?? null,
    sheetsDone: parsed.sheetsDone,
    sheetsCreatedAt: parsed.sheetsCreatedAt ?? null,
    sheetsId: parsed.sheetsId ?? null,
    ghlDone: parsed.ghlDone,
    ghlStartedAt: parsed.ghlStartedAt ?? null,
    ghlId: parsed.ghlId ?? null,
  };
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
    done: !enabled,
    cursor: null,
    pages: 0,
  };
}
