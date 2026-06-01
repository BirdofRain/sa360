import { z } from "zod";

export const portalContextQuerySchema = z.object({
  loginEmail: z.string().trim().email(),
});

export const portalDashboardQuerySchema = z
  .object({
    clientAccountId: z.string().trim().min(1).optional(),
  })
  .strict();
