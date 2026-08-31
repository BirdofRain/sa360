import { z } from "zod";

export const portalInviteAcceptBodySchema = z
  .object({
    token: z.string().min(1).max(128),
    password: z.string().min(1).max(1024),
  })
  .strict();

export const portalInviteInspectBodySchema = z
  .object({
    token: z.string().min(1).max(128),
  })
  .strict();

export type PortalInviteAcceptBody = z.infer<typeof portalInviteAcceptBodySchema>;
export type PortalInviteInspectBody = z.infer<typeof portalInviteInspectBodySchema>;
