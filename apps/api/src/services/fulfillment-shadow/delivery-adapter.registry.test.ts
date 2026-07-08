import test from "node:test";
import assert from "node:assert/strict";

import {
  getDeliveryAdapter,
  registerDeliveryAdapter,
} from "./delivery-adapter.registry.js";
import { sanitizeDeliveryTargetMetadata } from "../../repositories/delivery-target.repository.js";
import { validateDeliveryTargetMetadata } from "../../lib/delivery-target-metadata.validation.js";

test("adapter registry resolves ghl and mock webhook adapters independently", () => {
  registerDeliveryAdapter({
    adapterKey: "mock.adapter.v1",
    validateTarget: () => ({ ok: true, readinessStatus: "ready_for_shadow" }),
  });
  assert.ok(getDeliveryAdapter("ghl.crm.v1"));
  assert.ok(getDeliveryAdapter("mock.adapter.v1"));
});

test("delivery target presenter strips secret-like metadata keys", () => {
  const sanitized = sanitizeDeliveryTargetMetadata({
    endpointUrl: "https://example.com/hook",
    apiKey: "super-secret",
    refreshToken: "token-value",
  });
  assert.equal(sanitized.endpointUrl, "https://example.com/hook");
  assert.equal(sanitized.apiKey, undefined);
  assert.equal(sanitized.refreshToken, undefined);
});

test("delivery target metadata write validation rejects nested secrets", () => {
  const result = validateDeliveryTargetMetadata({
    endpointUrl: "https://example.com/hook",
    nested: { private_key: "value" },
  });
  assert.equal(result.ok, false);
});

test("alternate adapter registration works without matcher changes", () => {
  registerDeliveryAdapter({
    adapterKey: "sheets.export.v1",
    validateTarget: () => ({ ok: true, readinessStatus: "ready_for_shadow" }),
  });
  assert.ok(getDeliveryAdapter("sheets.export.v1"));
});
