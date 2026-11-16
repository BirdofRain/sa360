import assert from "node:assert/strict";
import test from "node:test";

import { externalWebhookAcceptanceEvent } from "./external-webhook-acceptance.js";

const acceptedAt = new Date("2026-11-16T15:00:00.000Z");

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "att_1",
    clientAccountId: "client_1",
    sourceLeadEventId: "lead_1",
    destinationId: "dest_1",
    state: "attempted",
    outcome: "http_accepted" as string | null,
    httpStatus: 204 as number | null,
    requestLeftSa360: true,
    httpAcceptedAt: acceptedAt as Date | null,
    ...overrides,
  };
}

test("acceptance event uses httpAcceptedAt and refuses every non-accepted attempt", () => {
  const event = externalWebhookAcceptanceEvent(row());
  assert.equal(event?.acceptanceId, "att_1");
  assert.equal(event?.attemptId, "att_1");
  assert.equal(event?.acceptedAt, "2026-11-16T15:00:00.000Z");
  assert.equal(externalWebhookAcceptanceEvent(row({ httpAcceptedAt: null })), null);
  assert.equal(externalWebhookAcceptanceEvent(row({ requestLeftSa360: false })), null);
  assert.equal(externalWebhookAcceptanceEvent(row({ state: "recorded", outcome: null, httpStatus: null, requestLeftSa360: false, httpAcceptedAt: null })), null);
  assert.equal(externalWebhookAcceptanceEvent(row({ state: "sending", outcome: null, httpStatus: null, requestLeftSa360: false, httpAcceptedAt: null })), null);
  assert.equal(externalWebhookAcceptanceEvent(row({ outcome: "retryable", httpStatus: null, requestLeftSa360: false, httpAcceptedAt: null })), null);
  assert.equal(externalWebhookAcceptanceEvent(row({ outcome: "failed", httpStatus: 500, httpAcceptedAt: null })), null);
  assert.equal(externalWebhookAcceptanceEvent(row({ outcome: "uncertain", httpStatus: null, httpAcceptedAt: null })), null);
});
