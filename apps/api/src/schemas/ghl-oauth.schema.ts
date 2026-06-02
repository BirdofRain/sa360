import { z } from "zod";

export const ghlOAuthStartQuerySchema = z.object({
  clientAccountId: z.string().trim().min(1).optional(),
  returnTo: z.string().trim().max(500).optional(),
  redirect: z.enum(["true", "false"]).optional(),
});

export const ghlConnectionsListQuerySchema = z.object({
  clientAccountId: z.string().trim().min(1).optional(),
  connectionStatus: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export const ghlConnectionLinkClientBodySchema = z
  .object({
    clientAccountId: z.string().trim().min(1),
  })
  .strict();
