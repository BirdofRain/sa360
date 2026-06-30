import { Prisma, type KanbanCard } from "@prisma/client";
import { prisma } from "../lib/db.js";
import {
  LAUNCH_KANBAN_DEFAULT_BOARD_KEY,
  LAUNCH_KANBAN_DEFAULT_BOARD_NAME,
  getLaunchKanbanSeed,
  type LaunchKanbanSeedCard,
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

export type KanbanSeedSyncResult = {
  boardKey: string;
  boardName: string;
  dryRun: boolean;
  totals: {
    seedCards: number;
    created: number;
    updated: number;
    skipped: number;
    deprecated: number;
  };
  created: Array<{ seedId: string; title: string; status: string; workstream: string }>;
  updated: Array<{
    seedId: string;
    cardId: string;
    title: string;
    preservedStatus: string;
    changedFields: string[];
  }>;
  skipped: Array<{ seedId: string; cardId: string; title: string; status: string }>;
  deprecated: Array<{ cardId: string; title: string; status: string; workstream: string }>;
};

type SyncSeedOptions = {
  dryRun?: boolean;
  preserveCardStatus?: boolean;
};

const LAUNCH_SEED_TAG_PREFIX = "seed:";

function launchSeedTag(seedId: string): string {
  return `${LAUNCH_SEED_TAG_PREFIX}${seedId}`;
}

function normalizeSeedTags(tags: string[] | null | undefined, seedId: string): string[] {
  const merged = new Set<string>(tags ?? []);
  merged.add(launchSeedTag(seedId));
  merged.add("launch-planning");
  return [...merged];
}

function nextSortOrderByStatus(cards: KanbanCard[], status: string): number {
  const max = cards
    .filter((c) => c.status === status)
    .reduce((acc, c) => Math.max(acc, c.sortOrder), 0);
  return max + 10;
}

function normalizeTitle(value: string): string {
  return value.trim().toLowerCase();
}

function toJsonOrNull(
  value: string[] | null | undefined
): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return value ? (value as Prisma.InputJsonValue) : Prisma.JsonNull;
}

type SeedSyncPlannedCreate = {
  seedId: string;
  title: string;
  status: string;
  workstream: string;
  data: Omit<Prisma.KanbanCardCreateManyInput, "boardKey">;
};

type SeedSyncPlannedUpdate = {
  seedId: string;
  cardId: string;
  title: string;
  preservedStatus: string;
  changedFields: string[];
  data: Prisma.KanbanCardUpdateInput;
};

type SeedSyncPlannedSkip = {
  seedId: string;
  cardId: string;
  title: string;
  status: string;
};

type SeedSyncPlan = {
  creates: SeedSyncPlannedCreate[];
  updates: SeedSyncPlannedUpdate[];
  skips: SeedSyncPlannedSkip[];
  deprecated: Array<{ cardId: string; title: string; status: string; workstream: string }>;
};

function planLaunchKanbanSeedSync(
  existingCards: KanbanCard[],
  seedCards: LaunchKanbanSeedCard[],
  options: { preserveCardStatus: boolean }
): SeedSyncPlan {
  const matchedCardIds = new Set<string>();
  const existingBySeedTag = new Map<string, KanbanCard>();
  const existingByTitle = new Map<string, KanbanCard[]>();
  const sortOrderByStatus = new Map<string, number>();

  for (const card of existingCards) {
    for (const tag of card.tags ?? []) {
      if (tag.startsWith(LAUNCH_SEED_TAG_PREFIX) && !existingBySeedTag.has(tag)) {
        existingBySeedTag.set(tag, card);
      }
    }
    const key = normalizeTitle(card.title);
    const bucket = existingByTitle.get(key) ?? [];
    bucket.push(card);
    existingByTitle.set(key, bucket);
    sortOrderByStatus.set(card.status, Math.max(sortOrderByStatus.get(card.status) ?? 0, card.sortOrder));
  }

  const plan: SeedSyncPlan = {
    creates: [],
    updates: [],
    skips: [],
    deprecated: [],
  };

  for (const seed of seedCards) {
    const seedTag = launchSeedTag(seed.seedId);
    let existing = existingBySeedTag.get(seedTag);

    if (!existing) {
      const titleMatches = existingByTitle.get(normalizeTitle(seed.title)) ?? [];
      existing = titleMatches.find((card) => !matchedCardIds.has(card.id));
    }

    if (!existing) {
      const nextSortOrder = (sortOrderByStatus.get(seed.status) ?? 0) + 10;
      sortOrderByStatus.set(seed.status, nextSortOrder);
      plan.creates.push({
        seedId: seed.seedId,
        title: seed.title,
        status: seed.status,
        workstream: seed.workstream,
        data: {
          title: seed.title,
          description: seed.description,
          status: seed.status,
          workstream: seed.workstream,
          priority: seed.priority,
          dueDate: seed.dueDate ?? null,
          owner: seed.owner ?? null,
          blocked: seed.blocked ?? false,
          dependencyCount: seed.dependencyCount ?? seed.dependencies?.length ?? 0,
          tags: normalizeSeedTags(seed.tags, seed.seedId),
          acceptanceCriteria: toJsonOrNull(seed.acceptanceCriteria ?? null),
          dependencies: toJsonOrNull(seed.dependencies ?? null),
          notes: seed.notes ?? null,
          sortOrder: nextSortOrder,
        },
      });
      continue;
    }

    matchedCardIds.add(existing.id);
    const patch: Prisma.KanbanCardUpdateInput = {};
    const changedFields: string[] = [];

    if (existing.title !== seed.title) {
      patch.title = seed.title;
      changedFields.push("title");
    }
    if (existing.description !== seed.description) {
      patch.description = seed.description;
      changedFields.push("description");
    }
    if (existing.workstream !== seed.workstream) {
      patch.workstream = seed.workstream;
      changedFields.push("workstream");
    }
    if (existing.priority !== seed.priority) {
      patch.priority = seed.priority;
      changedFields.push("priority");
    }

    if (!options.preserveCardStatus && existing.status !== seed.status) {
      patch.status = seed.status;
      changedFields.push("status");
    }

    const expectedDependencyCount = seed.dependencyCount ?? seed.dependencies?.length ?? 0;
    if (existing.dependencyCount !== expectedDependencyCount) {
      patch.dependencyCount = expectedDependencyCount;
      changedFields.push("dependencyCount");
    }

    const mergedTags = normalizeSeedTags(existing.tags, seed.seedId);
    const tagsUnchanged =
      mergedTags.length === existing.tags.length &&
      mergedTags.every((tag) => existing.tags.includes(tag));
    if (!tagsUnchanged) {
      patch.tags = mergedTags;
      changedFields.push("tags");
    }

    const seedAcceptanceRaw = seed.acceptanceCriteria ?? null;
    const seedDependenciesRaw = seed.dependencies ?? null;
    const seedAcceptance = JSON.stringify(seedAcceptanceRaw);
    const existingAcceptance = JSON.stringify(existing.acceptanceCriteria);
    if (seedAcceptance !== existingAcceptance) {
      patch.acceptanceCriteria = toJsonOrNull(seedAcceptanceRaw);
      changedFields.push("acceptanceCriteria");
    }
    const seedDependencies = JSON.stringify(seedDependenciesRaw);
    const existingDependencies = JSON.stringify(existing.dependencies);
    if (seedDependencies !== existingDependencies) {
      patch.dependencies = toJsonOrNull(seedDependenciesRaw);
      changedFields.push("dependencies");
    }

    if ((existing.notes ?? null) !== (seed.notes ?? null)) {
      patch.notes = seed.notes ?? null;
      changedFields.push("notes");
    }

    if (changedFields.length > 0) {
      plan.updates.push({
        seedId: seed.seedId,
        cardId: existing.id,
        title: seed.title,
        preservedStatus: existing.status,
        changedFields,
        data: patch,
      });
    } else {
      plan.skips.push({
        seedId: seed.seedId,
        cardId: existing.id,
        title: existing.title,
        status: existing.status,
      });
    }
  }

  for (const card of existingCards) {
    if (matchedCardIds.has(card.id)) continue;
    if (!card.tags.includes("launch-planning")) continue;
    plan.deprecated.push({
      cardId: card.id,
      title: card.title,
      status: card.status,
      workstream: card.workstream,
    });
  }

  return plan;
}

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

/**
 * Idempotent sync for existing DB-backed launch boards.
 *
 * - Uses deterministic seed tags (`seed:<seedId>`) to avoid duplicates.
 * - Preserves user progress/status by default.
 * - Never deletes cards; unmatched launch cards are reported as deprecated.
 */
export async function syncLaunchKanbanBoardFromSeed(
  boardKey: string,
  options: SyncSeedOptions = {}
): Promise<KanbanSeedSyncResult> {
  if (boardKey !== LAUNCH_KANBAN_DEFAULT_BOARD_KEY) {
    throw new Error(`Seed sync only supports board '${LAUNCH_KANBAN_DEFAULT_BOARD_KEY}'.`);
  }

  const dryRun = options.dryRun ?? true;
  const preserveCardStatus = options.preserveCardStatus ?? true;
  const seedCards = getLaunchKanbanSeed();

  if (dryRun) {
    const existingBoard = await prisma.kanbanBoard.findUnique({
      where: { boardKey },
      include: { cards: { orderBy: [{ status: "asc" }, { sortOrder: "asc" }] } },
    });
    const existingCards = existingBoard?.cards ?? [];
    const plan = planLaunchKanbanSeedSync(existingCards, seedCards, { preserveCardStatus });
    return {
      boardKey,
      boardName: existingBoard?.name ?? LAUNCH_KANBAN_DEFAULT_BOARD_NAME,
      dryRun: true,
      totals: {
        seedCards: seedCards.length,
        created: plan.creates.length,
        updated: plan.updates.length,
        skipped: plan.skips.length,
        deprecated: plan.deprecated.length,
      },
      created: plan.creates.map(({ seedId, title, status, workstream }) => ({
        seedId,
        title,
        status,
        workstream,
      })),
      updated: plan.updates.map(({ seedId, cardId, title, preservedStatus, changedFields }) => ({
        seedId,
        cardId,
        title,
        preservedStatus,
        changedFields,
      })),
      skipped: plan.skips.map(({ seedId, cardId, title, status }) => ({
        seedId,
        cardId,
        title,
        status,
      })),
      deprecated: plan.deprecated,
    };
  }

  const result = await prisma.$transaction(async (tx) => {
    const board = await tx.kanbanBoard.upsert({
      where: { boardKey },
      create: {
        boardKey,
        name: LAUNCH_KANBAN_DEFAULT_BOARD_NAME,
      },
      update: {
        name: LAUNCH_KANBAN_DEFAULT_BOARD_NAME,
      },
    });

    const existingCards = await tx.kanbanCard.findMany({
      where: { boardKey },
      orderBy: [{ status: "asc" }, { sortOrder: "asc" }],
    });

    const plan = planLaunchKanbanSeedSync(existingCards, seedCards, { preserveCardStatus });

    for (const create of plan.creates) {
      await tx.kanbanCard.create({
        data: {
          board: { connect: { boardKey } },
          ...create.data,
        },
      });
    }

    for (const update of plan.updates) {
      await tx.kanbanCard.update({
        where: { id: update.cardId },
        data: update.data,
      });
    }

    return {
      board,
      plan,
    };
  });

  return {
    boardKey,
    boardName: result.board.name,
    dryRun: false,
    totals: {
      seedCards: seedCards.length,
      created: result.plan.creates.length,
      updated: result.plan.updates.length,
      skipped: result.plan.skips.length,
      deprecated: result.plan.deprecated.length,
    },
    created: result.plan.creates.map(({ seedId, title, status, workstream }) => ({
      seedId,
      title,
      status,
      workstream,
    })),
    updated: result.plan.updates.map(({ seedId, cardId, title, preservedStatus, changedFields }) => ({
      seedId,
      cardId,
      title,
      preservedStatus,
      changedFields,
    })),
    skipped: result.plan.skips.map(({ seedId, cardId, title, status }) => ({
      seedId,
      cardId,
      title,
      status,
    })),
    deprecated: result.plan.deprecated,
  };
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
