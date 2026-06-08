import type { SupportTicket } from "@prisma/client";

import { sendTransactionalEmail } from "../lib/transactional-email.js";

/** Default inbox for new C.O.C. support tickets. Override with SUPPORT_TICKET_NOTIFY_EMAIL. */
export const DEFAULT_SUPPORT_TICKET_NOTIFY_EMAIL = "sam@lifeagentlaunch.com";

export function getSupportTicketNotifyEmail(): string | null {
  const raw = process.env.SUPPORT_TICKET_NOTIFY_EMAIL?.trim();
  if (raw === "false" || raw === "off" || raw === "0") return null;
  return raw || DEFAULT_SUPPORT_TICKET_NOTIFY_EMAIL;
}

export function isSupportTicketNotifyEnabled(): boolean {
  if (process.env.SUPPORT_TICKET_NOTIFY_ENABLED?.trim().toLowerCase() === "false") {
    return false;
  }
  return Boolean(getSupportTicketNotifyEmail());
}

export function buildSupportTicketCreatedEmail(ticket: SupportTicket): {
  subject: string;
  text: string;
} {
  const subjectLine =
    ticket.subject?.trim() ||
    ticket.description.trim().slice(0, 80) ||
    "New support ticket";

  const lines = [
    `New SA360 Admin C.O.C. support ticket #${ticket.ticketNumber}`,
    "",
    `Status: ${ticket.status}`,
    `Priority: ${ticket.priority}`,
    `Category: ${ticket.category}`,
    "",
    `Subject: ${ticket.subject ?? "(none)"}`,
    "",
    "Description:",
    ticket.description,
    "",
    `Requester: ${ticket.requesterName ?? ticket.requesterEmail ?? "(not provided)"}`,
    ticket.requesterEmail ? `Email: ${ticket.requesterEmail}` : null,
    ticket.clientAccountId ? `Client: ${ticket.clientAccountId}` : null,
    ticket.masterClientAccountId ? `Master client: ${ticket.masterClientAccountId}` : null,
    ticket.subaccountIdGhl ? `GHL location: ${ticket.subaccountIdGhl}` : null,
    ticket.relatedEntityType
      ? `Related: ${ticket.relatedEntityType} · ${ticket.relatedEntityId ?? "—"}`
      : null,
    ticket.pageUrl ? `Page: ${ticket.pageUrl}` : ticket.pagePath ? `Path: ${ticket.pagePath}` : null,
    "",
    `Ticket id: ${ticket.id}`,
    `Created: ${ticket.createdAt.toISOString()}`,
  ].filter((line): line is string => line != null);

  return {
    subject: `[SA360] Ticket #${ticket.ticketNumber}: ${subjectLine}`,
    text: lines.join("\n"),
  };
}

export type NotifySupportTicketCreatedResult =
  | { ok: true; sent: true; emailId?: string }
  | { ok: true; sent: false; reason: string }
  | { ok: false; error: string };

/** Best-effort notify — callers should not fail ticket creation when this errors. */
export async function notifySupportTicketCreated(
  ticket: SupportTicket,
  deps: { send?: typeof sendTransactionalEmail } = {}
): Promise<NotifySupportTicketCreatedResult> {
  if (!isSupportTicketNotifyEnabled()) {
    return { ok: true, sent: false, reason: "Support ticket email notify disabled" };
  }

  const to = getSupportTicketNotifyEmail();
  if (!to) {
    return { ok: true, sent: false, reason: "No notify recipient configured" };
  }

  const send = deps.send ?? sendTransactionalEmail;
  const { subject, text } = buildSupportTicketCreatedEmail(ticket);
  const result = await send({ to, subject, text });

  if (result.ok) {
    return { ok: true, sent: true, emailId: result.id };
  }
  if (result.skipped) {
    return { ok: true, sent: false, reason: result.error };
  }
  return { ok: false, error: result.error };
}
