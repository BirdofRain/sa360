import assert from "node:assert/strict";
import { test } from "node:test";
import type { WebhookRequestLog } from "@prisma/client";

import {
  buildFacebookCaptureSourceIntakeDebug,
  shouldPresentFacebookSourceIntake,
} from "./facebook-capture-webhook-detail.present.js";

test("Zapier and LeadConduit Facebook routes use the source request label", () => {
  assert.equal(
    shouldPresentFacebookSourceIntake({
      source: "facebook_lead_ads",
      route: "/sources/zapier/facebook-lead",
    }),
    true
  );
  assert.equal(
    shouldPresentFacebookSourceIntake({
      source: "facebook_lead_ads",
      route: "/sources/leadconduit/facebook-lead",
      requestBodyRedacted: { object: "page", entry: [] },
    }),
    true
  );
  assert.equal(
    shouldPresentFacebookSourceIntake({
      source: "facebook_lead_ads",
      route: "/sources/facebook/webhook",
      requestBodyRedacted: { object: "page", entry: [{ id: "1" }] },
    }),
    false
  );
  // Direct Meta leadgen callbacks are presented so capture, Graph fetch, and
  // source-client association are visible without a Zapier hop.
  for (const route of ["/sources/facebook/lead-created", "/webhooks/meta/leadgen"]) {
    assert.equal(
      shouldPresentFacebookSourceIntake({
        source: "facebook_lead_ads",
        route,
        requestBodyRedacted: { object: "page", entry: [{ id: "1" }] },
      }),
      true,
      route
    );
  }
});

test("direct Meta notification detail shows Graph fetch state and source client separately from destination", () => {
  const row = {
    id: "wh_meta",
    route: "/sources/facebook/lead-created",
    source: "facebook_lead_ads",
    sourceLeadEventId: "evt_meta",
    normalizedLeadUid: "facebook-meta_lead_ads-900000000000009",
    requestBodyRedacted: {
      object: "page",
      entry: [{ id: "102720336121632", changes: [{ field: "leadgen", value: { leadgen_id: "900000000000009" } }] }],
    },
    responseBodyRedacted: { ok: true, accepted: 1, duplicate: 0, queued: 1 },
  } as unknown as WebhookRequestLog;
  const debug = buildFacebookCaptureSourceIntakeDebug({
    row,
    sourceEvent: {
      id: "evt_meta",
      status: "normalized",
      sourceProvider: "facebook",
      sourceSystem: "meta_lead_ads",
      sourceLeadId: "900000000000009",
      clientAccountIdResolved: "client_pilot",
      routingRuleIdResolved: null,
      destinationLocationIdResolved: null,
      routingDryRunDecisionId: null,
      deliveredAt: null,
      approvedAt: null,
      receivedAt: new Date("2026-10-01T16:00:00.000Z"),
      rawPayloadJson: {
        envelope: { leadgenId: "900000000000009", pageId: "102720336121632", formId: "1149211490298917" },
        lead: { id: "900000000000009", field_data: [] },
      },
      normalizedPayloadJson: {
        schema_version: "sa360.facebook_capture.v1",
        contact: { lead_uid: "facebook-meta_lead_ads-900000000000009", email: "pilot@example.test" },
        source: {
          intake_method: "meta_lead_ads",
          leadgen_id: "900000000000009",
          page_id: "102720336121632",
          form_id: "1149211490298917",
        },
      },
      enrichmentMetadataJson: {
        captureOnly: true,
        captureSettled: true,
        intakeMethod: "meta_lead_ads",
        intakeProvenance: "meta",
        association: {
          outcome: "associated",
          clientAccountId: "client_pilot",
          sourceFunnelId: "funnel_pilot",
          pageId: "102720336121632",
          formId: "1149211490298917",
          explanation: "ok",
        },
        inventory: { thisRequestTracked: false, saleEligible: false, reason: "capture_only_facebook_intake_does_not_track_inventory" },
        delivery: { thisRequestAttempted: false, historicalOutcome: "not_recorded" },
        metaLeadgenFetch: {
          ownerId: "job_1",
          state: "captured",
          jobId: "meta-leadgen-fetch-900000000000009",
          attempt: 1,
          graphOutcome: "success",
          graphStatus: 200,
          tokenScope: "page_bound",
          liveDelivery: false,
          capiDispatched: false,
        },
      },
    } as unknown as import("@prisma/client").SourceLeadEvent,
    responseBody: row.responseBodyRedacted,
  });
  assert.equal(debug.requestPayloadLabel, "Raw Meta leadgen notification");
  assert.equal(debug.sourceAttributes.intake_method, "meta_lead_ads");
  assert.equal(debug.sourceAttributes.page_id, "102720336121632");
  assert.equal(debug.sourceAttributes.form_id, "1149211490298917");
  // Source client is visible; destination stays empty because nothing routed or delivered.
  assert.equal(debug.sourceAttributes.source_client_account_id, "client_pilot");
  assert.equal(debug.destinationClientAccountId, null);
  assert.equal(debug.routing.destination_client_account_id, null);
  assert.equal(debug.routing.matched, false);
  assert.equal(debug.outcomes?.association.outcome, "associated");
  assert.equal(debug.outcomes?.association.client_account_id, "client_pilot");
  assert.equal(debug.outcomes?.capture.queued, "1");
  assert.equal(debug.outcomes?.graphFetch?.state, "captured");
  assert.equal(debug.outcomes?.graphFetch?.graph_outcome, "success");
  assert.equal(debug.outcomes?.graphFetch?.graph_status, "200");
  assert.equal(debug.outcomes?.graphFetch?.token_scope, "page_bound");
  assert.equal(debug.outcomes?.graphFetch?.live_delivery, false);
  assert.equal(debug.outcomes?.delivery.this_request_attempted, false);
  assert.equal(debug.outcomes?.inventory.tracked, false);
  assert.doesNotMatch(JSON.stringify(debug), /access_token|appsecret/i);
});

test("capture detail separates raw request, association, inventory, and delivery", () => {
  const row = {
    id: "wh_1",
    route: "/sources/zapier/facebook-lead",
    sourceLeadEventId: null,
    normalizedLeadUid: null,
    requestBodyRedacted: {
      leadgen_id: "900000000000001",
      first_name: "Sam",
      last_name: "Rivera",
      email: "sam.rivera@example.test",
    },
    responseBodyRedacted: null,
  } as unknown as WebhookRequestLog;
  const debug = buildFacebookCaptureSourceIntakeDebug({
    row,
    sourceEvent: null,
    responseBody: {
      sourceEventId: "evt_1",
      capture: { outcome: "captured", status: "normalized" },
      association: { outcome: "unassociated", explanation: "No confirmed association." },
      inventory: { tracked: false, saleEligible: false },
      delivery: {
        thisRequestAttempted: false,
        historicalOutcome: "not_recorded",
        historicalDeliveredAt: null,
      },
    },
  });
  assert.equal(debug.requestPayloadLabel, "Raw Facebook source request");
  assert.notEqual(debug.requestPayloadLabel, "Lifecycle webhook payload");
  assert.equal(debug.identity.lead_name, "Sam Rivera");
  assert.equal(debug.outcomes?.association.outcome, "unassociated");
  assert.equal(debug.outcomes?.inventory.tracked, false);
  assert.equal(debug.outcomes?.inventory.sale_eligible, false);
  assert.equal(debug.outcomes?.delivery.this_request_attempted, false);
  assert.equal(debug.outcomes?.delivery.historical_outcome, "not_recorded");
  assert.match(debug.outcomes?.associationExplanation ?? "", /No confirmed association/);
});

test("replay presentation keeps historical delivery separate from this request", () => {
  const row = {
    id: "wh_2",
    route: "/sources/zapier/facebook-lead",
    sourceLeadEventId: "evt_delivered",
    normalizedLeadUid: null,
    requestBodyRedacted: { leadgen_id: "900000000000002" },
    responseBodyRedacted: null,
  } as unknown as WebhookRequestLog;
  const debug = buildFacebookCaptureSourceIntakeDebug({
    row,
    sourceEvent: {
      id: "evt_delivered",
      status: "delivered",
      deliveredAt: new Date("2025-11-06T00:00:00.000Z"),
      sourceLeadId: "900000000000002",
      receivedAt: new Date("2025-11-04T16:00:00.000Z"),
      enrichmentMetadataJson: {
        inventory: { tracked: false, saleEligible: false, reason: "capture_only_facebook_intake_does_not_track_inventory" },
        delivery: { thisRequestAttempted: false, historicalOutcome: "not_recorded" },
      },
    } as unknown as import("@prisma/client").SourceLeadEvent,
    responseBody: {
      inventory: {
        tracked: true,
        saleEligible: "not_evaluated",
        reason: "existing_inventory_item_not_modified",
      },
      delivery: {
        thisRequestAttempted: false,
        historicalOutcome: "delivered",
        historicalDeliveredAt: "2025-11-06T00:00:00.000Z",
      },
    },
  });
  assert.equal(debug.outcomes?.delivery.this_request_attempted, false);
  assert.equal(debug.outcomes?.delivery.historical_outcome, "delivered");
  assert.equal(debug.outcomes?.inventory.tracked, true);
  assert.equal(debug.outcomes?.inventory.sale_eligible, "not_evaluated");
});
