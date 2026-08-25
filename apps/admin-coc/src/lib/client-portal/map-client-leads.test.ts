import test from "node:test";
import assert from "node:assert/strict";

import {
  mapClientLeadDeliveryRow,
  mapClientLeadDeliveryRows,
  portalDeliveryStatusLabel,
  portalDeliveryStatusTone,
} from "./map-client-leads.ts";

test("maps client lead-delivery rows and ignores items without ids", () => {
  const rows = mapClientLeadDeliveryRows([
    {
      id: "lead_1",
      leadName: "Alex P.",
      phoneMasked: "(•••) •••-1212",
      campaignName: "Vet Q2",
      sourcePlatform: "meta",
      sourceType: "form",
      deliveryStatus: "delivered",
      receivedAt: "2026-08-20T10:00:00.000Z",
      lastEventName: "lead_delivered",
      appointmentStatus: "set",
    },
    { leadName: "Missing id" },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].campaign, "Vet Q2");
  assert.equal(rows[0].sourceLabel, "meta · form");
  assert.equal(rows[0].deliveryLabel, "Delivered");
});

test("uses leadUid when id is absent", () => {
  const row = mapClientLeadDeliveryRow({
    leadUid: "uid_9",
    deliveryStatus: "failed",
  });
  assert.equal(row?.id, "uid_9");
  assert.equal(row?.leadName, "Lead");
  assert.equal(row?.deliveryLabel, "Failed");
});

test("delivery status labels stay customer-facing", () => {
  assert.equal(portalDeliveryStatusLabel("in_progress"), "In progress");
  assert.equal(portalDeliveryStatusTone("delivered"), "good");
  assert.equal(portalDeliveryStatusTone("failed"), "bad");
});
