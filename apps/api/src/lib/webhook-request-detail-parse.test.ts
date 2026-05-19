import test from "node:test";
import assert from "node:assert/strict";
import type { WebhookRequestLog } from "@prisma/client";
import { emptyIdentity } from "./webhook-log-lead-identity.js";
import { buildWebhookRequestDetailDebug } from "./webhook-request-detail-parse.js";

function baseRow(overrides: Partial<WebhookRequestLog> = {}): WebhookRequestLog {
  const now = new Date("2026-05-19T12:00:00.000Z");
  return {
    id: "log-1",
    requestId: "req-abc",
    source: "ghl_lifecycle",
    route: "/webhooks/ghl/lifecycle-event",
    receivedAt: now,
    completedAt: now,
    durationMs: 42,
    processingStatus: "validation_failed",
    httpStatus: 400,
    clientAccountId: "client-1",
    subaccountIdGhl: "loc-1",
    contactIdGhl: "contact-1",
    eventUuid: "evt-uuid-1",
    eventNameInternal: null,
    errorCode: "VALIDATION_FAILED",
    errorSummary: "event.event_name_internal: Invalid enum value",
    requestBodyRedacted: {
      schema_version: "1.0",
      client_account_id: "client-1",
      subaccount_id_ghl: "loc-1",
      contact: {
        contact_id_ghl: "contact-1",
        phone_e164: "+15551234567",
        email: "lead@example.com",
        state: "TX",
      },
      event: {
        event_uuid: "evt-uuid-1",
        event_name_internal: "not_a_real_event",
      },
      attribution: { utm_source: "facebook" },
      state: { lifecycle_stage: "NEW" },
      routing: { campaign_key: "camp-a" },
    },
    responseBodyRedacted: {
      ok: false,
      error: "Invalid payload",
      details: {
        fieldErrors: {
          attribution: ["Required"],
          "event.event_name_internal": ["Invalid enum value"],
        },
        formErrors: [],
      },
    },
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as WebhookRequestLog;
}

test("buildWebhookRequestDetailDebug extracts lifecycle sections and validation errors", () => {
  const debug = buildWebhookRequestDetailDebug(baseRow(), {
    leadName: "Jane Doe",
    leadFirstName: "Jane",
    leadLastName: "Doe",
    leadPhone: "+15551234567",
    leadEmail: "lead@example.com",
  });

  assert.equal(debug.summary.validity, "invalid");
  assert.equal(debug.summary.event, "not_a_real_event");
  assert.equal(debug.topLine.request_id, "req-abc");
  assert.equal(debug.identity.lead_name, "Jane Doe");
  assert.equal(debug.lifecycleEvent.event_uuid, "evt-uuid-1");
  assert.equal(debug.attribution.utm_source, "facebook");
  assert.equal(debug.routingOwnership.campaign_key, "camp-a");
  assert.ok(debug.errors);
  assert.equal(debug.errors?.fieldErrors.length, 2);
  assert.equal(debug.errors?.fieldErrors[0]?.path, "attribution");
  assert.ok(hasJsonPayload(debug.requestBodyRedacted));
});

function hasJsonPayload(value: unknown): boolean {
  return value !== null && value !== undefined;
}

test("buildWebhookRequestDetailDebug handles missing request body without throwing", () => {
  const debug = buildWebhookRequestDetailDebug(
    baseRow({ requestBodyRedacted: null, responseBodyRedacted: null, processingStatus: "stored" }),
    emptyIdentity()
  );

  assert.equal(debug.summary.validity, "valid");
  assert.equal(debug.identity.contact_id_ghl, "contact-1");
  assert.equal(debug.requestBodyRedacted, null);
});

test("unauthorized row includes unauthorized reason", () => {
  const debug = buildWebhookRequestDetailDebug(
    baseRow({
      processingStatus: "unauthorized",
      httpStatus: 401,
      responseBodyRedacted: { ok: false, error: "Unauthorized" },
    }),
    emptyIdentity()
  );

  assert.equal(debug.summary.validity, "invalid");
  assert.ok(debug.errors?.unauthorizedReason?.includes("Unauthorized"));
});
