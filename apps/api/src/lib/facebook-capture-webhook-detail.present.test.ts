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
      inventory: { tracked: false },
      delivery: { attempted: false, status: "not_attempted" },
    },
  });
  assert.equal(debug.requestPayloadLabel, "Raw Facebook source request");
  assert.notEqual(debug.requestPayloadLabel, "Lifecycle webhook payload");
  assert.equal(debug.identity.lead_name, "Sam Rivera");
  assert.equal(debug.outcomes?.association.outcome, "unassociated");
  assert.equal(debug.outcomes?.inventory.tracked, false);
  assert.equal(debug.outcomes?.delivery.attempted, false);
  assert.match(debug.outcomes?.associationExplanation ?? "", /No confirmed association/);
});
