import { z } from "zod";
import {
  DELIVERY_MODES,
  INTERNAL_APPROVAL_STATUSES,
  READINESS_STATUSES,
} from "../lib/delivery-readiness-status.js";

export const deliveryReadinessListQuerySchema = z.object({
  masterClientAccountId: z.string().trim().min(1).optional(),
  clientAccountId: z.string().trim().min(1).optional(),
  destinationSubaccountIdGhl: z.string().trim().min(1).optional(),
  status: z.enum(READINESS_STATUSES).optional(),
});

export const routingRulesListQuerySchema = z.object({
  masterClientAccountId: z.string().trim().min(1),
  clientAccountId: z.string().trim().min(1).optional(),
  active: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true")),
});

const nullableTrimmed = z.string().trim().min(1).nullable().optional();

export const routingRuleDeliveryConfigPatchSchema = z
  .object({
    destinationWorkflowIdGhl: nullableTrimmed,
    destinationPipelineIdGhl: nullableTrimmed,
    destinationPipelineStageIdGhl: nullableTrimmed,
    defaultAssignedUserIdGhl: nullableTrimmed,
    backupSheetEnabled: z.boolean().optional(),
    backupSheetId: nullableTrimmed,
    snapshotInstalled: z.boolean().optional(),
    requiredFieldsInstalled: z.boolean().optional(),
    ghlConnectionStatus: nullableTrimmed,
    deliveryMode: z.enum(DELIVERY_MODES).optional(),
    deliveryEnabled: z.boolean().optional(),
    clientCutoverApproved: z.boolean().optional(),
    internalApprovalStatus: z.enum(INTERNAL_APPROVAL_STATUSES).optional(),
    opportunityCreationEnabled: z.boolean().optional(),
    confirmLiveDeliveryRisk: z.boolean().optional(),
  })
  .strict();

export type DeliveryReadinessListQuery = z.infer<typeof deliveryReadinessListQuerySchema>;
export type RoutingRulesListQuery = z.infer<typeof routingRulesListQuerySchema>;
export type RoutingRuleDeliveryConfigPatch = z.infer<typeof routingRuleDeliveryConfigPatchSchema>;
