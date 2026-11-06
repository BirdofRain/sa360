import assert from "node:assert/strict";
import test from "node:test";

import {
  sanitizeSourceResolutionReview,
  sourceResolutionClassificationLabel,
} from "./source-resolution.ts";

test("source resolution labels keep a confirmed owner unresolved", () => {
  assert.match(
    sourceResolutionClassificationLabel("unstamped_confirmed_owner"),
    /Unresolved/
  );
  assert.match(sourceResolutionClassificationLabel("cannot_identify"), /Cannot identify/);
});

test("source resolution sanitizer drops payload fields and keeps identifiers", () => {
  const view = sanitizeSourceResolutionReview({
    readOnly: true,
    writesPerformed: false,
    summary: {
      events: 83,
      byStatus: [{ status: "normalized", events: 81 }],
      settledCaptureOnly: 81,
      unresolvedClient: 83,
      unstampedDespiteConfirmedOwner: 81,
      cannotIdentify: 2,
      invalidSourceIdentifiers: 0,
      unresolvedWithPageFormAndCampaign: 0,
    },
    associations: {
      items: [
        {
          id: "funnel_1",
          pageId: "222591640945329",
          formId: "1977370106440985",
          associationStatus: "confirmed",
          originClientAccountId: "jr_laird",
          suggestedClientAccountId: null,
          ownership: "confirmed",
          createdAt: "2026-11-01T00:00:00.000Z",
          updatedAt: "2026-11-01T00:00:00.000Z",
        },
      ],
      total: 1,
      limit: 25,
      offset: 0,
      truncated: false,
    },
    groups: {
      items: [
        {
          pageId: "222591640945329",
          formId: "1977370106440985",
          campaignId: null,
          unresolvedEvents: 81,
          classification: "unstamped_confirmed_owner",
          confirmedOriginClientAccountId: "jr_laird",
          confirmedSourceFunnelId: "funnel_1",
          sourceFunnelCreatedAt: null,
          sourceFunnelUpdatedAt: null,
          earliestReceivedAt: null,
          latestReceivedAt: null,
          outcomes: { unassociated: 81 },
          explanation: "Settlement recorded unassociated.",
          events: [
            {
              sourceEventId: "evt_1",
              status: "normalized",
              receivedAt: "2026-10-01T00:00:00.000Z",
              normalizedAt: null,
              storedAssociationOutcome: "unassociated",
              email: "person@example.test",
            },
          ],
        },
        {
          pageId: null,
          formId: null,
          campaignId: null,
          unresolvedEvents: 2,
          classification: "cannot_identify",
          confirmedOriginClientAccountId: null,
          explanation: "Cannot match.",
          events: [],
        },
      ],
      total: 2,
      limit: 25,
      offset: 0,
    },
  });
  assert.ok(view);
  assert.equal(view.summary.unstampedDespiteConfirmedOwner, 81);
  assert.equal(view.groups.items[0]?.classification, "unstamped_confirmed_owner");
  assert.equal(view.groups.items[0]?.events[0]?.sourceEventId, "evt_1");
  assert.equal(JSON.stringify(view).includes("person@example.test"), false);
  assert.equal(view.groups.items[1]?.classification, "cannot_identify");
  assert.equal(view.associations.items[0]?.originClientAccountId, "jr_laird");
});

test("source resolution sanitizer rejects a payload-bearing response", () => {
  assert.equal(
    sanitizeSourceResolutionReview({
      readOnly: true,
      writesPerformed: false,
      rawPayloadJson: { email: "person@example.test" },
      summary: { events: 0 },
      associations: { items: [] },
      groups: { items: [] },
    }),
    null
  );
});
