import assert from "node:assert/strict";
import test from "node:test";

import { CAPTURED_TEST_DELIVERY_CLASS } from "./captured-test-delivery.js";
import { COMPANY_SHEETS_CANARY_SCHEMA_VERSION } from "../../lib/company-google-sheets-env.js";
import { COMPANY_SHEETS_V3_HEADER } from "@sa360/shared";
import { isGhlWriteTransportAllowed } from "../ghl-delivery-adapter/ghl-delivery-disabled-transport.js";
import { createFailClosedGhlPort, createFailClosedSheetsAppend, refuseSheets } from "./onboarding-execution-binding.js";

const sheetRequest = {
  kind: "onboarding_captured_test" as const,
  idempotencyKey: "onboarding-test:run:sheets",
  deliveryRowId: "onboarding-test:run:sheets",
  sourceLeadEventId: "evt",
  clientAccountId: "client_a",
  spreadsheetId: "sheet_1",
  worksheetId: 4,
  worksheetTitle: "Canary",
  worksheetRole: "canary" as const,
  schemaVersion: COMPANY_SHEETS_CANARY_SCHEMA_VERSION,
  values: Array.from({ length: 35 }, () => "x"),
  testRunId: "run",
  sa360DeliveryClass: CAPTURED_TEST_DELIVERY_CLASS,
};

test("a 35-cell campaign row is refused before any sheets call when the target is Canary", async () => {
  const port = createFailClosedSheetsAppend();
  const outcome = await port.append(sheetRequest);
  assert.equal(outcome.status, "failed");
  assert.equal(outcome.externalCallExecuted, false);
  assert.equal(outcome.error, "canary_schema_mismatch");
  assert.equal(port.calls.length, 0);
});

test("the fail-closed sheets port does not record a refused exact-v3 append", () => {
  const outcome = refuseSheets({
    ...sheetRequest,
    worksheetId: 9,
    worksheetTitle: "Approved Test",
    worksheetRole: "campaign",
    schemaVersion: "company_sheets_campaign_v3",
    values: Array.from({ length: COMPANY_SHEETS_V3_HEADER.length }, () => ""),
  });
  assert.equal(outcome.externalCallExecuted, false);
  assert.equal(outcome.status, "failed");
});

test("the fail-closed GHL port does not call the network", async () => {
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("live fetch");
  };
  try {
    const port = createFailClosedGhlPort(calls);
    const contact = await port.upsertContact({
      idempotencyKey: "onboarding-test:run:ghl-contact",
      locationId: "loc",
      sourceLeadEventId: "evt",
      testRunId: "run",
      email: null,
      phone: null,
      firstName: null,
      lastName: null,
      sa360DeliveryClass: CAPTURED_TEST_DELIVERY_CLASS,
      sa360TestRunId: "run",
    });
    assert.equal(isGhlWriteTransportAllowed(), false);
    assert.equal(contact.externalCallExecuted, false);
    assert.equal(contact.error, "ghl_write_transport_disabled");
    assert.equal(calls.length, 0);
  } finally {
    globalThis.fetch = original;
  }
});
