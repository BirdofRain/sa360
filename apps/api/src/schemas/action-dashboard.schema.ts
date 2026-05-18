import { z } from "zod";

export const actionDashboardTodayQuerySchema = z
  .object({
    clientAccountId: z.string().trim().min(1).max(128),
    locationId: z.string().trim().min(1).max(128).optional(),
    agentDisplayName: z.string().trim().min(1).max(256).optional(),
  })
  .strict();

export type ActionDashboardTodayQuery = z.infer<typeof actionDashboardTodayQuerySchema>;
