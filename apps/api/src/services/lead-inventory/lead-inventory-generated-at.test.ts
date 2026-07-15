import { test } from "node:test";
import assert from "node:assert/strict";

import { resolveInventoryGeneratedAt } from "./lead-inventory-generated-at.js";

test("resolveInventoryGeneratedAt prefers normalized provider timestamps", () => {
  const result = resolveInventoryGeneratedAt({
    normalizedPayloadJson: { generatedAt: "2026-01-15T12:00:00.000Z" },
    enrichmentMetadataJson: null,
    receivedAt: new Date("2026-02-01T00:00:00.000Z"),
  });
  assert.equal(result.generatedAt?.toISOString(), "2026-01-15T12:00:00.000Z");
  assert.equal(result.source, "normalized_payload");
});

test("resolveInventoryGeneratedAt does not fall back to receivedAt", () => {
  const result = resolveInventoryGeneratedAt({
    normalizedPayloadJson: {},
    enrichmentMetadataJson: null,
    receivedAt: new Date("2026-02-01T00:00:00.000Z"),
  });
  assert.equal(result.generatedAt, null);
  assert.equal(result.source, null);
});

test("resolveInventoryGeneratedAt reads enrichment metadata when normalized missing", () => {
  const result = resolveInventoryGeneratedAt({
    normalizedPayloadJson: null,
    enrichmentMetadataJson: { sourceAttributes: { generated_at: "2026-03-01T08:00:00.000Z" } },
    receivedAt: new Date("2026-03-10T00:00:00.000Z"),
  });
  assert.equal(result.generatedAt?.toISOString(), "2026-03-01T08:00:00.000Z");
  assert.equal(result.source, "enrichment_metadata");
});
