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
