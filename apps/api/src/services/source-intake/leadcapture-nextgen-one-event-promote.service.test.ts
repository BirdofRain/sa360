import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  processLeadCaptureNextGenLeadCreated,
  type LeadCaptureNextGenIntakeInput,
} from "./leadcapture-nextgen-intake.service.js";
import {
  NEXTGEN_ONE_EVENT_PROMOTE_CONFIRMATION,
  NEXTGEN_ONE_EVENT_PROMOTE_SOURCE_SYSTEM,
  NEXTGEN_ONE_EVENT_PROMOTE_STAGE,
  promoteOneLeadCaptureNextGenSourceEvent,
  type NextGenOneEventPromoteArgs,
  type NextGenOneEventPromoteEventRow,
  type NextGenOneEventPromoteInventoryRow,
  type NextGenOneEventPromoteStore,
} from "./leadcapture-nextgen-one-event-promote.service.js";

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "../../fixtures/leadcaptureio");
const LOCAL_TEST_DB_URL = "postgresql://sa360@127.0.0.1:5432/sa360_test";
const EVENT_ID = "evt_nextgen_promote_1";

function loadNurseFixture(): Record<string, unknown> {
  return JSON.parse(
    readFileSync(join(fixtureDir, "leadcaptureio-webhook-sample-nextgen-nurse.json"), "utf8")
  ) as Record<string, unknown>;
}

function nurseIdentity() {
  const fixture = loadNurseFixture();
  return {
    fixture,
    route: String(fixture.sa360_route_key),
    leadId: String(fixture.lead_id),
  };
}

function captureOnlyEvent(
  overrides: Partial<NextGenOneEventPromoteEventRow> = {}
): NextGenOneEventPromoteEventRow {
  const { fixture, route, leadId } = nurseIdentity();
  return {
    id: EVENT_ID,
    sourceProvider: "leadcapture_io",
    sourceSystem: NEXTGEN_ONE_EVENT_PROMOTE_SOURCE_SYSTEM,
    sourceRouteKey: route,
    sourceLeadId: leadId,
    sourceLeadUid: `leadcaptureio-${NEXTGEN_ONE_EVENT_PROMOTE_SOURCE_SYSTEM}-${leadId}`,
    status: "received",
    rawPayloadJson: fixture as NextGenOneEventPromoteEventRow["rawPayloadJson"],
    normalizedPayloadJson: null,
    deliveredAt: null,
    deliveryResultJson: null,
    enrichmentMetadataJson: { intakeStage: "capture_only", captureOnly: true },
    ...overrides,
  };
}

type MemoryStore = NextGenOneEventPromoteStore & {
  event: NextGenOneEventPromoteEventRow | null;
  inventoryItem: NextGenOneEventPromoteInventoryRow | null;
  inventoryByEvent: number;
  inventoryByIdentity: number;
  siblingCount: number;
  outboxCount: number;
  allocationCount: number;
  metaCount: number;
  lockCalls: number;
  findCalls: number;
};

function createMemoryStore(
  event: NextGenOneEventPromoteEventRow | null,
  counts: Partial<Omit<MemoryStore, keyof NextGenOneEventPromoteStore | "event" | "lockCalls" | "findCalls">> = {}
): MemoryStore {
  const store: MemoryStore = {
    event,
    inventoryItem: counts.inventoryByEvent
      ? {
          id: "inv_promote_1",
          nicheKey: "nurse",
          generatedAt: new Date("2026-08-18T14:37:03.545Z"),
          status: "pending_review",
        }
      : null,
    inventoryByEvent: counts.inventoryByEvent ?? 0,
    inventoryByIdentity: counts.inventoryByIdentity ?? 0,
    siblingCount: counts.siblingCount ?? (event ? 1 : 0),
    outboxCount: counts.outboxCount ?? 0,
    allocationCount: counts.allocationCount ?? 0,
    metaCount: counts.metaCount ?? 0,
    lockCalls: 0,
    findCalls: 0,
    async withPromoteLock(_sourceEventId, fn) {
      store.lockCalls += 1;
      return fn();
    },
    async findSourceLeadEventById(id) {
      store.findCalls += 1;
      if (!store.event || store.event.id !== id) return null;
      return store.event;
    },
    async findInventoryItemBySourceLeadEventId(id) {
      if (!store.inventoryItem || !store.event || store.event.id !== id) return null;
      return store.inventoryItem;
    },
    async countInventoryBySourceLeadEventId() {
      return store.inventoryByEvent;
    },
    async countInventoryBySourceIdentity() {
      return store.inventoryByIdentity;
    },
    async countSourceEventsBySourceIdentity() {
      return store.siblingCount;
    },
    async countFulfillmentOutboxBySourceLeadEventId() {
      return store.outboxCount;
    },
    async countLeadAllocationsBySourceLeadEventId() {
      return store.allocationCount;
    },
    async countMetaDispatchAttempts() {
      return store.metaCount;
    },
  };
  return store;
}

function baseArgs(overrides: Partial<NextGenOneEventPromoteArgs> = {}): NextGenOneEventPromoteArgs {
  const { route, leadId } = nurseIdentity();
  return {
    sourceEventId: EVENT_ID,
    stage: NEXTGEN_ONE_EVENT_PROMOTE_STAGE,
    expectedSourceSystem: NEXTGEN_ONE_EVENT_PROMOTE_SOURCE_SYSTEM,
    expectedRoute: route,
    expectedLeadId: leadId,
    expectedDbHost: "127.0.0.1",
    operator: "test-operator",
    confirm: NEXTGEN_ONE_EVENT_PROMOTE_CONFIRMATION,
    databaseUrl: LOCAL_TEST_DB_URL,
    ...overrides,
  };
}

function mustNotProcess(): never {
  throw new Error("processor_must_not_run");
}

function createdInventoryTracking(sourceLeadEventId: string) {
  return {
    ok: true as const,
    outcome: "created" as const,
    inventoryItemId: "inv_promote_1",
    sourceLeadEventId,
    sourceLane: "leadcapture_io" as const,
    generatedAt: "2026-08-18T14:37:03.545Z",
    generatedAtSource: "source_intake",
    commerceEligible: false,
    inventoryStatus: "pending_review" as const,
    lifecycleKey: "FRESH_HOLD" as const,
    identityMatch: null,
    diagnostics: {
      queryCount: 1,
      queries: ["leadInventoryItem.findUnique(sourceLeadEventId)"],
      jsonCorpusScan: false,
      unboundedFindMany: false,
    },
  };
}

function unmatchedPersist() {
  return {
    routing: {
      matched: false,
      reason: "unmatched",
      matchType: undefined,
    },
    duplicateRiskJson: null,
    status: "routing_unmatched" as const,
    normalizedWithEnrichment: { routing: { niche_key: "NURSE" } } as never,
  };
}

async function promoteThroughRealProcessor(store: MemoryStore) {
  let processCalls = 0;
  const event = store.event;
  if (!event) throw new Error("memory event required");

  const result = await promoteOneLeadCaptureNextGenSourceEvent(baseArgs(), {
    store,
    processLeadCaptureNextGenLeadCreatedImpl: async (input: LeadCaptureNextGenIntakeInput) => {
      processCalls += 1;
      return processLeadCaptureNextGenLeadCreated({
        ...input,
        deps: {
          findCorrelatedSourceLeadEventsImpl: async () => [{ id: event.id }] as never,
          findSourceLeadEventByIdImpl: async () => event as never,
          createSourceLeadEventImpl: async () => {
            throw new Error("should_not_create_second_event");
          },
          updateSourceLeadEventImpl: async (_id, data) => {
            Object.assign(event, data);
            return event as never;
          },
          persistRoutingAndDuplicateImpl: async (_id, normalized) => {
            event.normalizedPayloadJson = normalized as object;
            event.status = "routing_unmatched";
            return unmatchedPersist();
          },
          trackCampaignInventoryImpl: async () => {
            store.inventoryByEvent += 1;
            store.inventoryByIdentity += 1;
            store.inventoryItem = {
              id: "inv_promote_1",
              nicheKey: "nurse",
              generatedAt: new Date("2026-08-18T14:37:03.545Z"),
              status: "pending_review",
            };
            return createdInventoryTracking(event.id) as never;
          },
          ensureFulfillmentOutboxForSourceLeadImpl: async () => {
            throw new Error("should_not_enqueue_outbox");
          },
        },
      });
    },
  });

  return { result, processCalls };
}

test("valid capture-only NextGen event promotes through real service path", async () => {
  const previousStage = process.env.SA360_LEADCAPTURE_NEXTGEN_INTAKE_STAGE;
  process.env.SA360_LEADCAPTURE_NEXTGEN_INTAKE_STAGE = "capture_only";
  try {
    const store = createMemoryStore(captureOnlyEvent());
    const { result, processCalls } = await promoteThroughRealProcessor(store);
    assert.equal(result.outcome, "PROMOTED");
    assert.equal(result.ok, true);
    assert.equal(processCalls, 1);
    assert.equal(result.before?.normalizedPayloadPresent, false);
    assert.equal(result.before?.associatedInventoryCount, 0);
    assert.equal(result.after?.normalizedPayloadPresent, true);
    assert.equal(result.after?.associatedInventoryCount, 1);
    assert.equal(result.after?.siblingSourceEventCount, 1);
    assert.equal(result.after?.fulfillmentOutboxCount, 0);
    assert.equal(result.after?.allocationCount, 0);
    assert.equal(result.after?.ghlDeliveryAttempted, false);
    assert.equal(result.after?.metaDispatchCount, 0);
    assert.equal(result.processor?.sourceEventId, EVENT_ID);
    assert.equal(result.processor?.intakeStage, NEXTGEN_ONE_EVENT_PROMOTE_STAGE);
    assert.equal(result.processor?.shadowOutboxEnsured, false);
    assert.equal(result.processor?.inventoryTrackingOutcome, "created");
    assert.equal(result.inventory?.inventoryItemId, "inv_promote_1");
    assert.equal(result.inventory?.nicheKey, "nurse");
    assert.equal(result.inventory?.generatedAt, "2026-08-18T14:37:03.545Z");
    assert.equal(result.inventory?.status, "pending_review");
    assert.equal(result.inventory?.lifecycleKey, "FRESH_HOLD");
    assert.equal(result.inventory?.commerceEligible, false);
    assert.equal(store.event?.status, "routing_unmatched");
  } finally {
    if (previousStage === undefined) delete process.env.SA360_LEADCAPTURE_NEXTGEN_INTAKE_STAGE;
    else process.env.SA360_LEADCAPTURE_NEXTGEN_INTAKE_STAGE = previousStage;
  }
});

test("normalizedPayloadJson already exists refuses without processor", async () => {
  const store = createMemoryStore(
    captureOnlyEvent({
      normalizedPayloadJson: { routing: { niche_key: "NURSE" } },
      status: "routing_unmatched",
    })
  );
  const result = await promoteOneLeadCaptureNextGenSourceEvent(baseArgs(), {
    store,
    processLeadCaptureNextGenLeadCreatedImpl: mustNotProcess,
  });
  assert.equal(result.outcome, "REFUSED");
  assert.equal(result.reasonCode, "REFUSED_ALREADY_PROMOTED");
  assert.equal(result.writesAttempted, false);
});

test("inventory already exists refuses without processor", async () => {
  const store = createMemoryStore(captureOnlyEvent(), { inventoryByEvent: 1, inventoryByIdentity: 1 });
  const result = await promoteOneLeadCaptureNextGenSourceEvent(baseArgs(), {
    store,
    processLeadCaptureNextGenLeadCreatedImpl: mustNotProcess,
  });
  assert.equal(result.outcome, "REFUSED");
  assert.equal(result.reasonCode, "inventory_already_exists");
  assert.equal(result.writesAttempted, false);
});

test("wrong source system refuses", async () => {
  const store = createMemoryStore(
    captureOnlyEvent({ sourceSystem: "leadcapture_io" })
  );
  const result = await promoteOneLeadCaptureNextGenSourceEvent(baseArgs(), {
    store,
    processLeadCaptureNextGenLeadCreatedImpl: mustNotProcess,
  });
  assert.equal(result.outcome, "REFUSED");
  assert.equal(result.reasonCode, "source_system_mismatch");
});

test("wrong route refuses", async () => {
  const store = createMemoryStore(captureOnlyEvent());
  const result = await promoteOneLeadCaptureNextGenSourceEvent(
    baseArgs({ expectedRoute: "LCIO_WRONG_ROUTE" }),
    {
      store,
      processLeadCaptureNextGenLeadCreatedImpl: mustNotProcess,
    }
  );
  assert.equal(result.outcome, "REFUSED");
  assert.equal(result.reasonCode, "source_route_mismatch");
});

test("wrong lead ID refuses", async () => {
  const store = createMemoryStore(captureOnlyEvent());
  const result = await promoteOneLeadCaptureNextGenSourceEvent(
    baseArgs({ expectedLeadId: "00000000-0000-4000-8000-000000000000" }),
    {
      store,
      processLeadCaptureNextGenLeadCreatedImpl: mustNotProcess,
    }
  );
  assert.equal(result.outcome, "REFUSED");
  assert.equal(result.reasonCode, "source_lead_id_mismatch");
});

test("missing raw payload refuses", async () => {
  const store = createMemoryStore(captureOnlyEvent({ rawPayloadJson: null }));
  const result = await promoteOneLeadCaptureNextGenSourceEvent(baseArgs(), {
    store,
    processLeadCaptureNextGenLeadCreatedImpl: mustNotProcess,
  });
  assert.equal(result.outcome, "REFUSED");
  assert.equal(result.reasonCode, "raw_payload_missing");
});

test("unsupported stage refuses", async () => {
  const store = createMemoryStore(captureOnlyEvent());
  const result = await promoteOneLeadCaptureNextGenSourceEvent(
    baseArgs({ stage: "shadow_fulfillment" }),
    {
      store,
      processLeadCaptureNextGenLeadCreatedImpl: mustNotProcess,
    }
  );
  assert.equal(result.outcome, "REFUSED");
  assert.equal(result.reasonCode, "unsupported_stage");
  assert.equal(store.lockCalls, 0);
  assert.equal(store.findCalls, 0);
});

test("wrong confirmation phrase refuses", async () => {
  const store = createMemoryStore(captureOnlyEvent());
  const result = await promoteOneLeadCaptureNextGenSourceEvent(
    baseArgs({ confirm: "PROMOTE ALL NEXTGEN SOURCE EVENTS" }),
    {
      store,
      processLeadCaptureNextGenLeadCreatedImpl: mustNotProcess,
    }
  );
  assert.equal(result.outcome, "REFUSED");
  assert.equal(result.reasonCode, "confirmation_mismatch");
  assert.equal(store.lockCalls, 0);
  assert.equal(store.findCalls, 0);
});

test("expected DB host mismatch refuses before mutation", async () => {
  const store = createMemoryStore(captureOnlyEvent());
  const result = await promoteOneLeadCaptureNextGenSourceEvent(
    baseArgs({ expectedDbHost: "wrong.example.com" }),
    {
      store,
      processLeadCaptureNextGenLeadCreatedImpl: mustNotProcess,
    }
  );
  assert.equal(result.outcome, "REFUSED");
  assert.equal(result.reasonCode, "db_host_mismatch");
  assert.equal(result.writesAttempted, false);
  assert.equal(store.lockCalls, 0);
  assert.equal(store.findCalls, 0);
});

test("second run refuses already promoted and does not create duplicate inventory", async () => {
  const previousStage = process.env.SA360_LEADCAPTURE_NEXTGEN_INTAKE_STAGE;
  process.env.SA360_LEADCAPTURE_NEXTGEN_INTAKE_STAGE = "capture_only";
  try {
    const store = createMemoryStore(captureOnlyEvent());
    const first = await promoteThroughRealProcessor(store);
    assert.equal(first.result.outcome, "PROMOTED");
    assert.equal(first.processCalls, 1);
    assert.equal(store.inventoryByEvent, 1);

    const second = await promoteThroughRealProcessor(store);
    assert.equal(second.result.outcome, "REFUSED");
    assert.equal(second.result.reasonCode, "REFUSED_ALREADY_PROMOTED");
    assert.equal(second.result.writesAttempted, false);
    assert.equal(second.processCalls, 0);
    assert.equal(store.inventoryByEvent, 1);
    assert.equal(store.siblingCount, 1);
  } finally {
    if (previousStage === undefined) delete process.env.SA360_LEADCAPTURE_NEXTGEN_INTAKE_STAGE;
    else process.env.SA360_LEADCAPTURE_NEXTGEN_INTAKE_STAGE = previousStage;
  }
});

test("processor failure reports FAILED without fabricating success", async () => {
  const store = createMemoryStore(captureOnlyEvent());
  const result = await promoteOneLeadCaptureNextGenSourceEvent(baseArgs(), {
    store,
    processLeadCaptureNextGenLeadCreatedImpl: async () => {
      throw new Error("processor_boom");
    },
  });
  assert.equal(result.outcome, "FAILED");
  assert.equal(result.ok, false);
  assert.equal(result.reasonCode, "processor_failed");
  assert.equal(result.reason, "processor_boom");
  assert.equal(result.after?.normalizedPayloadPresent, false);
  assert.equal(result.after?.associatedInventoryCount, 0);
  assert.equal(store.event?.normalizedPayloadJson, null);
});

test("global capture_only env remains irrelevant when stageOverride is normalize_route_proof", async () => {
  const previousStage = process.env.SA360_LEADCAPTURE_NEXTGEN_INTAKE_STAGE;
  process.env.SA360_LEADCAPTURE_NEXTGEN_INTAKE_STAGE = "capture_only";
  try {
    const store = createMemoryStore(captureOnlyEvent());
    const { result } = await promoteThroughRealProcessor(store);
    assert.equal(result.outcome, "PROMOTED");
    assert.equal(result.processor?.intakeStage, NEXTGEN_ONE_EVENT_PROMOTE_STAGE);
    assert.notEqual(result.processor?.intakeStage, "capture_only");
    assert.equal(result.after?.normalizedPayloadPresent, true);
    assert.equal(result.after?.associatedInventoryCount, 1);
  } finally {
    if (previousStage === undefined) delete process.env.SA360_LEADCAPTURE_NEXTGEN_INTAKE_STAGE;
    else process.env.SA360_LEADCAPTURE_NEXTGEN_INTAKE_STAGE = previousStage;
  }
});

test("wrong source provider refuses before processor", async () => {
  const store = createMemoryStore(captureOnlyEvent({ sourceProvider: "facebook" }));
  const result = await promoteOneLeadCaptureNextGenSourceEvent(baseArgs(), {
    store,
    processLeadCaptureNextGenLeadCreatedImpl: mustNotProcess,
  });
  assert.equal(result.outcome, "REFUSED");
  assert.equal(result.reasonCode, "source_provider_mismatch");
  assert.equal(result.writesAttempted, false);
});

test("ambiguous source identity refuses before processor", async () => {
  const store = createMemoryStore(captureOnlyEvent(), { siblingCount: 2 });
  const result = await promoteOneLeadCaptureNextGenSourceEvent(baseArgs(), {
    store,
    processLeadCaptureNextGenLeadCreatedImpl: mustNotProcess,
  });
  assert.equal(result.outcome, "REFUSED");
  assert.equal(result.reasonCode, "source_identity_not_unique");
  assert.equal(result.writesAttempted, false);
});

test("non-received status is not treated as capture-only", async () => {
  const store = createMemoryStore(captureOnlyEvent({ status: "routing_unmatched" }));
  const result = await promoteOneLeadCaptureNextGenSourceEvent(baseArgs(), {
    store,
    processLeadCaptureNextGenLeadCreatedImpl: mustNotProcess,
  });
  assert.equal(result.outcome, "REFUSED");
  assert.equal(result.reasonCode, "not_capture_only");
  assert.equal(result.writesAttempted, false);
});

test("missing capture-only enrichment refuses", async () => {
  const store = createMemoryStore(
    captureOnlyEvent({
      enrichmentMetadataJson: { intakeStage: "normalize_route_proof", captureOnly: false },
    })
  );
  const result = await promoteOneLeadCaptureNextGenSourceEvent(baseArgs(), {
    store,
    processLeadCaptureNextGenLeadCreatedImpl: mustNotProcess,
  });
  assert.equal(result.outcome, "REFUSED");
  assert.equal(result.reasonCode, "not_capture_only");
  assert.equal(result.writesAttempted, false);
});

test("pre-existing fulfillment outbox refuses before mutation", async () => {
  const store = createMemoryStore(captureOnlyEvent(), { outboxCount: 1 });
  const result = await promoteOneLeadCaptureNextGenSourceEvent(baseArgs(), {
    store,
    processLeadCaptureNextGenLeadCreatedImpl: mustNotProcess,
  });
  assert.equal(result.outcome, "REFUSED");
  assert.equal(result.reasonCode, "preexisting_side_effects");
  assert.equal(result.writesAttempted, false);
});

test("pre-existing allocation refuses before mutation", async () => {
  const store = createMemoryStore(captureOnlyEvent(), { allocationCount: 1 });
  const result = await promoteOneLeadCaptureNextGenSourceEvent(baseArgs(), {
    store,
    processLeadCaptureNextGenLeadCreatedImpl: mustNotProcess,
  });
  assert.equal(result.outcome, "REFUSED");
  assert.equal(result.reasonCode, "preexisting_side_effects");
  assert.equal(result.writesAttempted, false);
});

test("pre-existing GHL delivery markers refuse before mutation", async () => {
  const store = createMemoryStore(
    captureOnlyEvent({ deliveredAt: new Date("2026-08-24T09:32:46.758Z") })
  );
  const result = await promoteOneLeadCaptureNextGenSourceEvent(baseArgs(), {
    store,
    processLeadCaptureNextGenLeadCreatedImpl: mustNotProcess,
  });
  assert.equal(result.outcome, "REFUSED");
  assert.equal(result.reasonCode, "preexisting_side_effects");
  assert.equal(result.writesAttempted, false);
});

test("pre-existing Meta dispatch refuses before mutation", async () => {
  const store = createMemoryStore(captureOnlyEvent(), { metaCount: 1 });
  const result = await promoteOneLeadCaptureNextGenSourceEvent(baseArgs(), {
    store,
    processLeadCaptureNextGenLeadCreatedImpl: mustNotProcess,
  });
  assert.equal(result.outcome, "REFUSED");
  assert.equal(result.reasonCode, "preexisting_side_effects");
  assert.equal(result.writesAttempted, false);
});

test("normalized payload without inventory is FAILED not PROMOTED", async () => {
  const store = createMemoryStore(captureOnlyEvent());
  const event = store.event!;
  const result = await promoteOneLeadCaptureNextGenSourceEvent(baseArgs(), {
    store,
    processLeadCaptureNextGenLeadCreatedImpl: async () => {
      event.normalizedPayloadJson = { routing: { niche_key: "NURSE" } };
      event.status = "routing_unmatched";
      return {
        ok: true,
        provider: "leadcapture_io",
        sourceSystem: "leadcapture_io_nextgen",
        sourceEventId: event.id,
        status: "routing_unmatched",
        sourceRouteKey: event.sourceRouteKey ?? "",
        sourceLeadId: event.sourceLeadId ?? "",
        normalizedLeadUid: event.sourceLeadUid,
        duplicate: true,
        matched: false,
        intakeStage: "normalize_route_proof",
        shadowOutboxEnsured: false,
        nextAction: "normalized without inventory",
      };
    },
  });
  assert.equal(result.outcome, "FAILED");
  assert.equal(result.ok, false);
  assert.equal(result.reasonCode, "after_verification_failed");
  assert.match(result.reason ?? "", /inventory_not_created|processor_inventory/);
  assert.equal(result.after?.normalizedPayloadPresent, true);
  assert.equal(result.after?.associatedInventoryCount, 0);
  assert.notEqual(result.outcome, "PROMOTED");
});
