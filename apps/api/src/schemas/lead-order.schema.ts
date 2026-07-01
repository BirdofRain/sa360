import { z } from "zod";

import {
  LEAD_ORDER_CREATED_BY_ROLES,
  LEAD_ORDER_STATUSES,
} from "../services/lead-order/lead-order.types.js";

const optionalTrimmed = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v && v.length > 0 ? v : undefined));

const statesSchema = z
  .union([
    z.array(z.string().trim().min(1).max(8)).min(1).max(20),
    z.string().trim().min(1).max(200),
  ])
  .transform((v) => {
    if (Array.isArray(v)) return v.map((s) => s.toUpperCase());
    return v
      .split(/[,;\s]+/)
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
  })
  .refine((arr) => arr.length > 0, { message: "At least one state is required" });

export const leadOrderIdParamSchema = z.object({
  id: z.string().trim().min(1),
});

export const leadOrderListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  cursor: z.string().trim().optional(),
  status: z.enum(LEAD_ORDER_STATUSES).optional(),
  clientAccountId: z.string().trim().optional(),
  nicheKey: z.string().trim().optional(),
});

const leadOrderCreateBaseSchema = z.object({
  nicheKey: z.string().trim().min(1).max(120),
  productType: optionalTrimmed(120),
  states: statesSchema,
  leadVolume: z.coerce.number().int().min(1).max(1_000_000),
  deliveryCadence: optionalTrimmed(120),
  campaignType: z.string().trim().min(1).max(120),
  crmPackage: z.string().trim().min(1).max(120),
  aiVoiceAddon: z.boolean().optional().default(false),
  requestedStartDate: z
    .string()
    .trim()
    .optional()
    .nullable()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  deliveryDestinationType: optionalTrimmed(120),
  deliveryDestinationLabel: z.string().trim().min(1).max(240),
  notes: optionalTrimmed(2000),
});

export const leadOrderAdminCreateBodySchema = leadOrderCreateBaseSchema.extend({
  clientAccountId: z.string().trim().min(1).max(120),
  clientDisplayName: optionalTrimmed(180),
  status: z.enum(LEAD_ORDER_STATUSES).optional(),
  adminNotes: optionalTrimmed(2000),
  routingRuleId: optionalTrimmed(120),
  campaignId: optionalTrimmed(120),
  createdByUserId: optionalTrimmed(120),
});

export const leadOrderClientCreateBodySchema = leadOrderCreateBaseSchema;

export const leadOrderAdminUpdateBodySchema = z
  .object({
    status: z.enum(LEAD_ORDER_STATUSES).optional(),
    adminNotes: optionalTrimmed(2000),
    routingRuleId: optionalTrimmed(120).nullable(),
    campaignId: optionalTrimmed(120).nullable(),
    clientDisplayName: optionalTrimmed(180),
    trustStatusSnapshot: z
      .object({
        status: z.string().trim().optional(),
        warnings: z.array(z.string().trim()).optional(),
        checkedAt: z.string().trim().optional(),
      })
      .optional()
      .nullable(),
  })
  .refine(
    (body) =>
      body.status !== undefined ||
      body.adminNotes !== undefined ||
      body.routingRuleId !== undefined ||
      body.campaignId !== undefined ||
      body.clientDisplayName !== undefined ||
      body.trustStatusSnapshot !== undefined,
    { message: "At least one field is required" }
  );

export const leadOrderClientListQuerySchema = leadOrderListQuerySchema.omit({
  clientAccountId: true,
});

export type LeadOrderAdminCreateBody = z.infer<typeof leadOrderAdminCreateBodySchema>;
export type LeadOrderClientCreateBody = z.infer<typeof leadOrderClientCreateBodySchema>;
export type LeadOrderAdminUpdateBody = z.infer<typeof leadOrderAdminUpdateBodySchema>;
export type LeadOrderListQuery = z.infer<typeof leadOrderListQuerySchema>;
