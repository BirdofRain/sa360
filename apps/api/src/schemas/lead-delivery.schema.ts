import { z } from "zod";

const leadDeliveryDate = z
  .string()
  .trim()
  .min(1)
  .refine((value) => !Number.isNaN(Date.parse(value)), { message: "Invalid date" });

export const leadDeliveryListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  cursor: z.string().trim().min(1).optional(),
  clientAccountId: z.string().trim().min(1).optional(),
  matched: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true")),
  status: z.string().trim().min(1).optional(),
  sourceProvider: z.string().trim().min(1).optional(),
  includeCleanup: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true")),
  cleanupStatus: z.string().trim().min(1).optional(),
  /** Shared by All and Delivered. Matches campaign, funnel, or source lead id. */
  q: z.string().trim().min(1).max(80).optional(),
  /** Inclusive receivedAt start. Shared by All and Delivered. */
  from: leadDeliveryDate.optional(),
  /** Inclusive receivedAt end. Shared by All and Delivered. */
  to: leadDeliveryDate.optional(),
});

export const leadDeliveryIdParamSchema = z.object({
  id: z.string().trim().min(1),
});

export type LeadDeliveryListQuery = z.infer<typeof leadDeliveryListQuerySchema>;
