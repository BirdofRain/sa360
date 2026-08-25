import test from "node:test";
import assert from "node:assert/strict";
import type { Prisma, SourceLeadEvent, WebhookRequestLog } from "@prisma/client";
import {
  buildLeadCaptureSourceIntakeDebug,
  presentLeadCaptureRoutingNiche,
} from "./leadcapture-webhook-detail.present.js";
import { resolveWebhookLeadIdentitySafe } from "./webhook-log-lead-identity.js";
import { buildWebhookRequestDetailDebug } from "./webhook-request-detail-parse.js";

test("capture-only Nurse source niche is source-only, not fake VET routing", () => {
  const presented = presentLeadCaptureRoutingNiche({
    normalizedRouting: null,
    rawPayload: { niche_key: "NURSE", niche: "NURSE" },
  });
  assert.equal(presented.niche_key, "NURSE");
  assert.equal(presented.niche_label, "source-only");
  assert.equal(presented.product_type, "—");
  assert.notEqual(presented.niche_key, "VET");
  assert.notEqual(presented.niche_label, "Veteran");
  assert.notEqual(presented.product_type, "Final Expense");
});

test("capture-only missing niche is Unresolved, not VET", () => {
  const presented = presentLeadCaptureRoutingNiche({
    normalizedRouting: null,
    rawPayload: { first_name: "Casey" },
  });
  assert.equal(presented.niche_key, "Unresolved");
  assert.equal(presented.niche_label, "—");
  assert.equal(presented.product_type, "—");
  assert.notEqual(presented.niche_key, "VET");
});

test("normalized VET keeps genuine resolved Veteran / Final Expense", () => {
  const presented = presentLeadCaptureRoutingNiche({
    normalizedRouting: {
      niche_key: "VET",
      niche_label: "Veteran",
      product_type: "Final Expense",
    },
    rawPayload: { niche_key: "VET" },
  });
  assert.equal(presented.niche_key, "VET");
  assert.equal(presented.niche_label, "Veteran");
  assert.equal(presented.product_type, "Final Expense");
});

test("normalized NURSE does not invent Veteran or Final Expense", () => {
  const presented = presentLeadCaptureRoutingNiche({
    normalizedRouting: { niche_key: "NURSE" },
    rawPayload: { niche_key: "NURSE" },
  });
  assert.equal(presented.niche_key, "NURSE");
  assert.notEqual(presented.niche_label, "Veteran");
  assert.notEqual(presented.product_type, "Final Expense");
});

function baseRow(overrides: Partial<WebhookRequestLog> = {}): WebhookRequestLog {
  const now = new Date("2026-08-18T15:16:48.000Z");
  return {
    id: "log-nurse",
    requestId: "req-nurse",
    source: "leadcapture_io",
    route: "/webhooks/leadcaptureio/nextgen",
    receivedAt: now,
    completedAt: now,
    durationMs: 12,
    processingStatus: "stored",
    httpStatus: 200,
    clientAccountId: null,
    subaccountIdGhl: null,
    contactIdGhl: null,
    eventUuid: null,
    eventNameInternal: null,
    errorCode: null,
    errorSummary: null,
    requestBodyRedacted: {
      niche_key: "NURSE",
      niche: "NURSE",
      sa360_route_key: "LCIO_NG_NURSE_ANDRU_DURANSO",
    },
    responseBodyRedacted: { ok: true, matched: false },
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as WebhookRequestLog;
}

test("capture-only source intake debug surfaces Nurse as source-only", () => {
  const debug = buildLeadCaptureSourceIntakeDebug({
    row: baseRow(),
    sourceEvent: {
      id: "evt-nurse",
      sourceLeadId: "9f3a2c10-4b21-4d88-8a77-6c1e0b2d9e11",
      sourceSystem: "leadcapture_io_nextgen",
      sourceType: "webhook",
      sourceRouteKey: "LCIO_NG_NURSE_ANDRU_DURANSO",
      sourceCampaignId: "LCIO_NG_NURSE_ANDRU_DURANSO",
      sourceCampaignName: "Life Insurance For Nurses - Andru Duranso",
      sourceFunnelName: "Nurse Coverage NextGen Canary",
      rawPayloadJson: {
        niche_key: "NURSE",
        niche: "NURSE",
      },
      normalizedPayloadJson: null,
      routingResultJson: null,
      enrichmentMetadataJson: { captureOnly: true, intakeStage: "capture_only" },
      status: "received",
    } as unknown as SourceLeadEvent,
    responseBody: { ok: true, matched: false },
  });
  assert.equal(debug.routing.niche_key, "NURSE");
  assert.equal(debug.routing.niche_label, "source-only");
  assert.equal(debug.routing.product_type, "—");
  assert.notEqual(debug.routing.niche_key, "VET");
  assert.notEqual(debug.routing.niche_label, "Veteran");
  assert.notEqual(debug.routing.product_type, "Final Expense");
});

const JOSEPHINE_LEAD_ID = "beab299c-f2ee-4540-ae35-d33149bae9e8";
const JOSEPHINE_LEAD_UID = `leadcaptureio-leadcapture_io_nextgen-${JOSEPHINE_LEAD_ID}`;
const JOSEPHINE_PHONE = "+15550101234";

function josephineProviderBody(overrides: Record<string, unknown> = {}): Prisma.JsonObject {
  return {
    provider: "leadcapture_io",
    sa360_source_platform: "leadcapture_io",
    sa360_source_system: "leadcapture_io_nextgen",
    lead_id: JOSEPHINE_LEAD_ID,
    first_name: "Josephine ",
    last_name: "Matthews ",
    email: "test@example.test",
    phone: JOSEPHINE_PHONE,
    state: "South Carolina",
    sa360_route_key: "LCIO_NG_NURSE_ANDRU_DURANSO",
    ...overrides,
  } as Prisma.JsonObject;
}

function captureOnlyEvent(overrides: Record<string, unknown> = {}): SourceLeadEvent {
  return {
    id: "cmt8y7zzn002ph70upq1zkr5k",
    sourceLeadId: JOSEPHINE_LEAD_ID,
    sourceProvider: "leadcapture_io",
    sourceSystem: "leadcapture_io_nextgen",
    sourceType: "webhook",
    sourceRouteKey: "LCIO_NG_NURSE_ANDRU_DURANSO",
    sourceCampaignId: "LCIO_NG_NURSE_ANDRU_DURANSO",
    sourceCampaignName: "Life Insurance For Nurses - Andru Duranso",
    sourceFunnelName: "Nurse Coverage NextGen Canary",
    rawPayloadJson: josephineProviderBody(),
    normalizedPayloadJson: null,
    routingResultJson: null,
    enrichmentMetadataJson: { captureOnly: true, intakeStage: "capture_only" },
    status: "received",
    clientAccountIdResolved: null,
    destinationLocationIdResolved: null,
    ...overrides,
  } as unknown as SourceLeadEvent;
}

function presentSourceIntake(input: {
  body?: Prisma.JsonObject;
  event?: SourceLeadEvent;
  row?: Partial<WebhookRequestLog>;
}) {
  const requestBodyRedacted = input.body ?? josephineProviderBody();
  return buildLeadCaptureSourceIntakeDebug({
    row: baseRow({
      source: "leadcapture_io",
      processingStatus: "stored",
      httpStatus: 200,
      clientAccountId: null,
      contactIdGhl: null,
      normalizedLeadUid: JOSEPHINE_LEAD_UID,
      sourceLeadEventId: "cmt8y7zzn002ph70upq1zkr5k",
      requestBodyRedacted,
      responseBodyRedacted: {
        ok: true,
        sourceEventId: "cmt8y7zzn002ph70upq1zkr5k",
        sourceLeadId: JOSEPHINE_LEAD_ID,
        normalizedLeadUid: JOSEPHINE_LEAD_UID,
      },
      ...input.row,
    }),
    sourceEvent: input.event ?? captureOnlyEvent({ rawPayloadJson: requestBodyRedacted }),
    responseBody: {
      ok: true,
      sourceEventId: "cmt8y7zzn002ph70upq1zkr5k",
      normalizedLeadUid: JOSEPHINE_LEAD_UID,
    },
  });
}

test("REPRO: capture-only NextGen Josephine shows Lead / Contact from redacted request", () => {
  const body = josephineProviderBody();
  const event = captureOnlyEvent({ rawPayloadJson: { ...body } });
  const debug = presentSourceIntake({ body, event });

  assert.equal(debug.identity.lead_name, "Josephine Matthews");
  assert.equal(debug.identity.first_name, "Josephine");
  assert.equal(debug.identity.last_name, "Matthews");
  assert.equal(debug.identity.email, "test@example.test");
  assert.equal(debug.identity.phone, JOSEPHINE_PHONE);
  assert.equal(debug.identity.state, "South Carolina");
  assert.equal(debug.identity.lead_uid, JOSEPHINE_LEAD_UID);
  assert.equal(debug.intakeStatus, "received");
  assert.equal(event.status, "received");
  assert.equal(event.normalizedPayloadJson, null);
  assert.equal((event.enrichmentMetadataJson as { captureOnly: boolean }).captureOnly, true);
});

test("capture-only Josephine top line, compact identity, and Lead / Contact share one name", () => {
  const row = baseRow({
    source: "leadcapture_io",
    processingStatus: "stored",
    httpStatus: 200,
    clientAccountId: null,
    normalizedLeadUid: JOSEPHINE_LEAD_UID,
    requestBodyRedacted: josephineProviderBody(),
    responseBodyRedacted: { ok: true },
  });
  const sourceIntake = presentSourceIntake({ body: josephineProviderBody() });
  const identity = resolveWebhookLeadIdentitySafe({
    source: "leadcapture_io",
    requestBodyRedacted: row.requestBodyRedacted,
    responseBodyRedacted: row.responseBodyRedacted,
  });
  const detail = buildWebhookRequestDetailDebug(row, identity, sourceIntake);

  assert.equal(sourceIntake.identity.lead_name, "Josephine Matthews");
  assert.equal(detail.identity.lead_name, "Josephine Matthews");
  assert.equal(detail.topLine.lead, "Josephine Matthews");
  assert.equal(identity.leadName, "Josephine Matthews");
});

test("normalized contact wins when provider fields differ", () => {
  const debug = presentSourceIntake({
    body: josephineProviderBody(),
    event: captureOnlyEvent({
      status: "routed",
      enrichmentMetadataJson: { captureOnly: false, intakeStage: "normalize_route_proof" },
      normalizedPayloadJson: {
        contact: {
          first_name: "Ada",
          last_name: "Lovelace",
          email: "ada@example.test",
          phone_e164: "+15550109999",
          state: "Texas",
          lead_uid: "normalized-uid-ada",
        },
      },
    }),
  });

  assert.equal(debug.identity.lead_name, "Ada Lovelace");
  assert.equal(debug.identity.first_name, "Ada");
  assert.equal(debug.identity.last_name, "Lovelace");
  assert.equal(debug.identity.email, "ada@example.test");
  assert.equal(debug.identity.phone, "+15550109999");
  assert.equal(debug.identity.state, "Texas");
  assert.notEqual(debug.identity.lead_name, "Josephine Matthews");
});

test("capture-only first name only, last name only, and neither", () => {
  const firstOnly = presentSourceIntake({
    body: josephineProviderBody({ first_name: "Josephine ", last_name: "  " }),
  });
  assert.equal(firstOnly.identity.lead_name, "Josephine");
  assert.equal(firstOnly.identity.first_name, "Josephine");
  assert.equal(firstOnly.identity.last_name, null);

  const lastOnly = presentSourceIntake({
    body: josephineProviderBody({ first_name: "   ", last_name: "Matthews " }),
  });
  assert.equal(lastOnly.identity.lead_name, "Matthews");
  assert.equal(lastOnly.identity.first_name, null);
  assert.equal(lastOnly.identity.last_name, "Matthews");

  const neither = presentSourceIntake({
    body: josephineProviderBody({ first_name: "  ", last_name: "", email: "test@example.test" }),
  });
  assert.equal(neither.identity.lead_name, null);
  assert.equal(neither.identity.first_name, null);
  assert.equal(neither.identity.last_name, null);
  assert.equal(neither.identity.email, "test@example.test");
});

test("capture-only phone_number alias and absent email/state stay blank", () => {
  const phoneNumber = presentSourceIntake({
    body: josephineProviderBody({
      phone: undefined,
      phone_number: "+15550101999",
    }),
  });
  assert.equal(phoneNumber.identity.phone, "+15550101999");

  const missing = presentSourceIntake({
    body: josephineProviderBody({
      email: "  ",
      state: undefined,
      phone: JOSEPHINE_PHONE,
    }),
  });
  assert.equal(missing.identity.email, null);
  assert.equal(missing.identity.state, null);
  assert.equal(missing.identity.phone, JOSEPHINE_PHONE);
});

test("redacted provider fields stay redacted and rawPayloadJson is not used", () => {
  const redactedBody = josephineProviderBody({
    first_name: "***REDACTED***",
    last_name: "***REDACTED***",
    email: "***REDACTED***",
    phone: "***REDACTED***",
  });
  const event = captureOnlyEvent({
    rawPayloadJson: josephineProviderBody({
      first_name: "Unredacted",
      last_name: "Secret",
      email: "secret@example.test",
      phone: "+15550999999",
    }),
  });
  const debug = presentSourceIntake({ body: redactedBody, event });

  assert.equal(debug.identity.first_name, "***REDACTED***");
  assert.equal(debug.identity.last_name, "***REDACTED***");
  assert.equal(debug.identity.email, "***REDACTED***");
  assert.equal(debug.identity.phone, "***REDACTED***");
  assert.equal(debug.identity.lead_name, "***REDACTED*** ***REDACTED***");
  assert.notEqual(debug.identity.first_name, "Unredacted");
  assert.notEqual(debug.identity.email, "secret@example.test");
});

test("capture-only presenter does not mutate the source event or request body", () => {
  const body = josephineProviderBody();
  const event = captureOnlyEvent({ rawPayloadJson: { ...body } });
  const before = JSON.stringify({
    status: event.status,
    normalized: event.normalizedPayloadJson,
    captureOnly: (event.enrichmentMetadataJson as { captureOnly: boolean }).captureOnly,
    body,
  });

  presentSourceIntake({ body, event });

  assert.equal(event.status, "received");
  assert.equal(event.normalizedPayloadJson, null);
  assert.equal((event.enrichmentMetadataJson as { captureOnly: boolean }).captureOnly, true);
  assert.equal(
    JSON.stringify({
      status: event.status,
      normalized: event.normalizedPayloadJson,
      captureOnly: (event.enrichmentMetadataJson as { captureOnly: boolean }).captureOnly,
      body,
    }),
    before
  );
});
