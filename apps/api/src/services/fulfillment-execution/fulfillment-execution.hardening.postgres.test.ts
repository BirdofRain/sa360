import test from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";

import { claimDeliveryAttempt, recordAttemptUnknownOutcome } from "./delivery-attempt.service.js";
import {
  commitFulfillmentSuccess,
  safeReleaseReservation,
} from "./fulfillment-outcome.service.js";
import { reserveLeadAllocation } from "./reservation.service.js";
import { EXECUTION_MODE_LIVE, EXECUTION_MODE_SIMULATION } from "./fulfillment-execution.constants.js";

const PG_TEST_URL = process.env.FULFILLMENT_PG_TEST_URL?.trim();

async function seedReservedFixture(db: PrismaClient, suffix: string) {
  const clientAccount = await db.clientAccount.create({
    data: {
      clientAccountId: `pg_client_${suffix}`,
      clientDisplayName: "PG Client",
      status: "active",
    },
  });
  const order = await db.leadOrder.create({
    data: {
      orderNumber: `ORD-PG-${suffix}`,
      clientAccountId: clientAccount.clientAccountId,
      status: "active",
      nicheKey: "solar",
      leadVolume: 5,
      campaignType: "lead_gen",
      crmPackage: "basic",
      createdByRole: "admin",
      orderKind: "pay_per_lead",
      fulfillmentMode: "pooled_matching",
      requestedQuantity: 5,
      activatedAt: new Date(),
    },
  });
  const event = await db.sourceLeadEvent.create({
    data: {
      sourceLeadUid: `uid_${suffix}`,
      sourceProvider: "manual_import",
      sourceSystem: "external_vendor",
      sourceType: "manual_entry",
      rawPayloadJson: { test: true },
      clientAccountIdResolved: clientAccount.clientAccountId,
      status: "approved",
      normalizedPayloadJson: {},
      enrichmentMetadataJson: {},
    },
  });
  await db.leadEligibilityAssessment.create({
    data: {
      sourceLeadEventId: event.id,
      policyKey: "lf2_shadow_eligibility",
      policyVersion: "1.0.0",
      status: "eligible",
    },
  });
  const target = await db.deliveryTarget.create({
    data: {
      clientAccountId: clientAccount.clientAccountId,
      displayName: "Sim Target",
      adapterKey: "test.simulated.v1",
      isRequired: true,
    },
  });
  const allocation = await db.leadAllocation.create({
    data: {
      sourceLeadEventId: event.id,
      leadOrderId: order.id,
      clientAccountId: clientAccount.clientAccountId,
      status: "shadow",
      allocationPolicyVersion: "1.0.0",
      idempotencyKey: `alloc:pg:${suffix}`,
    },
  });
  const instruction = await db.deliveryInstruction.create({
    data: {
      leadAllocationId: allocation.id,
      deliveryTargetId: target.id,
      sequence: 1,
      isRequired: true,
      status: "planned",
    },
  });
  return { clientAccount, order, event, target, allocation, instruction };
}

test("postgres hardening suite", { skip: PG_TEST_URL ? false : "Set FULFILLMENT_PG_TEST_URL for postgres race tests" }, async (t) => {
  const db = new PrismaClient({ datasources: { db: { url: PG_TEST_URL } } });

  await t.test("claim wins race: release fails and reserved capacity remains held", async () => {
    const suffix = `${Date.now()}_claim`;
    const fx = await seedReservedFixture(db, suffix);
    const reserved = await reserveLeadAllocation(fx.allocation.id, db);
    assert.equal(reserved.ok, true);

    const claim = await claimDeliveryAttempt(
      fx.instruction.id,
      { executionMode: EXECUTION_MODE_SIMULATION },
      db
    );
    assert.equal(claim.ok, true);

    const release = await safeReleaseReservation(fx.allocation.id, { reasonCode: "race_test" }, db);
    assert.equal(release.ok, false);
    if (!release.ok) assert.equal(release.code, "active_attempt_blocks_release");

    const refreshedOrder = await db.leadOrder.findUnique({ where: { id: fx.order.id } });
    assert.equal(refreshedOrder?.reservedQuantity, 1);

    const refreshedAlloc = await db.leadAllocation.findUnique({ where: { id: fx.allocation.id } });
    assert.equal(refreshedAlloc?.status, "delivering");

    const attempts = await db.deliveryAttempt.count({
      where: { deliveryInstructionId: fx.instruction.id, status: { in: ["claimed", "in_progress"] } },
    });
    assert.equal(attempts, 1);
  });

  await t.test("release wins race: claim creates no attempt and reservedQuantity decrements once", async () => {
    const suffix = `${Date.now()}_rel`;
    const fx = await seedReservedFixture(db, suffix);
    const reserved = await reserveLeadAllocation(fx.allocation.id, db);
    assert.equal(reserved.ok, true);

    const release = await safeReleaseReservation(fx.allocation.id, { reasonCode: "race_test" }, db);
    assert.equal(release.ok, true);

    const claim = await claimDeliveryAttempt(
      fx.instruction.id,
      { executionMode: EXECUTION_MODE_SIMULATION },
      db
    );
    assert.equal(claim.ok, false);

    const attempts = await db.deliveryAttempt.count({
      where: { deliveryInstructionId: fx.instruction.id },
    });
    assert.equal(attempts, 0);

    const refreshedOrder = await db.leadOrder.findUnique({ where: { id: fx.order.id } });
    assert.equal(refreshedOrder?.reservedQuantity, 0);
    const refreshedAlloc = await db.leadAllocation.findUnique({ where: { id: fx.allocation.id } });
    assert.equal(refreshedAlloc?.status, "released");
  });

  await t.test("unknown outcome blocks second claim and holds reservation", async () => {
    const suffix = `${Date.now()}_unk`;
    const fx = await seedReservedFixture(db, suffix);
    await reserveLeadAllocation(fx.allocation.id, db);

    const attempt = await db.deliveryAttempt.create({
      data: {
        deliveryInstructionId: fx.instruction.id,
        adapterKey: "test.simulated.v1",
        attemptNumber: 1,
        idempotencyKey: `attempt:live:unk:${suffix}`,
        executionMode: EXECUTION_MODE_LIVE,
        status: "in_progress",
      },
    });
    await db.leadAllocation.update({ where: { id: fx.allocation.id }, data: { status: "delivering" } });
    await db.deliveryInstruction.update({
      where: { id: fx.instruction.id },
      data: { status: "executing" },
    });

    const unknown = await recordAttemptUnknownOutcome(
      attempt.id,
      { errorSummary: "provider timeout" },
      db
    );
    assert.equal(unknown.ok, true);

    const claim = await claimDeliveryAttempt(
      fx.instruction.id,
      { executionMode: EXECUTION_MODE_LIVE },
      db
    );
    assert.equal(claim.ok, false);

    const refreshedInstruction = await db.deliveryInstruction.findUnique({
      where: { id: fx.instruction.id },
    });
    assert.equal(refreshedInstruction?.status, "review_required");

    const refreshedOrder = await db.leadOrder.findUnique({ where: { id: fx.order.id } });
    assert.equal(refreshedOrder?.reservedQuantity, 1);
    assert.equal(refreshedOrder?.fulfilledQuantity, 0);
  });

  await t.test("concurrent dual required instruction commit transitions counters once", async () => {
    const suffix = `${Date.now()}_dual`;
    const fx = await seedReservedFixture(db, suffix);
    const target2 = await db.deliveryTarget.create({
      data: {
        clientAccountId: fx.clientAccount.clientAccountId,
        displayName: "Sim Target 2",
        adapterKey: "test.simulated.v1",
        isRequired: true,
      },
    });
    await reserveLeadAllocation(fx.allocation.id, db);

    const instr2 = await db.deliveryInstruction.create({
      data: {
        leadAllocationId: fx.allocation.id,
        deliveryTargetId: target2.id,
        sequence: 2,
        isRequired: true,
        status: "executing",
      },
    });

    await db.deliveryInstruction.update({
      where: { id: fx.instruction.id },
      data: { status: "executing" },
    });
    await db.leadAllocation.update({ where: { id: fx.allocation.id }, data: { status: "delivering" } });

    const attempt1 = await db.deliveryAttempt.create({
      data: {
        deliveryInstructionId: fx.instruction.id,
        adapterKey: "test.simulated.v1",
        attemptNumber: 1,
        idempotencyKey: `attempt:dual:1:${suffix}`,
        executionMode: EXECUTION_MODE_LIVE,
        status: "in_progress",
      },
    });
    const attempt2 = await db.deliveryAttempt.create({
      data: {
        deliveryInstructionId: instr2.id,
        adapterKey: "test.simulated.v1",
        attemptNumber: 1,
        idempotencyKey: `attempt:dual:2:${suffix}`,
        executionMode: EXECUTION_MODE_LIVE,
        status: "in_progress",
      },
    });

    const [r1, r2] = await Promise.all([
      commitFulfillmentSuccess(fx.instruction.id, { attemptId: attempt1.id, externalReference: "live:1" }, db),
      commitFulfillmentSuccess(instr2.id, { attemptId: attempt2.id, externalReference: "live:2" }, db),
    ]);
    assert.equal(r1.ok, true);
    assert.equal(r2.ok, true);

    const replay = await commitFulfillmentSuccess(
      fx.instruction.id,
      { attemptId: attempt1.id, externalReference: "live:1" },
      db
    );
    assert.equal(replay.ok, true);
    if (replay.ok) assert.equal(replay.status, "already_committed");

    const refreshedOrder = await db.leadOrder.findUnique({ where: { id: fx.order.id } });
    assert.equal(refreshedOrder?.reservedQuantity, 0);
    assert.equal(refreshedOrder?.fulfilledQuantity, 1);

    const refreshedAlloc = await db.leadAllocation.findUnique({ where: { id: fx.allocation.id } });
    assert.equal(refreshedAlloc?.status, "committed");
  });

  await db.$disconnect();
});
