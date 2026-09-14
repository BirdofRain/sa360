import type { Prisma } from "@prisma/client";
import { logger } from "../../lib/logger.js";
import { getMetaWebhookConfig, type MetaWebhookConfig } from "../../lib/meta-webhook.js";
import {
  FACEBOOK_LEAD_PROVIDER,
  FACEBOOK_LEAD_SOURCE_SYSTEM,
  type FacebookLeadFields,
} from "./facebook-lead-normalizer.js";
import {
  findFacebookLeadReplayEvent,
  isFacebookLeadFullyProcessed,
  processFacebookSourceLead,
  type FacebookLeadIntakeResult,
} from "./facebook-lead-intake.service.js";
import {
  findSourceLeadEventById,
  updateSourceLeadEvent,
  withCanonicalSourceLeadLock,
} from "../../repositories/source-lead-event.repository.js";
import {
  buildFixtureGraphLead,
  classifyMetaGraphResult,
  fetchMetaLeadDetails,
  isRetryableMetaGraphOutcome,
  mapMetaLeadToFacebookFields,
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
    | "fetching"
    | "normalized"
    | "routing_matched"
    | "routing_review_required"
    | "duplicate"
    | "retrying"
    | "failed"
    | "completed";
  jobId?: string;
  attempt?: number;
  queuedAt?: string;
  fetchStartedAt?: string;
  fetchFinishedAt?: string;
  graphOutcome?: MetaGraphOutcome | "skipped_fixture" | "skipped_hydrated";
  graphStatus?: number;
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
      intake?: FacebookLeadIntakeResult;
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
  now?: () => Date;
  withLockImpl?: typeof withCanonicalSourceLeadLock;
  findByIdImpl?: typeof findSourceLeadEventById;
  updateEventImpl?: typeof updateSourceLeadEvent;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readFetchMeta(enrichment: unknown): MetaLeadgenFetchMeta | null {
  const rec = asRecord(enrichment);
  const fetch = rec?.metaLeadgenFetch;
  const bag = asRecord(fetch);
  if (!bag || typeof bag.ownerId !== "string") return null;
  return {
    ownerId: bag.ownerId,
    state: (typeof bag.state === "string" ? bag.state : "queued") as MetaLeadgenFetchMeta["state"],
    jobId: typeof bag.jobId === "string" ? bag.jobId : undefined,
    attempt: typeof bag.attempt === "number" ? bag.attempt : undefined,
    queuedAt: typeof bag.queuedAt === "string" ? bag.queuedAt : undefined,
    fetchStartedAt: typeof bag.fetchStartedAt === "string" ? bag.fetchStartedAt : undefined,
    fetchFinishedAt: typeof bag.fetchFinishedAt === "string" ? bag.fetchFinishedAt : undefined,
    graphOutcome: bag.graphOutcome as MetaLeadgenFetchMeta["graphOutcome"],
    graphStatus: typeof bag.graphStatus === "number" ? bag.graphStatus : undefined,
    liveDelivery: false,
    capiDispatched: false,
  };
}

function isLeaseActive(meta: MetaLeadgenFetchMeta | null, now: Date): boolean {
  if (!meta || meta.state !== "fetching" || !meta.fetchStartedAt) return false;
  const started = Date.parse(meta.fetchStartedAt);
  return Number.isFinite(started) && now.getTime() - started < FETCH_LEASE_MS;
}

async function mergeFetchMeta(
  eventId: string,
  patch: Partial<MetaLeadgenFetchMeta>,
  extra: { errorSummary?: string | null; rawPayloadJson?: object } | undefined,
  findById: typeof findSourceLeadEventById,
  updateEvent: typeof updateSourceLeadEvent
): Promise<void> {
  const row = await findById(eventId);
  if (!row) return;
  const existing = asRecord(row.enrichmentMetadataJson) ?? {};
  const prev = asRecord(existing.metaLeadgenFetch) ?? {};
  await updateEvent(eventId, {
    enrichmentMetadataJson: {
      ...existing,
      metaLeadgenFetch: {
        liveDelivery: false,
        capiDispatched: false,
        ...prev,
        ...patch,
      },
    } as object,
    ...(extra?.errorSummary !== undefined ? { errorSummary: extra.errorSummary } : {}),
    ...(extra?.rawPayloadJson ? { rawPayloadJson: extra.rawPayloadJson } : {}),
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
 * Serialized Graph fetch + normalize + optional shadow routing for one canonical
 * Meta leadgen identity. No inventory, GHL, LF2 outbox, or Meta CAPI.
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
  const withLock = deps.withLockImpl ?? withCanonicalSourceLeadLock;
  const findById = deps.findByIdImpl ?? findSourceLeadEventById;
  const updateEvent = deps.updateEventImpl ?? updateSourceLeadEvent;

  const fixtureMode = Boolean(input.fixture || config.fixtureEnabled);
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
        (await findFacebookLeadReplayEvent(leadgenId));
      if (!event) {
        return { kind: "missing" as const };
      }
      if (isFacebookLeadFullyProcessed(event, config.routingEnabled)) {
        return { kind: "processed" as const, eventId: event.id };
      }
      const lease = readFetchMeta(event.enrichmentMetadataJson);
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

  if (!gate.hydrated) {
    const fixtureBody = fixtureMode
      ? fixtureGraphFromRaw(gate.rawPayloadJson, leadgenId)
      : null;
    if (fixtureBody) {
      graphBody = fixtureBody;
      graphOutcome = "skipped_fixture";
      graphStatus = 200;
      fields = mapMetaLeadToFacebookFields(fixtureBody, envelope);
    } else {
      let lead: MetaGraphLeadResult;
      try {
        lead = await fetchImpl(leadgenId, config);
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
        await mergeFetchMeta(
          gate.eventId,
          {
            ownerId,
            state: retryable ? "retrying" : "failed",
            jobId: input.jobId,
            attempt,
            fetchFinishedAt: nowImpl().toISOString(),
            graphOutcome,
            graphStatus,
            liveDelivery: false,
            capiDispatched: false,
          },
          {
            errorSummary: `Meta Graph lead fetch failed (${graphOutcome}, status ${graphStatus}).`,
            rawPayloadJson: {
              ...(asRecord(gate.rawPayloadJson) ?? {}),
              envelope,
              graphStatus,
              graphOutcome,
            } as object,
          },
          findById,
          updateEvent
        );
        logger.warn("meta_leadgen_fetch.graph_failed", {
          leadgenId,
          sourceLeadEventId: gate.eventId,
          graphOutcome,
          graphStatus,
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

  const persist = await withLock(
    FACEBOOK_LEAD_PROVIDER,
    FACEBOOK_LEAD_SOURCE_SYSTEM,
    leadgenId,
    async () => {
      const latest = await findById(gate.eventId);
      if (!latest) {
        return { kind: "missing" as const };
      }
      if (isFacebookLeadFullyProcessed(latest, config.routingEnabled)) {
        return { kind: "processed" as const };
      }
      const rawPayloadJson = {
        ...(asRecord(latest.rawPayloadJson) ?? asRecord(gate.rawPayloadJson) ?? {}),
        envelope,
        ...(graphBody ? { lead: graphBody } : {}),
      };
      const intake = await processImpl({
        fields: fields ?? { leadgenId },
        rawPayloadJson,
        masterClientAccountId: config.masterClientAccountId ?? "",
        sourceType: "lead_form",
        webhookRequestLogId: latest.webhookRequestLogId ?? gate.webhookRequestLogId ?? undefined,
        existingEventId: latest.id,
        routingEnabled: config.routingEnabled,
      });
      return { kind: "done" as const, intake };
    }
  );

  if (persist.kind === "missing") {
    return {
      ok: false,
      retryable: true,
      error: "canonical_source_lead_event_missing",
      graphFetched,
      graphOutcome: "retryable_failure",
      graphStatus,
    };
  }
  if (persist.kind === "processed") {
    return { ok: true, skipped: "already_processed", graphFetched, graphOutcome };
  }

  await mergeFetchMeta(
    gate.eventId,
    {
      ownerId,
      state: routingObservabilityState(persist.intake),
      jobId: input.jobId,
      attempt,
      fetchFinishedAt: nowImpl().toISOString(),
      graphOutcome,
      graphStatus: graphFetched ? graphStatus : graphOutcome === "skipped_fixture" ? 200 : undefined,
      liveDelivery: false,
      capiDispatched: false,
    },
    undefined,
    findById,
    updateEvent
  );

  logger.info("meta_leadgen_fetch.completed", {
    leadgenId,
    sourceLeadEventId: gate.eventId,
    graphFetched,
    graphOutcome,
    status: persist.intake.status,
    matched: persist.intake.matched,
    replayed: persist.intake.replayed,
    liveDelivery: false,
  });

  return {
    ok: true,
    graphFetched,
    graphOutcome,
    intake: persist.intake,
  };
}
