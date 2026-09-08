import { z } from "zod";

export const PORTAL_REGISTER_FORBIDDEN_KEYS = [
  "clientAccountId",
  "status",
  "portalEnabled",
  "portalPasswordHash",
  "portalSessionEpoch",
  "portalInviteTokenHash",
  "paymentConfirmationStatus",
  "orderKind",
  "role",
  "admin",
] as const;

export const portalRegisterBodySchema = z
  .object({
    agencyName: z.string().trim().min(2).max(200),
    email: z.string().trim().email().max(320),
    password: z.string().min(1).max(128),
  })
  .strict();

export type PortalRegisterBody = z.infer<typeof portalRegisterBodySchema>;
