import assert from "node:assert/strict";
import test from "node:test";

import {
  formatPortalInventorySelectionSummary,
  parsePortalInventoryMapPayload,
  portalInventoryMapFill,
  portalInventoryMapFreshnessLabel,
  portalInventoryMapIsEmpty,
  portalInventoryMapRequestPath,
  portalInventoryMapTone,
  summarizePortalInventorySelection,
} from "./portal-inventory-map.ts";

function apiEnvelope() {
  return {
    ok: true,
    availability: {
      catalogScope: "global_lal_inventory",
      advisory: true,
      filters: { nicheKey: "vet", productType: null },
      evaluatedAt: "2026-10-05T12:00:00.000Z",
      dataStatus: "live",
      states: [
        { stateCode: "TX", availabilityLabel: "Available" },
        { stateCode: "nc", availabilityLabel: "Limited" },
        { stateCode: "WY", availabilityLabel: "Currently unavailable" },
        { stateCode: "ZZ", availabilityLabel: "Available" },
        { stateCode: "FL", availabilityLabel: "Plenty" },
        { stateCode: "TX", availabilityLabel: "Limited" },
      ],
      summary: { Available: 99, Limited: 99, "Currently unavailable": 99 },
    },
  };
}

test("parses the API envelope, drops unknown states/labels, and recomputes summary", () => {
  const model = parsePortalInventoryMapPayload(apiEnvelope());
  assert.ok(model);
  assert.equal(model.dataStatus, "live");
  assert.equal(model.nicheKey, "vet");
  assert.equal(model.productType, null);
  assert.equal(model.evaluatedAt, "2026-10-05T12:00:00.000Z");
  assert.deepEqual(model.states, {
    TX: "Available",
    NC: "Limited",
    WY: "Currently unavailable",
  });
  assert.deepEqual(model.summary, { Available: 1, Limited: 1, "Currently unavailable": 1 });
  assert.equal(portalInventoryMapIsEmpty(model), false);
});

test("accepts the bare availability object too", () => {
  const model = parsePortalInventoryMapPayload(apiEnvelope().availability);
  assert.equal(model?.states.TX, "Available");
});

test("parsing is idempotent: the BFF forwards the normalized model and the browser re-parses it", () => {
  const fromApi = parsePortalInventoryMapPayload(apiEnvelope());
  assert.ok(fromApi);
  const bffBody = JSON.parse(JSON.stringify({ ok: true, availability: fromApi })) as unknown;
  const roundTripped = parsePortalInventoryMapPayload(bffBody);
  assert.deepEqual(roundTripped, fromApi);
  assert.equal(roundTripped?.nicheKey, "vet");
  assert.equal(roundTripped?.summary.Available, 1);
  assert.equal(portalInventoryMapIsEmpty(roundTripped!), false);
});

test("unavailable payloads carry no states and read as unknown", () => {
  const model = parsePortalInventoryMapPayload({
    ok: true,
    availability: {
      dataStatus: "unavailable",
      evaluatedAt: "2026-10-05T12:00:00.000Z",
      states: [{ stateCode: "TX", availabilityLabel: "Available" }],
    },
  });
  assert.ok(model);
  assert.equal(model.dataStatus, "unavailable");
  assert.deepEqual(model.states, {});
  assert.equal(portalInventoryMapTone(model, "TX"), "unknown");
  assert.equal(portalInventoryMapIsEmpty(model), false);
});

test("garbage payloads return null", () => {
  assert.equal(parsePortalInventoryMapPayload(null), null);
  assert.equal(parsePortalInventoryMapPayload("nope"), null);
  assert.equal(parsePortalInventoryMapPayload([1, 2]), null);
});

test("empty live map is detected", () => {
  const model = parsePortalInventoryMapPayload({
    dataStatus: "live",
    states: [{ stateCode: "TX", availabilityLabel: "Currently unavailable" }],
  });
  assert.ok(model);
  assert.equal(portalInventoryMapIsEmpty(model), true);
});

test("tone and fill fall back to unknown for missing data", () => {
  const model = parsePortalInventoryMapPayload(apiEnvelope());
  assert.equal(portalInventoryMapTone(model, "TX"), "Available");
  assert.equal(portalInventoryMapTone(model, "CA"), "unknown");
  assert.equal(portalInventoryMapTone(model, "ZZ"), "unknown");
  assert.equal(portalInventoryMapTone(null, "TX"), "unknown");
  assert.equal(portalInventoryMapFill("unknown"), "url(#portal-map-unknown)");
  assert.notEqual(portalInventoryMapFill("Available"), portalInventoryMapFill("Limited"));
});

test("request path only forwards niche and product type", () => {
  assert.equal(portalInventoryMapRequestPath({}), "/api/client-portal/inventory-map");
  assert.equal(
    portalInventoryMapRequestPath({ nicheKey: " vet ", productType: "exclusive" }),
    "/api/client-portal/inventory-map?nicheKey=vet&productType=exclusive"
  );
});

test("freshness label is relative and tolerant", () => {
  const now = new Date("2026-10-05T12:30:00.000Z");
  assert.equal(portalInventoryMapFreshnessLabel(null, now), null);
  assert.equal(portalInventoryMapFreshnessLabel("not a date", now), null);
  assert.equal(portalInventoryMapFreshnessLabel("2026-10-05T12:29:40.000Z", now), "Checked just now");
  assert.equal(portalInventoryMapFreshnessLabel("2026-10-05T12:00:00.000Z", now), "Checked 30 min ago");
  assert.equal(portalInventoryMapFreshnessLabel("2026-10-05T09:00:00.000Z", now), "Checked 3 hr ago");
});

test("selection summary counts states per bucket", () => {
  const model = parsePortalInventoryMapPayload(apiEnvelope());
  const summary = summarizePortalInventorySelection(model, ["TX", "NC", "WY", "CA"]);
  assert.deepEqual(summary, {
    Available: 1,
    Limited: 1,
    "Currently unavailable": 1,
    unknown: 1,
  });
  assert.equal(
    formatPortalInventorySelectionSummary(summary),
    "1 available · 1 limited · 1 currently unavailable · 1 unknown"
  );
  assert.equal(
    formatPortalInventorySelectionSummary(summarizePortalInventorySelection(model, [])),
    null
  );
});
