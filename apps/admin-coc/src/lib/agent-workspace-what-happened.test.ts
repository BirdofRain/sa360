import test from "node:test";
import assert from "node:assert/strict";
import {
  buildWhatHappenedRequestBody,
  formatWhatHappenedApiError,
  resolveWhatHappenedContactIdentity,
  WHAT_HAPPENED_OUTCOME_OPTIONS,
} from "./agent-workspace-what-happened.ts";
import { isoToDateOnlyInputValue } from "./date-local.ts";

test("resolveWhatHappenedContactIdentity: no URL ids cannot submit", () => {
  const r = resolveWhatHappenedContactIdentity({});
  assert.equal(r.canSubmit, false);
  assert.equal(r.contactIdGhl, undefined);
});

test("contactId URL maps to contactIdGhl in body", () => {
  const built = buildWhatHappenedRequestBody({
    clientAccountId: "c1",
    locationId: "loc1",
    contactIdFromUrl: "ghl-contact-99",
    outcome: "no_answer",
    notes: "test",
  });
  assert.equal(built.ok, true);
  if (!built.ok) return;
  assert.equal(built.body.contactIdGhl, "ghl-contact-99");
  assert.equal(built.body.outcome, "no_answer");
  assert.equal(built.body.clientAccountId, "c1");
  assert.equal(built.body.locationId, "loc1");
  assert.equal(built.body.notes, "test");
  assert.equal(built.body.leadUid, undefined);
});

test("build rejects missing contact identity", () => {
  const built = buildWhatHappenedRequestBody({
    clientAccountId: "c1",
    outcome: "no_answer",
  });
  assert.equal(built.ok, false);
});

test("outcome options use API enum values not display labels", () => {
  for (const o of WHAT_HAPPENED_OUTCOME_OPTIONS) {
    assert.match(o.value, /^[a-z_]+$/);
    assert.notEqual(o.value, o.label);
  }
  const built = buildWhatHappenedRequestBody({
    clientAccountId: "c1",
    contactIdFromUrl: "x",
    outcome: "no_answer",
  });
  assert.equal(built.ok, true);
  if (built.ok) assert.equal(built.body.outcome, "no_answer");
});

test("invalid display label is not accepted as outcome", () => {
  const built = buildWhatHappenedRequestBody({
    clientAccountId: "c1",
    contactIdFromUrl: "x",
    outcome: "No answer",
  });
  assert.equal(built.ok, false);
});

test("metadata includes GHL appointment/policy strings when set", () => {
  const built = buildWhatHappenedRequestBody({
    clientAccountId: "c1",
    contactIdFromUrl: "x",
    outcome: "no_answer",
    appointmentStatusMetadata: "Set",
    policyStatusMetadata: "Pending",
    followUpDate: "2026-06-01",
  });
  assert.equal(built.ok, true);
  if (!built.ok) return;
  assert.equal(built.body.metadata?.sa360_appointment_status, "Set");
  assert.equal(built.body.metadata?.sa360_policy_status, "Pending");
  assert.ok(typeof built.body.metadata?.nextFollowUpAt === "string");
  assert.equal(
    isoToDateOnlyInputValue(String(built.body.metadata?.nextFollowUpAt)),
    "2026-06-01"
  );
});

test("formatWhatHappenedApiError: missing contact", () => {
  const msg = formatWhatHappenedApiError(400, {
    error: "Invalid body",
    details: {
      fieldErrors: { contactIdGhl: ["contactIdGhl or leadUid is required"] },
      formErrors: [],
    },
  });
  assert.match(msg, /Missing contact context/i);
});
