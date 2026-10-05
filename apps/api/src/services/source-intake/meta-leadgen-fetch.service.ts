import type { Prisma } from "@prisma/client";
import { logger } from "../../lib/logger.js";
import {
  getMetaWebhookConfig,
  resolveMetaPageAccessToken,
  type MetaWebhookConfig,
} from "../../lib/meta-webhook.js";
import { isSettledCaptureOnlyFacebookEvent } from "./facebook-capture-provenance.js";
import {
  FACEBOOK_LEAD_PROVIDER,
  FACEBOOK_LEAD_SOURCE_SYSTEM,
  type FacebookLeadFields,
} from "./facebook-lead-normalizer.js";
import {
  isFacebookLeadFullyProcessed,
  processFacebookSourceLead,
  type FacebookLeadIntakeResult,
} from "./facebook-lead-intake.service.js";
import {
  findSourceLeadEventById,
  updateSourceLeadEvent,
  withCanonicalSourceLeadLock,
} from "../../repositories/source-lead-event.repository.js";
import { settleMetaLeadCapture, type MetaLeadCaptureResult } from "./meta-lead-capture.service.js";
import {
  buildFixtureGraphLead,
  classifyMetaGraphResult,
  describeMetaGraphFailure,
  fetchMetaLeadDetails,
  isRetryableMetaGraphOutcome,
  mapMetaLeadToFacebookFields,
  readMetaGraphError,
  type MetaGraphErrorDetail,
  type MetaGraphLeadResult,
  type MetaGraphOutcome,
  type MetaLeadFetcher,
  type MetaLeadgenEnvelope,
} from "./meta-lead-graph.service.js";

const FETCH_LEASE_MS = 5 * 60 * 1000;

export type MetaLeadgenFetchMeta = {
  ownerId: string;
  state:
    | "queued"
    | "enqueue_failed"
    | "fetching"
    | "normalized"
    | "captured"
    | "routing_matched"
    | "routing_review_required"
    | "duplicate"
    | "retrying"
    | "failed"
    | "completed";
  jobId?: string;
  attempt?: number;
  queuedAt?: string;
  /** Set when the webhook saw a retained BullMQ job and did not enqueue again. */
  enqueueSkippedAt?: string;
  enqueueFailedAt?: string;
  /** Set by the Admin C.O.C. requeue action. */
  requeuedAt?: string;
  fetchStartedAt?: string;
  fetchFinishedAt?: string;
  graphOutcome?: MetaGraphOutcome | "skipped_fixture" | "skipped_hydrated";
  graphStatus?: number;
  /** Token-free Graph error detail from the most recent failed attempt. */
  graphError?: MetaGraphErrorDetail | null;
  /** Which Page the configured token was bound to when Graph was called. */
  tokenScope?: "page_bound" | "unbound";
  liveDelivery: false;
  capiDispatched: false;
};

export type ProcessMetaLeadgenFetchInput = {
  leadgenId: string;
  sourceLeadEventId: string;
  jobId?: string;
  attemptNumber?: number;
  fixture?: boolean;
};

export type ProcessMetaLeadgenFetchResult =
  | {
      ok: true;
      skipped?: "already_processed" | "in_flight" | "flags_disabled";
      graphFetched: boolean;
      /** Present when routing is enabled (lifecycle normalize + shadow routing). */
      intake?: FacebookLeadIntakeResult;
      /** Present when routing is disabled (capture-only settle with Page+Form association). */
      capture?: MetaLeadCaptureResult;
      graphOutcome?: MetaGraphOutcome | "skipped_fixture" | "skipped_hydrated";
    }
  | {
      ok: false;
      retryable: boolean;
      error: string;
      graphFetched: boolean;
      graphOutcome: MetaGraphOutcome;
      graphStatus: number;
    };

export type ProcessMetaLeadgenFetchDeps = {
  getMetaWebhookConfigImpl?: () => MetaWebhookConfig;
  fetchMetaLeadDetailsImpl?: MetaLeadFetcher;
  processFacebookSourceLeadImpl?: typeof processFacebookSourceLead;
  settleMetaLeadCaptureImpl?: typeof settleMetaLeadCapture;
  now?: () => Date;
  withLockImpl?: typeof withCanonicalSourceLeadLock;
  findByIdImpl?: typeof findSourceLeadEventById;
  updateEventImpl?: typeof updateSourceLeadEvent;
  /**
   * Test seam. Runs after Graph failure is classified and before failure
   * metadata is persisted, while the canonical lock is not held.
   */
  beforeGraphFailurePersistImpl?: () => Promise<void>;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function readMetaLeadgenFetchMeta(enrichment: unknown): MetaLeadgenFetchMeta | null {
  const rec = asRecord(enrichment);
  const fetch = rec?.metaLeadgenFetch;
  const bag = asRecord(fetch);
  if (!bag) return null;
  return {
    // The webhook writes queue state before any worker owns the row.
    ownerId: typeof bag.ownerId === "string" ? bag.ownerId : "",
    state: (typeof bag.state === "string" ? bag.state : "queued") as MetaLeadgenFetchMeta["state"],
    jobId: typeof bag.jobId === "string" ? bag.jobId : undefined,
    attempt: typeof bag.attempt === "number" ? bag.attempt : undefined,
    queuedAt: typeof bag.queuedAt === "string" ? bag.queuedAt : undefined,
    enqueueSkippedAt: typeof bag.enqueueSkippedAt === "string" ? bag.enqueueSkippedAt : undefined,
    enqueueFailedAt: typeof bag.enqueueFailedAt === "string" ? bag.enqueueFailedAt : undefined,
    requeuedAt: typeof bag.requeuedAt === "string" ? bag.requeuedAt : undefined,
    fetchStartedAt: typeof bag.fetchStartedAt === "string" ? bag.fetchStartedAt : undefined,
    fetchFinishedAt: typeof bag.fetchFinishedAt === "string" ? bag.fetchFinishedAt : undefined,
    graphOutcome: bag.graphOutcome as MetaLeadgenFetchMeta["graphOutcome"],
    graphStatus: typeof bag.graphStatus === "number" ? bag.graphStatus : undefined,
    graphError: (asRecord(bag.graphError) as MetaGraphErrorDetail | null) ?? null,
    tokenScope: bag.tokenScope as MetaLeadgenFetchMeta["tokenScope"],
    liveDelivery: false,
    capiDispatched: false,
  };
}

function isLeaseActive(meta: MetaLeadgenFetchMeta | null, now: Date): boolean {
  if (!meta || meta.state !== "fetching" || !meta.fetchStartedAt) return false;
  const started = Date.parse(meta.fetchStartedAt);
  return Number.isFinite(started) && now.getTime() - started < FETCH_LEASE_MS;
}

/**
 * Persist Graph observability onto the canonical row.
 *
 * The read, settled-capture check, and write share the same advisory lock and
 * transaction as Zapier capture. A snapshot taken before that lock must not be
 * written: Zapier can settle the row in between. Callers must not invoke this
 * while they already hold the canonical lock (connection_limit=1 deadlock).
 *
 * Exported so the webhook route records queue state (queued / enqueue_failed)
 * with the same lock-safe merge instead of replacing the enrichment blob.
 */
export async function mergeMetaLeadgenFetchMeta(
  leadgenId: string,
  eventId: string,
  patch: Partial<MetaLeadgenFetchMeta>,
  extra: { errorSummary?: string | null; rawPayloadJson?: object } | undefined,
  withLock: typeof withCanonicalSourceLeadLock = withCanonicalSourceLeadLock
): Promise<void> {
  await withLock(FACEBOOK_LEAD_PROVIDER, FACEBOOK_LEAD_SOURCE_SYSTEM, leadgenId, async (tx) => {
    const row = await tx.sourceLeadEvent.findUnique({ where: { id: eventId } });
    if (!row) return;
    if (isSettledCaptureOnlyFacebookEvent(row)) return;
    const existing = asRecord(row.enrichmentMetadataJson) ?? {};
    const prev = asRecord(existing.metaLeadgenFetch) ?? {};
    await tx.sourceLeadEvent.update({
      where: { id: row.id },
      data: {
        enrichmentMetadataJson: {
          ...existing,
          metaLeadgenFetch: {
            liveDelivery: false,
            capiDispatched: false,
            ...prev,
            ...patch,
          },
        } as Prisma.InputJsonValue,
        ...(extra?.errorSummary !== undefined ? { errorSummary: extra.errorSummary } : {}),
        ...(extra?.rawPayloadJson
          ? { rawPayloadJson: extra.rawPayloadJson as Prisma.InputJsonValue }
          : {}),
      },
    });
  });
}

const mergeFetchMeta = mergeMetaLeadgenFetchMeta;

/**
 * Record a repeated Meta notification for a leadgen_id whose canonical row is
 * not yet fully processed (Meta retries after a non-2xx, or re-sends on its
 * own schedule). The stored raw notification and any failure diagnostic are
 * preserved; only a redelivery counter and the latest envelope are appended.
 * Settled capture rows are left untouched.
 */
export async function recordMetaNotificationRedelivery(
  input: {
    leadgenId: string;
    eventId: string;
    envelope: MetaLeadgenEnvelope;
    receivedAt: Date;
    webhookRequestLogId?: string | null;
    /** Diagnostic to set only when the row has none (never overwrites a failure). */
    errorSummaryIfEmpty?: string | null;
  },
  withLock: typeof withCanonicalSourceLeadLock = withCanonicalSourceLeadLock
): Promise<void> {
  await withLock(FACEBOOK_LEAD_PROVIDER, FACEBOOK_LEAD_SOURCE_SYSTEM, input.leadgenId, async (tx) => {
    const row = await tx.sourceLeadEvent.findUnique({ where: { id: input.eventId } });
    if (!row) return;
    if (isSettledCaptureOnlyFacebookEvent(row)) return;
    const raw = asRecord(row.rawPayloadJson) ?? {};
    const prevRedelivery = asRecord(raw.redelivery);
    const count = typeof prevRedelivery?.count === "number" ? prevRedelivery.count + 1 : 1;
    await tx.sourceLeadEvent.update({
      where: { id: row.id },
      data: {
        rawPayloadJson: {
          ...raw,
          envelope: raw.envelope ?? input.envelope,
          redelivery: {
            count,
            lastReceivedAt: input.receivedAt.toISOString(),
            lastEnvelope: input.envelope,
            ...(input.webhookRequestLogId ? { lastWebhookRequestLogId: input.webhookRequestLogId } : {}),
          },
        } as Prisma.InputJsonValue,
        ...(row.errorSummary === null && input.errorSummaryIfEmpty !== undefined
          ? { errorSummary: input.errorSummaryIfEmpty }
          : {}),
      },
    });
  });
}

function envelopeFromRaw(raw: unknown, leadgenId: string): MetaLeadgenEnvelope {
  const rec = asRecord(raw);
  const envelope = asRecord(rec?.envelope) ?? rec;
  return {
    leadgenId,
    pageId: typeof envelope?.pageId === "string" ? envelope.pageId : undefined,
    formId: typeof envelope?.formId === "string" ? envelope.formId : undefined,
    adId: typeof envelope?.adId === "string" ? envelope.adId : undefined,
    adgroupId: typeof envelope?.adgroupId === "string" ? envelope.adgroupId : undefined,
    createdTime: typeof envelope?.createdTime === "string" ? envelope.createdTime : undefined,
  };
}

function fixtureGraphFromRaw(raw: unknown, leadgenId: string): Record<string, unknown> | null {
  const rec = asRecord(raw);
  if (!rec) return null;
  const graphLead = asRecord(rec.graphLead) ?? asRecord(rec.lead);
  if (graphLead) return graphLead;
  if (rec.fixture === true || rec.testLead) {
    const testLead = asRecord(rec.testLead) ?? rec;
    return buildFixtureGraphLead(leadgenId, {
      leadgenId,
      firstName: typeof testLead.firstName === "string" ? testLead.firstName : undefined,
      lastName: typeof testLead.lastName === "string" ? testLead.lastName : undefined,
      email: typeof testLead.email === "string" ? testLead.email : undefined,
      phone: typeof testLead.phone === "string" ? testLead.phone : undefined,
      state: typeof testLead.state === "string" ? testLead.state : undefined,
      zip: typeof testLead.zip === "string" ? testLead.zip : undefined,
      campaignId: typeof testLead.campaignId === "string" ? testLead.campaignId : undefined,
      campaignName: typeof testLead.campaignName === "string" ? testLead.campaignName : undefined,
      formId: typeof testLead.formId === "string" ? testLead.formId : undefined,
      formName: typeof testLead.formName === "string" ? testLead.formName : undefined,
      adId: typeof testLead.adId === "string" ? testLead.adId : undefined,
      createdTime: typeof testLead.createdTime === "string" ? testLead.createdTime : undefined,
      field_data: rec.field_data,
    });
  }
  return null;
}

function routingObservabilityState(
  intake: FacebookLeadIntakeResult
): MetaLeadgenFetchMeta["state"] {
  if (intake.replayed) return "duplicate";
  if (intake.status === "routing_matched") return "routing_matched";
  if (
    intake.status === "needs_review" ||
    intake.status === "routing_unmatched" ||
    intake.status === "duplicate_blocked"
  ) {
    return "routing_review_required";
  }
  if (intake.status === "normalized") return "normalized";
  return "completed";
}

/**
 * Serialized Graph fetch + normalize for one canonical Meta leadgen identity.
 *
 * - Routing disabled (pilot posture): capture-only settle with Page ID + Form ID
 *   association. No master client, no routing decision.
 * - Routing enabled: lifecycle normalize + shadow routing dry-run.
 *
 * Never: inventory, GHL, LF2 outbox, or Meta CAPI.
 */
export async function processMetaLeadgenFetch(
  input: ProcessMetaLeadgenFetchInput,
  deps: ProcessMetaLeadgenFetchDeps = {}
): Promise<ProcessMetaLeadgenFetchResult> {
  const leadgenId = input.leadgenId.trim();
  const ownerId = (input.jobId ?? `owner-${input.sourceLeadEventId}`).trim();
  const attempt = input.attemptNumber ?? 1;
  const nowImpl = deps.now ?? (() => new Date());
  const config = (deps.getMetaWebhookConfigImpl ?? getMetaWebhookConfig)();
  const fetchImpl = deps.fetchMetaLeadDetailsImpl ?? fetchMetaLeadDetails;
  const processImpl = deps.processFacebookSourceLeadImpl ?? processFacebookSourceLead;
  const settleImpl = deps.settleMetaLeadCaptureImpl ?? settleMetaLeadCapture;
  const withLock = deps.withLockImpl ?? withCanonicalSourceLeadLock;

  // Only the job/request fixture bit hydrates without Graph. The global
  // SA360_META_LEAD_ADS_FIXTURE_ENABLED flag must not bypass intake/graph
  // flags for live webhook jobs, and must never authorize a production token.
  const fixtureMode = Boolean(input.fixture);
  if (!fixtureMode && (!config.intakeEnabled || !config.graphFetchEnabled)) {
    logger.info("meta_leadgen_fetch.flags_disabled", {
      leadgenId,
      intakeEnabled: config.intakeEnabled,
      graphFetchEnabled: config.graphFetchEnabled,
    });
    return { ok: true, skipped: "flags_disabled", graphFetched: false };
  }

  const gate = await withLock(
    FACEBOOK_LEAD_PROVIDER,
    FACEBOOK_LEAD_SOURCE_SYSTEM,
    leadgenId,
    async (tx) => {
      const event =
        (await tx.sourceLeadEvent.findUnique({ where: { id: input.sourceLeadEventId } })) ??
        (await tx.sourceLeadEvent.findFirst({
          where: {
            sourceProvider: FACEBOOK_LEAD_PROVIDER,
            sourceSystem: FACEBOOK_LEAD_SOURCE_SYSTEM,
            sourceLeadId: leadgenId,
          },
          orderBy: { receivedAt: "asc" },
        }));
      if (!event) {
        return { kind: "missing" as const };
      }
      if (isFacebookLeadFullyProcessed(event, config.routingEnabled)) {
        return { kind: "processed" as const, eventId: event.id };
      }
      const lease = readMetaLeadgenFetchMeta(event.enrichmentMetadataJson);
      if (isLeaseActive(lease, nowImpl()) && lease && lease.ownerId !== ownerId) {
        return { kind: "in_flight" as const, eventId: event.id };
      }
      const hydrated = Boolean(event.normalizedAt) || Boolean(event.normalizedPayloadJson);
      const startedAt = nowImpl().toISOString();
      const existing = asRecord(event.enrichmentMetadataJson) ?? {};
      const prev = asRecord(existing.metaLeadgenFetch) ?? {};
      await tx.sourceLeadEvent.update({
        where: { id: event.id },
        data: {
          enrichmentMetadataJson: {
            ...existing,
            metaLeadgenFetch: {
              liveDelivery: false,
              capiDispatched: false,
              ...prev,
              ownerId,
              state: "fetching",
              jobId: input.jobId,
              attempt,
              fetchStartedAt: startedAt,
            },
          } as Prisma.InputJsonValue,
          errorSummary: hydrated
            ? event.errorSummary
            : "Meta Graph fetch in progress.",
        },
      });
      return {
        kind: "proceed" as const,
        eventId: event.id,
        hydrated,
        rawPayloadJson: event.rawPayloadJson,
        webhookRequestLogId: event.webhookRequestLogId,
      };
    }
  );

  if (gate.kind === "missing") {
    return {
      ok: false,
      retryable: true,
      error: "canonical_source_lead_event_missing",
      graphFetched: false,
      graphOutcome: "retryable_failure",
      graphStatus: 0,
    };
  }
  if (gate.kind === "processed") {
    return { ok: true, skipped: "already_processed", graphFetched: false };
  }
  if (gate.kind === "in_flight") {
    return { ok: true, skipped: "in_flight", graphFetched: false };
  }

  const envelope = envelopeFromRaw(gate.rawPayloadJson, leadgenId);
  let graphFetched = false;
  let graphOutcome: MetaGraphOutcome | "skipped_fixture" | "skipped_hydrated" = "skipped_hydrated";
  let graphStatus = 0;
  let fields: FacebookLeadFields | null = null;
  let graphBody: Record<string, unknown> | null = null;
  let tokenScope: MetaLeadgenFetchMeta["tokenScope"];

  if (!gate.hydrated) {
    const fixtureBody = fixtureMode
      ? fixtureGraphFromRaw(gate.rawPayloadJson, leadgenId)
      : null;
    if (fixtureMode) {
      if (!fixtureBody) {
        await mergeFetchMeta(
          leadgenId,
          gate.eventId,
          {
            ownerId,
            state: "failed",
            jobId: input.jobId,
            attempt,
            fetchFinishedAt: nowImpl().toISOString(),
            graphOutcome: "malformed",
            graphStatus: 0,
            liveDelivery: false,
            capiDispatched: false,
          },
          {
            errorSummary:
              "Fixture Meta lead is missing a token-free Graph body; live Graph was not called.",
          },
          withLock
        );
        return {
          ok: false,
          retryable: false,
          error: "graph_malformed",
          graphFetched: false,
          graphOutcome: "malformed",
          graphStatus: 0,
        };
      }
      graphBody = fixtureBody;
      graphOutcome = "skipped_fixture";
      graphStatus = 200;
      fields = mapMetaLeadToFacebookFields(fixtureBody, envelope);
    } else {
      // A Page access token only reads leads for its own Page. Resolve the token
      // for this notification's Page before calling Graph; a missing or
      // mismatched token is terminal for this job (requeue after configuring).
      const token = resolveMetaPageAccessToken(envelope.pageId, config);
      if (!token.ok) {
        if (deps.beforeGraphFailurePersistImpl) {
          await deps.beforeGraphFailurePersistImpl();
        }
        await mergeFetchMeta(
          leadgenId,
          gate.eventId,
          {
            ownerId,
            state: "failed",
            jobId: input.jobId,
            attempt,
            fetchFinishedAt: nowImpl().toISOString(),
            graphOutcome: "token_unavailable",
            graphStatus: 0,
            graphError: null,
            liveDelivery: false,
            capiDispatched: false,
          },
          {
            errorSummary: token.diagnostic,
            rawPayloadJson: {
              ...(asRecord(gate.rawPayloadJson) ?? {}),
              envelope,
              graphStatus: 0,
              graphOutcome: "token_unavailable",
            } as object,
          },
          withLock
        );
        logger.warn("meta_leadgen_fetch.token_unavailable", {
          leadgenId,
          sourceLeadEventId: gate.eventId,
          pageId: envelope.pageId ?? null,
          reason: token.reason,
        });
        return {
          ok: false,
          retryable: false,
          error: "graph_token_unavailable",
          graphFetched: false,
          graphOutcome: "token_unavailable",
          graphStatus: 0,
        };
      }
      tokenScope = token.scope;

      let lead: MetaGraphLeadResult;
      try {
        lead = await fetchImpl(leadgenId, { ...config, accessToken: token.accessToken });
      } catch (err) {
        lead = {
          ok: false,
          status: 0,
          body: { error: err instanceof Error ? err.message : "graph_fetch_threw" },
        };
      }
      graphFetched = true;
      graphStatus = lead.status;
      graphOutcome = classifyMetaGraphResult(lead);
      if (graphOutcome !== "success" || !lead.body) {
        const retryable = isRetryableMetaGraphOutcome(graphOutcome);
        const graphError = readMetaGraphError(lead.body);
        if (deps.beforeGraphFailurePersistImpl) {
          await deps.beforeGraphFailurePersistImpl();
        }
        await mergeFetchMeta(
          leadgenId,
          gate.eventId,
          {
            ownerId,
            state: retryable ? "retrying" : "failed",
            jobId: input.jobId,
            attempt,
            fetchFinishedAt: nowImpl().toISOString(),
            graphOutcome,
            graphStatus,
            graphError,
            tokenScope,
            liveDelivery: false,
            capiDispatched: false,
          },
          {
            errorSummary: describeMetaGraphFailure({
              outcome: graphOutcome,
              status: graphStatus,
              body: lead.body,
              leadgenId,
            }),
            rawPayloadJson: {
              ...(asRecord(gate.rawPayloadJson) ?? {}),
              envelope,
              graphStatus,
              graphOutcome,
              ...(graphError ? { graphError } : {}),
            } as object,
          },
          withLock
        );
        logger.warn("meta_leadgen_fetch.graph_failed", {
          leadgenId,
          sourceLeadEventId: gate.eventId,
          graphOutcome,
          graphStatus,
          graphErrorCode: graphError?.code ?? null,
          retryable,
        });
        return {
          ok: false,
          retryable,
          error: `graph_${graphOutcome}`,
          graphFetched: true,
          graphOutcome,
          graphStatus,
        };
      }
      graphBody = lead.body;
      fields = mapMetaLeadToFacebookFields(lead.body, envelope);
    }
  }

  // Re-check processed state under the same advisory lock. When routing is
  // disabled the capture settle happens inside this transaction (tx-only, no
  // default-client calls), so a concurrent Zapier capture for the same
  // leadgen_id either lands before (we see settled -> processed) or after (it
  // sees our settled row and replays). When routing is enabled we RELEASE before
  // normalize/routing: holding the lock while calling
  // processFacebookSourceLead (or findById on the default Prisma client)
  // deadlocks the test pool (connection_limit=1) and is unnecessary; the
  // fetching lease still serializes concurrent workers (in_flight), and
  // processFacebookSourceLead is idempotent.
  const captureMode = !config.routingEnabled;
  const persistGate = await withLock(
    FACEBOOK_LEAD_PROVIDER,
    FACEBOOK_LEAD_SOURCE_SYSTEM,
    leadgenId,
    async (tx) => {
      const latest = await tx.sourceLeadEvent.findUnique({ where: { id: gate.eventId } });
      if (!latest) {
        return { kind: "missing" as const };
      }
      if (isFacebookLeadFullyProcessed(latest, config.routingEnabled)) {
        return { kind: "processed" as const };
      }
      if (!captureMode) {
        return {
          kind: "ready" as const,
          eventId: latest.id,
          webhookRequestLogId: latest.webhookRequestLogId,
          rawPayloadJson: latest.rawPayloadJson,
        };
      }
      const latestRaw = asRecord(latest.rawPayloadJson) ?? asRecord(gate.rawPayloadJson) ?? {};
      const storedLead = asRecord(latestRaw.lead);
      const captureFields: FacebookLeadFields =
        fields ??
        (storedLead
          ? mapMetaLeadToFacebookFields(storedLead, envelope)
          : { leadgenId, pageId: envelope.pageId, formId: envelope.formId, createdTime: envelope.createdTime });
      const capture = await settleImpl(
        {
          event: latest,
          leadgenId,
          fields: captureFields,
          rawPayloadJson: { ...latestRaw, envelope, ...(graphBody ? { lead: graphBody } : {}) },
          fetchMeta: {
            ownerId,
            state: "captured",
            jobId: input.jobId,
            attempt,
            fetchFinishedAt: nowImpl().toISOString(),
            graphOutcome,
            graphStatus: graphFetched ? graphStatus : graphOutcome === "skipped_fixture" ? 200 : undefined,
            graphError: null,
            ...(tokenScope ? { tokenScope } : {}),
            liveDelivery: false,
            capiDispatched: false,
          },
          now: nowImpl(),
        },
        tx
      );
      return { kind: "captured" as const, capture };
    }
  );

  if (persistGate.kind === "missing") {
    return {
      ok: false,
      retryable: true,
      error: "canonical_source_lead_event_missing",
      graphFetched,
      graphOutcome: "retryable_failure",
      graphStatus,
    };
  }
  if (persistGate.kind === "processed") {
    return { ok: true, skipped: "already_processed", graphFetched, graphOutcome };
  }
  if (persistGate.kind === "captured") {
    logger.info("meta_leadgen_fetch.captured", {
      leadgenId,
      sourceLeadEventId: persistGate.capture.sourceEventId,
      graphFetched,
      graphOutcome,
      captureOutcome: persistGate.capture.captureOutcome,
      associationOutcome: persistGate.capture.association.outcome,
      sourceClientAccountId: persistGate.capture.sourceClientAccountId,
      liveDelivery: false,
    });
    return { ok: true, graphFetched, graphOutcome, capture: persistGate.capture };
  }

  const rawPayloadJson = {
    ...(asRecord(persistGate.rawPayloadJson) ?? asRecord(gate.rawPayloadJson) ?? {}),
    envelope,
    ...(graphBody ? { lead: graphBody } : {}),
  };
  const intake = await processImpl({
    fields: fields ?? { leadgenId },
    rawPayloadJson,
    masterClientAccountId: config.masterClientAccountId ?? "",
    sourceType: "lead_form",
    webhookRequestLogId: persistGate.webhookRequestLogId ?? gate.webhookRequestLogId ?? undefined,
    existingEventId: persistGate.eventId,
    routingEnabled: config.routingEnabled,
  });

  await mergeFetchMeta(
    leadgenId,
    persistGate.eventId,
    {
      ownerId,
      state: routingObservabilityState(intake),
      jobId: input.jobId,
      attempt,
      fetchFinishedAt: nowImpl().toISOString(),
      graphOutcome,
      graphStatus: graphFetched ? graphStatus : graphOutcome === "skipped_fixture" ? 200 : undefined,
      graphError: null,
      ...(tokenScope ? { tokenScope } : {}),
      liveDelivery: false,
      capiDispatched: false,
    },
    undefined,
    withLock
  );

  logger.info("meta_leadgen_fetch.completed", {
    leadgenId,
    sourceLeadEventId: persistGate.eventId,
    graphFetched,
    graphOutcome,
    status: intake.status,
    matched: intake.matched,
    replayed: intake.replayed,
    liveDelivery: false,
  });

  return {
    ok: true,
    graphFetched,
    graphOutcome,
    intake,
  };
}
