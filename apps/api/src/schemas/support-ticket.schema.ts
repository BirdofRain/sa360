import { z } from "zod";

import {
  SUPPORT_TICKET_CATEGORIES,
  SUPPORT_TICKET_PRIORITIES,
  SUPPORT_TICKET_STATUSES,
} from "../lib/support-ticket.constants.js";

const optionalTrimmed = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v && v.length > 0 ? v : undefined));

export const supportTicketCreateBodySchema = z.object({
  subject: optionalTrimmed(180),
  description: z.string().trim().min(1).max(5000),
  category: z.enum(SUPPORT_TICKET_CATEGORIES).optional(),
  priority: z.enum(SUPPORT_TICKET_PRIORITIES).optional(),
  requesterName: optionalTrimmed(120),
  requesterEmail: optionalTrimmed(180),
  requesterUserId: optionalTrimmed(120),
  clientAccountId: optionalTrimmed(120),
  masterClientAccountId: optionalTrimmed(120),
  subaccountIdGhl: optionalTrimmed(120),
  relatedEntityType: optionalTrimmed(120),
  relatedEntityId: optionalTrimmed(120),
  pagePath: optionalTrimmed(500),
  pageUrl: optionalTrimmed(2000),
  queryJson: z.record(z.unknown()).optional().nullable(),
  contextJson: z.record(z.unknown()).optional().nullable(),
  userAgent: optionalTrimmed(500),
});

export const supportTicketListQuerySchema = z.object({
  status: z.enum(SUPPORT_TICKET_STATUSES).optional(),
  priority: z.enum(SUPPORT_TICKET_PRIORITIES).optional(),
  category: z.enum(SUPPORT_TICKET_CATEGORIES).optional(),
  clientAccountId: z.string().trim().optional(),
  masterClientAccountId: z.string().trim().optional(),
  search: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(25),
});

export const supportTicketIdParamSchema = z.object({
  id: z.string().trim().min(1),
});

export const supportTicketUpdateBodySchema = z
  .object({
    status: z.enum(SUPPORT_TICKET_STATUSES).optional(),
    priority: z.enum(SUPPORT_TICKET_PRIORITIES).optional(),
    category: z.enum(SUPPORT_TICKET_CATEGORIES).optional(),
    assignedToName: optionalTrimmed(120),
    assignedToUserId: optionalTrimmed(120),
    resolutionSummary: optionalTrimmed(2000),
    internalNote: z.string().trim().min(1).max(2000).optional(),
    internalNoteBy: optionalTrimmed(120),
  })
  .refine(
    (body) =>
      body.status !== undefined ||
      body.priority !== undefined ||
      body.category !== undefined ||
      body.assignedToName !== undefined ||
      body.assignedToUserId !== undefined ||
      body.resolutionSummary !== undefined ||
      body.internalNote !== undefined,
    { message: "At least one field is required" }
  );

export type SupportTicketCreateBody = z.infer<typeof supportTicketCreateBodySchema>;
export type SupportTicketListQuery = z.infer<typeof supportTicketListQuerySchema>;
export type SupportTicketUpdateBody = z.infer<typeof supportTicketUpdateBodySchema>;
