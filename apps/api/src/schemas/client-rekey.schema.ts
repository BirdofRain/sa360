import { z } from "zod";

const clientAccountIdSchema = z
  .string()
  .trim()
  .min(2)
  .max(80)
  .regex(/^[a-z][a-z0-9_]*$/, "clientAccountId must be lowercase slug (a-z, 0-9, _)");

export const clientRekeyPreviewQuerySchema = z
  .object({
    targetClientAccountId: clientAccountIdSchema,
  })
  .strict();

export const clientRekeyBodySchema = z
  .object({
    targetClientAccountId: clientAccountIdSchema,
    confirmation: z.string().trim().min(8).max(240),
  })
  .strict();
