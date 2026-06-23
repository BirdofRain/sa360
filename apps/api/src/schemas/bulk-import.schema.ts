import { z } from "zod";

export const bulkImportIdParamSchema = z.object({ id: z.string().min(1) }).strict();

export const bulkImportUploadBodySchema = z
  .object({
    fileName: z.string().min(1).max(255),
    csvText: z.string().min(1),
    importLabel: z.string().optional(),
    uploadedBy: z.string().optional(),
  })
  .strict();

export const bulkImportMappingBodySchema = z
  .object({
    mapping: z.record(z.string()),
    defaultValues: z.record(z.string()).optional(),
    templateName: z.string().optional(),
    resetConfirmation: z.string().optional(),
  })
  .strict();

export const bulkImportDestinationBodySchema = z
  .object({
    destinationClientAccountId: z.string().min(1),
    destinationLocationIdGhl: z.string().min(1),
    vendorLabel: z.string().optional(),
    campaignLabel: z.string().optional(),
    nicheKey: z.string().optional(),
    nicheLabel: z.string().optional(),
    productType: z.string().optional(),
    ownerOverrideIdGhl: z.string().optional(),
    workflowStrategy: z
      .enum(["trigger_new_lead", "source_tag_only", "no_automation", "aged_lead_workflow"])
      .optional(),
    workflowWarningAcknowledged: z.boolean().optional(),
    useExistingRoutingRules: z.boolean().optional().default(false),
    operator: z.string().optional(),
  })
  .strict();

export const bulkImportSimulateBodySchema = z
  .object({
    rowIds: z.array(z.string()).optional(),
    limit: z.number().int().min(1).max(100).optional(),
  })
  .strict();

export const bulkImportApproveBodySchema = z
  .object({
    operatorConfirmationText: z.string(),
    approvedBy: z.string().optional(),
    rowLimit: z.number().int().min(1).max(250).optional(),
    mode: z.enum(["simulate", "live_canary"]).optional().default("live_canary"),
  })
  .strict();

export const bulkImportRowActionBodySchema = z
  .object({
    rowIds: z.array(z.string()).min(1),
    action: z.enum(["exclude", "restore"]),
  })
  .strict();

export const bulkImportListQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).optional().default(50),
    cursor: z.string().optional(),
  })
  .strict();

export const bulkImportConfirmationBodySchema = z
  .object({
    confirmationText: z.string(),
  })
  .strict();

export const bulkImportResetBodySchema = z
  .object({
    confirmationText: z.string(),
    target: z.enum(["mapping", "destination", "review", "simulation"]),
  })
  .strict();

export const bulkImportWizardStepBodySchema = z
  .object({
    step: z.enum([
      "upload",
      "map",
      "destination",
      "review",
      "simulate",
      "approve",
      "monitor",
      "results",
    ]),
  })
  .strict();
