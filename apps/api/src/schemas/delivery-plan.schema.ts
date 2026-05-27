import { z } from "zod";
import { DELIVERY_PLAN_STATUSES } from "../lib/lead-delivery-plan-status.js";

export const deliveryPlanListQuerySchema = z.object({
  masterClientAccountId: z.string().trim().min(1),
  destinationClientAccountId: z.string().trim().min(1).optional(),
  status: z.enum(DELIVERY_PLAN_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export const deliveryPlanStatusPatchSchema = z.object({
  status: z.enum(DELIVERY_PLAN_STATUSES),
});
