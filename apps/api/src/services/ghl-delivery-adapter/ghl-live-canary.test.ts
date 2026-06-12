import test from "node:test";
import assert from "node:assert/strict";
import {
  buildLiveCanaryIdempotencyKey,
  parseGhlApiErrorSummary,
  redactGhlPayload,
} from "./ghl-live-transport.js";
import {
  buildContactUpsertRequest,
  buildLiveContactUpsertHttpBody,
  buildLiveOpportunityHttpBody,
  buildAssignOwnerRequest,
  isValidGhlAssignedUserId,
  planContactNamesFromContext,
} from "./ghl-delivery-request-builders.js";
import type { GhlAdapterPlanContext } from "./ghl-delivery-adapter.types.js";
import { validateLiveCanaryExecuteBody } from "./ghl-live-canary-gates.service.js";
import {
  adapterSimulationRecordMode,
  LIVE_CANARY_CONFIRMATION_TEXT,
} from "../../lib/ghl-delivery-adapter-mode.js";
import {
  describeAdapterSimulationGate,
  isAdapterSimulationPassedForLiveCanary,
} from "../../repositories/ghl-live-delivery-run.repository.js";

test("buildLiveCanaryIdempotencyKey is deterministic", () => {
  const input = {
    deliveryPlanId: "plan_1",
    destinationSubaccountIdGhl: "loc_1",
    sourceLeadUid: "lead_1",
    sourceEmail: "a@example.com",
    sourcePhoneE164: "+15551234567",
    planVersion: "1.0",
  };
  const a = buildLiveCanaryIdempotencyKey(input);
  const b = buildLiveCanaryIdempotencyKey(input);
  assert.equal(a, b);
  assert.match(a, /^[a-f0-9]{64}$/);
});

test("validateLiveCanaryExecuteBody rejects wrong confirmation text", () => {
  const errors = validateLiveCanaryExecuteBody({
    confirmLiveDeliveryRisk: true,
    operatorConfirmationText: "NOPE",
  });
  assert.ok(errors.some((e) => e.includes(LIVE_CANARY_CONFIRMATION_TEXT)));
});

test("validateLiveCanaryExecuteBody accepts exact confirmation text", () => {
  const errors = validateLiveCanaryExecuteBody({
    confirmLiveDeliveryRisk: true,
    operatorConfirmationText: LIVE_CANARY_CONFIRMATION_TEXT,
  });
  assert.equal(errors.length, 0);
});

test("redactGhlPayload removes bearer tokens from nested headers", () => {
  const redacted = redactGhlPayload({
    headers: { Authorization: "Bearer secret-token-value" },
  });
  assert.ok(redacted);
  const headers = redacted!.headers as Record<string, string>;
  assert.notEqual(headers.Authorization, "Bearer secret-token-value");
});

test("isAdapterSimulationPassedForLiveCanary requires simulated status", () => {
  assert.equal(
    isAdapterSimulationPassedForLiveCanary({ status: "simulated", mode: "simulate" }),
    true
  );
  assert.equal(
    isAdapterSimulationPassedForLiveCanary({ status: "failed_validation", mode: "simulate" }),
    false
  );
  assert.equal(
    isAdapterSimulationPassedForLiveCanary({ status: "simulated", mode: "live_canary" }),
    false
  );
});

test("adapterSimulationRecordMode maps live_canary env to simulate persistence", () => {
  assert.equal(adapterSimulationRecordMode("live_canary"), "simulate");
  assert.equal(adapterSimulationRecordMode("simulate"), "simulate");
  assert.equal(adapterSimulationRecordMode("readonly_probe"), "readonly_probe");
});

test("buildLiveContactUpsertHttpBody omits customFields object from upsert", () => {
  const ctx: GhlAdapterPlanContext = {
    plan: {
      id: "plan_1",
      destinationSubaccountIdGhl: "loc_1",
      sourceEmail: "a@example.test",
      sourcePhoneE164: "+15551234567",
      sourceLeadUid: "lead_1",
      destinationClientAccountId: "client_1",
      nicheKey: "VET",
      steps: [
        {
          id: "step_contact",
          deliveryPlanId: "plan_1",
          stepOrder: 3,
          stepType: "create_or_update_contact",
          status: "planned",
          title: "Contact",
          description: null,
          targetSystem: "ghl",
          targetId: null,
          requestPreviewJson: {
            locationId: "loc_1",
            contact: {
              firstName: "Test",
              lastName: "Lead",
              email: "a@example.test",
              phone: "+15551234567",
            },
          },
          resultPreviewJson: null,
          warnings: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    } as never,
    rule: null,
  };
  const preview = buildContactUpsertRequest(ctx);
  const body = buildLiveContactUpsertHttpBody(preview);
  assert.equal("customFields" in body, false);
  assert.equal(body.locationId, "loc_1");
  assert.equal(body.email, "a@example.test");
  assert.equal(body.firstName, "Test");
  assert.equal(body.lastName, "Lead");
  assert.deepEqual(planContactNamesFromContext(ctx), {
    firstName: "Test",
    lastName: "Lead",
  });
});

test("parseGhlApiErrorSummary reads GHL message field", () => {
  assert.equal(
    parseGhlApiErrorSummary("", { message: "Invalid phone number" }),
    "Invalid phone number"
  );
});

test("parseGhlApiErrorSummary reads GHL message array", () => {
  assert.equal(
    parseGhlApiErrorSummary("", {
      message: ["property locationId should not exist"],
      error: "Unprocessable Entity",
      statusCode: 422,
    }),
    "property locationId should not exist"
  );
});

test("isValidGhlAssignedUserId rejects null-like tokens", () => {
  assert.equal(isValidGhlAssignedUserId("user_real"), true);
  assert.equal(isValidGhlAssignedUserId(null), false);
  assert.equal(isValidGhlAssignedUserId(""), false);
  assert.equal(isValidGhlAssignedUserId("null"), false);
  assert.equal(isValidGhlAssignedUserId("undefined"), false);
});

test("buildLiveOpportunityHttpBody uses upsert contactId not plan sourceContactIdGhl", () => {
  const ctx: GhlAdapterPlanContext = {
    plan: {
      id: "plan_1",
      destinationSubaccountIdGhl: "loc_dest",
      sourceContactIdGhl: "stale_contact_id",
      sourceEmail: "lead@example.test",
      sourceLeadUid: "lead_1",
      destinationClientAccountId: "client_dest",
      nicheKey: "vet",
    } as never,
    rule: {
      opportunityCreationEnabled: true,
      destinationPipelineIdGhl: "pipe_1",
      destinationPipelineStageIdGhl: "stage_1",
    } as never,
  };
  const body = buildLiveOpportunityHttpBody(ctx, "fresh_contact_id");
  assert.ok(body);
  assert.equal(body!.contactId, "fresh_contact_id");
  assert.notEqual(body!.contactId, "stale_contact_id");
  assert.equal(body!.status, "open");
  assert.ok(typeof body!.name === "string");
});

test("buildAssignOwnerRequest returns null when owner unconfigured", () => {
  const ctx: GhlAdapterPlanContext = {
    plan: { destinationSubaccountIdGhl: "loc_1" } as never,
    rule: { defaultAssignedUserIdGhl: "null" } as never,
  };
  assert.equal(buildAssignOwnerRequest(ctx), null);
});

test("describeAdapterSimulationGate explains why live_canary mode does not count", () => {
  const gate = describeAdapterSimulationGate({
    id: "run_old",
    status: "simulated",
    mode: "live_canary",
  });
  assert.equal(gate.passed, false);
  assert.match(gate.detail, /live_canary/);
  assert.match(gate.detail, /run_old/);
});
