import { z } from "zod";

export const portalBuyerAvailabilityBodySchema = z.object({
  clientAccountId: z.string().trim().min(1).max(120),
  nicheKey: z.string().trim().min(1).max(80),
  commerceAgeBucketKey: z.string().trim().min(1).max(64),
  states: z.array(z.string().trim().min(2).max(2)).min(1).max(60),
});
