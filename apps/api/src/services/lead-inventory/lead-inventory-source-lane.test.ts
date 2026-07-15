import { test } from "node:test";
import assert from "node:assert/strict";

import {
  matchesCanonicalSourceLane,
  narrowProvidersForCanonicalLane,
} from "./lead-inventory-source-lane.js";

test("leadcapture_io lane matches LeadCapture provider events", () => {
  const event = {
    sourceProvider: "leadcapture_io" as const,
    sourceSystem: "leadcapture_io_legacy" as const,
    enrichmentMetadataJson: { sourceLane: "leadcapture_io" },
  };
  assert.deepEqual(narrowProvidersForCanonicalLane("leadcapture_io"), ["leadcapture_io"]);
  assert.equal(matchesCanonicalSourceLane(event, "leadcapture_io"), true);
  assert.equal(matchesCanonicalSourceLane(event, "facebook_meta_lead_ads"), false);
});

test("facebook_meta_lead_ads matches facebook meta lead ads composite lane", () => {
  const event = {
    sourceProvider: "facebook" as const,
    sourceSystem: "meta_lead_ads" as const,
    enrichmentMetadataJson: {},
  };
  assert.deepEqual(narrowProvidersForCanonicalLane("facebook_meta_lead_ads"), ["facebook"]);
  assert.equal(matchesCanonicalSourceLane(event, "facebook_meta_lead_ads"), true);
});

test("facebook_meta_lead_ads does not match unrelated facebook events", () => {
  const event = {
    sourceProvider: "facebook" as const,
    sourceSystem: "meta_lead_ads" as const,
    enrichmentMetadataJson: { sourceLane: "meta_paid_social_vet" },
  };
  assert.equal(matchesCanonicalSourceLane(event, "facebook_meta_lead_ads"), false);
});

test("absent lane accepts otherwise qualifying candidates", () => {
  const event = {
    sourceProvider: "facebook" as const,
    sourceSystem: "meta_lead_ads" as const,
    enrichmentMetadataJson: {},
  };
  assert.equal(matchesCanonicalSourceLane(event, undefined), true);
  assert.equal(narrowProvidersForCanonicalLane(undefined), null);
});
