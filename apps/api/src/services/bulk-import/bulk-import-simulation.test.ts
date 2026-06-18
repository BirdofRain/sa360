import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveDestinationSaveNextStep,
  resolveMappingSaveNextStep,
  resolveNormalizeNextStep,
  resolveSimulateNextStep,
} from "./bulk-import-wizard-progression.service.js";
import {
  shouldRepairSimulationOnlySourceLeadEvent,
  restoredStatusForRepairedSimulationEvent,
} from "./bulk-import-simulation.service.js";
import { runManualBulkImportRoutingDryRun } from "../routing-dry-run.service.js";
import { buildDirectCanaryDeliveryPlanSteps } from "../lead-delivery-plan.service.js";

test("resolveMappingSaveNextStep routes to destination when mapping complete but no destination", () => {
  assert.equal(
    resolveMappingSaveNextStep({ missingRequired: [], hasDestination: false }),
    "destination"
  );
});

test("resolveNormalizeNextStep opens simulate when rows are eligible", () => {
  assert.equal(resolveNormalizeNextStep({ eligibleForSimulation: 5 }), "simulate");
  assert.equal(resolveNormalizeNextStep({ eligibleForSimulation: 0 }), "review");
});

test("resolveSimulateNextStep stays on simulate when all rows fail", () => {
  assert.equal(resolveSimulateNextStep(0), "simulate");
  assert.equal(resolveSimulateNextStep(3), "approve");
});

test("resolveDestinationSaveNextStep always opens review", () => {
  assert.equal(resolveDestinationSaveNextStep(), "review");
});

test("shouldRepairSimulationOnlySourceLeadEvent repairs simulate-only delivery_failed", () => {
  assert.equal(
    shouldRepairSimulationOnlySourceLeadEvent({
      status: "delivery_failed",
      bulkImportId: "batch_1",
      approvedAt: null,
      deliveredAt: null,
      deliveryResultJson: { mode: "simulate", externalCallExecuted: false },
      clientAccountIdResolved: "client_a",
    }),
    true
  );
});

test("shouldRepairSimulationOnlySourceLeadEvent does not repair live delivery failure", () => {
  assert.equal(
    shouldRepairSimulationOnlySourceLeadEvent({
      status: "delivery_failed",
      bulkImportId: "batch_1",
      approvedAt: new Date(),
      deliveredAt: null,
      deliveryResultJson: { mode: "live_canary", externalCallExecuted: true },
      clientAccountIdResolved: "client_a",
    }),
    false
  );
});

test("restoredStatusForRepairedSimulationEvent returns routing_matched when routed", () => {
  assert.equal(
    restoredStatusForRepairedSimulationEvent({
      routingResultJson: { matched: true },
      clientAccountIdResolved: "client_a",
    }),
    "routing_matched"
  );
});

test("buildDirectCanaryDeliveryPlanSteps supports manual_bulk_import without campaign rule", () => {
  const { steps, summary } = buildDirectCanaryDeliveryPlanSteps({
    decision: {
      id: "dec_1",
      masterClientAccountId: "master",
      sourceEventUuid: "evt_1",
      sourceLeadUid: "lead_1",
      matched: true,
      confidence: "high",
      matchedRuleId: null,
      destinationClientAccountId: "client_a",
      destinationSubaccountIdGhl: "loc_a",
      matchReason: "manual",
      deliveryMode: "dry_run",
      routingEventNameInternal: "lead_matched",
      attributionSnapshot: {},
      validationStatus: null,
      createdAt: new Date(),
    } as never,
    matched: true,
    rule: null,
    routingAuthority: "manual_bulk_import",
    manualDestination: {
      clientAccountId: "client_a",
      clientDisplayName: "Vet Life",
      nicheKey: "VET",
      productType: "Final Expense",
      destinationSubaccountIdGhl: "loc_a",
      destinationPipelineIdGhl: null,
      destinationPipelineStageIdGhl: null,
      destinationWorkflowIdGhl: null,
      defaultAssignedUserIdGhl: null,
      opportunityCreationEnabled: false,
    },
    attribution: { masterClientAccountId: "master" },
    leadIdentity: {
      firstName: "Jane",
      lastName: "Doe",
      email: "jane@example.test",
      phoneE164: "+15550101001",
      displayName: "Jane Doe",
      contactIdGhl: null,
    },
    duplicateRisk: null,
  });

  assert.match(summary, /manual|adapter|Vet Life/i);
  assert.ok(steps.some((s) => s.stepType === "create_or_update_contact"));
  assert.ok(steps.length >= 3);
});

test("runManualBulkImportRoutingDryRun does not require campaign routing rule", async () => {
  const created: Array<Record<string, unknown>> = [];
  const payload = {
    schema_version: "1.0",
    client_account_id: "master",
    subaccount_id_ghl: "loc_a",
    contact: {
      lead_uid: "lead_manual_1",
      first_name: "Test",
      last_name: "Lead",
      email: "test@example.test",
      phone_e164: "+15550101001",
    },
    event: {
      event_uuid: "evt_manual_1",
      event_name_internal: "lead_created" as const,
      event_name_meta: "Lead created",
      send_to_meta: false,
    },
    state: {},
  };

  const output = await runManualBulkImportRoutingDryRun(
    {
      payload,
      destinationClientAccountId: "client_a",
      destinationLocationIdGhl: "loc_a",
      masterClientAccountId: "master",
    },
    {
      prisma: {
        routingDryRunDecision: {
          create: async ({ data }: { data: Record<string, unknown> }) => {
            created.push(data);
            return { id: "dec_manual_1", ...data };
          },
        },
      } as never,
    }
  );

  assert.equal(output.matched, true);
  assert.equal(output.matchType, "manual_bulk_import");
  assert.equal(output.matchedRuleId, undefined);
  assert.equal(created[0]?.matchedRuleId, null);
  assert.equal(output.lifecycleEventsEmitted.length, 0);
});
