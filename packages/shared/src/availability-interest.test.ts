import assert from "node:assert/strict";
import test from "node:test";

import {
  AVAILABILITY_INTEREST_MARKER,
  agedPplFulfillmentBlocker,
  availabilityInterestCampaignType,
  availabilityInterestOfferingFromCampaignType,
  availabilityInterestOfferingLabel,
  campaignTypeToAvailabilityOffering,
  isComingSoonCampaignType,
  mergeAvailabilityInterestIntoNotes,
  normalizePublicClientCampaignType,
  parseAvailabilityInterestFromNotes,
  stripAvailabilityInterestFromNotes,
} from "./availability-interest.ts";

test("fresh leads and live transfer map to coming-soon offerings", () => {
  assert.equal(campaignTypeToAvailabilityOffering("Fresh leads"), "fresh_leads");
  assert.equal(campaignTypeToAvailabilityOffering("Live transfer"), "live_transfer");
  assert.equal(campaignTypeToAvailabilityOffering("  fresh-leads "), "fresh_leads");
  assert.equal(campaignTypeToAvailabilityOffering("Aged leads"), null);
  assert.equal(campaignTypeToAvailabilityOffering("aged leads"), null);
  assert.equal(campaignTypeToAvailabilityOffering("Fresh"), null);
  assert.equal(campaignTypeToAvailabilityOffering("Fresh Lead"), null);
  assert.equal(campaignTypeToAvailabilityOffering("Live transfers"), null);
  assert.equal(campaignTypeToAvailabilityOffering("Buy now"), null);
  assert.equal(campaignTypeToAvailabilityOffering("ppl_aged"), null);
  assert.equal(normalizePublicClientCampaignType("aged leads"), "Aged leads");
  assert.equal(normalizePublicClientCampaignType("Aged-leads"), "Aged leads");
  assert.equal(normalizePublicClientCampaignType("availability_interest:fresh_leads"), null);
  assert.equal(isComingSoonCampaignType("Live transfer"), true);
  assert.equal(isComingSoonCampaignType("Fresh-leads"), true);
  assert.equal(isComingSoonCampaignType("Aged leads"), false);
  assert.equal(availabilityInterestOfferingLabel("fresh_leads"), "Fresh Leads");
  assert.equal(availabilityInterestOfferingLabel("live_transfer"), "Live Transfer");
  assert.equal(
    availabilityInterestCampaignType("fresh_leads"),
    "availability_interest:fresh_leads"
  );
  assert.equal(
    availabilityInterestOfferingFromCampaignType("availability_interest:live_transfer"),
    "live_transfer"
  );
  assert.equal(availabilityInterestOfferingFromCampaignType("Fresh leads"), null);
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

test("interest appendix is preserved when customer notes are near the limit", () => {
  const notes = mergeAvailabilityInterestIntoNotes("A".repeat(2000), {
    requestedOffering: "fresh_leads",
    notifyWhenAvailable: true,
    capturedAt: "2026-10-05T15:00:00.000Z",
  });
  assert.ok(notes.length <= 2000);
  assert.equal(
    parseAvailabilityInterestFromNotes(notes)?.requestedOffering,
    "fresh_leads"
  );
  assert.equal(stripAvailabilityInterestFromNotes(notes).includes(AVAILABILITY_INTEREST_MARKER), false);
});

test("aged fulfillment blocks interest sentinels and markers, not legacy campaign labels", () => {
  assert.equal(
    agedPplFulfillmentBlocker({ campaignType: "Fresh leads", notes: "hello" }),
    null
  );
  assert.equal(
    agedPplFulfillmentBlocker({ campaignType: "Live transfer", notes: null }),
    null
  );
  assert.equal(
    agedPplFulfillmentBlocker({
      campaignType: "availability_interest:fresh_leads",
      notes: null,
    }),
    "availability_interest_only"
  );
  assert.equal(
    agedPplFulfillmentBlocker({
      campaignType: "availability_interest:live_transfer",
      notes: "Call after 4",
    }),
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
