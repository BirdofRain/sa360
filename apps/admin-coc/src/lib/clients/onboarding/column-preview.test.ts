import assert from "node:assert/strict";
import test from "node:test";

import { projectStoredLeadColumnPreview, projectStoredLeadPreviewList } from "./column-preview.ts";

const lead = {
  id: "evt_new",
  receivedAt: "2026-10-26T15:04:00.000Z",
  sourceProvider: "leadcapture_io",
  sourceSystem: "leadcapture_io_nextgen",
  sourceType: "webhook",
  label: "10/26/2026 · a***@example.invalid",
  normalizedPayloadJson: { contact: { email: "secret-payload@example.invalid" } },
};

test("the preview projector drops payloads and refuses a delivery-ready claim", () => {
  const projected = projectStoredLeadColumnPreview({
    ok: true,
    previewOnly: true,
    deliveryReady: false,
    presentAsDeliveryReady: false,
    googleHeaderIndependentlyReread: false,
    writes: false,
    persisted: false,
    externalCalls: { sheets: false, ghl: false },
    basis: "published",
    publishedMapUnchanged: true,
    reasons: ["google_header_not_reread"],
    map: {
      id: "map_1",
      status: "published",
      revision: 2,
      spreadsheetId: "sheet",
      worksheetId: 15,
      headerFingerprint: "abc",
      headerFingerprintMatchesBinding: true,
    },
    lead,
    columns: [
      {
        columnLetter: "A",
        position: 1,
        sheetHeader: "Email",
        sourceField: "email",
        sourceHeader: "Email",
        formattedValue: "ada.preview.distinct@example.invalid",
        appended: true,
        warnings: [],
      },
    ],
    operatorDecisions: [{ code: "primary_concern_not_replaced", message: "Operator decision." }],
    rawPayloadJson: { token: "sekret" },
    normalizedPayloadJson: lead.normalizedPayloadJson,
  });
  assert.ok(projected);
  const body = JSON.stringify(projected);
  assert.equal(body.includes("sekret"), false);
  assert.equal(body.includes("secret-payload"), false);
  assert.equal(projected?.deliveryReady, false);
  assert.equal(projectStoredLeadColumnPreview({ ...projected, deliveryReady: true }), null);
  const listed = projectStoredLeadPreviewList({ ok: true, leads: [lead], nextCursor: null, rawPayloadJson: { token: "sekret" } });
  assert.equal(JSON.stringify(listed).includes("sekret"), false);
  assert.equal(JSON.stringify(listed).includes("secret-payload"), false);
});
