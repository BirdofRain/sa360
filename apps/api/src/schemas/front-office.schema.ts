import { z } from "zod";

export const frontOfficeQuerySchema = z.object({
  clientAccountId: z.string().trim().min(1).optional(),
  nicheKey: z.string().trim().min(1).optional(),
  productType: z.string().trim().min(1).optional(),
});

export type FrontOfficeQuery = z.infer<typeof frontOfficeQuerySchema>;
