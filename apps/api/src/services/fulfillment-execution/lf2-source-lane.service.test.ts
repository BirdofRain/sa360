import test from "node:test";
import assert from "node:assert/strict";

import { resolveCanonicalSourceLane } from "./lf2-source-lane.service.js";

test("resolveCanonicalSourceLane prefers enrichmentMetadataJson.sourceLane", () => {
  const lane = resolveCanonicalSourceLane({
    sourceProvider: "facebook",
    sourceSystem: "meta_lead_ads",
    enrichmentMetadataJson: { sourceLane: "meta_paid_social" },
  });
  assert.equal(lane, "meta_paid_social");
});

test("resolveCanonicalSourceLane falls back to provider_system composite", () => {
  const lane = resolveCanonicalSourceLane({
    sourceProvider: "manual_import",
    sourceSystem: "external_vendor",
    enrichmentMetadataJson: {},
  });
  assert.equal(lane, "manual_import_external_vendor");
});

test("broad provider name cannot satisfy narrower source-lane allowlist accidentally", () => {
  const broad = resolveCanonicalSourceLane({
    sourceProvider: "facebook",
    sourceSystem: "meta_lead_ads",
    enrichmentMetadataJson: {},
  });
  const narrow = resolveCanonicalSourceLane({
    sourceProvider: "facebook",
    sourceSystem: "meta_lead_ads",
    enrichmentMetadataJson: { sourceLane: "meta_paid_social_vet" },
  });
  assert.notEqual(broad, narrow);
  assert.equal(broad, "facebook_meta_lead_ads");
  assert.equal(narrow, "meta_paid_social_vet");
});
