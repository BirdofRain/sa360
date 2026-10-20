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
  leadTimelineWebhookLookups,
  mergeCorrelationKeys,
  normalizeLeadCaptureTimelineKeys,
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
    sourceLeadEventId: overrides.sourceLeadEventId ?? null,
    normalizedLeadUid: overrides.normalizedLeadUid ?? null,
    routingDryRunDecisionId: overrides.routingDryRunDecisionId ?? null,
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

test("extractKeysFromWebhookLog resolves leadcapture destination client and lead uid", () => {
  const row = webhookRow({
    id: "wh_lc_1",
    requestId: "req_lc_1",
    receivedAt: new Date("2026-06-16T12:00:00.000Z"),
    source: WebhookRequestSource.leadcapture_io,
    clientAccountId: "vet_life_james_torrey",
    normalizedLeadUid: "leadcaptureio-leadcapture_io_legacy-jt-legacy-dryrun-002",
    requestBodyRedacted: {
      provider: "leadcapture_io",
      answers: {
        lead_id: "jt-legacy-dryrun-002",
        email: "sa360test+jt-legacy-dryrun-002@lifeagentlaunch.com",
        phone: "+15550103902",
      },
    },
    responseBodyRedacted: {
      normalizedLeadUid: "leadcaptureio-leadcapture_io_legacy-jt-legacy-dryrun-002",
      destinationClientAccountId: "vet_life_james_torrey",
    },
  });
  const extracted = extractKeysFromWebhookLog(row);
  assert.equal(extracted.clientAccountId, "vet_life_james_torrey");
  assert.equal(extracted.leadUid, "leadcaptureio-leadcapture_io_legacy-jt-legacy-dryrun-002");
  assert.equal(extracted.contactIdGhl, "ghl_contact_1");
  assert.equal(extracted.phoneE164, "+15550103902");
});

const MADISON_LEAD_ID = "6e4bfbf9-940e-49e7-87dc-d07661d592da";
const MADISON_LEAD_UID = `leadcaptureio-leadcapture_io_nextgen-${MADISON_LEAD_ID}`;

test("LeadCapture timeline does not treat the source lead uid as a GHL contact id", () => {
  const row = webhookRow({
    id: "wh_madison",
    requestId: "e48eb04c-632e-4646-8a87-b21095a0979e",
    receivedAt: new Date("2026-10-20T12:05:05.810Z"),
    source: WebhookRequestSource.leadcapture_io,
    clientAccountId: "madison_pimentel",
    contactIdGhl: null,
    normalizedLeadUid: MADISON_LEAD_UID,
    processingStatus: "routing_matched",
    httpStatus: 200,
    eventNameInternal: "lead_created",
    requestBodyRedacted: {
      provider: "leadcapture_io",
      sa360_source_system: "leadcapture_io_nextgen",
      lead_id: MADISON_LEAD_ID,
      first_name: "Larry",
      last_name: "Hughes",
      email: "larry.hughes@example.test",
      phone: "+15550109620",
      parent_url: "https://go.lifeinsuranceforvets.com/learn-madison-pimentel",
    },
    responseBodyRedacted: {
      normalizedLeadUid: MADISON_LEAD_UID,
      destinationClientAccountId: "madison_pimentel",
      status: "routing_matched",
    },
  });
  const extracted = extractKeysFromWebhookLog(row);
  assert.equal(extracted.leadUid, MADISON_LEAD_UID);
  assert.equal(extracted.contactIdGhl, undefined);
  assert.equal(extracted.clientAccountId, "madison_pimentel");

  const normalized = normalizeLeadCaptureTimelineKeys({
    clientAccountId: "madison_pimentel",
    leadUid: MADISON_LEAD_UID,
    contactIdGhl: MADISON_LEAD_UID,
    phoneE164: "+15550109620",
    email: "larry.hughes@example.test",
  });
  assert.equal(normalized.leadUid, MADISON_LEAD_UID);
  assert.equal(normalized.contactIdGhl, undefined);

  const lookups = leadTimelineWebhookLookups({
    keys: {
      leadUid: MADISON_LEAD_UID,
      contactIdGhl: MADISON_LEAD_UID,
      phoneE164: "+15550109620",
      email: "larry.hughes@example.test",
    },
    eventUuids: [],
    anchorWebhookLogId: "wh_madison",
  });
  assert.deepEqual(lookups, [{ normalizedLeadUid: MADISON_LEAD_UID }, { id: "wh_madison" }]);
  assert.equal(JSON.stringify(lookups).includes("15550109620"), false);
  assert.equal(JSON.stringify(lookups).includes("example.test"), false);
});

test("a real GHL contact id remains a webhook lookup beside the source lead uid", () => {
  const lookups = leadTimelineWebhookLookups({
    keys: {
      leadUid: "leadcaptureio-leadcapture_io_nextgen-other-lead",
      contactIdGhl: "ghl_real_contact",
      phoneE164: "+15550109620",
    },
    eventUuids: ["evt-1"],
    anchorWebhookLogId: null,
  });
  assert.deepEqual(lookups, [
    { contactIdGhl: "ghl_real_contact" },
    { normalizedLeadUid: "leadcaptureio-leadcapture_io_nextgen-other-lead" },
    { eventUuid: { in: ["evt-1"] } },
  ]);

  const sameString = normalizeLeadCaptureTimelineKeys({
    leadUid: "ghl_real_contact",
    contactIdGhl: "ghl_real_contact",
  });
  assert.equal(sameString.contactIdGhl, "ghl_real_contact");
  assert.equal(sameString.leadUid, "ghl_real_contact");
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

test("lifecycle lead_created row links webhookLogId when eventUuid matches webhook", () => {
  const t1 = new Date("2026-05-19T10:00:00.000Z");
  const eventUuid = "evt-linked-1";
  const storedWebhook = webhookRow({
    id: "wh-linked",
    requestId: "req-linked",
    receivedAt: t1,
    processingStatus: "stored",
    eventUuid,
    eventNameInternal: "lead_created",
    requestBodyRedacted: {
      schema_version: "1.0",
      client_account_id: keys.clientAccountId,
      contact: { lead_uid: keys.leadUid, contact_id_ghl: keys.contactIdGhl },
      state: {},
      event: {
        event_uuid: eventUuid,
        event_name_internal: "lead_created",
        event_name_meta: "Lead",
      },
    },
  });

  const data: LeadTimelineFetchedData = {
    keys,
    lifecycleRows: [
      {
        id: "lc-linked",
        eventUuid,
        clientAccountId: keys.clientAccountId,
        subaccountIdGhl: null,
        leadUid: keys.leadUid!,
        contactIdGhl: keys.contactIdGhl,
        eventNameInternal: "lead_created",
        eventNameMeta: "Lead",
        payloadJson: {},
        status: "received",
        receivedAt: t1,
        processedAt: null,
      },
    ],
    webhookRows: [storedWebhook],
    indexRow: null,
    synthflowRows: [],
    outboundRows: [],
    agentRows: [],
  };

  const result = assembleLeadTimelineResponse(data, { sort: "asc", limit: 50 });
  const lifecycleRow = result.timeline.find((r) => r.sourceTable === "LifecycleEvent");
  assert.equal(lifecycleRow?.webhookLogId, "wh-linked");
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

test("assembled NextGen timeline shows the intake webhook name without a synthetic GHL contact", () => {
  const receivedAt = new Date("2026-10-20T12:05:05.810Z");
  const madison = webhookRow({
    id: "wh_madison_timeline",
    requestId: "e48eb04c-632e-4646-8a87-b21095a0979e",
    receivedAt,
    source: WebhookRequestSource.leadcapture_io,
    route: "/sources/leadcapture/nextgen/lead-created",
    clientAccountId: "madison_pimentel",
    contactIdGhl: null,
    normalizedLeadUid: MADISON_LEAD_UID,
    processingStatus: "routing_matched",
    httpStatus: 200,
    eventNameInternal: "lead_created",
    requestBodyRedacted: {
      provider: "leadcapture_io",
      sa360_source_system: "leadcapture_io_nextgen",
      lead_id: MADISON_LEAD_ID,
      first_name: "Larry",
      last_name: "Hughes",
      phone: "+15550109620",
    },
  });

  const result = assembleLeadTimelineResponse(
    {
      keys: {
        clientAccountId: "madison_pimentel",
        leadUid: MADISON_LEAD_UID,
        phoneE164: "+15550109620",
      },
      lifecycleRows: [],
      webhookRows: [madison],
      indexRow: null,
      synthflowRows: [],
      outboundRows: [],
      agentRows: [],
    },
    { sort: "asc", limit: 20 }
  );

  assert.equal(result.identity.displayName, "Larry Hughes");
  assert.equal(result.identity.leadUid, MADISON_LEAD_UID);
  assert.equal(result.identity.contactIdGhl, null);
  assert.equal(result.identity.clientAccountId, "madison_pimentel");
  assert.equal(result.currentState.lifecycleStage, null);
  assert.equal(result.timeline.length, 1);
  assert.equal(result.timeline[0]?.eventNameInternal, "lead_created");
  assert.equal(result.timeline[0]?.processingStatus, "routing_matched");
  assert.equal(result.timeline[0]?.httpStatus, "200");
  assert.equal(result.timeline[0]?.validity, "valid");
  assert.equal(result.timeline[0]?.leadName, "Larry Hughes");
  assert.ok(result.warnings.some((warning) => warning.includes("No InboundContactIndex")));
});
