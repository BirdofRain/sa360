import assert from "node:assert/strict";
import test from "node:test";
import type { SupportTicket } from "@prisma/client";

import { isTransactionalEmailConfigured } from "../lib/transactional-email.js";
import {
  DEFAULT_SUPPORT_TICKET_NOTIFY_EMAIL,
  buildSupportTicketCreatedEmail,
  getSupportTicketNotifyEmail,
  isSupportTicketNotifyEnabled,
  notifySupportTicketCreated,
} from "../services/support-ticket-notify.service.js";

const sampleTicket = {
  id: "tkt_1",
  ticketNumber: 42,
  source: "admin_coc",
  status: "OPEN",
  priority: "HIGH",
  category: "BUG",
  subject: "Webhook detail broken",
  description: "The JSON panel is clipped on mobile.",
  requesterName: "Sam",
  requesterEmail: "reporter@example.com",
  requesterUserId: null,
  assignedToName: null,
  assignedToUserId: null,
  clientAccountId: "client_1",
  masterClientAccountId: "master_1",
  subaccountIdGhl: "loc_1",
  relatedEntityType: "WebhookRequestLog",
  relatedEntityId: "wh_1",
  pagePath: "/webhooks",
  pageUrl: "https://coc.example/webhooks?clientAccountId=client_1",
  queryJson: null,
  contextJson: null,
  userAgent: "test",
  internalNotes: null,
  resolutionSummary: null,
  createdAt: new Date("2026-06-04T15:00:00.000Z"),
  updatedAt: new Date("2026-06-04T15:00:00.000Z"),
  closedAt: null,
} satisfies SupportTicket;

test("getSupportTicketNotifyEmail defaults to sam@lifeagentlaunch.com", (t) => {
  const prev = process.env.SUPPORT_TICKET_NOTIFY_EMAIL;
  t.after(() => {
    if (prev === undefined) delete process.env.SUPPORT_TICKET_NOTIFY_EMAIL;
    else process.env.SUPPORT_TICKET_NOTIFY_EMAIL = prev;
  });
  delete process.env.SUPPORT_TICKET_NOTIFY_EMAIL;
  assert.equal(getSupportTicketNotifyEmail(), DEFAULT_SUPPORT_TICKET_NOTIFY_EMAIL);
});

test("buildSupportTicketCreatedEmail includes ticket number and description", () => {
  const { subject, text } = buildSupportTicketCreatedEmail(sampleTicket);
  assert.match(subject, /#42/);
  assert.match(text, /JSON panel is clipped/);
  assert.match(text, /sam@lifeagentlaunch.com|reporter@example.com/);
  assert.match(text, /WebhookRequestLog/);
});

test("notifySupportTicketCreated sends when email transport configured", async (t) => {
  const prevTo = process.env.SUPPORT_TICKET_NOTIFY_EMAIL;
  const prevKey = process.env.RESEND_API_KEY;
  const prevFrom = process.env.SA360_TRANSACTIONAL_EMAIL_FROM;
  t.after(() => {
    if (prevTo === undefined) delete process.env.SUPPORT_TICKET_NOTIFY_EMAIL;
    else process.env.SUPPORT_TICKET_NOTIFY_EMAIL = prevTo;
    if (prevKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = prevKey;
    if (prevFrom === undefined) delete process.env.SA360_TRANSACTIONAL_EMAIL_FROM;
    else process.env.SA360_TRANSACTIONAL_EMAIL_FROM = prevFrom;
  });

  process.env.RESEND_API_KEY = "re_test_key";
  process.env.SA360_TRANSACTIONAL_EMAIL_FROM = "SA360 <notify@lifeagentlaunch.com>";
  assert.equal(isTransactionalEmailConfigured(), true);
  assert.equal(isSupportTicketNotifyEnabled(), true);

  let capturedTo: string | undefined;
  const result = await notifySupportTicketCreated(sampleTicket, {
    send: async (input) => {
      capturedTo = Array.isArray(input.to) ? input.to[0] : input.to;
      return { ok: true, id: "email_123" };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.sent, true);
  assert.equal(capturedTo, DEFAULT_SUPPORT_TICKET_NOTIFY_EMAIL);
});

test("notifySupportTicketCreated skips when notify disabled", async (t) => {
  const prev = process.env.SUPPORT_TICKET_NOTIFY_ENABLED;
  t.after(() => {
    if (prev === undefined) delete process.env.SUPPORT_TICKET_NOTIFY_ENABLED;
    else process.env.SUPPORT_TICKET_NOTIFY_ENABLED = prev;
  });
  process.env.SUPPORT_TICKET_NOTIFY_ENABLED = "false";
  const result = await notifySupportTicketCreated(sampleTicket);
  assert.equal(result.ok, true);
  assert.equal(result.sent, false);
});
