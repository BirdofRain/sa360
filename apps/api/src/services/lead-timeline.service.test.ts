import test from "node:test";
import assert from "node:assert/strict";
import type { WebhookRequestLog } from "@prisma/client";
import { WebhookRequestSource } from "@prisma/client";
import {
  assembleLeadTimelineResponse,
  sortTimelineEntries,
  type LeadTimelineFetchedData,
} from "./lead-timeline.service.js";
import {
  computeMissingMilestones,
  extractKeysFromWebhookLog,
  mergeCorrelationKeys,
  requireResolvedCorrelationKeys,
  webhookValidity,
} from "./lead-timeline-correlation.js";

const keys = {
  clientAccountId: "client_demo",
  leadUid: "lead_abc",
  contactIdGhl: "ghl_contact_1",
  phoneE164: "+15551234001",
  email: "lead@example.com",
};

function webhookRow(
  overrides: Partial<WebhookRequestLog> & { id: string; requestId: string; receivedAt: Date }
): WebhookRequestLog {
  const base: WebhookRequestLog = {
    id: overrides.id,
    requestId: overrides.requestId,
    source: WebhookRequestSource.ghl_lifecycle,
    route: "/webhooks/ghl/lifecycle-event",
    receivedAt: overrides.receivedAt,
    completedAt: overrides.receivedAt,
    durationMs: 10,
    processingStatus: "stored",
    httpStatus: 200,
    clientAccountId: keys.clientAccountId,
    subaccountIdGhl: null,
    contactIdGhl: keys.contactIdGhl,
    eventUuid: overrides.eventUuid ?? null,
    eventNameInternal: overrides.eventNameInternal ?? null,
    errorCode: null,
    errorSummary: null,
    requestBodyRedacted: overrides.requestBodyRedacted ?? null,
    responseBodyRedacted: overrides.responseBodyRedacted ?? null,
    createdAt: overrides.receivedAt,
    updatedAt: overrides.receivedAt,
  };
  return { ...base, ...overrides };
}

test("extractKeysFromWebhookLog derives leadUid from lifecycle request body", () => {
  const row = webhookRow({
    id: "wh-1",
    requestId: "req-1",
    receivedAt: new Date("2026-05-19T10:00:00.000Z"),
    requestBodyRedacted: {
      schema_version: "1.0",
      client_account_id: keys.clientAccountId,
      contact: {
        lead_uid: keys.leadUid,
        contact_id_ghl: keys.contactIdGhl,
        phone_e164: keys.phoneE164,
        email: keys.email,
      },
      state: {},
      event: {
        event_uuid: "evt-lead-1",
        event_name_internal: "lead_created",
        event_name_meta: "Lead",
      },
    },
  });
  const extracted = extractKeysFromWebhookLog(row);
  assert.equal(extracted.leadUid, keys.leadUid);
  assert.equal(extracted.clientAccountId, keys.clientAccountId);
});

test("requireResolvedCorrelationKeys needs clientAccountId and a match key", () => {
  assert.equal(
    requireResolvedCorrelationKeys(mergeCorrelationKeys({ clientAccountId: "c1", leadUid: "l1" }))
      ?.leadUid,
    "l1"
  );
  assert.equal(requireResolvedCorrelationKeys({ clientAccountId: "c1" }), null);
});

test("assembleLeadTimelineResponse includes failed webhook without lifecycle row", () => {
  const t1 = new Date("2026-05-19T10:00:00.000Z");
  const t2 = new Date("2026-05-19T11:00:00.000Z");
  const failedWebhook = webhookRow({
    id: "wh-fail",
    requestId: "req-fail",
    receivedAt: t1,
    processingStatus: "validation_failed",
    httpStatus: 400,
    errorSummary: "attribution: Required",
    eventNameInternal: "lead_created",
    eventUuid: "evt-fail-only",
    requestBodyRedacted: {
      schema_version: "1.0",
      client_account_id: keys.clientAccountId,
      contact: { lead_uid: keys.leadUid, contact_id_ghl: keys.contactIdGhl },
      state: {},
      event: {
        event_uuid: "evt-fail-only",
        event_name_internal: "lead_created",
        event_name_meta: "Lead",
      },
    },
  });

  const data: LeadTimelineFetchedData = {
    keys,
    lifecycleRows: [
      {
        id: "lc-2",
        eventUuid: "evt-appt",
        clientAccountId: keys.clientAccountId,
        subaccountIdGhl: null,
        leadUid: keys.leadUid!,
        contactIdGhl: keys.contactIdGhl,
        eventNameInternal: "appointment_set",
        eventNameMeta: "Schedule",
        payloadJson: {},
        status: "received",
        receivedAt: t2,
        processedAt: null,
      },
    ],
    webhookRows: [failedWebhook],
    indexRow: {
      id: "idx-1",
      clientAccountId: keys.clientAccountId,
      subaccountIdGhl: "",
      phoneE164: keys.phoneE164!,
      leadUid: keys.leadUid,
      contactIdGhl: keys.contactIdGhl,
      firstName: "Jane",
      lastName: "Doe",
      displayName: "Jane Doe",
      email: keys.email,
      state: "TX",
      assignedAgentId: null,
      assignedAgentName: null,
      lifecycleStage: "APPOINTMENT_SET",
      appointmentStatus: "SET",
      policyStatus: null,
      leadType: null,
      sourceOrigin: "lifecycle_webhook",
      clientStatus: "LEAD",
      lastSeenAt: t2,
      createdAt: t1,
      updatedAt: t2,
    },
    synthflowRows: [],
    outboundRows: [],
    agentRows: [],
  };

  const result = assembleLeadTimelineResponse(data, { sort: "asc", limit: 50 });
  assert.equal(result.timeline.length, 2);
  assert.equal(result.timeline[0]?.eventNameInternal, "lead_created");
  assert.equal(result.timeline[0]?.validity, "invalid");
  assert.equal(result.timeline[0]?.sourceTable, "WebhookRequestLog");
  assert.equal(result.timeline[1]?.eventNameInternal, "appointment_set");
  assert.equal(result.currentState.lifecycleStage, "APPOINTMENT_SET");
  assert.ok(result.missingMilestones.includes("appointment_showed"));
  assert.ok(result.missingMilestones.includes("sold"));
});

test("computeMissingMilestones lists gaps", () => {
  const seen = new Set(["lead_created", "appointment_set"]);
  const missing = computeMissingMilestones(seen);
  assert.ok(missing.includes("sold"));
  assert.ok(!missing.includes("lead_created"));
});

test("webhookValidity marks validation_failed as invalid", () => {
  assert.equal(webhookValidity("validation_failed"), "invalid");
  assert.equal(webhookValidity("stored"), "valid");
});

test("sortTimelineEntries orders chronologically", () => {
  const sorted = sortTimelineEntries(
    [
      {
        id: "b",
        source: "x",
        sourceTable: "WebhookRequestLog",
        requestId: "r2",
        eventUuid: null,
        eventNameInternal: "appointment_set",
        eventNameMeta: null,
        receivedAt: "2026-05-19T12:00:00.000Z",
        validity: "valid",
        processingStatus: "stored",
        httpStatus: "200",
        leadName: null,
        phoneE164: null,
        email: null,
        summary: null,
        errorSummary: null,
      },
      {
        id: "a",
        source: "x",
        sourceTable: "WebhookRequestLog",
        requestId: "r1",
        eventUuid: null,
        eventNameInternal: "lead_created",
        eventNameMeta: null,
        receivedAt: "2026-05-19T10:00:00.000Z",
        validity: "valid",
        processingStatus: "stored",
        httpStatus: "200",
        leadName: null,
        phoneE164: null,
        email: null,
        summary: null,
        errorSummary: null,
      },
    ],
    "asc"
  );
  assert.equal(sorted[0]?.eventNameInternal, "lead_created");
});
