import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { Prisma, type KanbanCard } from "@prisma/client";

import { verifyAdminApiKey } from "../lib/admin-auth.js";
import {
  createKanbanCard,
  getOrSeedKanbanBoard,
  reorderKanbanBoard,
  updateKanbanCard,
  type KanbanCardDto,
} from "../repositories/kanban.repository.js";
import {
  kanbanBoardKeyParamSchema,
  kanbanCardCreateBodySchema,
  kanbanCardIdParamSchema,
  kanbanCardUpdateBodySchema,
  kanbanReorderBodySchema,
} from "../schemas/kanban.schema.js";

/** Mounted by `app.ts` under the same `/admin/v1` prefix as `adminRoutes`. */
export async function adminKanbanRoutes(app: FastifyInstance) {
  const handleGetBoard = async (
    request: FastifyRequest<{ Params: { boardKey: string } }>,
    reply: FastifyReply
  ) => {
    if (!(await verifyAdminApiKey(request, reply))) return;
    const params = kanbanBoardKeyParamSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ ok: false, error: "Invalid boardKey" });
    }
    const board = await getOrSeedKanbanBoard(params.data.boardKey);
    if (!board) {
      return reply.status(404).send({ ok: false, error: "Board not found" });
    }
    return serializeBoard(board);
  };

  const handleUpdateCard = async (
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply
  ) => {
    if (!(await verifyAdminApiKey(request, reply))) return;
    const params = kanbanCardIdParamSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ ok: false, error: "Invalid id" });
    }
    const body = kanbanCardUpdateBodySchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({
        ok: false,
        error: "Invalid body",
        details: body.error.flatten(),
      });
    }

    const patch: Prisma.KanbanCardUpdateInput = {};
    const b = body.data;
    if (b.title !== undefined) patch.title = b.title;
    if (b.description !== undefined) patch.description = b.description;
    if (b.status !== undefined) patch.status = b.status;
    if (b.workstream !== undefined) patch.workstream = b.workstream;
    if (b.priority !== undefined) patch.priority = b.priority;
    if (b.dueDate !== undefined) {
      patch.dueDate = b.dueDate ? new Date(b.dueDate) : null;
    }
    if (b.owner !== undefined) patch.owner = b.owner;
    if (b.blocked !== undefined) patch.blocked = b.blocked;
    if (b.dependencyCount !== undefined) patch.dependencyCount = b.dependencyCount;
    if (b.tags !== undefined) patch.tags = b.tags;
    if (b.acceptanceCriteria !== undefined) {
      patch.acceptanceCriteria =
        b.acceptanceCriteria === null ? Prisma.JsonNull : b.acceptanceCriteria;
    }
    if (b.dependencies !== undefined) {
      patch.dependencies = b.dependencies === null ? Prisma.JsonNull : b.dependencies;
    }
    if (b.notes !== undefined) patch.notes = b.notes;
    if (b.sortOrder !== undefined) patch.sortOrder = b.sortOrder;

    try {
      const card = await updateKanbanCard(params.data.id, patch);
      return serializeCard(card);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Update failed";
      if (msg.includes("Record to update not found")) {
        return reply.status(404).send({ ok: false, error: "Card not found" });
      }
      request.log.error({ err: e }, "kanban.update_card.failed");
      return reply.status(500).send({ ok: false, error: "Update failed" });
    }
  };

  const handleCreateCard = async (request: FastifyRequest, reply: FastifyReply) => {
    if (!(await verifyAdminApiKey(request, reply))) return;
    const body = kanbanCardCreateBodySchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({
        ok: false,
        error: "Invalid body",
        details: body.error.flatten(),
      });
    }
    const b = body.data;
    try {
      const card = await createKanbanCard(b.boardKey, {
        title: b.title,
        description: b.description,
        status: b.status,
        workstream: b.workstream,
        priority: b.priority,
        dueDate: b.dueDate ? new Date(b.dueDate) : undefined,
        owner: b.owner ?? undefined,
        blocked: b.blocked ?? false,
        dependencyCount: b.dependencyCount ?? b.dependencies?.length ?? 0,
        tags: b.tags ?? [],
        acceptanceCriteria: b.acceptanceCriteria ?? undefined,
        dependencies: b.dependencies ?? undefined,
        notes: b.notes ?? undefined,
        sortOrder: b.sortOrder ?? 0,
      });
      return reply.status(201).send(serializeCard(card));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Create failed";
      if (msg.includes("Foreign key") || msg.includes("not found")) {
        return reply.status(404).send({ ok: false, error: "Board not found" });
      }
      request.log.error({ err: e }, "kanban.create_card.failed");
      return reply.status(500).send({ ok: false, error: "Create failed" });
    }
  };

  const handleReorder = async (
    request: FastifyRequest<{ Params: { boardKey: string } }>,
    reply: FastifyReply
  ) => {
    if (!(await verifyAdminApiKey(request, reply))) return;
    const params = kanbanBoardKeyParamSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ ok: false, error: "Invalid boardKey" });
    }
    const body = kanbanReorderBodySchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({
        ok: false,
        error: "Invalid body",
        details: body.error.flatten(),
      });
    }
    try {
      const cards = await reorderKanbanBoard(params.data.boardKey, body.data.items);
      return {
        boardKey: params.data.boardKey,
        cards: cards.map(serializeCardFromRow),
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Reorder failed";
      if (msg.includes("Record to update not found")) {
        return reply.status(404).send({ ok: false, error: "One or more cards not found" });
      }
      request.log.error({ err: e }, "kanban.reorder.failed");
      return reply.status(500).send({ ok: false, error: "Reorder failed" });
    }
  };

  app.get<{ Params: { boardKey: string } }>(
    "/kanban/boards/:boardKey",
    handleGetBoard
  );
  app.put<{ Params: { id: string } }>("/kanban/cards/:id", handleUpdateCard);
  app.post("/kanban/cards", handleCreateCard);
  app.put<{ Params: { boardKey: string } }>(
    "/kanban/boards/:boardKey/reorder",
    handleReorder
  );
}

function serializeBoard(board: {
  boardKey: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  cards: KanbanCardDto[];
}) {
  return {
    boardKey: board.boardKey,
    name: board.name,
    createdAt: board.createdAt.toISOString(),
    updatedAt: board.updatedAt.toISOString(),
    cards: board.cards.map(serializeCard),
  };
}

function serializeCard(c: KanbanCardDto) {
  return {
    id: c.id,
    boardKey: c.boardKey,
    title: c.title,
    description: c.description,
    status: c.status,
    workstream: c.workstream,
    priority: c.priority,
    dueDate: c.dueDate ? c.dueDate.toISOString() : null,
    owner: c.owner,
    blocked: c.blocked,
    dependencyCount: c.dependencyCount,
    tags: c.tags,
    acceptanceCriteria: c.acceptanceCriteria,
    dependencies: c.dependencies,
    notes: c.notes,
    sortOrder: c.sortOrder,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

function serializeCardFromRow(c: KanbanCard) {
  return {
    id: c.id,
    boardKey: c.boardKey,
    title: c.title,
    description: c.description,
    status: c.status,
    workstream: c.workstream,
    priority: c.priority,
    dueDate: c.dueDate ? c.dueDate.toISOString() : null,
    owner: c.owner,
    blocked: c.blocked,
    dependencyCount: c.dependencyCount,
    tags: c.tags,
    acceptanceCriteria: c.acceptanceCriteria,
    dependencies: c.dependencies,
    notes: c.notes,
    sortOrder: c.sortOrder,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}
