import test from "node:test";
import assert from "node:assert/strict";
import { actionDashboardActionBodySchema } from "./action-dashboard-action.schema.js";

test("rejects missing clientAccountId, contactIdGhl, or actionCode", () => {
  const missingClient = actionDashboardActionBodySchema.safeParse({
    contactIdGhl: "c1",
    actionCode: "CALL_ATTEMPT",
    phoneE164: "+15551234567",
  });
  assert.equal(missingClient.success, false);

  const missingContact = actionDashboardActionBodySchema.safeParse({
    clientAccountId: "client_a",
    actionCode: "CALL_ATTEMPT",
    phoneE164: "+15551234567",
  });
  assert.equal(missingContact.success, false);

  const missingCode = actionDashboardActionBodySchema.safeParse({
    clientAccountId: "client_a",
    contactIdGhl: "c1",
    phoneE164: "+15551234567",
  });
  assert.equal(missingCode.success, false);
});

test("FOLLOW_UP requires followUpDueAt or notes", () => {
  const bad = actionDashboardActionBodySchema.safeParse({
    clientAccountId: "client_a",
    contactIdGhl: "c1",
    phoneE164: "+15551234567",
    actionCode: "FOLLOW_UP",
  });
  assert.equal(bad.success, false);

  const okNotes = actionDashboardActionBodySchema.safeParse({
    clientAccountId: "client_a",
    contactIdGhl: "c1",
    phoneE164: "+15551234567",
    actionCode: "FOLLOW_UP",
    notes: "call back Tuesday",
  });
  assert.equal(okNotes.success, true);

  const okDue = actionDashboardActionBodySchema.safeParse({
    clientAccountId: "client_a",
    contactIdGhl: "c1",
    phoneE164: "+15551234567",
    actionCode: "FOLLOW_UP",
    followUpDueAt: "2026-05-20T14:00:00.000Z",
  });
  assert.equal(okDue.success, true);
});
