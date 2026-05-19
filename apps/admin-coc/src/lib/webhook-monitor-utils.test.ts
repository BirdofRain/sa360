import test from "node:test";
import assert from "node:assert/strict";
import type { AdminWebhookListItem } from "@/lib/admin-api/types";
import {
  filterWebhookRowsHideErrors,
  isInvalidWebhookRow,
  isWebhookErrorRow,
  sortWebhookRowsByReceivedAt,
} from "./webhook-monitor-utils.ts";

function row(
  partial: Pick<AdminWebhookListItem, "id" | "receivedAt" | "processingStatus">
): AdminWebhookListItem {
  return {
    id: partial.id,
    requestId: partial.id,
    receivedAt: partial.receivedAt,
    processingStatus: partial.processingStatus,
    source: "ghl_lifecycle",
    route: "/webhooks/ghl/lifecycle-event",
    httpStatus: 200,
    durationMs: 10,
    clientAccountId: "demo",
    leadName: null,
    leadFirstName: null,
    leadLastName: null,
    leadPhone: null,
    leadEmail: null,
    subaccountIdGhl: null,
    contactIdGhl: null,
    eventUuid: null,
    eventNameInternal: null,
    errorCode: null,
    errorSummary: null,
  };
}

test("default table order is newest first (receivedAt DESC)", () => {
  const items = [
    row({ id: "old", receivedAt: "2026-05-18T10:00:00.000Z", processingStatus: "stored" }),
    row({ id: "new", receivedAt: "2026-05-18T12:00:00.000Z", processingStatus: "stored" }),
    row({ id: "mid", receivedAt: "2026-05-18T11:00:00.000Z", processingStatus: "stored" }),
  ];
  const sorted = sortWebhookRowsByReceivedAt(items, "desc");
  assert.deepEqual(sorted.map((r) => r.id), ["new", "mid", "old"]);
});

test("error rows are not pinned above newer stored rows", () => {
  const items = [
    row({
      id: "err-old",
      receivedAt: "2026-05-18T09:00:00.000Z",
      processingStatus: "unauthorized",
    }),
    row({
      id: "ok-new",
      receivedAt: "2026-05-18T12:00:00.000Z",
      processingStatus: "stored",
    }),
    row({
      id: "err-new",
      receivedAt: "2026-05-18T11:00:00.000Z",
      processingStatus: "validation_failed",
    }),
  ];
  const sorted = sortWebhookRowsByReceivedAt(items, "desc");
  assert.equal(sorted[0]?.id, "ok-new");
  assert.equal(sorted[1]?.id, "err-new");
  assert.equal(sorted[2]?.id, "err-old");
});

test("hide errors removes unauthorized and validation_failed rows", () => {
  const items = [
    row({ id: "1", receivedAt: "2026-05-18T12:00:00.000Z", processingStatus: "stored" }),
    row({ id: "2", receivedAt: "2026-05-18T11:00:00.000Z", processingStatus: "unauthorized" }),
    row({ id: "3", receivedAt: "2026-05-18T10:00:00.000Z", processingStatus: "validation_failed" }),
    row({ id: "4", receivedAt: "2026-05-18T09:00:00.000Z", processingStatus: "failed" }),
  ];
  const out = filterWebhookRowsHideErrors(items);
  assert.deepEqual(out.map((r) => r.id), ["1"]);
});

test("isInvalidWebhookRow and isWebhookErrorRow align with badges", () => {
  assert.equal(isInvalidWebhookRow("unauthorized"), true);
  assert.equal(isInvalidWebhookRow("validation_failed"), true);
  assert.equal(isInvalidWebhookRow("stored"), false);
  assert.equal(isWebhookErrorRow("error"), true);
  assert.equal(isWebhookErrorRow("stored"), false);
});
