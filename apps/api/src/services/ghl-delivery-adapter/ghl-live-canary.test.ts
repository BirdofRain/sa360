import test from "node:test";
import assert from "node:assert/strict";
import {
  buildLiveCanaryIdempotencyKey,
  redactGhlPayload,
} from "./ghl-live-transport.js";
import { validateLiveCanaryExecuteBody } from "./ghl-live-canary-gates.service.js";
import { LIVE_CANARY_CONFIRMATION_TEXT } from "../../lib/ghl-delivery-adapter-mode.js";
import { isAdapterSimulationPassedForLiveCanary } from "../../repositories/ghl-live-delivery-run.repository.js";

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
