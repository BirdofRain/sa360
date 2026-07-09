import test from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import {
  FULFILLMENT_ELIGIBILITY_POLICY_KEY,
  FULFILLMENT_ELIGIBILITY_POLICY_VERSION,
} from "@sa360/shared";

import {
  LF2_EXECUTION_ENABLED_ENV,
  LF2_GHL_ALLOWED_CLIENT_IDS_ENV,
  LF2_GHL_ALLOWED_LOCATION_IDS_ENV,
  LF2_GHL_ALLOWED_ORDER_IDS_ENV,
  LF2_GHL_ALLOWED_SOURCE_LANES_ENV,
  LF2_GHL_CANARY_ENABLED_ENV,
} from "../../lib/lf2-ghl-canary-config.js";
import { LIVE_CANARY_CONFIRMATION_TEXT } from "../../lib/ghl-delivery-adapter-mode.js";
import {
  enableLiveCanaryRuntimeForTests,
  resetDeliveryRuntimeTestState,
} from "../../test/delivery-runtime-mode-test-helpers.js";
import type { GhlLiveHttpDeps } from "../ghl-delivery-adapter/ghl-live-transport.js";
import { evaluateLf2GhlCanaryGates } from "./lf2-ghl-canary-gate-evaluation.service.js";
import { executeLf2GhlCanaryForInstruction } from "./fulfillment-ghl-canary.service.js";
import { reserveLeadAllocation } from "./reservation.service.js";
import { EXECUTION_MODE_LIVE } from "./fulfillment-execution.constants.js";

const PG_TEST_URL = process.env.FULFILLMENT_PG_TEST_URL?.trim();

test.afterEach(() => {
  resetDeliveryRuntimeTestState();
  delete process.env[LF2_EXECUTION_ENABLED_ENV];
  delete process.env[LF2_GHL_CANARY_ENABLED_ENV];
  delete process.env[LF2_GHL_ALLOWED_CLIENT_IDS_ENV];
  delete process.env[LF2_GHL_ALLOWED_LOCATION_IDS_ENV];
  delete process.env[LF2_GHL_ALLOWED_ORDER_IDS_ENV];
  delete process.env[LF2_GHL_ALLOWED_SOURCE_LANES_ENV];
  delete process.env.GHL_DELIVERY_ADAPTER_MAX_MODE;
  delete process.env.GHL_PRIVATE_INTEGRATION_TOKEN;
});

function armLf2CanaryEnv(input: {
  clientId: string;
  locationId: string;
  orderId: string;
  sourceLane: string;
}) {
  process.env[LF2_EXECUTION_ENABLED_ENV] = "true";
  process.env[LF2_GHL_CANARY_ENABLED_ENV] = "true";
  process.env[LF2_GHL_ALLOWED_CLIENT_IDS_ENV] = input.clientId;
  process.env[LF2_GHL_ALLOWED_LOCATION_IDS_ENV] = input.locationId;
  process.env[LF2_GHL_ALLOWED_ORDER_IDS_ENV] = input.orderId;
  process.env[LF2_GHL_ALLOWED_SOURCE_LANES_ENV] = input.sourceLane;
  process.env.GHL_DELIVERY_ADAPTER_MAX_MODE = "live_canary";
  process.env.GHL_PRIVATE_INTEGRATION_TOKEN = "test-token";
  enableLiveCanaryRuntimeForTests();
}

async function seedLf2GhlCanaryFixture(db: PrismaClient, suffix: string) {
  const clientAccount = await db.clientAccount.create({
    data: {
      clientAccountId: `lf2_client_${suffix}`,
      clientDisplayName: "LF2 Client",
      status: "active",
    },
  });
  await db.clientGhlDestination.create({
    data: {
      clientAccountId: clientAccount.clientAccountId,
      destinationSubaccountIdGhl: `loc_auth_${suffix}`,
      ghlConnectionStatus: "connected",
      snapshotInstalled: true,
      requiredFieldsInstalled: true,
      deliveryMode: "live",
      deliveryEnabled: true,
      clientCutoverApproved: true,
      internalApprovalStatus: "approved",
      destinationWorkflowIdGhl: "wf_1",
      destinationPipelineIdGhl: "pipe_1",
      destinationPipelineStageIdGhl: "stage_1",
      defaultAssignedUserIdGhl: "user_1",
      opportunityCreationEnabled: true,
    },
  });
  const order = await db.leadOrder.create({
    data: {
      orderNumber: `LF2-ORD-${suffix}`,
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
      allowedSourceLanesJson: ["meta_paid_social"],
    },
  });
  const event = await db.sourceLeadEvent.create({
    data: {
      sourceLeadUid: `uid_${suffix}`,
      sourceProvider: "facebook",
      sourceSystem: "meta_lead_ads",
      sourceType: "manual_entry",
      rawPayloadJson: { test: true },
      clientAccountIdResolved: clientAccount.clientAccountId,
      status: "approved",
      normalizedPayloadJson: {
        phone_e164: "+15551234567",
        email: "test@example.com",
        state: "TX",
        contact: {
          firstName: "Test",
          lastName: "Lead",
          email: "test@example.com",
          phone_e164: "+15551234567",
        },
      },
      enrichmentMetadataJson: { sourceLane: "meta_paid_social" },
    },
  });
  await db.leadEligibilityAssessment.create({
    data: {
      sourceLeadEventId: event.id,
      policyKey: FULFILLMENT_ELIGIBILITY_POLICY_KEY,
      policyVersion: FULFILLMENT_ELIGIBILITY_POLICY_VERSION,
      status: "eligible",
    },
  });
  await db.leadProof.create({
    data: {
      leadUid: `uid_${suffix}`,
      sourceLane: "meta_paid_social",
      phoneE164: "+15551234567",
      email: "test@example.com",
      proofStatus: "PROOF_ATTACHED",
      consentText: "I agree",
    },
  });
  const target = await db.deliveryTarget.create({
    data: {
      clientAccountId: clientAccount.clientAccountId,
      displayName: "GHL Target",
      adapterKey: "ghl.crm.v1",
      enabled: true,
      isRequired: true,
      readinessStatus: "ready_for_live_canary",
      configMetadataJson: { destinationSubaccountIdGhl: `loc_auth_${suffix}` },
    },
  });
  const allocation = await db.leadAllocation.create({
    data: {
      sourceLeadEventId: event.id,
      leadOrderId: order.id,
      clientAccountId: clientAccount.clientAccountId,
      status: "shadow",
      allocationPolicyVersion: "1.0.0",
      idempotencyKey: `alloc:lf2:${suffix}`,
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
  return {
    clientAccount,
    order,
    event,
    target,
    allocation,
    instruction,
    authoritativeLocationId: `loc_auth_${suffix}`,
    canonicalSourceLane: "meta_paid_social",
  };
}

function makeExecuteBody() {
  return {
    confirmLiveDeliveryRisk: true,
    operatorConfirmationText: LIVE_CANARY_CONFIRMATION_TEXT,
    executedBy: "test",
  };
}

function mockSuccessfulGhlDeps(input: {
  expectedLocationId: string;
  onExecutionStart?: () => void;
}): {
  deps: GhlLiveHttpDeps;
  executionCount: () => number;
  httpCallCount: () => number;
  urls: () => string[];
} {
  let executions = 0;
  let httpCalls = 0;
  let executionOpen = false;
  const urls: string[] = [];
  const deps: GhlLiveHttpDeps = {
    fetch: async (url, init) => {
      if (!executionOpen) {
        executionOpen = true;
        executions += 1;
        input.onExecutionStart?.();
      }
      httpCalls += 1;
      urls.push(String(url));
      const method = init?.method ?? "GET";
      const urlStr = String(url);
      if (urlStr.includes("/contacts/upsert") && method === "POST") {
        return new Response(JSON.stringify({ contact: { id: "ghl_contact_test" } }), {
          status: 200,
        });
      }
      if (urlStr.includes("/opportunities") && method === "POST") {
        return new Response(JSON.stringify({ opportunity: { id: "ghl_opp_test" } }), {
          status: 200,
        });
      }
      if (urlStr.includes("/contacts/") && method === "PUT") {
        return new Response(JSON.stringify({ contact: { id: "ghl_contact_test" } }), {
          status: 200,
        });
      }
      return new Response(JSON.stringify({ ok: true, tags: [], workflow: { started: true } }), {
        status: 200,
      });
    },
  };
  return { deps, executionCount: () => executions, httpCallCount: () => httpCalls, urls: () => urls };
}

test("LF2 GHL canary hardening suite", { skip: PG_TEST_URL ? false : "Set FULFILLMENT_PG_TEST_URL" }, async (t) => {
  const db = new PrismaClient({ datasources: { db: { url: PG_TEST_URL } } });

  await t.test("LF2 flags default off deny execution", async () => {
    const suffix = `${Date.now()}_flags_off`;
    const fx = await seedLf2GhlCanaryFixture(db, suffix);
    const gates = await evaluateLf2GhlCanaryGates(fx.instruction.id, db);
    assert.equal("notFound" in gates, false);
    if ("notFound" in gates) return;
    assert.equal(gates.canExecute, false);
    assert.ok(gates.blockers.some((entry) => entry.includes(LF2_EXECUTION_ENABLED_ENV)));

    await reserveLeadAllocation(fx.allocation.id, db);
    const blocked = await executeLf2GhlCanaryForInstruction(
      fx.instruction.id,
      makeExecuteBody(),
      undefined,
      db
    );
    assert.equal("blocked" in blocked, true);
    const attemptCount = await db.deliveryAttempt.count({
      where: { deliveryInstructionId: fx.instruction.id, executionMode: EXECUTION_MODE_LIVE },
    });
    assert.equal(attemptCount, 0);
  });

  await t.test("empty allowlists deny execution", async () => {
    const suffix = `${Date.now()}_empty_allow`;
    const fx = await seedLf2GhlCanaryFixture(db, suffix);
    process.env[LF2_EXECUTION_ENABLED_ENV] = "true";
    process.env[LF2_GHL_CANARY_ENABLED_ENV] = "true";
    const gates = await evaluateLf2GhlCanaryGates(fx.instruction.id, db);
    if ("notFound" in gates) throw new Error("not found");
    assert.equal(gates.canExecute, false);
    assert.equal(gates.allowlists.client.allowed, false);
  });

  await t.test("wrong client location order lane deny", async () => {
    const suffix = `${Date.now()}_wrong_allow`;
    const fx = await seedLf2GhlCanaryFixture(db, suffix);
    armLf2CanaryEnv({
      clientId: "wrong_client",
      locationId: fx.authoritativeLocationId,
      orderId: fx.order.id,
      sourceLane: fx.canonicalSourceLane,
    });
    const gates = await evaluateLf2GhlCanaryGates(fx.instruction.id, db);
    if ("notFound" in gates) throw new Error("not found");
    assert.equal(gates.canExecute, false);
    assert.ok(gates.blockers.some((entry) => entry.includes("client allowlist")));

    await reserveLeadAllocation(fx.allocation.id, db);
    const blocked = await executeLf2GhlCanaryForInstruction(
      fx.instruction.id,
      makeExecuteBody(),
      undefined,
      db
    );
    assert.equal("blocked" in blocked, true);
    const attemptCount = await db.deliveryAttempt.count({
      where: { deliveryInstructionId: fx.instruction.id, executionMode: EXECUTION_MODE_LIVE },
    });
    assert.equal(attemptCount, 0);
  });

  await t.test("destination mismatch denies execution", async () => {
    const suffix = `${Date.now()}_dest_mismatch`;
    const fx = await seedLf2GhlCanaryFixture(db, suffix);
    await db.deliveryTarget.update({
      where: { id: fx.target.id },
      data: {
        configMetadataJson: { destinationSubaccountIdGhl: "loc_mismatch_only" },
      },
    });
    armLf2CanaryEnv({
      clientId: fx.clientAccount.clientAccountId,
      locationId: fx.authoritativeLocationId,
      orderId: fx.order.id,
      sourceLane: fx.canonicalSourceLane,
    });
    const gates = await evaluateLf2GhlCanaryGates(fx.instruction.id, db);
    if ("notFound" in gates) throw new Error("not found");
    assert.equal(gates.destinationMismatch, true);
    assert.ok(gates.blockers.includes("delivery_target_destination_mismatch"));
  });

  await t.test("target disabled and not ready deny", async () => {
    const suffix = `${Date.now()}_target`;
    const fx = await seedLf2GhlCanaryFixture(db, suffix);
    armLf2CanaryEnv({
      clientId: fx.clientAccount.clientAccountId,
      locationId: fx.authoritativeLocationId,
      orderId: fx.order.id,
      sourceLane: fx.canonicalSourceLane,
    });
    await db.deliveryTarget.update({
      where: { id: fx.target.id },
      data: { enabled: false, readinessStatus: "blocked" },
    });
    const gates = await evaluateLf2GhlCanaryGates(fx.instruction.id, db);
    if ("notFound" in gates) throw new Error("not found");
    assert.equal(gates.canExecute, false);
    assert.ok(gates.blockers.some((entry) => entry.includes("disabled")));
  });

  await t.test("inactive order and ineligible assessment deny", async () => {
    const suffix = `${Date.now()}_inactive`;
    const fx = await seedLf2GhlCanaryFixture(db, suffix);
    armLf2CanaryEnv({
      clientId: fx.clientAccount.clientAccountId,
      locationId: fx.authoritativeLocationId,
      orderId: fx.order.id,
      sourceLane: fx.canonicalSourceLane,
    });
    await db.leadOrder.update({ where: { id: fx.order.id }, data: { status: "paused" } });
    await db.leadEligibilityAssessment.updateMany({
      where: { sourceLeadEventId: fx.event.id },
      data: { status: "ineligible" },
    });
    const gates = await evaluateLf2GhlCanaryGates(fx.instruction.id, db);
    if ("notFound" in gates) throw new Error("not found");
    assert.equal(gates.canExecute, false);
  });

  await t.test("missing phone and email together is a blocker", async () => {
    const suffix = `${Date.now()}_no_contact`;
    const fx = await seedLf2GhlCanaryFixture(db, suffix);
    armLf2CanaryEnv({
      clientId: fx.clientAccount.clientAccountId,
      locationId: fx.authoritativeLocationId,
      orderId: fx.order.id,
      sourceLane: fx.canonicalSourceLane,
    });
    await db.sourceLeadEvent.update({
      where: { id: fx.event.id },
      data: { normalizedPayloadJson: { contact: { firstName: "No", lastName: "Contact" } } },
    });
    const gates = await evaluateLf2GhlCanaryGates(fx.instruction.id, db);
    if ("notFound" in gates) throw new Error("not found");
    assert.ok(gates.blockers.some((entry) => entry.includes("phone and email")));
  });

  await t.test("preflight reports canonical source lane and authoritative location", async () => {
    const suffix = `${Date.now()}_preflight`;
    const fx = await seedLf2GhlCanaryFixture(db, suffix);
    armLf2CanaryEnv({
      clientId: fx.clientAccount.clientAccountId,
      locationId: fx.authoritativeLocationId,
      orderId: fx.order.id,
      sourceLane: fx.canonicalSourceLane,
    });
    await reserveLeadAllocation(fx.allocation.id, db);
    const gates = await evaluateLf2GhlCanaryGates(fx.instruction.id, db);
    if ("notFound" in gates) throw new Error("not found");
    assert.equal(gates.canonicalSourceLane, "meta_paid_social");
    assert.equal(gates.authoritativeLocationId, fx.authoritativeLocationId);
    assert.equal(gates.executionPosture, "first_execution");
  });

  await t.test("concurrent canary requests produce one external call", async () => {
    const suffix = `${Date.now()}_conc`;
    const fx = await seedLf2GhlCanaryFixture(db, suffix);
    armLf2CanaryEnv({
      clientId: fx.clientAccount.clientAccountId,
      locationId: fx.authoritativeLocationId,
      orderId: fx.order.id,
      sourceLane: fx.canonicalSourceLane,
    });
    await reserveLeadAllocation(fx.allocation.id, db);
    const mock = mockSuccessfulGhlDeps({ expectedLocationId: fx.authoritativeLocationId });
    const body = makeExecuteBody();

    const [first, second] = await Promise.all([
      executeLf2GhlCanaryForInstruction(fx.instruction.id, body, mock.deps, db),
      executeLf2GhlCanaryForInstruction(fx.instruction.id, body, mock.deps, db),
    ]);

    const externalExecutions = mock.executionCount();
    assert.equal(externalExecutions, 1, `expected one execution session, got ${externalExecutions}`);

    const attemptCount = await db.deliveryAttempt.count({
      where: { deliveryInstructionId: fx.instruction.id, executionMode: EXECUTION_MODE_LIVE },
    });
    assert.equal(attemptCount, 1);

    const oneAlreadyActive = "alreadyActive" in first || "alreadyActive" in second;
    const oneOk = "ok" in first && first.ok === true || "ok" in second && second.ok === true;
    assert.ok(oneAlreadyActive || oneOk);

    const order = await db.leadOrder.findUnique({ where: { id: fx.order.id } });
    assert.ok((order?.fulfilledQuantity ?? 0) <= 1);
  });

  await t.test("succeeded and unknown outcome replays make zero external calls", async () => {
    const suffix = `${Date.now()}_replay`;
    const fx = await seedLf2GhlCanaryFixture(db, suffix);
    armLf2CanaryEnv({
      clientId: fx.clientAccount.clientAccountId,
      locationId: fx.authoritativeLocationId,
      orderId: fx.order.id,
      sourceLane: fx.canonicalSourceLane,
    });
    await reserveLeadAllocation(fx.allocation.id, db);

    await db.deliveryAttempt.create({
      data: {
        deliveryInstructionId: fx.instruction.id,
        adapterKey: "ghl.crm.v1",
        attemptNumber: 1,
        idempotencyKey: `attempt:live:succeeded:${suffix}`,
        executionMode: EXECUTION_MODE_LIVE,
        status: "succeeded",
        completedAt: new Date(),
      },
    });
    const mockSucceeded = mockSuccessfulGhlDeps({ expectedLocationId: fx.authoritativeLocationId });
    const replaySucceeded = await executeLf2GhlCanaryForInstruction(
      fx.instruction.id,
      makeExecuteBody(),
      mockSucceeded.deps,
      db
    );
    assert.equal("alreadyActive" in replaySucceeded || "blocked" in replaySucceeded, true);
    assert.equal(mockSucceeded.httpCallCount(), 0);

    await db.deliveryAttempt.deleteMany({ where: { deliveryInstructionId: fx.instruction.id } });
    const attempt = await db.deliveryAttempt.create({
      data: {
        deliveryInstructionId: fx.instruction.id,
        adapterKey: "ghl.crm.v1",
        attemptNumber: 1,
        idempotencyKey: `attempt:live:unknown:${suffix}`,
        executionMode: EXECUTION_MODE_LIVE,
        status: "unknown_outcome",
        completedAt: new Date(),
      },
    });
    await db.leadAllocation.update({
      where: { id: fx.allocation.id },
      data: { status: "review_required" },
    });
    const mockUnknown = mockSuccessfulGhlDeps({ expectedLocationId: fx.authoritativeLocationId });
    const replayUnknown = await executeLf2GhlCanaryForInstruction(
      fx.instruction.id,
      makeExecuteBody(),
      mockUnknown.deps,
      db
    );
    assert.equal("blocked" in replayUnknown || "alreadyActive" in replayUnknown, true);
    assert.equal(mockUnknown.httpCallCount(), 0);
    assert.ok(attempt.id);
  });

  await t.test("confirmed success commits counters once with mocked transport", async () => {
    const suffix = `${Date.now()}_success`;
    const fx = await seedLf2GhlCanaryFixture(db, suffix);
    armLf2CanaryEnv({
      clientId: fx.clientAccount.clientAccountId,
      locationId: fx.authoritativeLocationId,
      orderId: fx.order.id,
      sourceLane: fx.canonicalSourceLane,
    });
    await reserveLeadAllocation(fx.allocation.id, db);
    const mock = mockSuccessfulGhlDeps({ expectedLocationId: fx.authoritativeLocationId });
    const result = await executeLf2GhlCanaryForInstruction(
      fx.instruction.id,
      makeExecuteBody(),
      mock.deps,
      db
    );
    if (!("ok" in result) || !result.ok) {
      assert.fail(`expected success, got ${JSON.stringify(result)}`);
    }
    assert.ok(mock.httpCallCount() >= 1);

    const order = await db.leadOrder.findUnique({ where: { id: fx.order.id } });
    assert.equal(order?.fulfilledQuantity, 1);
    assert.equal(order?.reservedQuantity, 0);

    const replay = await executeLf2GhlCanaryForInstruction(
      fx.instruction.id,
      makeExecuteBody(),
      mock.deps,
      db
    );
    assert.equal("alreadyActive" in replay || ("blocked" in replay), true);
    const orderAfter = await db.leadOrder.findUnique({ where: { id: fx.order.id } });
    assert.equal(orderAfter?.fulfilledQuantity, 1);
  });

  await t.test("response snapshots contain no bearer tokens", async () => {
    const suffix = `${Date.now()}_secrets`;
    const fx = await seedLf2GhlCanaryFixture(db, suffix);
    armLf2CanaryEnv({
      clientId: fx.clientAccount.clientAccountId,
      locationId: fx.authoritativeLocationId,
      orderId: fx.order.id,
      sourceLane: fx.canonicalSourceLane,
    });
    await reserveLeadAllocation(fx.allocation.id, db);
    const mock = mockSuccessfulGhlDeps({ expectedLocationId: fx.authoritativeLocationId });
    const result = await executeLf2GhlCanaryForInstruction(
      fx.instruction.id,
      makeExecuteBody(),
      mock.deps,
      db
    );
    const serialized = JSON.stringify(result);
    assert.ok(!serialized.includes("test-token"));
    assert.ok(!serialized.toLowerCase().includes("authorization"));
    const attempt = await db.deliveryAttempt.findFirst({
      where: { deliveryInstructionId: fx.instruction.id },
    });
    const attemptJson = JSON.stringify(attempt?.sanitizedResponseJson ?? {});
    assert.ok(!attemptJson.includes("test-token"));
  });

  await t.test("audit failure before deliverLive is terminal pre-send not unknown", async () => {
    const suffix = `${Date.now()}_audit_fail`;
    const fx = await seedLf2GhlCanaryFixture(db, suffix);
    armLf2CanaryEnv({
      clientId: fx.clientAccount.clientAccountId,
      locationId: fx.authoritativeLocationId,
      orderId: fx.order.id,
      sourceLane: fx.canonicalSourceLane,
    });
    await reserveLeadAllocation(fx.allocation.id, db);
    const mock = mockSuccessfulGhlDeps({ expectedLocationId: fx.authoritativeLocationId });
    const result = await executeLf2GhlCanaryForInstruction(
      fx.instruction.id,
      makeExecuteBody(),
      mock.deps,
      db,
      {
        recordAudit: async () => {
          throw new Error("audit down");
        },
      }
    );
    assert.equal("ok" in result && result.ok, false);
    assert.equal(mock.httpCallCount(), 0);
    const attempt = await db.deliveryAttempt.findFirst({
      where: { deliveryInstructionId: fx.instruction.id, executionMode: EXECUTION_MODE_LIVE },
    });
    assert.equal(attempt?.status, "terminal_failure");
    const allocation = await db.leadAllocation.findUnique({ where: { id: fx.allocation.id } });
    assert.equal(allocation?.status, "reserved");
    const instruction = await db.deliveryInstruction.findUnique({ where: { id: fx.instruction.id } });
    assert.equal(instruction?.status, "planned");
  });

  await t.test("exception after deliverLive begins is unknown outcome with replay blocked", async () => {
    const suffix = `${Date.now()}_after_deliver`;
    const fx = await seedLf2GhlCanaryFixture(db, suffix);
    armLf2CanaryEnv({
      clientId: fx.clientAccount.clientAccountId,
      locationId: fx.authoritativeLocationId,
      orderId: fx.order.id,
      sourceLane: fx.canonicalSourceLane,
    });
    await reserveLeadAllocation(fx.allocation.id, db);
    let calls = 0;
    const deps: GhlLiveHttpDeps = {
      fetch: async () => {
        calls += 1;
        throw new Error("transport exploded");
      },
    };
    const result = await executeLf2GhlCanaryForInstruction(
      fx.instruction.id,
      makeExecuteBody(),
      deps,
      db
    );
    assert.equal("ok" in result && result.ok, false);
    assert.ok(calls >= 1);
    const callsAfterFirst = calls;
    const attempt = await db.deliveryAttempt.findFirst({
      where: { deliveryInstructionId: fx.instruction.id, executionMode: EXECUTION_MODE_LIVE },
    });
    assert.equal(attempt?.status, "unknown_outcome");
    const allocation = await db.leadAllocation.findUnique({ where: { id: fx.allocation.id } });
    assert.equal(allocation?.status, "review_required");
    const replay = await executeLf2GhlCanaryForInstruction(
      fx.instruction.id,
      makeExecuteBody(),
      deps,
      db
    );
    assert.equal("blocked" in replay || "alreadyActive" in replay, true);
    assert.equal(calls, callsAfterFirst);
  });

  await t.test("contact external failure holds reservation and blocks replay", async () => {
    const suffix = `${Date.now()}_contact_fail`;
    const fx = await seedLf2GhlCanaryFixture(db, suffix);
    armLf2CanaryEnv({
      clientId: fx.clientAccount.clientAccountId,
      locationId: fx.authoritativeLocationId,
      orderId: fx.order.id,
      sourceLane: fx.canonicalSourceLane,
    });
    await reserveLeadAllocation(fx.allocation.id, db);
    let calls = 0;
    const deps: GhlLiveHttpDeps = {
      fetch: async (url, init) => {
        calls += 1;
        const urlStr = String(url);
        if (urlStr.includes("/contacts/upsert")) {
          return new Response(JSON.stringify({ message: "invalid contact" }), { status: 400 });
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      },
    };
    const result = await executeLf2GhlCanaryForInstruction(
      fx.instruction.id,
      makeExecuteBody(),
      deps,
      db
    );
    assert.equal("ok" in result && result.ok, false);
    assert.ok(calls >= 1);
    const attempt = await db.deliveryAttempt.findFirst({
      where: { deliveryInstructionId: fx.instruction.id, executionMode: EXECUTION_MODE_LIVE },
    });
    assert.equal(attempt?.status, "unknown_outcome");
    const allocation = await db.leadAllocation.findUnique({ where: { id: fx.allocation.id } });
    assert.equal(allocation?.status, "review_required");
    const order = await db.leadOrder.findUnique({ where: { id: fx.order.id } });
    assert.equal(order?.reservedQuantity, 1);
    const replay = await executeLf2GhlCanaryForInstruction(
      fx.instruction.id,
      makeExecuteBody(),
      deps,
      db
    );
    assert.equal("blocked" in replay || "alreadyActive" in replay, true);
    assert.equal(calls, 1);
  });

  await t.after(async () => {
    await db.$disconnect();
  });
});
