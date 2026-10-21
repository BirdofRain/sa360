/**
 * Local sa360_test proof that fulfillment reconcile skips a synthetic pilot lead
 * and that the same classification blocks the shadow processor.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { Prisma, PrismaClient } from "@prisma/client";

import { assertSafeTestDatabaseUrl } from "../../lib/safe-test-database-url.js";
import { FULFILLMENT_SHADOW_WORK_TYPE } from "./fulfillment-keys.js";
import {
  ensureFulfillmentOutboxForSourceLead,
  processShadowFulfillmentOutboxItem,
  reconcileMissingFulfillmentOutbox,
} from "./shadow-processor.service.js";
import { listSourceLeadEventsMissingOutbox } from "../../repositories/fulfillment-outbox.repository.js";
import { createShadowLeadAllocationIdempotent } from "../../repositories/lead-allocation.repository.js";
import {
  CompanySheetsPilotIsolatedError,
  companySheetsInternalPilotLeadExclusion,
} from "../company-sheets-dispatch/company-sheets-pilot-isolation.js";
import { trackCampaignInventoryFromSourceEvent } from "../lead-inventory/campaign-inventory-tracking.service.js";
import { listLiveLeadPool } from "../live-lead-pool/live-lead-pool.service.js";
import { approveSourceLeadDelivery } from "../source-intake/source-lead-delivery.service.js";
import { SOURCE_LEAD_APPROVE_DELIVERY_CONFIRMATION } from "../source-intake/source-intake.types.js";
import { generateLeadDeliveryPlanForDecision } from "../lead-delivery-plan.service.js";

const integrationUrlRaw = process.env.SA360_TEST_DATABASE_URL?.trim() || "";
const runIntegration = Boolean(integrationUrlRaw);

describe("company sheets pilot fulfillment isolation (local sa360_test)", { skip: !runIntegration }, () => {
  let db: PrismaClient;
  const stamp = `${Date.now()}`;
  const ids: string[] = [];
  let decisionId: string | null = null;

  before(async () => {
    assertSafeTestDatabaseUrl(integrationUrlRaw);
    db = new PrismaClient({ datasources: { db: { url: integrationUrlRaw } } });
    await db.$connect();
  });

  after(async () => {
    if (!db) return;
    if (decisionId) {
      await db.leadDeliveryPlan.deleteMany({ where: { routingDryRunDecisionId: decisionId } });
      await db.routingDryRunDecision.deleteMany({ where: { id: decisionId } });
    }
    if (ids.length > 0) {
      await db.leadInventoryItem.deleteMany({ where: { sourceLeadEventId: { in: ids } } });
      await db.sourceLeadEvent.deleteMany({ where: { id: { in: ids } } });
    }
    await db.$disconnect();
  });

  async function makeLead(input: {
    sourceLeadId: string;
    sourceRouteKey?: string | null;
    enrichmentMetadataJson?: Prisma.InputJsonValue | typeof Prisma.DbNull;
    receivedAt?: Date;
  }) {
    const lead = await db.sourceLeadEvent.create({
      data: {
        sourceProvider: "manual_import",
        sourceSystem: "external_vendor",
        sourceType: "manual_entry",
        sourceRouteKey: input.sourceRouteKey ?? null,
        sourceLeadId: input.sourceLeadId,
        status: "routing_matched",
        rawPayloadJson: { synthetic: true, sourceLeadId: input.sourceLeadId },
        enrichmentMetadataJson: input.enrichmentMetadataJson ?? Prisma.DbNull,
        receivedAt: input.receivedAt ?? new Date("2999-06-01T00:00:00.000Z"),
      },
    });
    ids.push(lead.id);
    return lead;
  }

  it("reconcile selects ordinary routing_matched leads and skips every pilot marker", async () => {
    const plain = await makeLead({ sourceLeadId: `plain-${stamp}`, receivedAt: new Date("2999-06-01T00:00:01.000Z") });
    const enriched = await makeLead({
      sourceLeadId: `enriched-${stamp}`,
      enrichmentMetadataJson: { nicheKey: "final_expense" },
      receivedAt: new Date("2999-06-01T00:00:02.000Z"),
    });
    const otherClass = await makeLead({
      sourceLeadId: `other-class-${stamp}`,
      enrichmentMetadataJson: { recordClass: "campaign_lead", intake: "leadcapture_io" },
      receivedAt: new Date("2999-06-01T00:00:02.500Z"),
    });
    const routeOnly = await makeLead({
      sourceLeadId: `route-${stamp}`,
      sourceRouteKey: "company_sheets_internal_pilot",
      receivedAt: new Date("2999-06-01T00:00:03.000Z"),
    });
    const classOnly = await makeLead({
      sourceLeadId: `class-${stamp}`,
      enrichmentMetadataJson: { recordClass: "company_sheets_internal_pilot" },
      receivedAt: new Date("2999-06-01T00:00:04.000Z"),
    });
    const intakeOnly = await makeLead({
      sourceLeadId: `intake-${stamp}`,
      enrichmentMetadataJson: { intake: "company_sheets_internal_pilot" },
      receivedAt: new Date("2999-06-01T00:00:05.000Z"),
    });
    const owned = [plain.id, enriched.id, otherClass.id, routeOnly.id, classOnly.id, intakeOnly.id];
    const ordinary = [plain.id, enriched.id, otherClass.id];

    const predicateRows = await db.sourceLeadEvent.findMany({
      where: {
        AND: [
          { id: { in: owned } },
          { status: { in: ["normalized", "routing_matched", "approved"] } },
          { fulfillmentOutboxItems: { none: { workType: FULFILLMENT_SHADOW_WORK_TYPE } } },
          companySheetsInternalPilotLeadExclusion(),
        ],
      },
      select: { id: true },
    });
    assert.deepEqual(predicateRows.map((row) => row.id).sort(), ordinary.sort());

    const selected: string[][] = [];
    const scoped = {
      sourceLeadEvent: {
        findMany: async (args: {
          where: Prisma.SourceLeadEventWhereInput;
          orderBy?: Prisma.SourceLeadEventOrderByWithRelationInput;
          take?: number;
          select?: Prisma.SourceLeadEventSelect;
        }) => {
          const rows = await db.sourceLeadEvent.findMany({
            ...args,
            where: { AND: [args.where, { id: { in: owned } }] },
          });
          selected.push(rows.map((row) => row.id));
          return rows;
        },
        findUnique: (args: Prisma.SourceLeadEventFindUniqueArgs) => db.sourceLeadEvent.findUnique(args),
      },
      fulfillmentOutbox: db.fulfillmentOutbox,
    } as unknown as PrismaClient;

    const listed = await listSourceLeadEventsMissingOutbox(
      { limit: 50, workType: FULFILLMENT_SHADOW_WORK_TYPE },
      scoped
    );
    assert.deepEqual(listed.map((row) => row.id).sort(), ordinary.sort());

    const first = await reconcileMissingFulfillmentOutbox({ limit: 50 }, scoped);
    assert.deepEqual(first.sourceLeadEventIds.sort(), ordinary.sort());
    assert.deepEqual(selected.at(-1)?.sort(), ordinary.sort());
    assert.equal(await db.fulfillmentOutbox.count({ where: { sourceLeadEventId: { in: [routeOnly.id, classOnly.id, intakeOnly.id] } } }), 0);
    assert.equal(await db.fulfillmentOutbox.count({ where: { sourceLeadEventId: plain.id } }), 1);

    const second = await reconcileMissingFulfillmentOutbox({ limit: 50 }, scoped);
    assert.deepEqual(second.sourceLeadEventIds, []);
    assert.equal(await db.fulfillmentOutbox.count({ where: { sourceLeadEventId: plain.id } }), 1);

    await assert.rejects(
      () => ensureFulfillmentOutboxForSourceLead(routeOnly.id, db),
      (err: unknown) => err instanceof CompanySheetsPilotIsolatedError
    );
    await assert.rejects(
      () => ensureFulfillmentOutboxForSourceLead(classOnly.id, db),
      (err: unknown) => err instanceof CompanySheetsPilotIsolatedError
    );

    const forced = await db.fulfillmentOutbox.create({
      data: {
        idempotencyKey: `fulfillment:shadow:${routeOnly.id}`,
        sourceLeadEventId: routeOnly.id,
        workType: FULFILLMENT_SHADOW_WORK_TYPE,
        status: "pending",
      },
    });
    const processed = await processShadowFulfillmentOutboxItem(forced.id, db);
    assert.equal(processed.ok, true);
    if (processed.ok) {
      assert.equal(processed.status, "stopped");
      if (processed.status === "stopped") assert.equal(processed.stopReason, "company_sheets_internal_pilot");
    }
    assert.equal(await db.leadEligibilityAssessment.count({ where: { sourceLeadEventId: routeOnly.id } }), 0);
    assert.equal(await db.leadAllocation.count({ where: { sourceLeadEventId: routeOnly.id } }), 0);
    const stopped = await db.fulfillmentOutbox.findUniqueOrThrow({ where: { id: forced.id } });
    assert.equal(stopped.status, "terminal_failure");

    await assert.rejects(
      () =>
        createShadowLeadAllocationIdempotent(
          {
            sourceLeadEventId: classOnly.id,
            leadOrderId: "order-not-created",
            clientAccountId: "client-not-created",
            allocationPolicyVersion: "1.0.0",
            decisionReasonsJson: [],
            candidateCount: 0,
            idempotencyKey: `allocation:shadow:${classOnly.id}:isolation`,
          },
          db
        ),
      (err: unknown) => err instanceof CompanySheetsPilotIsolatedError
    );
    assert.equal(await db.leadAllocation.count({ where: { sourceLeadEventId: classOnly.id } }), 0);

    const inventory = await trackCampaignInventoryFromSourceEvent(
      { sourceLeadEventId: intakeOnly.id, sourceLane: "leadcapture_io" },
      db
    );
    assert.equal(inventory.ok, true);
    if (inventory.ok) {
      assert.equal(inventory.outcome, "skipped_not_resale_supply");
      assert.equal(inventory.inventoryItemId, null);
    }
    assert.equal(await db.leadInventoryItem.count({ where: { sourceLeadEventId: intakeOnly.id } }), 0);

    const approved = await approveSourceLeadDelivery({
      sourceLeadEventId: routeOnly.id,
      mode: "simulate",
      operatorConfirmationText: SOURCE_LEAD_APPROVE_DELIVERY_CONFIRMATION,
    });
    assert.equal(approved.ok, false);
    if (!approved.ok) assert.equal(approved.error, "company_sheets_internal_pilot");
    const stillMatched = await db.sourceLeadEvent.findUniqueOrThrow({ where: { id: routeOnly.id } });
    assert.equal(stillMatched.status, "routing_matched");

    const decision = await db.routingDryRunDecision.create({
      data: {
        masterClientAccountId: `pilot-isolation-${stamp}`,
        sourceLeadUid: `sheets-pilot:${stamp}`,
        matched: true,
        confidence: "operator_selected",
        matchReason: "Operator-confirmed synthetic company Sheets pilot for the internal test client",
        deliveryMode: "dry_run",
        routingEventNameInternal: "operator_selected_destination",
        attributionSnapshot: {
          matchType: "internal_sheets_pilot",
          routingAuthority: "operator_selected_destination",
          syntheticPilot: true,
          sourceRouteKey: "company_sheets_internal_pilot",
        },
      },
    });
    decisionId = decision.id;
    await db.sourceLeadEvent.update({
      where: { id: routeOnly.id },
      data: { routingDryRunDecisionId: decision.id },
    });
    const plan = await generateLeadDeliveryPlanForDecision(decision.id);
    assert.equal("blocked" in plan, true);
    assert.equal(await db.leadDeliveryPlan.count({ where: { routingDryRunDecisionId: decision.id } }), 0);

    const pool = await listLiveLeadPool({ limit: 20 }, db);
    const poolIds = new Set(pool.items.map((item) => item.sourceEventId));
    assert.equal(poolIds.has(plain.id), true);
    assert.equal(poolIds.has(enriched.id), true);
    assert.equal(poolIds.has(otherClass.id), true);
    assert.equal(poolIds.has(routeOnly.id), false);
    assert.equal(poolIds.has(classOnly.id), false);
    assert.equal(poolIds.has(intakeOnly.id), false);
  });
});
