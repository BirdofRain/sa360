import test from "node:test";
import assert from "node:assert/strict";
import type { WebhookRequestDetailDebug } from "@/lib/admin-api/types";
import {
  hasWebhookRawJsonContent,
  stringifyWebhookJson,
  webhookRawJsonEmptyMessage,
  webhookRawJsonTabPayload,
} from "./webhook-raw-json.utils.ts";

function minimalDebug(overrides: Partial<WebhookRequestDetailDebug> = {}): WebhookRequestDetailDebug {
  return {
    summary: {
      event: "lead_created",
      validity: "valid",
      status: "stored",
      http: "200",
      time: "2026-05-19T12:00:00.000Z",
      durationMs: "10",
      source: "ghl_lifecycle",
      route: "/webhooks/ghl/lifecycle-event",
    },
    topLine: {
      request_id: "req-1",
      time: "2026-05-19T12:00:00.000Z",
      event: "lead_created",
      lead: null,
      client: "demo",
      subaccount: null,
      validity: "valid",
      status: "stored",
      http: "200",
      ms: "10",
      route: "/webhooks/ghl/lifecycle-event",
    },
    identity: {},
    lifecycleEvent: {},
    state: {},
    attribution: {},
    appointment: {},
    policy: {},
    routingOwnership: {},
    errors: null,
    requestBodyRedacted: null,
    responseBodyRedacted: null,
    meta: {},
    ...overrides,
  };
}

test("stringifyWebhookJson returns pretty JSON for objects", () => {
  const text = stringifyWebhookJson({ ok: true, event: "lead_created" });
  assert.ok(text?.includes('"ok": true'));
  assert.ok(text?.includes("lead_created"));
});

test("stringifyWebhookJson returns null for missing payload", () => {
  assert.equal(stringifyWebhookJson(null), null);
  assert.equal(stringifyWebhookJson(undefined), null);
});

test("hasWebhookRawJsonContent is true when request body present", () => {
  const debug = minimalDebug({ requestBodyRedacted: { event: { event_uuid: "e1" } } });
  assert.equal(hasWebhookRawJsonContent(webhookRawJsonTabPayload(debug, "request")), true);
});

test("request tab empty message when body missing", () => {
  const debug = minimalDebug();
  assert.equal(hasWebhookRawJsonContent(webhookRawJsonTabPayload(debug, "request")), false);
  assert.match(webhookRawJsonEmptyMessage("request"), /No request JSON/);
});
