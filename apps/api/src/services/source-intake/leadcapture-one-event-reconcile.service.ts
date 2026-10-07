/**
 * Guarded one-event LeadCapture source-association reconciliation.
 *
 * Operator tool for an event that arrived before confirmed source associations
 * could resolve a destination. It reuses the existing `SourceLeadEvent` — it
 * never re-POSTs the webhook, because the Legacy lane always inserts a new
 * event row and a resend would duplicate the lead.
 *
 * What one run does, in order:
 *   1. verifies the DB target, operator, confirmation phrase, and the event's
 *      own identity against operator-supplied expectations;
 *   2. resolves the confirmed source association read-only and refuses unless
 *      it matches the expected client;
 *   3. refuses when any delivery-shaped side effect already exists;
 *   4. (apply only) observes the `SourceFunnel` the event arrived from, re-runs
 *      the normal routing pipeline on the stored payloads, and lets the
 *      idempotent inventory tracker reuse or create the one inventory row;
 *   5. re-verifies that nothing duplicated and nothing was delivered.
 *
 * Preview is the default. No external delivery path is reachable from here:
 * fulfillment outbox, allocation, GHL delivery, and Meta dispatch are all
 * preflight refusals and post-run verification failures.
 */

import type { Prisma, PrismaClient, SourceLeadEventStatus } from "@prisma/client";

import { lifecycleEventSchema } from "../../schemas/lifecycle-event.schema.js";
import {
  findSourceFunnelById,
  stampNullOriginOnSourceEventInventory,
} from "../../repositories/source-funnel.repository.js";
import {
  assertExpectedDbHost,
  type DbTargetIdentity,
} from "../aged-inventory-bulk/aged-inventory-bulk-db-guard.js";
import { trackCampaignInventorySafely } from "../lead-inventory/campaign-inventory-tracking.service.js";
import type { CampaignInventoryTrackingResult } from "../lead-inventory/campaign-inventory-tracking.service.js";
import {
  applyLeadCaptureEndpointDefaults,
  materializeLeadCapturePayload,
} from "./leadcapture-payload-resolver.js";
import {
  resolveConfirmedLeadCaptureSourceAssociation,
  type LeadCaptureSourceAssociationResult,
} from "./leadcapture-source-association.service.js";
import {
  hasLeadCaptureSourceIdentitySignals,
  leadCaptureSourceIdentitySignalsFromLifecyclePayload,
  leadCaptureSourceIdentitySignalsFromPayload,
  withLeadCaptureSourceCampaignIdFallback,
  type LeadCaptureSourceIdentitySignals,
} from "./leadcapture-source-identity-signals.js";
import { resolveNextGenSourceIdentity } from "./leadcapture-nextgen-source-identity.js";
import { observeNextGenSourceFunnelSafely } from "./source-funnel.service.js";
import { persistRoutingAndDuplicate } from "./source-intake-routing-persist.js";

export const LEADCAPTURE_RECONCILE_CONFIRMATION = "RECONCILE ONE LEADCAPTURE SOURCE EVENT";
export const LEADCAPTURE_RECONCILE_PROVIDER = "leadcapture_io" as const;

/** Prisma interactive-transaction wait/timeout. Remote reconcile can exceed the 5s default. */
export const LEADCAPTURE_RECONCILE_LOCK_MAX_WAIT_MS = 30_000;
export const LEADCAPTURE_RECONCILE_LOCK_TIMEOUT_MS = 180_000;

const RECONCILE_LOCK_PREFIX = "leadcapture-one-event-reconcile:";

export type LeadCaptureOneEventReconcileOutcome =
  | "RECONCILED"
  | "PREVIEWED"
  | "REFUSED"
  | "FAILED";

export type LeadCaptureOneEventReconcileReasonCode =
  | "confirmation_mismatch"
  | "operator_required"
  | "db_host_mismatch"
  | "source_event_not_found"
  | "source_provider_mismatch"
  | "source_system_mismatch"
  | "source_route_mismatch"
  | "source_lead_id_mismatch"
  | "raw_payload_missing"
  | "not_normalized"
  | "source_association_unmatched"
  | "destination_client_mismatch"
  | "preexisting_side_effects"
  | "inventory_duplicate"
  | "inventory_origin_conflict"
  | "routing_failed"
  | "after_verification_failed";

export type LeadCaptureOneEventReconcileArgs = {
  sourceEventId: string;
  expectedSourceSystem: string;
  expectedRoute: string;
  expectedLeadId: string;
  /** The client the confirmed association must resolve to. Never inferred. */
  expectedDestinationClientAccountId: string;
  expectedDbHost: string;
  operator: string;
  confirm: string;
  /** Default false: resolve and report only, write nothing. */
  apply?: boolean;
  databaseUrl?: string;
};

export type LeadCaptureOneEventReconcileSnapshot = {
  sourceEventId: string;
  sourceProvider: string;
  sourceSystem: string;
  sourceRouteKey: string | null;
  sourceLeadId: string | null;
  status: SourceLeadEventStatus;
  normalizedPayloadPresent: boolean;
  clientAccountIdResolved: string | null;
  routingRuleIdResolved: string | null;
  routingAuthority: string | null;
  inventoryCount: number;
  /** Inventory for this event already stamped to the expected origin client. */
  inventoryWithExpectedOriginCount: number;
  /** Inventory for this event stamped to some *other* client. Never overwritten. */
  inventoryWithConflictingOriginCount: number;
  fulfillmentOutboxCount: number;
  allocationCount: number;
  ghlDeliveryAttempted: boolean;
  metaDispatchCount: number;
  sourceFunnelId: string | null;
  sourceFunnelFirstSeenAt: string | null;
  sourceFunnelLastSeenAt: string | null;
  operator: string;
  dbHostVerified: string;
};

export type LeadCaptureOneEventReconcileAssociation = {
  sourceFunnelId: string;
  originClientAccountId: string;
  matchedBy: string;
  matchEvidence: string;
  routeKey: string | null;
};

export type LeadCaptureOneEventReconcileResult = {
  outcome: LeadCaptureOneEventReconcileOutcome;
  ok: boolean;
  reasonCode?: LeadCaptureOneEventReconcileReasonCode;
  reason?: string;
  writesAttempted: boolean;
  before?: LeadCaptureOneEventReconcileSnapshot;
  after?: LeadCaptureOneEventReconcileSnapshot;
  association?: LeadCaptureOneEventReconcileAssociation;
  plannedActions?: string[];
  routing?: {
    matched: boolean;
    matchedRuleId: string | null;
    destinationClientAccountId: string | null;
    routingAuthority: string | null;
    status: SourceLeadEventStatus;
  };
  inventory?: {
    outcome: string;
    inventoryItemId: string | null;
    reused: boolean;
    /** Rows whose NULL origin client was filled in. Never an overwrite. */
    originStampedCount?: number;
  };
};

export type LeadCaptureOneEventReconcileEventRow = {
  id: string;
  sourceProvider: string;
  sourceSystem: string;
  sourceRouteKey: string | null;
  sourceLeadId: string | null;
  sourceLeadUid: string | null;
  status: SourceLeadEventStatus;
  rawPayloadJson: Prisma.JsonValue;
  normalizedPayloadJson: Prisma.JsonValue | null;
  routingResultJson: Prisma.JsonValue | null;
  sourceCampaignId: string | null;
  clientAccountIdResolved: string | null;
  routingRuleIdResolved: string | null;
  deliveredAt: Date | null;
  deliveryResultJson: Prisma.JsonValue | null;
  enrichmentMetadataJson: Prisma.JsonValue | null;
};

export type LeadCaptureOneEventReconcileStore = {
  withReconcileLock<T>(sourceEventId: string, fn: () => Promise<T>): Promise<T>;
  findSourceLeadEventById(id: string): Promise<LeadCaptureOneEventReconcileEventRow | null>;
  countInventoryBySourceLeadEventId(id: string): Promise<number>;
  countInventoryWithOriginBySourceLeadEventId(input: {
    sourceLeadEventId: string;
    originClientAccountId: string;
  }): Promise<number>;
  countInventoryWithConflictingOriginBySourceLeadEventId(input: {
    sourceLeadEventId: string;
    originClientAccountId: string;
  }): Promise<number>;
  countFulfillmentOutboxBySourceLeadEventId(id: string): Promise<number>;
  countLeadAllocationsBySourceLeadEventId(id: string): Promise<number>;
  countMetaDispatchAttempts(eventUuids: string[]): Promise<number>;
};

export type LeadCaptureOneEventReconcileDeps = {
  prisma?: PrismaClient;
  store?: LeadCaptureOneEventReconcileStore;
  assertExpectedDbHostImpl?: typeof assertExpectedDbHost;
  resolveAssociationImpl?: typeof resolveConfirmedLeadCaptureSourceAssociation;
  observeSourceFunnelImpl?: typeof observeNextGenSourceFunnelSafely;
  persistRoutingImpl?: typeof persistRoutingAndDuplicate;
  trackCampaignInventoryImpl?: typeof trackCampaignInventorySafely;
  stampNullOriginOnSourceEventInventoryImpl?: typeof stampNullOriginOnSourceEventInventory;
  findSourceFunnelByIdImpl?: typeof findSourceFunnelById;
  now?: Date;
};

function asPlainObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function jsonPresent(value: Prisma.JsonValue | null | undefined): boolean {
  return value !== null && value !== undefined;
}

function trimOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function safeErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message.trim()) return err.message;
  return "unknown_error";
}

function ghlDeliveryAttempted(event: LeadCaptureOneEventReconcileEventRow): boolean {
  if (event.deliveredAt) return true;
  if (jsonPresent(event.deliveryResultJson)) return true;
  const enrichment = asPlainObject(event.enrichmentMetadataJson);
  return enrichment?.liveCanaryAttempt === true;
}

function routingAuthorityOf(event: LeadCaptureOneEventReconcileEventRow): string | null {
  return trimOrNull(asPlainObject(event.routingResultJson)?.routingAuthority);
}

function createPrismaReconcileStore(db: PrismaClient): LeadCaptureOneEventReconcileStore {
  return {
    async withReconcileLock(sourceEventId, fn) {
      const key = `${RECONCILE_LOCK_PREFIX}${sourceEventId}`;
      return db.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
          return await fn();
        },
        {
          maxWait: LEADCAPTURE_RECONCILE_LOCK_MAX_WAIT_MS,
          timeout: LEADCAPTURE_RECONCILE_LOCK_TIMEOUT_MS,
        }
      );
    },
    findSourceLeadEventById(id) {
      return db.sourceLeadEvent.findUnique({
        where: { id },
        select: {
          id: true,
          sourceProvider: true,
          sourceSystem: true,
          sourceRouteKey: true,
          sourceLeadId: true,
          sourceLeadUid: true,
          status: true,
          rawPayloadJson: true,
          normalizedPayloadJson: true,
          routingResultJson: true,
          sourceCampaignId: true,
          clientAccountIdResolved: true,
          routingRuleIdResolved: true,
          deliveredAt: true,
          deliveryResultJson: true,
          enrichmentMetadataJson: true,
        },
      });
    },
    countInventoryBySourceLeadEventId(id) {
      return db.leadInventoryItem.count({ where: { sourceLeadEventId: id } });
    },
    countInventoryWithOriginBySourceLeadEventId(input) {
      return db.leadInventoryItem.count({
        where: {
          sourceLeadEventId: input.sourceLeadEventId,
          originClientAccountId: input.originClientAccountId,
        },
      });
    },
    countInventoryWithConflictingOriginBySourceLeadEventId(input) {
      return db.leadInventoryItem.count({
        where: {
          sourceLeadEventId: input.sourceLeadEventId,
          originClientAccountId: { not: null },
          NOT: { originClientAccountId: input.originClientAccountId },
        },
      });
    },
    countFulfillmentOutboxBySourceLeadEventId(id) {
      return db.fulfillmentOutbox.count({ where: { sourceLeadEventId: id } });
    },
    countLeadAllocationsBySourceLeadEventId(id) {
      return db.leadAllocation.count({ where: { sourceLeadEventId: id } });
    },
    countMetaDispatchAttempts(eventUuids) {
      const ids = eventUuids.filter((value) => value.length > 0);
      if (ids.length === 0) return Promise.resolve(0);
      return db.metaDispatchAttempt.count({ where: { eventUuid: { in: ids } } });
    },
  };
}

async function loadSnapshot(input: {
  event: LeadCaptureOneEventReconcileEventRow;
  store: LeadCaptureOneEventReconcileStore;
  sourceFunnelId: string | null;
  expectedClientAccountId: string;
  findFunnel: typeof findSourceFunnelById;
  db: PrismaClient;
  operator: string;
  dbHostVerified: string;
}): Promise<LeadCaptureOneEventReconcileSnapshot> {
  const { event, store } = input;
  const [
    inventoryCount,
    inventoryWithExpectedOriginCount,
    inventoryWithConflictingOriginCount,
    fulfillmentOutboxCount,
    allocationCount,
    metaDispatchCount,
  ] = await Promise.all([
    store.countInventoryBySourceLeadEventId(event.id),
    store.countInventoryWithOriginBySourceLeadEventId({
      sourceLeadEventId: event.id,
      originClientAccountId: input.expectedClientAccountId,
    }),
    store.countInventoryWithConflictingOriginBySourceLeadEventId({
      sourceLeadEventId: event.id,
      originClientAccountId: input.expectedClientAccountId,
    }),
    store.countFulfillmentOutboxBySourceLeadEventId(event.id),
    store.countLeadAllocationsBySourceLeadEventId(event.id),
    store.countMetaDispatchAttempts(
      [event.id, event.sourceLeadId ?? "", event.sourceLeadUid ?? ""].filter(Boolean)
    ),
  ]);

  const funnel = input.sourceFunnelId
    ? await input.findFunnel(input.sourceFunnelId, input.db)
    : null;

  return {
    sourceEventId: event.id,
    sourceProvider: event.sourceProvider,
    sourceSystem: event.sourceSystem,
    sourceRouteKey: event.sourceRouteKey,
    sourceLeadId: event.sourceLeadId,
    status: event.status,
    normalizedPayloadPresent: jsonPresent(event.normalizedPayloadJson),
    clientAccountIdResolved: event.clientAccountIdResolved,
    routingRuleIdResolved: event.routingRuleIdResolved,
    routingAuthority: routingAuthorityOf(event),
    inventoryCount,
    inventoryWithExpectedOriginCount,
    inventoryWithConflictingOriginCount,
    fulfillmentOutboxCount,
    allocationCount,
    ghlDeliveryAttempted: ghlDeliveryAttempted(event),
    metaDispatchCount,
    sourceFunnelId: funnel?.id ?? input.sourceFunnelId ?? null,
    sourceFunnelFirstSeenAt: funnel?.firstSeenAt?.toISOString() ?? null,
    sourceFunnelLastSeenAt: funnel?.lastSeenAt?.toISOString() ?? null,
    operator: input.operator,
    dbHostVerified: input.dbHostVerified,
  };
}

function refused(input: {
  reasonCode: LeadCaptureOneEventReconcileReasonCode;
  reason: string;
  before?: LeadCaptureOneEventReconcileSnapshot;
  association?: LeadCaptureOneEventReconcileAssociation;
}): LeadCaptureOneEventReconcileResult {
  return {
    outcome: "REFUSED",
    ok: false,
    reasonCode: input.reasonCode,
    reason: input.reason,
    writesAttempted: false,
    before: input.before,
    association: input.association,
  };
}

function preexistingSideEffectReason(
  before: LeadCaptureOneEventReconcileSnapshot
): string | null {
  const parts: string[] = [];
  if (before.fulfillmentOutboxCount > 0) parts.push("fulfillment_outbox");
  if (before.allocationCount > 0) parts.push("allocation");
  if (before.ghlDeliveryAttempted) parts.push("ghl_delivery");
  if (before.metaDispatchCount > 0) parts.push("meta_dispatch");
  return parts.length > 0 ? `Pre-existing side effects: ${parts.join(", ")}.` : null;
}

function afterVerificationProblem(input: {
  before: LeadCaptureOneEventReconcileSnapshot;
  after: LeadCaptureOneEventReconcileSnapshot;
  expectedClientAccountId: string;
  inventoryItemId: string | null;
}): string | null {
  const { before, after } = input;
  if (after.sourceEventId !== before.sourceEventId) return "event_id_changed";
  if (!after.normalizedPayloadPresent) return "normalized_payload_missing_after_reconcile";
  if (after.inventoryCount > 1) return "inventory_duplicated";
  if (after.clientAccountIdResolved !== input.expectedClientAccountId) {
    return "destination_client_not_resolved";
  }
  if (input.inventoryItemId && after.inventoryCount !== 1) return "inventory_not_created";
  if (after.inventoryCount === 1 && after.inventoryWithExpectedOriginCount !== 1) {
    return "inventory_origin_not_stamped";
  }
  if (!after.sourceFunnelFirstSeenAt) return "source_funnel_not_observed";
  if (after.fulfillmentOutboxCount > 0) return "fulfillment_outbox_created";
  if (after.allocationCount > 0) return "allocation_created";
  if (after.ghlDeliveryAttempted) return "ghl_delivery_attempted";
  if (after.metaDispatchCount > 0) return "meta_dispatch_created";
  return null;
}

/**
 * Identity signals for the stored event: the raw payload is authoritative, and
 * the persisted normalized payload is the fallback for events whose raw body
 * predates `parent_url` materialization.
 */
export function reconcileIdentitySignals(input: {
  materializedPayload: Record<string, unknown>;
  routeKey: string | null;
  normalizedPayload: unknown;
  sourceCampaignId: string | null;
}): LeadCaptureSourceIdentitySignals {
  const fromRaw = leadCaptureSourceIdentitySignalsFromPayload(
    input.materializedPayload,
    input.routeKey
  );
  if (hasLeadCaptureSourceIdentitySignals(fromRaw)) {
    return withLeadCaptureSourceCampaignIdFallback(fromRaw, input.sourceCampaignId);
  }
  const parsed = lifecycleEventSchema.safeParse(input.normalizedPayload);
  const fromNormalized = parsed.success
    ? leadCaptureSourceIdentitySignalsFromLifecyclePayload(parsed.data)
    : fromRaw;
  return withLeadCaptureSourceCampaignIdFallback(fromNormalized, input.sourceCampaignId);
}

function presentAssociation(
  association: LeadCaptureSourceAssociationResult
): LeadCaptureOneEventReconcileAssociation | undefined {
  if (!association.matched) return undefined;
  return {
    sourceFunnelId: association.match.sourceFunnelId,
    originClientAccountId: association.match.originClientAccountId,
    matchedBy: association.match.matchedBy,
    matchEvidence: association.match.matchEvidence,
    routeKey: association.match.routeKey,
  };
}

function reusedInventory(result: CampaignInventoryTrackingResult): boolean {
  return result.ok && result.outcome.startsWith("reused");
}

export async function reconcileOneLeadCaptureSourceEventAssociation(
  args: LeadCaptureOneEventReconcileArgs,
  deps: LeadCaptureOneEventReconcileDeps = {}
): Promise<LeadCaptureOneEventReconcileResult> {
  const assertHost = deps.assertExpectedDbHostImpl ?? assertExpectedDbHost;
  const resolveAssociation =
    deps.resolveAssociationImpl ?? resolveConfirmedLeadCaptureSourceAssociation;
  const observeFunnel = deps.observeSourceFunnelImpl ?? observeNextGenSourceFunnelSafely;
  const persistRouting = deps.persistRoutingImpl ?? persistRoutingAndDuplicate;
  const trackInventory = deps.trackCampaignInventoryImpl ?? trackCampaignInventorySafely;
  const stampOrigin =
    deps.stampNullOriginOnSourceEventInventoryImpl ?? stampNullOriginOnSourceEventInventory;
  const findFunnel = deps.findSourceFunnelByIdImpl ?? findSourceFunnelById;

  if (args.confirm !== LEADCAPTURE_RECONCILE_CONFIRMATION) {
    return refused({
      reasonCode: "confirmation_mismatch",
      reason: "Confirmation phrase did not match.",
    });
  }

  const operator = args.operator.trim();
  if (!operator) {
    return refused({ reasonCode: "operator_required", reason: "Operator is required." });
  }

  const expectedClientAccountId = args.expectedDestinationClientAccountId.trim();
  if (!expectedClientAccountId) {
    return refused({
      reasonCode: "destination_client_mismatch",
      reason: "expected-destination-client-account-id is required.",
    });
  }

  const databaseUrl = (args.databaseUrl ?? process.env.DATABASE_URL ?? "").trim();
  let dbIdentity: DbTargetIdentity;
  try {
    dbIdentity = assertHost({ databaseUrl, expectedDbHost: args.expectedDbHost });
  } catch (err) {
    return refused({ reasonCode: "db_host_mismatch", reason: safeErrorMessage(err) });
  }

  const db = deps.prisma ?? (await import("../../lib/db.js")).prisma;
  const store = deps.store ?? createPrismaReconcileStore(db);
  const apply = args.apply === true;

  return store.withReconcileLock(args.sourceEventId, async () => {
    const event = await store.findSourceLeadEventById(args.sourceEventId);
    if (!event) {
      return refused({
        reasonCode: "source_event_not_found",
        reason: "SourceLeadEvent not found.",
      });
    }

    const snapshotBase = {
      store,
      findFunnel,
      db,
      operator,
      dbHostVerified: dbIdentity.sanitized,
      expectedClientAccountId,
    };

    if (event.sourceProvider !== LEADCAPTURE_RECONCILE_PROVIDER) {
      return refused({
        reasonCode: "source_provider_mismatch",
        reason: "sourceProvider is not leadcapture_io.",
        before: await loadSnapshot({ ...snapshotBase, event, sourceFunnelId: null }),
      });
    }
    if (event.sourceSystem !== args.expectedSourceSystem) {
      return refused({
        reasonCode: "source_system_mismatch",
        reason: "sourceSystem does not match --expected-source-system.",
        before: await loadSnapshot({ ...snapshotBase, event, sourceFunnelId: null }),
      });
    }
    if ((event.sourceRouteKey ?? "") !== args.expectedRoute) {
      return refused({
        reasonCode: "source_route_mismatch",
        reason: "sourceRouteKey does not match --expected-route.",
        before: await loadSnapshot({ ...snapshotBase, event, sourceFunnelId: null }),
      });
    }
    if ((event.sourceLeadId ?? "") !== args.expectedLeadId) {
      return refused({
        reasonCode: "source_lead_id_mismatch",
        reason: "sourceLeadId does not match --expected-lead-id.",
        before: await loadSnapshot({ ...snapshotBase, event, sourceFunnelId: null }),
      });
    }

    const rawStored = asPlainObject(event.rawPayloadJson);
    if (!rawStored) {
      return refused({
        reasonCode: "raw_payload_missing",
        reason: "rawPayloadJson must exist and be an object.",
        before: await loadSnapshot({ ...snapshotBase, event, sourceFunnelId: null }),
      });
    }

    const parsedNormalized = lifecycleEventSchema.safeParse(event.normalizedPayloadJson);
    if (!parsedNormalized.success) {
      return refused({
        reasonCode: "not_normalized",
        reason:
          "normalizedPayloadJson is missing or no longer valid; re-normalize through the intake lane instead.",
        before: await loadSnapshot({ ...snapshotBase, event, sourceFunnelId: null }),
      });
    }

    const routeKey = event.sourceRouteKey ?? undefined;
    const raw = applyLeadCaptureEndpointDefaults(rawStored, routeKey);
    const materialized = materializeLeadCapturePayload(raw, { routeKeyFromPath: routeKey });
    const signals = reconcileIdentitySignals({
      materializedPayload: materialized,
      routeKey: event.sourceRouteKey,
      normalizedPayload: event.normalizedPayloadJson,
      sourceCampaignId: event.sourceCampaignId,
    });
    const association = await resolveAssociation(signals, db);
    const presentedAssociation = presentAssociation(association);

    if (!association.matched) {
      return refused({
        reasonCode: "source_association_unmatched",
        reason: `No confirmed source association for this event (${association.reason}).`,
        before: await loadSnapshot({ ...snapshotBase, event, sourceFunnelId: null }),
      });
    }
    if (association.match.originClientAccountId !== expectedClientAccountId) {
      return refused({
        reasonCode: "destination_client_mismatch",
        reason:
          "Confirmed source association resolves to a different client than --expected-destination-client-account-id.",
        before: await loadSnapshot({
          ...snapshotBase,
          event,
          sourceFunnelId: association.match.sourceFunnelId,
        }),
        association: presentedAssociation,
      });
    }

    const before = await loadSnapshot({
      ...snapshotBase,
      event,
      sourceFunnelId: association.match.sourceFunnelId,
    });

    const sideEffects = preexistingSideEffectReason(before);
    if (sideEffects) {
      return refused({
        reasonCode: "preexisting_side_effects",
        reason: sideEffects,
        before,
        association: presentedAssociation,
      });
    }
    if (before.inventoryCount > 1) {
      return refused({
        reasonCode: "inventory_duplicate",
        reason: "More than one inventory row already references this SourceLeadEvent.",
        before,
        association: presentedAssociation,
      });
    }
    // Origin provenance is append-only: stamping only ever fills a NULL origin.
    // An existing origin pointing at another client is an operator-visible
    // conflict, so refuse before planning or writing anything.
    if (before.inventoryWithConflictingOriginCount > 0) {
      return refused({
        reasonCode: "inventory_origin_conflict",
        reason: `Inventory for this SourceLeadEvent is already stamped to a different origin client than ${expectedClientAccountId}.`,
        before,
        association: presentedAssociation,
      });
    }

    if (!apply) {
      return {
        outcome: "PREVIEWED",
        ok: true,
        writesAttempted: false,
        before,
        association: presentedAssociation,
        plannedActions: [
          "observe_source_funnel_first_seen_last_seen",
          "re_run_routing_dry_run_on_existing_event",
          before.inventoryCount === 1
            ? "reuse_existing_inventory_item"
            : "create_inventory_item_if_eligible",
          ...(before.inventoryCount === 1 && before.inventoryWithExpectedOriginCount === 0
            ? ["stamp_null_origin_client_on_existing_inventory"]
            : []),
        ],
      };
    }

    const now = deps.now ?? new Date();
    let routingSummary: LeadCaptureOneEventReconcileResult["routing"];
    let inventorySummary: LeadCaptureOneEventReconcileResult["inventory"];
    try {
      await observeFunnel(
        {
          identity: resolveNextGenSourceIdentity(materialized, event.sourceRouteKey ?? ""),
          seenAt: now,
        },
        db
      );

      const persisted = await persistRouting(
        event.id,
        parsedNormalized.data,
        raw,
        event.sourceProvider,
        event.sourceSystem,
        event.sourceRouteKey ?? "",
        event.sourceLeadId ?? "",
        false,
        now.toISOString(),
        now,
        {
          extraEnrichmentMetadata: {
            sourceFunnelId: association.match.sourceFunnelId,
            sourceFunnelObserved: true,
            sourceFunnelAssociationStatus: "confirmed",
            reconciledBy: operator,
            reconciledAt: now.toISOString(),
          },
        }
      );
      routingSummary = {
        matched: persisted.routing.matched,
        matchedRuleId: persisted.routing.matchedRuleId ?? null,
        destinationClientAccountId: persisted.routing.destinationClientAccountId ?? null,
        routingAuthority: persisted.routing.routingAuthority ?? null,
        status: persisted.status,
      };

      const tracking = await trackInventory(
        { sourceLeadEventId: event.id, sourceLane: "leadcapture_io" },
        db
      );
      const stamped = await stampOrigin({
        sourceLeadEventId: event.id,
        originClientAccountId: association.match.originClientAccountId,
        db,
      });
      inventorySummary = {
        outcome: tracking.ok ? tracking.outcome : tracking.code,
        inventoryItemId: tracking.ok ? tracking.inventoryItemId : null,
        reused: reusedInventory(tracking),
        originStampedCount: stamped.count,
      };
    } catch (err) {
      return {
        outcome: "FAILED",
        ok: false,
        reasonCode: "routing_failed",
        reason: safeErrorMessage(err),
        writesAttempted: true,
        before,
        association: presentedAssociation,
        routing: routingSummary,
        inventory: inventorySummary,
      };
    }

    const afterEvent = await store.findSourceLeadEventById(args.sourceEventId);
    if (!afterEvent) {
      return {
        outcome: "FAILED",
        ok: false,
        reasonCode: "after_verification_failed",
        reason: "SourceLeadEvent missing after reconcile.",
        writesAttempted: true,
        before,
        association: presentedAssociation,
        routing: routingSummary,
        inventory: inventorySummary,
      };
    }

    const after = await loadSnapshot({
      ...snapshotBase,
      event: afterEvent,
      sourceFunnelId: association.match.sourceFunnelId,
    });
    const problem = afterVerificationProblem({
      before,
      after,
      expectedClientAccountId,
      inventoryItemId: inventorySummary?.inventoryItemId ?? null,
    });
    if (problem) {
      return {
        outcome: "FAILED",
        ok: false,
        reasonCode: "after_verification_failed",
        reason: problem,
        writesAttempted: true,
        before,
        after,
        association: presentedAssociation,
        routing: routingSummary,
        inventory: inventorySummary,
      };
    }

    return {
      outcome: "RECONCILED",
      ok: true,
      writesAttempted: true,
      before,
      after,
      association: presentedAssociation,
      routing: routingSummary,
      inventory: inventorySummary,
    };
  });
}
