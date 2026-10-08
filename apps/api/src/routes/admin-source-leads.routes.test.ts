import test from "node:test";
import assert from "node:assert/strict";
import type { SourceLeadEvent } from "@prisma/client";
import Fastify from "fastify";
import {
  adminSourceLeadsRoutes,
  presentSourceLeadListItem,
  type AdminSourceLeadsRoutesOptions,
} from "./admin-source-leads.js";
import { SOURCE_LEAD_APPROVE_DELIVERY_CONFIRMATION } from "../services/source-intake/source-intake.types.js";

const HEADER = "x-sa360-admin-key";

function sourceLeadEvent(overrides: Partial<SourceLeadEvent> = {}): SourceLeadEvent {
  const now = new Date("2026-10-08T06:52:59.000Z");
  return {
    id: "evt_jean",
    sourceProvider: "leadcapture_io",
    sourceSystem: "leadcapture_io_nextgen",
    sourceType: "webhook",
    sourceRouteKey: "UNKNOWN_ROUTE",
    sourceCampaignId: "go.lifeinsuranceforvets.com/learn-jean-perez",
    sourceCampaignName: null,
    sourceFunnelName: null,
    sourceLeadId: "lead_jean",
    sourceLeadUid: "leadcaptureio-leadcapture_io_nextgen-lead_jean",
    clientAccountIdResolved: "jean_perez",
    destinationLocationIdResolved: null,
    routingRuleIdResolved: null,
    status: "routing_matched",
    rawPayloadJson: {},
    normalizedPayloadJson: {
      contact: { first_name: "Jean", last_name: "Lead" },
    },
    routingResultJson: {
      matched: true,
      routingAuthority: "confirmed_source_association",
    },
    duplicateRiskJson: null,
    deliveryResultJson: null,
    enrichmentMetadataJson: null,
    routingDryRunDecisionId: "decision_jean",
    errorSummary: null,
    webhookRequestLogId: null,
    receivedAt: now,
    normalizedAt: now,
    routedAt: now,
    approvedAt: null,
    deliveredAt: null,
    approvedBy: null,
    bulkImportId: null,
    bulkImportRowId: null,
    cleanupStatus: null,
    cleanupReason: null,
    cleanupMarkedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

async function buildApp(opts: AdminSourceLeadsRoutesOptions = {}) {
  const app = Fastify({ logger: false });
  await app.register(adminSourceLeadsRoutes, { prefix: "/admin/v1", ...opts });
  return app;
}

test("GET /admin/v1/source-leads → 401 without admin key", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "admin-secret";
  const app = await buildApp();
  const res = await app.inject({ method: "GET", url: "/admin/v1/source-leads" });
  assert.equal(res.statusCode, 401);
  await app.close();
  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
});

test("confirmed source association is presented as matched with its destination and authority", () => {
  const item = presentSourceLeadListItem(sourceLeadEvent());

  assert.equal(item?.matched, true);
  assert.equal(item?.matchedRuleId, null);
  assert.equal(item?.destinationClientAccountId, "jean_perez");
  assert.equal(item?.routingAuthority, "confirmed_source_association");
});

test("true routing miss remains unmatched", () => {
  const item = presentSourceLeadListItem(
    sourceLeadEvent({
      clientAccountIdResolved: null,
      status: "routing_unmatched",
      routingResultJson: {
        matched: false,
        routingAuthority: "campaign_routing_rule",
      },
    })
  );

  assert.equal(item?.matched, false);
  assert.equal(item?.destinationClientAccountId, null);
});

test("POST /admin/v1/source-leads/:id/requeue → 401 without admin key", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "admin-secret";
  const app = await buildApp();
  const res = await app.inject({
    method: "POST",
    url: "/admin/v1/source-leads/evt_1/requeue",
  });
  assert.equal(res.statusCode, 401);
  await app.close();
  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
});

test("approve-delivery requires exact confirmation text", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "admin-secret";
  const app = await buildApp({
    approveSourceLeadDeliveryImpl: async () => ({
      ok: false,
      error: "confirmation_required",
      reason: "missing confirmation",
      sourceLeadEventId: "evt_1",
    }),
  });
  const res = await app.inject({
    method: "POST",
    url: "/admin/v1/source-leads/evt_1/approve-delivery",
    headers: { [HEADER]: "admin-secret", "content-type": "application/json" },
    payload: { mode: "simulate", operatorConfirmationText: "WRONG" },
  });
  assert.ok(res.statusCode === 400 || res.statusCode === 409);
  await app.close();
  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
});

test("approve-delivery accepts valid confirmation text", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "admin-secret";
  let called = false;
  const app = await buildApp({
    approveSourceLeadDeliveryImpl: async (input) => {
      called = true;
      assert.equal(input.operatorConfirmationText, SOURCE_LEAD_APPROVE_DELIVERY_CONFIRMATION);
      return {
        ok: true,
        mode: "simulate",
        matched: true,
        destinationClientAccountId: "smart_agent_360_demo",
        destinationSubaccountIdGhl: "VPuMIhN6JpxdoXvvlekZ",
        routingDryRunDecisionId: "dec_1",
        deliveryPlanId: "plan_1",
        adapterRunId: "run_1",
        liveRunId: null,
        externalCallExecuted: false,
        summary: "simulated",
        blockers: [],
        warnings: [],
        nextAction: "done",
        matchedRuleId: "rule_1",
        duplicateRisk: null,
        readiness: null,
        deliveryPlanStatus: "planned",
        adapterMode: "simulate",
        sourceLeadEventId: input.sourceLeadEventId,
      };
    },
  });
  const res = await app.inject({
    method: "POST",
    url: "/admin/v1/source-leads/evt_1/approve-delivery",
    headers: { [HEADER]: "admin-secret", "content-type": "application/json" },
    payload: {
      mode: "simulate",
      operatorConfirmationText: SOURCE_LEAD_APPROVE_DELIVERY_CONFIRMATION,
    },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(called, true);
  await app.close();
  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
});
