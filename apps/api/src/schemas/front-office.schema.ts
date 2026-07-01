import { z } from "zod";

export const frontOfficeQuerySchema = z.object({
  clientAccountId: z.string().trim().min(1).optional(),
});

export type FrontOfficeQuery = z.infer<typeof frontOfficeQuerySchema>;
