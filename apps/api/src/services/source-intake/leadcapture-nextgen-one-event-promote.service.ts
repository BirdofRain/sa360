import type { Prisma, PrismaClient, SourceLeadEventStatus } from "@prisma/client";

import {
  assertExpectedDbHost,
  type DbTargetIdentity,
} from "../aged-inventory-bulk/aged-inventory-bulk-db-guard.js";
import { calculateInventoryAgeDays } from "../lead-inventory/lead-inventory-age.js";
import {
  isPurchasableInventoryCommerceLifecycle,
  resolveInventoryCommerceLifecycle,
  type InventoryCommerceLifecycleKey,
} from "../ppl-fulfillment/commerce-lifecycle.js";
import {
  processLeadCaptureNextGenLeadCreated,
  type LeadCaptureNextGenIntakeDeps,
  type LeadCaptureNextGenIntakeResult,
} from "./leadcapture-nextgen-intake.service.js";

export const NEXTGEN_ONE_EVENT_PROMOTE_CONFIRMATION = "PROMOTE ONE NEXTGEN SOURCE EVENT";
export const NEXTGEN_ONE_EVENT_PROMOTE_STAGE = "normalize_route_proof" as const;
export const NEXTGEN_ONE_EVENT_PROMOTE_SOURCE_PROVIDER = "leadcapture_io" as const;
export const NEXTGEN_ONE_EVENT_PROMOTE_SOURCE_SYSTEM = "leadcapture_io_nextgen" as const;
export const NEXTGEN_ONE_EVENT_PROMOTE_CAPTURE_STATUS = "received" as const;

/** Prisma interactive-transaction wait/timeout. Remote promotion can exceed the 5s default. */
export const NEXTGEN_ONE_EVENT_PROMOTE_LOCK_MAX_WAIT_MS = 30_000;
export const NEXTGEN_ONE_EVENT_PROMOTE_LOCK_TIMEOUT_MS = 180_000;

export type NextGenOneEventPromoteOutcome = "PROMOTED" | "REFUSED" | "FAILED";

export type NextGenOneEventPromoteReasonCode =
  | "unsupported_stage"
  | "confirmation_mismatch"
  | "operator_required"
  | "db_host_mismatch"
  | "source_event_not_found"
  | "source_system_mismatch"
  | "source_system_not_nextgen"
  | "source_provider_mismatch"
  | "source_route_mismatch"
  | "source_lead_id_mismatch"
  | "source_identity_not_unique"
  | "raw_payload_missing"
  | "not_capture_only"
  | "REFUSED_ALREADY_PROMOTED"
  | "inventory_already_exists"
  | "preexisting_side_effects"
  | "processor_failed"
  | "after_verification_failed";

export type NextGenOneEventPromoteArgs = {
  sourceEventId: string;
  stage: string;
  expectedSourceSystem: string;
  expectedRoute: string;
  expectedLeadId: string;
  expectedDbHost: string;
  operator: string;
  confirm: string;
  databaseUrl?: string;
};

export type NextGenOneEventPromoteInventorySummary = {
  inventoryItemId: string;
  nicheKey: string;
  generatedAt: string;
  status: string;
  lifecycleKey: InventoryCommerceLifecycleKey;
  commerceEligible: boolean;
};

export type NextGenOneEventPromoteSafeSnapshot = {
  sourceEventId: string;
  sourceProvider: string;
  sourceSystem: string;
  sourceRouteKey: string | null;
  sourceLeadId: string | null;
  status: SourceLeadEventStatus;
  normalizedPayloadPresent: boolean;
  associatedInventoryCount: number;
  sourceIdentityInventoryCount: number;
  siblingSourceEventCount: number;
  fulfillmentOutboxCount: number;
  allocationCount: number;
  ghlDeliveryAttempted: boolean;
  metaDispatchCount: number;
  stageRequested: typeof NEXTGEN_ONE_EVENT_PROMOTE_STAGE | string;
  operator: string;
  dbHostVerified: string;
};

export type NextGenOneEventPromoteResult = {
  outcome: NextGenOneEventPromoteOutcome;
  ok: boolean;
  reasonCode?: NextGenOneEventPromoteReasonCode;
  reason?: string;
  writesAttempted: boolean;
  before?: NextGenOneEventPromoteSafeSnapshot;
  after?: NextGenOneEventPromoteSafeSnapshot;
  inventory?: NextGenOneEventPromoteInventorySummary;
  processor?: {
    sourceEventId: string;
    status: SourceLeadEventStatus;
    intakeStage: string;
    duplicate: boolean;
    matched: boolean;
    shadowOutboxEnsured: boolean;
    inventoryTrackingOk?: boolean;
    inventoryTrackingOutcome?: string;
    inventoryItemId?: string | null;
    inventoryGeneratedAt?: string | null;
    inventoryLifecycleKey?: string;
    inventoryCommerceEligible?: boolean;
    inventoryStatus?: string | null;
  };
};

export type NextGenOneEventPromoteEventRow = {
  id: string;
  sourceProvider: string;
  sourceSystem: string;
  sourceRouteKey: string | null;
  sourceLeadId: string | null;
  sourceLeadUid: string | null;
  status: SourceLeadEventStatus;
  rawPayloadJson: Prisma.JsonValue;
  normalizedPayloadJson: Prisma.JsonValue | null;
  deliveredAt: Date | null;
  deliveryResultJson: Prisma.JsonValue | null;
  enrichmentMetadataJson: Prisma.JsonValue | null;
};

export type NextGenOneEventPromoteInventoryRow = {
  id: string;
  nicheKey: string;
  generatedAt: Date;
  status: string;
};

export type NextGenOneEventPromoteStore = {
  withPromoteLock<T>(sourceEventId: string, fn: () => Promise<T>): Promise<T>;
  findSourceLeadEventById(id: string): Promise<NextGenOneEventPromoteEventRow | null>;
  findInventoryItemBySourceLeadEventId(
    id: string
  ): Promise<NextGenOneEventPromoteInventoryRow | null>;
  countInventoryBySourceLeadEventId(id: string): Promise<number>;
  countInventoryBySourceIdentity(input: {
    sourceProvider: string;
    sourceSystem: string;
    sourceLeadId: string;
  }): Promise<number>;
  countSourceEventsBySourceIdentity(input: {
    sourceProvider: string;
    sourceSystem: string;
    sourceLeadId: string;
  }): Promise<number>;
  countFulfillmentOutboxBySourceLeadEventId(id: string): Promise<number>;
  countLeadAllocationsBySourceLeadEventId(id: string): Promise<number>;
  countMetaDispatchAttempts(eventUuids: string[]): Promise<number>;
};

export type NextGenOneEventPromoteDeps = {
  prisma?: PrismaClient;
  store?: NextGenOneEventPromoteStore;
  assertExpectedDbHostImpl?: typeof assertExpectedDbHost;
  processLeadCaptureNextGenLeadCreatedImpl?: typeof processLeadCaptureNextGenLeadCreated;
  processorDeps?: LeadCaptureNextGenIntakeDeps;
};

/**
 * Concurrency: this command is intended for a single manual invocation.
 *
 * The lock is transaction-scoped:
 *   SELECT pg_advisory_xact_lock(hashtext('nextgen-one-event-promote:' || id))
 * acquired inside a Prisma interactive `$transaction` callback. Prisma pins
 * that callback to one PostgreSQL session for the entire callback. The
 * callback stays open while preflight, processLeadCaptureNextGenLeadCreated,
 * and after-verification run. The lock is released automatically when the
 * transaction commits or rolls back.
 *
 * Session `pg_advisory_lock` / `pg_advisory_unlock` through a pooled
 * PrismaClient is not used — those calls are not guaranteed to share a
 * session.
 *
 * The NextGen processor keeps using its normal Prisma connections. This
 * outer transaction exists only to hold the advisory lock until promotion
 * finishes. Campaign inventory unique(sourceLeadEventId) plus its own
 * identity locks still prevent duplicate inventory rows. HTTP NextGen
 * intake never receives stageOverride, so capture_only inbound traffic
 * cannot promote while this command runs.
 */
const PROMOTE_LOCK_PREFIX = "nextgen-one-event-promote:";

function asPlainObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function jsonPresent(value: Prisma.JsonValue | null | undefined): boolean {
  return value !== null && value !== undefined;
}

function ghlDeliveryAttempted(event: NextGenOneEventPromoteEventRow): boolean {
  if (event.deliveredAt) return true;
  if (jsonPresent(event.deliveryResultJson)) return true;
  const enrichment = asPlainObject(event.enrichmentMetadataJson);
  return enrichment?.liveCanaryAttempt === true;
}

function isCanonicalCaptureOnlyEvent(event: NextGenOneEventPromoteEventRow): boolean {
  if (event.status !== NEXTGEN_ONE_EVENT_PROMOTE_CAPTURE_STATUS) return false;
  const enrichment = asPlainObject(event.enrichmentMetadataJson);
  if (!enrichment) return false;
  return enrichment.intakeStage === "capture_only" && enrichment.captureOnly === true;
}

function safeErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message.trim()) return err.message;
  return "unknown_error";
}

function presentInventory(
  item: NextGenOneEventPromoteInventoryRow,
  evaluatedAt = new Date()
): NextGenOneEventPromoteInventorySummary {
  const lifecycleKey = resolveInventoryCommerceLifecycle(
    calculateInventoryAgeDays(item.generatedAt, evaluatedAt)
  );
  return {
    inventoryItemId: item.id,
    nicheKey: item.nicheKey,
    generatedAt: item.generatedAt.toISOString(),
    status: item.status,
    lifecycleKey,
    commerceEligible: isPurchasableInventoryCommerceLifecycle(lifecycleKey),
  };
}

function createPrismaPromoteStore(db: PrismaClient): NextGenOneEventPromoteStore {
  return {
    async withPromoteLock(sourceEventId, fn) {
      const key = `${PROMOTE_LOCK_PREFIX}${sourceEventId}`;
      return db.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
          return await fn();
        },
        {
          maxWait: NEXTGEN_ONE_EVENT_PROMOTE_LOCK_MAX_WAIT_MS,
          timeout: NEXTGEN_ONE_EVENT_PROMOTE_LOCK_TIMEOUT_MS,
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
          deliveredAt: true,
          deliveryResultJson: true,
          enrichmentMetadataJson: true,
        },
      });
    },
    findInventoryItemBySourceLeadEventId(id) {
      return db.leadInventoryItem.findUnique({
        where: { sourceLeadEventId: id },
        select: {
          id: true,
          nicheKey: true,
          generatedAt: true,
          status: true,
        },
      });
    },
    countInventoryBySourceLeadEventId(id) {
      return db.leadInventoryItem.count({ where: { sourceLeadEventId: id } });
    },
    countInventoryBySourceIdentity(input) {
      return db.leadInventoryItem.count({
        where: {
          sourceLeadEvent: {
            sourceProvider: input.sourceProvider as never,
            sourceSystem: input.sourceSystem as never,
            sourceLeadId: input.sourceLeadId,
          },
        },
      });
    },
    countSourceEventsBySourceIdentity(input) {
      return db.sourceLeadEvent.count({
        where: {
          sourceProvider: input.sourceProvider as never,
          sourceSystem: input.sourceSystem as never,
          sourceLeadId: input.sourceLeadId,
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

async function loadSafeSnapshot(input: {
  event: NextGenOneEventPromoteEventRow;
  store: NextGenOneEventPromoteStore;
  operator: string;
  dbHostVerified: string;
  stageRequested: string;
}): Promise<NextGenOneEventPromoteSafeSnapshot> {
  const { event, store } = input;
  const sourceLeadId = event.sourceLeadId ?? "";
  const [
    associatedInventoryCount,
    sourceIdentityInventoryCount,
    siblingSourceEventCount,
    fulfillmentOutboxCount,
    allocationCount,
    metaDispatchCount,
  ] = await Promise.all([
    store.countInventoryBySourceLeadEventId(event.id),
    sourceLeadId
      ? store.countInventoryBySourceIdentity({
          sourceProvider: event.sourceProvider,
          sourceSystem: event.sourceSystem,
          sourceLeadId,
        })
      : Promise.resolve(0),
    sourceLeadId
      ? store.countSourceEventsBySourceIdentity({
          sourceProvider: event.sourceProvider,
          sourceSystem: event.sourceSystem,
          sourceLeadId,
        })
      : Promise.resolve(0),
    store.countFulfillmentOutboxBySourceLeadEventId(event.id),
    store.countLeadAllocationsBySourceLeadEventId(event.id),
    store.countMetaDispatchAttempts(
      [event.id, event.sourceLeadId ?? "", event.sourceLeadUid ?? ""].filter(Boolean)
    ),
  ]);

  return {
    sourceEventId: event.id,
    sourceProvider: event.sourceProvider,
    sourceSystem: event.sourceSystem,
    sourceRouteKey: event.sourceRouteKey,
    sourceLeadId: event.sourceLeadId,
    status: event.status,
    normalizedPayloadPresent: jsonPresent(event.normalizedPayloadJson),
    associatedInventoryCount,
    sourceIdentityInventoryCount,
    siblingSourceEventCount,
    fulfillmentOutboxCount,
    allocationCount,
    ghlDeliveryAttempted: ghlDeliveryAttempted(event),
    metaDispatchCount,
    stageRequested: input.stageRequested,
    operator: input.operator,
    dbHostVerified: input.dbHostVerified,
  };
}

function refused(input: {
  reasonCode: NextGenOneEventPromoteReasonCode;
  reason: string;
  writesAttempted?: boolean;
  before?: NextGenOneEventPromoteSafeSnapshot;
}): NextGenOneEventPromoteResult {
  return {
    outcome: "REFUSED",
    ok: false,
    reasonCode: input.reasonCode,
    reason: input.reason,
    writesAttempted: input.writesAttempted ?? false,
    before: input.before,
  };
}

function failed(input: {
  reasonCode: NextGenOneEventPromoteReasonCode;
  reason: string;
  writesAttempted: boolean;
  before?: NextGenOneEventPromoteSafeSnapshot;
  after?: NextGenOneEventPromoteSafeSnapshot;
  processor?: NextGenOneEventPromoteResult["processor"];
  inventory?: NextGenOneEventPromoteInventorySummary;
}): NextGenOneEventPromoteResult {
  return {
    outcome: "FAILED",
    ok: false,
    reasonCode: input.reasonCode,
    reason: input.reason,
    writesAttempted: input.writesAttempted,
    before: input.before,
    after: input.after,
    processor: input.processor,
    inventory: input.inventory,
  };
}

function presentProcessor(result: LeadCaptureNextGenIntakeResult): NonNullable<
  NextGenOneEventPromoteResult["processor"]
> {
  const tracking = result.inventoryTracking;
  return {
    sourceEventId: result.sourceEventId,
    status: result.status,
    intakeStage: result.intakeStage,
    duplicate: result.duplicate,
    matched: result.matched,
    shadowOutboxEnsured: result.shadowOutboxEnsured,
    inventoryTrackingOk: tracking?.ok,
    inventoryTrackingOutcome: tracking?.ok
      ? tracking.outcome
      : tracking && !tracking.ok
        ? tracking.code
        : undefined,
    inventoryItemId: tracking?.ok ? tracking.inventoryItemId : null,
    inventoryGeneratedAt: tracking?.ok ? tracking.generatedAt : null,
    inventoryLifecycleKey: tracking?.ok ? tracking.lifecycleKey : undefined,
    inventoryCommerceEligible: tracking?.ok ? tracking.commerceEligible : undefined,
    inventoryStatus: tracking?.ok ? tracking.inventoryStatus : undefined,
  };
}

function processorVerificationProblem(
  result: LeadCaptureNextGenIntakeResult,
  expectedEventId: string
): string | null {
  if (result.sourceEventId !== expectedEventId) {
    return "processor_source_event_id_mismatch";
  }
  if (result.intakeStage !== NEXTGEN_ONE_EVENT_PROMOTE_STAGE) {
    return "processor_intake_stage_mismatch";
  }
  if (result.shadowOutboxEnsured) {
    return "processor_shadow_outbox_ensured";
  }
  const tracking = result.inventoryTracking;
  if (!tracking?.ok) {
    return "processor_inventory_tracking_failed";
  }
  if (tracking.outcome !== "created") {
    return "processor_inventory_not_created";
  }
  if (!tracking.inventoryItemId) {
    return "processor_inventory_item_missing";
  }
  if (tracking.sourceLeadEventId !== expectedEventId) {
    return "processor_inventory_event_mismatch";
  }
  return null;
}

function afterVerificationProblem(
  after: NextGenOneEventPromoteSafeSnapshot,
  expectedEventId: string
): string | null {
  if (after.sourceEventId !== expectedEventId) {
    return "after_event_id_changed";
  }
  if (!after.normalizedPayloadPresent) {
    return "normalized_payload_missing_after_promote";
  }
  if (after.siblingSourceEventCount !== 1) {
    return "second_source_event_created";
  }
  if (after.associatedInventoryCount !== 1 || after.sourceIdentityInventoryCount !== 1) {
    return after.associatedInventoryCount === 0 || after.sourceIdentityInventoryCount === 0
      ? "inventory_not_created"
      : "inventory_count_exceeded";
  }
  if (after.fulfillmentOutboxCount > 0) {
    return "fulfillment_outbox_created";
  }
  if (after.allocationCount > 0) {
    return "nextgen_allocation_created";
  }
  if (after.ghlDeliveryAttempted) {
    return "ghl_delivery_attempted";
  }
  if (after.metaDispatchCount > 0) {
    return "meta_dispatch_created";
  }
  return null;
}

function preexistingSideEffectReason(before: NextGenOneEventPromoteSafeSnapshot): string | null {
  const parts: string[] = [];
  if (before.fulfillmentOutboxCount > 0) parts.push("fulfillment_outbox");
  if (before.allocationCount > 0) parts.push("allocation");
  if (before.ghlDeliveryAttempted) parts.push("ghl_delivery");
  if (before.metaDispatchCount > 0) parts.push("meta_dispatch");
  return parts.length > 0 ? `Pre-existing side effects: ${parts.join(", ")}.` : null;
}

export async function promoteOneLeadCaptureNextGenSourceEvent(
  args: NextGenOneEventPromoteArgs,
  deps: NextGenOneEventPromoteDeps = {}
): Promise<NextGenOneEventPromoteResult> {
  const processImpl =
    deps.processLeadCaptureNextGenLeadCreatedImpl ?? processLeadCaptureNextGenLeadCreated;
  const assertHost = deps.assertExpectedDbHostImpl ?? assertExpectedDbHost;

  if (args.stage !== NEXTGEN_ONE_EVENT_PROMOTE_STAGE) {
    return refused({
      reasonCode: "unsupported_stage",
      reason: `Only ${NEXTGEN_ONE_EVENT_PROMOTE_STAGE} is accepted.`,
    });
  }

  if (args.confirm !== NEXTGEN_ONE_EVENT_PROMOTE_CONFIRMATION) {
    return refused({
      reasonCode: "confirmation_mismatch",
      reason: "Confirmation phrase did not match.",
    });
  }

  const operator = args.operator.trim();
  if (!operator) {
    return refused({
      reasonCode: "operator_required",
      reason: "Operator is required.",
    });
  }

  const databaseUrl = (args.databaseUrl ?? process.env.DATABASE_URL ?? "").trim();
  let dbIdentity: DbTargetIdentity;
  try {
    dbIdentity = assertHost({
      databaseUrl,
      expectedDbHost: args.expectedDbHost,
    });
  } catch (err) {
    return refused({
      reasonCode: "db_host_mismatch",
      reason: safeErrorMessage(err),
    });
  }

  const store =
    deps.store ??
    createPrismaPromoteStore(deps.prisma ?? (await import("../../lib/db.js")).prisma);

  return store.withPromoteLock(args.sourceEventId, async () => {
    const event = await store.findSourceLeadEventById(args.sourceEventId);
    if (!event) {
      return refused({
        reasonCode: "source_event_not_found",
        reason: "SourceLeadEvent not found.",
      });
    }

    const before = await loadSafeSnapshot({
      event,
      store,
      operator,
      dbHostVerified: dbIdentity.sanitized,
      stageRequested: args.stage,
    });

    if (event.sourceSystem !== args.expectedSourceSystem) {
      return refused({
        reasonCode: "source_system_mismatch",
        reason: "sourceSystem does not match --expected-source-system.",
        before,
      });
    }

    if (event.sourceSystem !== NEXTGEN_ONE_EVENT_PROMOTE_SOURCE_SYSTEM) {
      return refused({
        reasonCode: "source_system_not_nextgen",
        reason: "sourceSystem is not leadcapture_io_nextgen.",
        before,
      });
    }

    if (event.sourceProvider !== NEXTGEN_ONE_EVENT_PROMOTE_SOURCE_PROVIDER) {
      return refused({
        reasonCode: "source_provider_mismatch",
        reason: "sourceProvider is not leadcapture_io.",
        before,
      });
    }

    if ((event.sourceRouteKey ?? "") !== args.expectedRoute) {
      return refused({
        reasonCode: "source_route_mismatch",
        reason: "sourceRouteKey does not match --expected-route.",
        before,
      });
    }

    if ((event.sourceLeadId ?? "") !== args.expectedLeadId) {
      return refused({
        reasonCode: "source_lead_id_mismatch",
        reason: "sourceLeadId does not match --expected-lead-id.",
        before,
      });
    }

    if (before.siblingSourceEventCount !== 1) {
      return refused({
        reasonCode: "source_identity_not_unique",
        reason: "More than one SourceLeadEvent exists for this source identity.",
        before,
      });
    }

    const rawPayload = asPlainObject(event.rawPayloadJson);
    if (!rawPayload) {
      return refused({
        reasonCode: "raw_payload_missing",
        reason: "rawPayloadJson must exist and be an object.",
        before,
      });
    }

    if (jsonPresent(event.normalizedPayloadJson)) {
      return refused({
        reasonCode: "REFUSED_ALREADY_PROMOTED",
        reason: "normalizedPayloadJson already exists; refusing to re-normalize.",
        before,
      });
    }

    if (!isCanonicalCaptureOnlyEvent(event)) {
      return refused({
        reasonCode: "not_capture_only",
        reason:
          "Event is not a canonical capture-only NextGen event (status received, intakeStage capture_only, captureOnly true).",
        before,
      });
    }

    if (before.associatedInventoryCount > 0 || before.sourceIdentityInventoryCount > 0) {
      return refused({
        reasonCode: "inventory_already_exists",
        reason: "Inventory already exists for this SourceLeadEvent or source identity.",
        before,
      });
    }

    const sideEffects = preexistingSideEffectReason(before);
    if (sideEffects) {
      return refused({
        reasonCode: "preexisting_side_effects",
        reason: sideEffects,
        before,
      });
    }

    let processorResult: LeadCaptureNextGenIntakeResult;
    try {
      processorResult = await processImpl({
        rawPayload,
        stageOverride: NEXTGEN_ONE_EVENT_PROMOTE_STAGE,
        deps: deps.processorDeps,
      });
    } catch (err) {
      const afterEvent = await store.findSourceLeadEventById(args.sourceEventId);
      const after = afterEvent
        ? await loadSafeSnapshot({
            event: afterEvent,
            store,
            operator,
            dbHostVerified: dbIdentity.sanitized,
            stageRequested: args.stage,
          })
        : undefined;
      return failed({
        reasonCode: "processor_failed",
        reason: safeErrorMessage(err),
        writesAttempted: true,
        before,
        after,
      });
    }

    const processorPresented = presentProcessor(processorResult);
    const processorProblem = processorVerificationProblem(processorResult, args.sourceEventId);

    const afterEvent = await store.findSourceLeadEventById(args.sourceEventId);
    if (!afterEvent) {
      return failed({
        reasonCode: "after_verification_failed",
        reason: [processorProblem, "SourceLeadEvent missing after processor"]
          .filter(Boolean)
          .join("; "),
        writesAttempted: true,
        before,
        processor: processorPresented,
      });
    }

    const after = await loadSafeSnapshot({
      event: afterEvent,
      store,
      operator,
      dbHostVerified: dbIdentity.sanitized,
      stageRequested: args.stage,
    });
    const afterProblem = afterVerificationProblem(after, args.sourceEventId);
    const inventoryRow = await store.findInventoryItemBySourceLeadEventId(args.sourceEventId);
    const inventory = inventoryRow ? presentInventory(inventoryRow) : undefined;
    const problems = [processorProblem, afterProblem].filter((value): value is string =>
      Boolean(value)
    );
    if (problems.length > 0) {
      return failed({
        reasonCode: "after_verification_failed",
        reason: problems.join("; "),
        writesAttempted: true,
        before,
        after,
        processor: processorPresented,
        inventory,
      });
    }

    if (!inventory) {
      return failed({
        reasonCode: "after_verification_failed",
        reason: "inventory_not_created",
        writesAttempted: true,
        before,
        after,
        processor: processorPresented,
      });
    }

    return {
      outcome: "PROMOTED",
      ok: true,
      writesAttempted: true,
      before,
      after,
      inventory,
      processor: processorPresented,
    };
  });
}
