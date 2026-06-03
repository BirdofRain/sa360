import { z } from "zod";
import { CLIENT_ACCOUNT_STATUSES } from "../lib/client-account-status.js";
import {
  DELIVERY_MODES,
  INTERNAL_APPROVAL_STATUSES,
} from "../lib/delivery-readiness-status.js";

const clientAccountIdSchema = z
  .string()
  .trim()
  .min(2)
  .max(80)
  .regex(/^[a-z][a-z0-9_]*$/, "clientAccountId must be lowercase slug (a-z, 0-9, _)");

const stringListSchema = z.array(z.string().trim().min(1)).max(32).optional();

export const clientAccountListQuerySchema = z.object({
  status: z.enum(CLIENT_ACCOUNT_STATUSES).optional(),
});

/** Destructive admin actions require explicit confirm=true. */
export const adminDeleteConfirmQuerySchema = z.object({
  confirm: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
});

export const clientAccountCreateBodySchema = z
  .object({
    clientAccountId: clientAccountIdSchema,
    clientDisplayName: z.string().trim().min(1).max(200),
    status: z.enum(CLIENT_ACCOUNT_STATUSES).optional(),
    portalEnabled: z.boolean().optional(),
    portalDisplayName: z.string().trim().min(1).max(200).nullable().optional(),
    portalLoginEmail: z.string().trim().email().max(320).nullable().optional(),
    primaryNicheKeys: stringListSchema,
    primaryProductTypes: stringListSchema,
    notes: z.string().max(8000).nullable().optional(),
  })
  .strict();

export const clientAccountPatchBodySchema = z
  .object({
    clientDisplayName: z.string().trim().min(1).max(200).optional(),
    status: z.enum(CLIENT_ACCOUNT_STATUSES).optional(),
    portalEnabled: z.boolean().optional(),
    portalDisplayName: z.string().trim().min(1).max(200).nullable().optional(),
    portalLoginEmail: z.string().trim().email().max(320).nullable().optional(),
    primaryNicheKeys: stringListSchema,
    primaryProductTypes: stringListSchema,
    notes: z.string().max(8000).nullable().optional(),
  })
  .strict();

const nullableTrimmed = z.string().trim().min(1).nullable().optional();

export const clientGhlDestinationPatchBodySchema = z
  .object({
    destinationSubaccountIdGhl: z.string().trim().min(1).max(120).optional(),
    locationName: nullableTrimmed,
    ghlConnectionStatus: nullableTrimmed,
    snapshotInstalled: z.boolean().optional(),
    requiredFieldsInstalled: z.boolean().optional(),
    defaultAssignedUserIdGhl: nullableTrimmed,
    destinationWorkflowIdGhl: nullableTrimmed,
    destinationPipelineIdGhl: nullableTrimmed,
    destinationPipelineStageIdGhl: nullableTrimmed,
    pipelineStageContactingIdGhl: nullableTrimmed,
    pipelineStageAppointmentSetIdGhl: nullableTrimmed,
    pipelineStageShowedIdGhl: nullableTrimmed,
    pipelineStageSoldIdGhl: nullableTrimmed,
    pipelineStageDeadIdGhl: nullableTrimmed,
    opportunityCreationEnabled: z.boolean().optional(),
    backupSheetEnabled: z.boolean().optional(),
    backupSheetId: nullableTrimmed,
    deliveryMode: z.enum(DELIVERY_MODES).optional(),
    deliveryEnabled: z.boolean().optional(),
    clientCutoverApproved: z.boolean().optional(),
    internalApprovalStatus: z.enum(INTERNAL_APPROVAL_STATUSES).optional(),
    confirmLiveDeliveryRisk: z.boolean().optional(),
  })
  .strict();

export type ClientAccountCreateBody = z.infer<typeof clientAccountCreateBodySchema>;
export type ClientAccountPatchBody = z.infer<typeof clientAccountPatchBodySchema>;
export type ClientGhlDestinationPatchBody = z.infer<typeof clientGhlDestinationPatchBodySchema>;
