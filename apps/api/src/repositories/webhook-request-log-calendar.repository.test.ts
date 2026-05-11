import test from "node:test";
import assert from "node:assert/strict";
import {
  findLatestLifecycleWebhookBodyForCalendar,
  WEBHOOK_CALENDAR_ALLOWED_PROCESSING_STATUSES,
} from "./webhook-request-log-calendar.repository.js";

test("allowed processing statuses include duplicate_index_refreshed", () => {
  assert.ok(WEBHOOK_CALENDAR_ALLOWED_PROCESSING_STATUSES.includes("duplicate_index_refreshed"));
});

test("findLatestLifecycleWebhookBodyForCalendar returns null without contactIdGhl", async () => {
  const r = await findLatestLifecycleWebhookBodyForCalendar({
    contactIdGhl: "",
    clientAccountId: "ca1",
  });
  assert.equal(r, null);
});

test("findLatestLifecycleWebhookBodyForCalendar returns null without clientAccountId (tenant gate)", async () => {
  const r = await findLatestLifecycleWebhookBodyForCalendar({
    contactIdGhl: "ghl_1",
    clientAccountId: "",
  });
  assert.equal(r, null);
});
