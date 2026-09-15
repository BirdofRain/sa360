import test from "node:test";
import assert from "node:assert/strict";

import {
  redactDeliveryTargetMetadataForPresentation,
  validateDeliveryTargetMetadata,
} from "./delivery-target-metadata.validation.js";

test("validateDeliveryTargetMetadata rejects nested secret-bearing keys", () => {
  const result = validateDeliveryTargetMetadata({
    endpointUrl: "https://example.com/hook",
    auth: {
      bearerToken: "secret-value",
    },
    headers: [{ api_key: "nested-secret" }],
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.paths.includes("auth.bearerToken"));
    assert.ok(result.paths.includes("headers[0].api_key"));
  }
});

test("validateDeliveryTargetMetadata accepts non-secret nested configuration", () => {
  const result = validateDeliveryTargetMetadata({
    endpointUrl: "https://example.com/hook",
    credentialRefId: "cred_123",
    routing: { locationId: "loc_1" },
  });
  assert.equal(result.ok, true);
});

test("P. validateDeliveryTargetMetadata rejects Google-style secret fields", () => {
  const result = validateDeliveryTargetMetadata({
    accessToken: "...",
    refreshToken: "...",
    clientSecret: "...",
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.paths.includes("accessToken"));
    assert.ok(result.paths.includes("refreshToken"));
    assert.ok(result.paths.includes("clientSecret"));
  }
});

test("validateDeliveryTargetMetadata rejects nested Google-style secret fields", () => {
  const result = validateDeliveryTargetMetadata({
    sheets: { oauth: { accessToken: "...", refreshToken: "...", clientSecret: "..." } },
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.paths.includes("sheets.oauth.accessToken"));
    assert.ok(result.paths.includes("sheets.oauth.refreshToken"));
    assert.ok(result.paths.includes("sheets.oauth.clientSecret"));
  }
});

test("validateDeliveryTargetMetadata accepts Sheets reference metadata without secrets", () => {
  const result = validateDeliveryTargetMetadata({
    connectionRefId: "clxxxxxxxx",
    spreadsheetId: "1abc",
    worksheetId: 0,
    worksheetTitle: "Leads",
    headerSchemaVersion: "sheets_delivery_v1",
    createdBySa360: true,
  });
  assert.equal(result.ok, true);
});

test("redactDeliveryTargetMetadataForPresentation strips nested secret keys", () => {
  const redacted = redactDeliveryTargetMetadataForPresentation({
    endpointUrl: "https://example.com/hook",
    nested: { oauth: { refreshToken: "value" } },
  });
  assert.equal(redacted.endpointUrl, "https://example.com/hook");
  assert.deepEqual(redacted.nested, {});
});
