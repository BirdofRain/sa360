import { z } from "zod";
import { lifecycleEventSchema } from "./lifecycle-event.schema.js";
import { ROUTING_VALIDATION_STATUSES } from "../lib/routing-validation-status.js";

export const ROUTING_DRY_RUN_REVIEW_QUEUES = [
  "unreviewed_only",
  "mismatches",
  "needs_mapping",
  "matched_no_plan",
  "matched_needs_config_plan",
] as const;

export const routingDryRunListQuerySchema = z.object({
  masterClientAccountId: z.string().trim().min(1),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  matched: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true")),
  validationStatus: z.enum(ROUTING_VALIDATION_STATUSES).optional(),
  destinationClientAccountId: z.string().trim().min(1).optional(),
  reviewQueue: z.enum(ROUTING_DRY_RUN_REVIEW_QUEUES).optional(),
  createdAfter: z.string().datetime().optional(),
  createdBefore: z.string().datetime().optional(),
});

export const routingDryRunStatsQuerySchema = z.object({
  masterClientAccountId: z.string().trim().min(1),
  destinationClientAccountId: z.string().trim().min(1).optional(),
  createdAfter: z.string().datetime().optional(),
  createdBefore: z.string().datetime().optional(),
});

const nullableTrimmedString = z
  .string()
  .trim()
  .min(1)
  .nullable()
  .optional();

export const routingDryRunValidationPatchSchema = z.object({
  validationStatus: z.enum(ROUTING_VALIDATION_STATUSES),
  legacyDeliveredClientAccountId: nullableTrimmedString,
  legacyDeliveredSubaccountIdGhl: nullableTrimmedString,
  legacyDeliveryContactIdGhl: nullableTrimmedString,
  legacyDeliveryStatus: nullableTrimmedString,
  validationNotes: z.string().trim().max(2000).nullable().optional(),
  validatedBy: z.string().trim().min(1).max(120).optional(),
});

export const routingDryRunBodySchema = z.object({
  payload: lifecycleEventSchema,
  /** When true, response includes matcher diagnostic (rule ids + reason codes only). */
  debug: z.boolean().optional(),
});

export type RoutingDryRunListQuery = z.infer<typeof routingDryRunListQuerySchema>;
export type RoutingDryRunStatsQuery = z.infer<typeof routingDryRunStatsQuerySchema>;
export type RoutingDryRunValidationPatch = z.infer<typeof routingDryRunValidationPatchSchema>;
