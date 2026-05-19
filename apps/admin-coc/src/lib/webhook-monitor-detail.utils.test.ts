import test from "node:test";
import assert from "node:assert/strict";
import type { AdminWebhookDetail, AdminWebhookListItem } from "@/lib/admin-api/types";
import {
  buildCompactDebugSummary,
  formatDetailFieldValue,
  hasJsonPayload,
  topLineFromListItem,
} from "./webhook-monitor-detail.utils.ts";

function listRow(overrides: Partial<AdminWebhookListItem> = {}): AdminWebhookListItem {
  return {
    id: "log-1",
    requestId: "req-1",
    source: "ghl_lifecycle",
    route: "/webhooks/ghl/lifecycle-event",
    receivedAt: "2026-05-19T12:00:00.000Z",
    completedAt: null,
    durationMs: 10,
    processingStatus: "stored",
    httpStatus: 200,
    clientAccountId: "client-1",
    subaccountIdGhl: null,
    contactIdGhl: null,
    eventUuid: null,
    eventNameInternal: "lead_created",
    errorCode: null,
    errorSummary: null,
    leadName: "Test Lead",
    ...overrides,
  };
}

test("topLineFromListItem includes Event near top fields", () => {
  const top = topLineFromListItem(listRow());
  assert.equal(top.event, "lead_created");
  assert.equal(top.request_id, "req-1");
  assert.equal(top.validity, "valid");
});

test("formatDetailFieldValue shows em dash for missing values", () => {
  assert.equal(formatDetailFieldValue(null), "—");
  assert.equal(formatDetailFieldValue(true), "true");
});

test("hasJsonPayload is false for empty payloads", () => {
  assert.equal(hasJsonPayload(null), false);
  assert.equal(hasJsonPayload(undefined), false);
  assert.equal(hasJsonPayload({ ok: true }), true);
});

test("buildCompactDebugSummary includes request_id and event", () => {
  const summary = buildCompactDebugSummary(listRow(), null);
  assert.match(summary, /request_id: req-1/);
  assert.match(summary, /event: lead_created/);
});

test("buildCompactDebugSummary uses detail debug when present", () => {
  const row = listRow({ processingStatus: "validation_failed" });
  const detail = {
    ...row,
    requestBodyRedacted: { event: { event_name_internal: "lead_created" } },
    responseBodyRedacted: null,
    createdAt: row.receivedAt,
    updatedAt: row.receivedAt,
    debug: {
      summary: {
        event: "lead_created",
        validity: "invalid",
        status: "validation_failed",
        http: "400",
        time: row.receivedAt,
        durationMs: "10",
        source: row.source,
        route: row.route,
      },
      topLine: topLineFromListItem(row),
      identity: { lead_name: "Test Lead" },
      lifecycleEvent: {},
      state: {},
      attribution: {},
      routingOwnership: {},
      errors: {
        error_code: "VALIDATION_FAILED",
        error_summary: "bad field",
        processingStatus: "validation_failed",
        validityReason: "Payload failed",
        unauthorizedReason: null,
        fieldErrors: [{ path: "attribution", message: "Required" }],
      },
      requestBodyRedacted: { ok: true },
      responseBodyRedacted: null,
      meta: {},
    },
  } as AdminWebhookDetail;

  const summary = buildCompactDebugSummary(row, detail);
  assert.match(summary, /error_summary: bad field/);
});
