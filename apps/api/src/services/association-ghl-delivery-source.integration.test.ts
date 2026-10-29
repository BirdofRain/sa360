/**
 * Local sa360_test proof that a confirmed source association persists a
 * direct-canary plan, records an adapter simulation, and still refuses live
 * delivery while destination safeguards are off. No CampaignRoutingRule is written.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { PrismaClient } from "@prisma/client";

import { assertSafeTestDatabaseUrl } from "../lib/safe-test-database-url.js";
import { LIVE_CANARY_CONFIRMATION_TEXT } from "../lib/ghl-delivery-adapter-mode.js";
import { generateDirectCanaryDeliveryPlanForDecision } from "./lead-delivery-plan.service.js";
import { ROUTING_AUTHORITY_SOURCE_ASSOCIATION } from "./routing-source-association.service.js";
import { runGhlAdapterSimulationForPlan } from "./ghl-delivery-adapter-run.service.js";
import {
  executeLiveCanaryForPlan,
  getLiveCanaryPreflightForPlan,
} from "./ghl-delivery-adapter/ghl-live-canary.service.js";

const integrationUrlRaw = process.env.SA360_TEST_DATABASE_URL?.trim() || "";
const runIntegration = Boolean(integrationUrlRaw);

const WORKFLOW_ID = "d4c1fa4c-a3e2-4fd8-9091-b3fad0d04edd";
const LOCATION_ID = "yCziKRW26eFg8IXAQZ73";

describe(
  "confirmed source association persists a GHL plan and simulation",
  { skip: !runIntegration },
  () => {
    let db: PrismaClient;
    const stamp = `${Date.now()}`;
    const clientAccountId = `assoc_ghl_${stamp}`;
    let decisionId: string | null = null;
    let planId: string | null = null;

    before(async () => {
      assertSafeTestDatabaseUrl(integrationUrlRaw);
      db = new PrismaClient({ datasources: { db: { url: integrationUrlRaw } } });
      await db.clientAccount.create({
        data: {
          clientAccountId,
          clientDisplayName: "Association GHL Test",
          status: "onboarding",
        },
      });
      await db.clientGhlDestination.create({
        data: {
          clientAccountId,
          destinationSubaccountIdGhl: LOCATION_ID,
          locationName: "Test Sam CRM",
          destinationWorkflowIdGhl: WORKFLOW_ID,
          workflowTriggerMode: "direct_api",
          destinationPipelineIdGhl: "QBIEpeXqzvF2JAmbBSIR",
          destinationPipelineStageIdGhl: "b5b3729f-d3ae-4185-84c4-2d0dc3417e81",
          opportunityCreationEnabled: true,
          deliveryMode: "shadow",
          deliveryEnabled: false,
          clientCutoverApproved: false,
          snapshotInstalled: false,
          requiredFieldsInstalled: false,
          ghlConnectionStatus: "connected",
          internalApprovalStatus: "not_reviewed",
        },
      });
    });

    after(async () => {
      if (planId) {
        await db.leadDeliveryPlan.delete({ where: { id: planId } }).catch(() => undefined);
      }
      if (decisionId) {
        await db.routingDryRunDecision.delete({ where: { id: decisionId } }).catch(() => undefined);
      }
      await db.clientAccount.delete({ where: { clientAccountId } }).catch(() => undefined);
      await db.$disconnect();
    });

    it("writes a plan and a passing simulation, then blocks live canary", async () => {
      const decision = await db.routingDryRunDecision.create({
        data: {
          masterClientAccountId: "lal_master_vet",
          sourceLeadUid: `assoc-${stamp}`,
          matched: true,
          matchedRuleId: null,
          confidence: "confirmed_source",
          matchReason: "Confirmed parent URL association",
          destinationClientAccountId: clientAccountId,
          destinationSubaccountIdGhl: LOCATION_ID,
          routingEventNameInternal: "routing_matched",
          attributionSnapshot: {
            routingAuthority: ROUTING_AUTHORITY_SOURCE_ASSOCIATION,
            sourceAssociation: {
              matchedBy: "parent_url_key",
              parentUrlKey: "go.lifeinsuranceforvets.com/learn-alex-gross",
            },
          },
        },
      });
      decisionId = decision.id;

      const created = await generateDirectCanaryDeliveryPlanForDecision(decision.id, {
        leadIdentity: {
          contactIdGhl: null,
          firstName: "Pat",
          lastName: "Lead",
          displayName: "Pat Lead",
          phoneE164: "+15555550123",
          email: "pat.lead@example.test",
        },
        attribution: {
          masterClientAccountId: "lal_master_vet",
          campaignId: "UNKNOWN_ROUTE",
          utmCampaign: "Alex Gross- Vet Web Form- 10/26/26",
        },
      });
      assert.equal("plan" in created, true);
      if (!("plan" in created)) return;
      planId = created.plan.id;

      const stored = await db.leadDeliveryPlan.findUniqueOrThrow({
        where: { id: created.plan.id },
        include: { steps: true },
      });
      assert.equal(stored.deliveryMode, "direct_canary");
      assert.equal(stored.status, "planned");
      assert.equal(stored.destinationClientAccountId, clientAccountId);
      assert.equal(stored.destinationSubaccountIdGhl, LOCATION_ID);
      const workflow = stored.steps.find((step) => step.stepType === "start_workflow");
      const preview = workflow?.requestPreviewJson as { workflowId?: string } | null;
      assert.equal(workflow?.status, "planned");
      assert.equal(preview?.workflowId, WORKFLOW_ID);
      assert.equal(
        await db.campaignRoutingRule.count({ where: { clientAccountId } }),
        0
      );

      const simulated = await runGhlAdapterSimulationForPlan(created.plan.id, {
        checkLiveReadiness: false,
      });
      assert.equal("adapterRun" in simulated, true);
      if (!("adapterRun" in simulated) || !simulated.adapterRun) return;
      const adapterRun = simulated.adapterRun;
      assert.equal(simulated.ok, true);
      assert.equal(adapterRun.status, "simulated");
      assert.equal(
        adapterRun.errors.includes("No CampaignRoutingRule linked to this delivery plan."),
        false
      );
      const runs = await db.ghlDeliveryAdapterRun.count({
        where: { leadDeliveryPlanId: created.plan.id, status: "simulated" },
      });
      assert.equal(runs, 1);

      const preflightResult = await getLiveCanaryPreflightForPlan(created.plan.id);
      assert.equal("preflight" in preflightResult, true);
      if (!("preflight" in preflightResult) || !preflightResult.preflight) return;
      const preflight = preflightResult.preflight;
      assert.equal(preflight.canExecute, false);
      assert.equal(preflight.lastAdapterSimulationStatus, "simulated");
      assert.equal(
        preflight.blockers.some((item) => item.includes("Matched routing rule")),
        false
      );
      assert.ok(preflight.blockers.some((item) => item.includes("deliveryEnabled is false")));
      assert.ok(
        preflight.blockers.some((item) => item.includes("snapshot is not marked installed"))
      );

      const live = await executeLiveCanaryForPlan(created.plan.id, {
        operatorConfirmationText: LIVE_CANARY_CONFIRMATION_TEXT,
        confirmLiveDeliveryRisk: true,
      });
      assert.equal("blocked" in live && live.blocked, true);
      assert.equal(
        await db.ghlLiveDeliveryRun.count({ where: { leadDeliveryPlanId: created.plan.id } }),
        0
      );
    });
  }
);
