import { z } from "zod";
import { lifecycleEventSchema } from "./lifecycle-event.schema.js";

export const routingDryRunListQuerySchema = z.object({
  masterClientAccountId: z.string().trim().min(1),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  matched: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true")),
});

export const routingDryRunBodySchema = z.object({
  payload: lifecycleEventSchema,
});

export type RoutingDryRunListQuery = z.infer<typeof routingDryRunListQuerySchema>;
