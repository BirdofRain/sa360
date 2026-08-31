import { z } from "zod";

export const portalContextQuerySchema = z.object({
  loginEmail: z.string().trim().email(),
});

export const portalLoginBodySchema = z
  .object({
    loginEmail: z.string().trim().email(),
    password: z.string().min(1).max(1024),
  })
  .strict();

export const portalSessionStateQuerySchema = z
  .object({
    clientAccountId: z.string().trim().min(1),
  })
  .strict();
