import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { PrismaClient } from "@prisma/client";

import { assertSafeTestDatabaseUrl } from "../lib/safe-test-database-url.js";
import { getLeadTimeline } from "./lead-timeline.service.js";

const integrationUrlRaw = process.env.SA360_TEST_DATABASE_URL?.trim() || "";
const runIntegration = Boolean(integrationUrlRaw);

const RUN = "madison-nextgen-timeline-gap";
const MADISON_CLIENT = "madison_pimentel";
const OTHER_CLIENT = "other_client_same_person_timeline";
const MASTER_CLIENT = "leadcapture_io";
const MADISON_LEAD_ID = "6e4bfbf9-940e-49e7-87dc-d07661d592da";
const MADISON_LEAD_UID = `leadcaptureio-leadcapture_io_nextgen-${MADISON_LEAD_ID}`;
const OTHER_LEAD_UID = `leadcaptureio-leadcapture_io_nextgen-${RUN}-other-client`;
const SAME_CLIENT_OTHER_LEAD_UID = `leadcaptureio-leadcapture_io_nextgen-${RUN}-madison-other`;
const SHARED_PHONE = "+15550109621";
const SHARED_EMAIL = "larry.hughes.timeline@example.test";

describe("NextGen client timeline linking", { skip: !runIntegration }, () => {
  let db: PrismaClient;

  before(async () => {
    const url = assertSafeTestDatabaseUrl(integrationUrlRaw);
    process.env.DATABASE_URL = url;
    db = new PrismaClient({ datasources: { db: { url } } });
    await db.lifecycleEvent.deleteMany({ where: { eventUuid: { startsWith: RUN } } });
    await db.webhookRequestLog.deleteMany({ where: { requestId: { startsWith: RUN } } });
  });

  after(async () => {
    if (!db) return;
    await db.lifecycleEvent.deleteMany({ where: { eventUuid: { startsWith: RUN } } });
    await db.webhookRequestLog.deleteMany({ where: { requestId: { startsWith: RUN } } });
    await db.$disconnect();
  });

  it("shows Madison's intake webhook and keeps the same person on another client separate", async () => {
    const receivedAt = new Date("2026-10-20T12:05:05.810Z");
    const body = {
      provider: "leadcapture_io",
      sa360_source_system: "leadcapture_io_nextgen",
      lead_id: MADISON_LEAD_ID,
      first_name: "Larry",
      last_name: "Hughes",
      email: SHARED_EMAIL,
      phone: SHARED_PHONE,
      parent_url: "https://go.lifeinsuranceforvets.com/learn-madison-pimentel",
    };

    const madison = await db.webhookRequestLog.create({
      data: {
        requestId: `${RUN}-madison-request`,
        source: "leadcapture_io",
        route: "/sources/leadcapture/nextgen/lead-created",
        receivedAt,
        processingStatus: "routing_matched",
        httpStatus: 200,
        clientAccountId: MADISON_CLIENT,
        contactIdGhl: null,
        eventNameInternal: "lead_created",
        normalizedLeadUid: MADISON_LEAD_UID,
        requestBodyRedacted: body,
        responseBodyRedacted: {
          ok: true,
          status: "routing_matched",
          matched: true,
          normalizedLeadUid: MADISON_LEAD_UID,
          destinationClientAccountId: MADISON_CLIENT,
        },
      },
    });

    const otherClient = await db.webhookRequestLog.create({
      data: {
        requestId: `${RUN}-other-client-request`,
        source: "leadcapture_io",
        route: "/sources/leadcapture/nextgen/lead-created",
        receivedAt: new Date("2026-10-20T12:06:00.000Z"),
        processingStatus: "routing_matched",
        httpStatus: 200,
        clientAccountId: OTHER_CLIENT,
        contactIdGhl: null,
        eventNameInternal: "lead_created",
        normalizedLeadUid: OTHER_LEAD_UID,
        requestBodyRedacted: {
          ...body,
          lead_id: `${RUN}-other-client`,
          parent_url: "https://go.lifeinsuranceforvets.com/learn-other-client",
        },
      },
    });

    const madisonOtherLead = await db.webhookRequestLog.create({
      data: {
        requestId: `${RUN}-madison-other-lead`,
        source: "leadcapture_io",
        route: "/sources/leadcapture/nextgen/lead-created",
        receivedAt: new Date("2026-10-20T12:07:00.000Z"),
        processingStatus: "routing_matched",
        httpStatus: 200,
        clientAccountId: MADISON_CLIENT,
        contactIdGhl: null,
        eventNameInternal: "lead_created",
        normalizedLeadUid: SAME_CLIENT_OTHER_LEAD_UID,
        requestBodyRedacted: {
          ...body,
          lead_id: `${RUN}-madison-other`,
          first_name: "Larry",
          last_name: "Other",
        },
      },
    });

    const madisonRouted = await db.lifecycleEvent.create({
      data: {
        eventUuid: `${RUN}-madison-lead-routed`,
        clientAccountId: MADISON_CLIENT,
        leadUid: MADISON_LEAD_UID,
        contactIdGhl: null,
        eventNameInternal: "lead_routed_dry_run",
        eventNameMeta: "Lead routed (dry run)",
        payloadJson: {
          client_account_id: MADISON_CLIENT,
          contact: { lead_uid: MADISON_LEAD_UID, first_name: "Larry", last_name: "Hughes" },
        },
        receivedAt: new Date("2026-10-20T12:05:06.000Z"),
      },
    });
    await db.lifecycleEvent.create({
      data: {
        eventUuid: `${RUN}-master-lead-matched`,
        clientAccountId: MASTER_CLIENT,
        leadUid: MADISON_LEAD_UID,
        contactIdGhl: null,
        eventNameInternal: "lead_matched",
        eventNameMeta: "Lead matched",
        payloadJson: { client_account_id: MASTER_CLIENT },
        receivedAt,
      },
    });
    await db.lifecycleEvent.create({
      data: {
        eventUuid: `${RUN}-other-client-same-lead-uid`,
        clientAccountId: OTHER_CLIENT,
        leadUid: MADISON_LEAD_UID,
        contactIdGhl: null,
        eventNameInternal: "lead_created",
        eventNameMeta: "Lead",
        payloadJson: { client_account_id: OTHER_CLIENT },
        receivedAt,
      },
    });

    const timeline = await getLeadTimeline({
      requestId: madison.id,
      clientAccountId: MADISON_CLIENT,
      leadUid: MADISON_LEAD_UID,
      contactIdGhl: MADISON_LEAD_UID,
      phoneE164: SHARED_PHONE,
      email: SHARED_EMAIL,
    });

    assert.ok(timeline);
    assert.equal(timeline.identity.clientAccountId, MADISON_CLIENT);
    assert.equal(timeline.identity.leadUid, MADISON_LEAD_UID);
    assert.equal(timeline.identity.contactIdGhl, null);
    assert.equal(timeline.identity.displayName, "Larry Hughes");
    assert.equal(timeline.currentState.lifecycleStage, null);
    assert.equal(timeline.currentState.routingStatus, null);
    assert.deepEqual(
      timeline.timeline.map((row) => row.id),
      [madison.id, madisonRouted.id]
    );
    assert.equal(timeline.timeline[0]?.eventNameInternal, "lead_created");
    assert.equal(timeline.timeline[0]?.processingStatus, "routing_matched");
    assert.equal(timeline.timeline[0]?.summary, "LeadCapture intake webhook status routing_matched.");
    assert.equal(timeline.timeline[0]?.httpStatus, "200");
    assert.equal(timeline.timeline[0]?.validity, "valid");
    assert.equal(timeline.missingMilestones.includes("lead_created"), true);
    assert.ok(timeline.warnings.some((warning) => warning.includes("No InboundContactIndex")));
    assert.equal(
      timeline.timeline.some((row) => row.id === otherClient.id || row.id === madisonOtherLead.id),
      false
    );

    const byRequestId = await getLeadTimeline({
      requestId: madison.requestId,
      phoneE164: SHARED_PHONE,
      email: SHARED_EMAIL,
      contactIdGhl: MADISON_LEAD_UID,
    });
    assert.ok(byRequestId);
    assert.equal(byRequestId.identity.clientAccountId, MADISON_CLIENT);
    assert.equal(byRequestId.identity.contactIdGhl, null);
    assert.deepEqual(
      byRequestId.timeline.map((row) => row.id),
      [madison.id, madisonRouted.id]
    );

    const otherTimeline = await getLeadTimeline({
      clientAccountId: OTHER_CLIENT,
      leadUid: OTHER_LEAD_UID,
      phoneE164: SHARED_PHONE,
      email: SHARED_EMAIL,
    });
    assert.ok(otherTimeline);
    assert.equal(otherTimeline.identity.clientAccountId, OTHER_CLIENT);
    assert.equal(otherTimeline.identity.leadUid, OTHER_LEAD_UID);
    assert.equal(otherTimeline.identity.contactIdGhl, null);
    assert.deepEqual(
      otherTimeline.timeline.map((row) => row.id),
      [otherClient.id]
    );
  });

  it("resolves a real GHL contact id only inside the requested client", async () => {
    const contactId = "ghl_real_madison_contact";
    const madison = await db.webhookRequestLog.create({
      data: {
        requestId: `${RUN}-ghl-madison`,
        source: "ghl_lifecycle",
        route: "/webhooks/ghl/lifecycle-event",
        processingStatus: "stored",
        httpStatus: 200,
        clientAccountId: MADISON_CLIENT,
        contactIdGhl: contactId,
        eventNameInternal: "lead_created",
        eventUuid: `${RUN}-ghl-madison-evt`,
        requestBodyRedacted: {
          schema_version: "1.0",
          client_account_id: MADISON_CLIENT,
          contact: {
            lead_uid: "madison-ghl-lead",
            contact_id_ghl: contactId,
            first_name: "Real",
            last_name: "Contact",
          },
          state: {},
          event: { event_uuid: `${RUN}-ghl-madison-evt`, event_name_internal: "lead_created" },
        },
      },
    });
    const otherClient = await db.webhookRequestLog.create({
      data: {
        requestId: `${RUN}-ghl-other`,
        source: "ghl_lifecycle",
        route: "/webhooks/ghl/lifecycle-event",
        processingStatus: "stored",
        httpStatus: 200,
        clientAccountId: OTHER_CLIENT,
        contactIdGhl: contactId,
        eventNameInternal: "lead_created",
        eventUuid: `${RUN}-ghl-other-evt`,
        requestBodyRedacted: {
          schema_version: "1.0",
          client_account_id: OTHER_CLIENT,
          contact: {
            lead_uid: "other-ghl-lead",
            contact_id_ghl: contactId,
            first_name: "Other",
            last_name: "Client",
          },
          state: {},
          event: { event_uuid: `${RUN}-ghl-other-evt`, event_name_internal: "lead_created" },
        },
      },
    });

    const timeline = await getLeadTimeline({
      clientAccountId: MADISON_CLIENT,
      contactIdGhl: contactId,
      leadUid: "madison-ghl-lead",
    });
    assert.ok(timeline);
    assert.equal(timeline.identity.contactIdGhl, contactId);
    assert.equal(timeline.identity.clientAccountId, MADISON_CLIENT);
    assert.deepEqual(
      timeline.timeline.map((row) => row.id),
      [madison.id]
    );
    assert.equal(timeline.timeline.some((row) => row.id === otherClient.id), false);
    assert.equal(timeline.missingMilestones.includes("lead_created"), false);

    const synthetic = await getLeadTimeline({
      clientAccountId: MADISON_CLIENT,
      contactIdGhl: MADISON_LEAD_UID,
      leadUid: "madison-ghl-lead",
    });
    assert.ok(synthetic);
    assert.equal(synthetic.identity.contactIdGhl, null);
    assert.equal(synthetic.timeline.some((row) => row.id === madison.id), false);
    assert.equal(synthetic.timeline.some((row) => row.id === otherClient.id), false);
  });
});
