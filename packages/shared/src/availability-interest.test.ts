import assert from "node:assert/strict";
import test from "node:test";

import {
  AVAILABILITY_INTEREST_MARKER,
  agedPplFulfillmentBlocker,
  availabilityInterestOfferingLabel,
  campaignTypeToAvailabilityOffering,
  isComingSoonCampaignType,
  mergeAvailabilityInterestIntoNotes,
  parseAvailabilityInterestFromNotes,
  stripAvailabilityInterestFromNotes,
} from "./availability-interest.ts";

test("fresh leads and live transfer map to coming-soon offerings", () => {
  assert.equal(campaignTypeToAvailabilityOffering("Fresh leads"), "fresh_leads");
  assert.equal(campaignTypeToAvailabilityOffering("Live transfer"), "live_transfer");
  assert.equal(campaignTypeToAvailabilityOffering("Aged leads"), null);
  assert.equal(campaignTypeToAvailabilityOffering("Fresh"), null);
  assert.equal(isComingSoonCampaignType("Live transfer"), true);
  assert.equal(availabilityInterestOfferingLabel("fresh_leads"), "Fresh Leads");
  assert.equal(availabilityInterestOfferingLabel("live_transfer"), "Live Transfer");
});

test("interest metadata round-trips and stays out of visible notes", () => {
  const notes = mergeAvailabilityInterestIntoNotes("Please call after 5.", {
    requestedOffering: "fresh_leads",
    notifyWhenAvailable: true,
    capturedAt: "2026-10-05T15:00:00.000Z",
  });
  assert.match(notes, new RegExp(AVAILABILITY_INTEREST_MARKER));
  assert.match(notes, /Please call after 5\./);
  const parsed = parseAvailabilityInterestFromNotes(notes);
  assert.deepEqual(parsed, {
    requestedOffering: "fresh_leads",
    notifyWhenAvailable: true,
    capturedAt: "2026-10-05T15:00:00.000Z",
  });
  const visible = stripAvailabilityInterestFromNotes(notes);
  assert.equal(visible, "Please call after 5.");
  assert.equal(visible.includes(AVAILABILITY_INTEREST_MARKER), false);
  assert.equal(visible.includes("fresh_leads"), false);
});

test("unchecked or malformed interest does not parse", () => {
  assert.equal(
    parseAvailabilityInterestFromNotes(
      `${AVAILABILITY_INTEREST_MARKER} ${JSON.stringify({
        requestedOffering: "fresh_leads",
        notifyWhenAvailable: false,
        capturedAt: "2026-10-05T15:00:00.000Z",
      })}`
    ),
    null
  );
  assert.equal(parseAvailabilityInterestFromNotes("customer note only"), null);
  assert.equal(
    parseAvailabilityInterestFromNotes(
      `${AVAILABILITY_INTEREST_MARKER} ${JSON.stringify({
        requestedOffering: "aged_leads",
        notifyWhenAvailable: true,
      })}`
    ),
    null
  );
});

test("aged fulfillment is blocked for coming-soon campaigns and interest markers", () => {
  assert.equal(
    agedPplFulfillmentBlocker({ campaignType: "Fresh leads", notes: "hello" }),
    "availability_interest_only"
  );
  assert.equal(
    agedPplFulfillmentBlocker({ campaignType: "Live transfer", notes: null }),
    "availability_interest_only"
  );
  assert.equal(
    agedPplFulfillmentBlocker({
      campaignType: "Aged leads",
      notes: mergeAvailabilityInterestIntoNotes("", {
        requestedOffering: "live_transfer",
        notifyWhenAvailable: true,
        capturedAt: "2026-10-05T15:00:00.000Z",
      }),
    }),
    "availability_interest_only"
  );
  assert.equal(
    agedPplFulfillmentBlocker({ campaignType: "Aged leads", notes: "Need Texas coverage" }),
    null
  );
});
