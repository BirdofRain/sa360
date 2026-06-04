"use server";

import {
  createAdminSupportTicket,
  fetchAdminSupportTicketById,
  updateAdminSupportTicket,
} from "@/lib/admin-api/support-tickets-server";
import type {
  SupportTicketCreateInput,
  SupportTicketDetail,
  SupportTicketUpdateInput,
} from "@/lib/support-tickets/types";

export type CreateSupportTicketActionResult =
  | { ok: true; ticketNumber: number; id: string }
  | { ok: false; error: string };

export async function createSupportTicketAction(
  body: SupportTicketCreateInput
): Promise<CreateSupportTicketActionResult> {
  const description = body.description?.trim();
  if (!description) {
    return { ok: false, error: "Please describe what’s going on." };
  }
  const res = await createAdminSupportTicket({ ...body, description });
  if (!res.ok || !res.ticket) {
    return { ok: false, error: res.error ?? "Could not create ticket." };
  }
  return { ok: true, ticketNumber: res.ticket.ticketNumber, id: res.ticket.id };
}

export type UpdateSupportTicketActionResult =
  | { ok: true; ticket: SupportTicketDetail }
  | { ok: false; error: string };

export async function updateSupportTicketAction(
  id: string,
  body: SupportTicketUpdateInput
): Promise<UpdateSupportTicketActionResult> {
  const res = await updateAdminSupportTicket(id, body);
  if (!res.ok || !res.ticket) {
    return { ok: false, error: res.error ?? "Could not update ticket." };
  }
  return { ok: true, ticket: res.ticket };
}

export type GetSupportTicketActionResult =
  | { ok: true; ticket: SupportTicketDetail }
  | { ok: false; error: string };

export async function getSupportTicketAction(id: string): Promise<GetSupportTicketActionResult> {
  const res = await fetchAdminSupportTicketById(id);
  if (!res.ticket) {
    return { ok: false, error: res.error ?? "Ticket not found." };
  }
  return { ok: true, ticket: res.ticket };
}
