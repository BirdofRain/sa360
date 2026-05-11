import { z } from "zod";

/** Status / priority strings are accepted as free-form to keep the column
 * vocabulary editable from the dashboard without a redeploy. */
const trimmedString = z.string().trim().min(1);

export const kanbanBoardKeyParamSchema = z.object({
  boardKey: trimmedString,
});

export const kanbanCardIdParamSchema = z.object({
  id: trimmedString,
});

/** PUT /admin/v1/kanban/cards/:id — fully optional, server-side merges. */
export const kanbanCardUpdateBodySchema = z
  .object({
    title: z.string().trim().min(1).optional(),
    description: z.string().optional(),
    status: trimmedString.optional(),
    workstream: trimmedString.optional(),
    priority: trimmedString.optional(),
    dueDate: z
      .string()
      .nullable()
      .optional()
      .refine(
        (v) => v == null || v === "" || !Number.isNaN(Date.parse(v)),
        { message: "Invalid ISO date" }
      ),
    owner: z.string().nullable().optional(),
    blocked: z.boolean().optional(),
    dependencyCount: z.number().int().min(0).optional(),
    tags: z.array(z.string()).optional(),
    acceptanceCriteria: z.array(z.string()).nullable().optional(),
    dependencies: z.array(z.string()).nullable().optional(),
    notes: z.string().nullable().optional(),
    sortOrder: z.number().int().optional(),
  })
  .strict();

export type KanbanCardUpdateBody = z.infer<typeof kanbanCardUpdateBodySchema>;

/** POST /admin/v1/kanban/cards */
export const kanbanCardCreateBodySchema = z
  .object({
    boardKey: trimmedString,
    title: z.string().trim().min(1),
    description: z.string().default(""),
    status: trimmedString,
    workstream: trimmedString,
    priority: trimmedString,
    dueDate: z
      .string()
      .nullable()
      .optional()
      .refine(
        (v) => v == null || v === "" || !Number.isNaN(Date.parse(v)),
        { message: "Invalid ISO date" }
      ),
    owner: z.string().nullable().optional(),
    blocked: z.boolean().optional(),
    dependencyCount: z.number().int().min(0).optional(),
    tags: z.array(z.string()).optional(),
    acceptanceCriteria: z.array(z.string()).nullable().optional(),
    dependencies: z.array(z.string()).nullable().optional(),
    notes: z.string().nullable().optional(),
    sortOrder: z.number().int().optional(),
  })
  .strict();

export type KanbanCardCreateBody = z.infer<typeof kanbanCardCreateBodySchema>;

/** PUT /admin/v1/kanban/boards/:boardKey/reorder */
export const kanbanReorderBodySchema = z
  .object({
    items: z
      .array(
        z
          .object({
            id: trimmedString,
            status: trimmedString,
            sortOrder: z.number().int(),
          })
          .strict()
      )
      .min(1)
      .max(500),
  })
  .strict();

export type KanbanReorderBody = z.infer<typeof kanbanReorderBodySchema>;
