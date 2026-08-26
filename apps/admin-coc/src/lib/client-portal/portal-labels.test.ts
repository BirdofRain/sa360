import test from "node:test";
import assert from "node:assert/strict";

import { formatPortalDisplayLabel, formatPortalDisplayValue } from "./portal-labels.ts";

test("known domain labels use explicit customer-facing mappings", () => {
  assert.equal(formatPortalDisplayLabel("vet"), "Veteran");
  assert.equal(formatPortalDisplayLabel("VET"), "Veteran");
  assert.equal(formatPortalDisplayLabel("exclusive"), "Exclusive");
  assert.equal(formatPortalDisplayLabel("aged"), "Aged");
  assert.equal(formatPortalDisplayLabel("ghl"), "GHL");
  assert.equal(formatPortalDisplayLabel("ghl_pro"), "GHL Pro");
  assert.equal(formatPortalDisplayLabel("ghl pro"), "GHL Pro");
  assert.equal(formatPortalDisplayLabel("weekly"), "Weekly");
  assert.equal(formatPortalDisplayLabel("appointment_set"), "Appointment set");
  assert.equal(formatPortalDisplayLabel("lead_delivered"), "Delivered");
});

test("compound source labels join mapped tokens", () => {
  assert.equal(formatPortalDisplayLabel("meta · form"), "Meta Form");
  assert.equal(formatPortalDisplayLabel("web · form"), "Web Form");
  assert.equal(formatPortalDisplayLabel("meta|form"), "Meta Form");
});

test("already-formatted known labels stay idempotent", () => {
  assert.equal(formatPortalDisplayLabel("Veteran"), "Veteran");
  assert.equal(formatPortalDisplayLabel("Appointment set"), "Appointment set");
  assert.equal(formatPortalDisplayLabel("GHL"), "GHL");
  assert.equal(formatPortalDisplayLabel("Meta Form"), "Meta Form");
});

test("unknown labels degrade safely without crashing", () => {
  assert.equal(formatPortalDisplayLabel("xyzzy_foo"), "Xyzzy foo");
  assert.equal(formatPortalDisplayLabel("needs_attention"), "Needs attention");
  assert.equal(formatPortalDisplayLabel(""), "");
  assert.equal(formatPortalDisplayLabel("—"), "—");
  assert.equal(formatPortalDisplayLabel(undefined), "");
  assert.equal(formatPortalDisplayLabel(null), "");
  assert.equal(formatPortalDisplayLabel(42), "");
  assert.equal(formatPortalDisplayValue("—"), null);
  assert.equal(formatPortalDisplayValue(""), null);
  assert.equal(formatPortalDisplayValue("vet"), "Veteran");
  assert.equal(
    formatPortalDisplayLabel("2026-08-20T10:00:00.000Z"),
    "2026-08-20T10:00:00.000Z"
  );
});
