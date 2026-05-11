import { Prisma, type KanbanCard } from "@prisma/client";
import { prisma } from "../lib/db.js";
import {
  LAUNCH_KANBAN_DEFAULT_BOARD_KEY,
  LAUNCH_KANBAN_DEFAULT_BOARD_NAME,
  getLaunchKanbanSeed,
} from "../lib/launch-kanban-seed.js";

/**
 * Subset of `KanbanCard` returned to clients. Currently every field is included
 * because the dashboard renders all of them; centralizing the shape lets us add
 * computed values (e.g. denormalized owner display) without changing routes.
 */
const cardSelect = {
  id: true,
  boardKey: true,
  title: true,
  description: true,
  status: true,
  workstream: true,
  priority: true,
  dueDate: true,
  owner: true,
  blocked: true,
  dependencyCount: true,
  tags: true,
  acceptanceCriteria: true,
  dependencies: true,
  notes: true,
  sortOrder: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.KanbanCardSelect;

export type KanbanCardDto = Prisma.KanbanCardGetPayload<{ select: typeof cardSelect }>;

export type KanbanBoardDto = {
  boardKey: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  cards: KanbanCardDto[];
};

/**
 * Idempotently fetch a board by key. When the board does not exist (or exists
 * with zero cards AND is the canonical launch board), seed it inside a single
 * transaction so concurrent first-readers don't double-seed.
 */
export async function getOrSeedKanbanBoard(boardKey: string): Promise<KanbanBoardDto | null> {
  const board = await prisma.kanbanBoard.findUnique({
    where: { boardKey },
    include: { cards: { orderBy: [{ status: "asc" }, { sortOrder: "asc" }] } },
  });

  if (board && board.cards.length > 0) {
    return {
      boardKey: board.boardKey,
      name: board.name,
      createdAt: board.createdAt,
      updatedAt: board.updatedAt,
      cards: board.cards,
    };
  }

  if (boardKey !== LAUNCH_KANBAN_DEFAULT_BOARD_KEY) {
    return board
      ? {
          boardKey: board.boardKey,
          name: board.name,
          createdAt: board.createdAt,
          updatedAt: board.updatedAt,
          cards: [],
        }
      : null;
  }

  return seedDefaultLaunchBoard();
}

/**
 * Create the canonical launch board + cards in one transaction. Safe to call
 * concurrently: a unique constraint on `boardKey` ensures only one inserter
 * wins; the loser falls back to a re-fetch.
 */
async function seedDefaultLaunchBoard(): Promise<KanbanBoardDto> {
  try {
    const seed = getLaunchKanbanSeed();
    const sortOrderByStatus = new Map<string, number>();
    const cardCreates = seed.map((c) => {
      const next = (sortOrderByStatus.get(c.status) ?? 0) + 10;
      sortOrderByStatus.set(c.status, next);
      return {
        title: c.title,
        description: c.description,
        status: c.status,
        workstream: c.workstream,
        priority: c.priority,
        dueDate: c.dueDate ?? null,
        owner: c.owner ?? null,
        blocked: c.blocked ?? false,
        dependencyCount: c.dependencyCount ?? c.dependencies?.length ?? 0,
        tags: c.tags ?? [],
        acceptanceCriteria: c.acceptanceCriteria
          ? (c.acceptanceCriteria as Prisma.InputJsonValue)
          : Prisma.JsonNull,
        dependencies: c.dependencies
          ? (c.dependencies as Prisma.InputJsonValue)
          : Prisma.JsonNull,
        notes: c.notes ?? null,
        sortOrder: next,
      } satisfies Omit<Prisma.KanbanCardCreateManyInput, "boardKey">;
    });

    const board = await prisma.$transaction(async (tx) => {
      const created = await tx.kanbanBoard.upsert({
        where: { boardKey: LAUNCH_KANBAN_DEFAULT_BOARD_KEY },
        create: {
          boardKey: LAUNCH_KANBAN_DEFAULT_BOARD_KEY,
          name: LAUNCH_KANBAN_DEFAULT_BOARD_NAME,
        },
        update: {},
      });

      const existing = await tx.kanbanCard.count({
        where: { boardKey: created.boardKey },
      });
      if (existing === 0) {
        await tx.kanbanCard.createMany({
          data: cardCreates.map((c) => ({ ...c, boardKey: created.boardKey })),
        });
      }

      const cards = await tx.kanbanCard.findMany({
        where: { boardKey: created.boardKey },
        select: cardSelect,
        orderBy: [{ status: "asc" }, { sortOrder: "asc" }],
      });

      return { board: created, cards };
    });

    return {
      boardKey: board.board.boardKey,
      name: board.board.name,
      createdAt: board.board.createdAt,
      updatedAt: board.board.updatedAt,
      cards: board.cards,
    };
  } catch (err) {
    // Concurrent seeder won; re-fetch and return.
    const fallback = await prisma.kanbanBoard.findUnique({
      where: { boardKey: LAUNCH_KANBAN_DEFAULT_BOARD_KEY },
      include: { cards: { orderBy: [{ status: "asc" }, { sortOrder: "asc" }] } },
    });
    if (!fallback) throw err;
    return {
      boardKey: fallback.boardKey,
      name: fallback.name,
      createdAt: fallback.createdAt,
      updatedAt: fallback.updatedAt,
      cards: fallback.cards,
    };
  }
}

/** Partial card update. Caller passes only the fields it wants to change. */
export async function updateKanbanCard(
  id: string,
  patch: Prisma.KanbanCardUpdateInput
): Promise<KanbanCardDto> {
  return prisma.kanbanCard.update({
    where: { id },
    data: patch,
    select: cardSelect,
  });
}

export async function createKanbanCard(
  boardKey: string,
  data: Omit<Prisma.KanbanCardCreateInput, "board"> & { boardKey?: never }
): Promise<KanbanCardDto> {
  return prisma.kanbanCard.create({
    data: {
      ...data,
      board: { connect: { boardKey } },
    },
    select: cardSelect,
  });
}

/**
 * Bulk update card status + sortOrder. Used on drag end so the whole board
 * reaches a consistent state in one round trip. Updates run in a transaction;
 * callers receive the refreshed card list for the board.
 */
export async function reorderKanbanBoard(
  boardKey: string,
  items: ReadonlyArray<{ id: string; status: string; sortOrder: number }>
): Promise<KanbanCard[]> {
  await prisma.$transaction(
    items.map((it) =>
      prisma.kanbanCard.update({
        where: { id: it.id },
        data: { status: it.status, sortOrder: it.sortOrder },
      })
    )
  );

  return prisma.kanbanCard.findMany({
    where: { boardKey },
    orderBy: [{ status: "asc" }, { sortOrder: "asc" }],
  });
}
