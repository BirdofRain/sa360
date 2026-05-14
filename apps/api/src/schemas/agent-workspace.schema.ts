import { z } from "zod";

/** GHL `locationId` is treated as `subaccountIdGhl` when the latter is omitted. */
export const agentWorkspaceBaseQuerySchema = z.object({
  clientAccountId: z.string().min(1).max(128),
  subaccountIdGhl: z.string().max(128).optional(),
  locationId: z.string().max(128).optional(),
});

export const agentWorkspaceContextQuerySchema = agentWorkspaceBaseQuerySchema.extend({
  contactIdGhl: z.string().max(128).optional(),
  leadUid: z.string().max(128).optional(),
});

export const agentWorkspaceLeadQueueQuerySchema = agentWorkspaceBaseQuerySchema.extend({
  lifecycleStage: z.string().max(256).optional(),
  /** Comma-separated list; overrides default stage filter when non-empty after split. */
  lifecycleStages: z.string().max(2048).optional(),
  assignedAgentId: z.string().max(128).optional(),
  /** Matched against `InboundContactIndex.leadType` (niche / vertical). */
  nicheKey: z.string().max(256).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
});

export const agentWorkspaceGuidanceQuerySchema = agentWorkspaceBaseQuerySchema.extend({
  nicheKey: z.string().max(256).optional(),
  lifecycleStage: z.string().max(256).optional(),
});

export const whatHappenedOutcomeSchema = z.enum([
  "appointment_set",
  "callback_scheduled",
  "not_interested",
  "no_answer",
  "connected_no_result",
  "sale_logged",
  "wrong_number",
  "other",
]);

export type WhatHappenedOutcome = z.infer<typeof whatHappenedOutcomeSchema>;
export const whatHappenedBodySchema = z
  .object({
    clientAccountId: z.string().min(1).max(128),
    subaccountIdGhl: z.string().max(128).optional(),
    locationId: z.string().max(128).optional(),
    contactIdGhl: z.string().max(128).optional(),
    leadUid: z.string().max(128).optional(),
    outcome: whatHappenedOutcomeSchema,
    notes: z.string().max(8000).optional(),
    resourceId: z.string().max(128).optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .refine((b) => Boolean(b.contactIdGhl?.trim() || b.leadUid?.trim()), {
    message: "contactIdGhl or leadUid is required",
    path: ["contactIdGhl"],
  });

export type WhatHappenedBody = z.infer<typeof whatHappenedBodySchema>;

export const contactGuidanceEventActionSchema = z.enum([
  "VIEWED",
  "COPIED",
  "USED",
  "DISMISSED",
  "SENT_TO_GHL",
  "OUTCOME_LOGGED",
]);

export const contactGuidanceEventBodySchema = z
  .object({
    clientAccountId: z.string().min(1).max(128),
    contactIdGhl: z.string().max(128).optional(),
    leadUid: z.string().max(128).optional(),
    resourceId: z.string().max(128).optional(),
    actionType: contactGuidanceEventActionSchema,
    metadata: z.record(z.unknown()).optional(),
  })
  .refine((b) => Boolean(b.contactIdGhl?.trim() || b.leadUid?.trim()), {
    message: "contactIdGhl or leadUid is required",
    path: ["contactIdGhl"],
  });

export type ContactGuidanceEventBody = z.infer<typeof contactGuidanceEventBodySchema>;
