import test from "node:test";
import assert from "node:assert/strict";
import { ROUTING_VALIDATION_STATUSES } from "../lib/routing-validation-status.js";
import {
  routingDryRunValidationPatchSchema,
  routingDryRunListQuerySchema,
} from "./routing.schema.js";

test("routingDryRunValidationPatchSchema accepts valid statuses", () => {
  const r = routingDryRunValidationPatchSchema.safeParse({
    validationStatus: "matched_legacy",
    legacyDeliveredClientAccountId: "client_legacy",
    validationNotes: "Matches Zapier row",
  });
  assert.equal(r.success, true);
});

test("routingDryRunValidationPatchSchema accepts every allowed status", () => {
  for (const validationStatus of ROUTING_VALIDATION_STATUSES) {
    const r = routingDryRunValidationPatchSchema.safeParse({ validationStatus });
    assert.equal(r.success, true, validationStatus);
  }
});

test("routingDryRunValidationPatchSchema rejects invalid status", () => {
  const r = routingDryRunValidationPatchSchema.safeParse({
    validationStatus: "totally_invalid",
  });
  assert.equal(r.success, false);
});

test("routingDryRunListQuerySchema accepts reviewQueue filter", () => {
  const r = routingDryRunListQuerySchema.safeParse({
    masterClientAccountId: "master_1",
    reviewQueue: "matched_no_plan",
  });
  assert.equal(r.success, true);
  if (r.success) assert.equal(r.data.reviewQueue, "matched_no_plan");
});

test("routingDryRunListQuerySchema accepts validationStatus filter", () => {
  const r = routingDryRunListQuerySchema.safeParse({
    masterClientAccountId: "master_1",
    validationStatus: "mismatch",
  });
  assert.equal(r.success, true);
  if (r.success) assert.equal(r.data.validationStatus, "mismatch");
});

test("routingDryRunListQuerySchema parses cleanup filters", () => {
  const r = routingDryRunListQuerySchema.safeParse({
    includeCleanup: "true",
    cleanupStatus: "INCOMPLETE_MISSING_CLIENT_AND_NAME",
  });
  assert.equal(r.success, true);
  if (r.success) {
    assert.equal(r.data.includeCleanup, true);
    assert.equal(r.data.cleanupStatus, "INCOMPLETE_MISSING_CLIENT_AND_NAME");
  }
});
