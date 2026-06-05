import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { verifyAdminApiKey } from "../lib/admin-auth.js";
import {
  supportTicketCreateBodySchema,
  supportTicketIdParamSchema,
  supportTicketListQuerySchema,
  supportTicketUpdateBodySchema,
} from "../schemas/support-ticket.schema.js";
import {
  createSupportTicket,
  getSupportTicketById,
  getSupportTicketStats,
  listSupportTickets,
  serializeSupportTicket,
  serializeSupportTicketSummary,
  updateSupportTicket,
} from "../services/support-ticket.service.js";
import { notifySupportTicketCreated } from "../services/support-ticket-notify.service.js";

async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  return verifyAdminApiKey(request, reply);
}

export async function adminSupportTicketRoutes(app: FastifyInstance) {
  app.get("/support-tickets/stats", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const stats = await getSupportTicketStats();
    return reply.send({ ok: true, stats });
  });

  app.get("/support-tickets", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const parsed = supportTicketListQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: "Invalid query",
        details: parsed.error.flatten(),
      });
    }
    const result = await listSupportTickets(parsed.data);
    return reply.send({
      ok: true,
      count: result.items.length,
      total: result.total,
      page: result.page,
      limit: result.limit,
      items: result.items.map(serializeSupportTicketSummary),
    });
  });

  app.get<{ Params: { id: string } }>("/support-tickets/:id", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const params = supportTicketIdParamSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ ok: false, error: "Invalid id" });
    }
    const row = await getSupportTicketById(params.data.id);
    if (!row) {
      return reply.status(404).send({ ok: false, error: "Ticket not found" });
    }
    return reply.send({ ok: true, ticket: serializeSupportTicket(row) });
  });

  app.post("/support-tickets", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const parsed = supportTicketCreateBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: "Invalid body",
        details: parsed.error.flatten(),
      });
    }
    try {
      const row = await createSupportTicket(parsed.data);
      void notifySupportTicketCreated(row).then((notifyResult) => {
        if (!notifyResult.ok) {
          request.log.warn(
            { ticketId: row.id, ticketNumber: row.ticketNumber, error: notifyResult.error },
            "support_ticket.notify.email_failed"
          );
        } else if (notifyResult.sent) {
          request.log.info(
            { ticketId: row.id, ticketNumber: row.ticketNumber, emailId: notifyResult.emailId },
            "support_ticket.notify.email_sent"
          );
        } else {
          request.log.debug(
            { ticketId: row.id, reason: notifyResult.reason },
            "support_ticket.notify.skipped"
          );
        }
      });
      return reply.status(201).send({
        ok: true,
        ticket: {
          id: row.id,
          ticketNumber: row.ticketNumber,
          status: row.status,
          priority: row.priority,
          category: row.category,
          subject: row.subject,
          createdAt: row.createdAt.toISOString(),
        },
      });
    } catch (e) {
      request.log.error({ err: e }, "support_ticket.create.failed");
      return reply.status(500).send({ ok: false, error: "Failed to create ticket" });
    }
  });

  app.patch<{ Params: { id: string } }>("/support-tickets/:id", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const params = supportTicketIdParamSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ ok: false, error: "Invalid id" });
    }
    const parsed = supportTicketUpdateBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: "Invalid body",
        details: parsed.error.flatten(),
      });
    }
    try {
      const row = await updateSupportTicket(params.data.id, parsed.data);
      if (!row) {
        return reply.status(404).send({ ok: false, error: "Ticket not found" });
      }
      return reply.send({ ok: true, ticket: serializeSupportTicket(row) });
    } catch (e) {
      request.log.error({ err: e }, "support_ticket.update.failed");
      return reply.status(500).send({ ok: false, error: "Failed to update ticket" });
    }
  });
}
