import { z } from "zod";

export const sourceLeadListQuerySchema = z
  .object({
    status: z.string().optional(),
    sourceProvider: z.string().optional(),
    sourceSystem: z.string().optional(),
    matched: z
      .enum(["true", "false"])
      .optional()
      .transform((v) => (v === undefined ? undefined : v === "true")),
    clientAccountIdResolved: z.string().optional(),
    includeCleanup: z
      .enum(["true", "false"])
      .optional()
      .transform((v) => (v === undefined ? undefined : v === "true")),
    cleanupStatus: z.string().trim().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(200).optional().default(50),
    cursor: z.string().optional(),
  })
  .strict();

export const sourceLeadApproveDeliveryBodySchema = z
  .object({
    mode: z.enum(["simulate", "live_canary"]),
    operatorConfirmationText: z.string().default(""),
    confirmLiveDeliveryRisk: z.boolean().optional().default(false),
    approvedBy: z.string().optional(),
  })
  .strict();

export const sourceLeadIdParamSchema = z.object({ id: z.string().min(1) }).strict();

export const sourceLeadRejectBodySchema = z
  .object({
    approvedBy: z.string().optional(),
  })
  .strict();

/** Future CSV import preview (scaffolding). */
export const sourceImportCsvPreviewBodySchema = z
  .object({
    importBatchId: z.string().optional(),
    rows: z.array(z.record(z.string())).min(1).max(500),
    columnMapping: z.record(z.string()).optional(),
    targetClientAccountId: z.string().optional(),
    targetLocationIdGhl: z.string().optional(),
  })
  .strict();

export type SourceLeadApproveDeliveryBody = z.infer<typeof sourceLeadApproveDeliveryBodySchema>;
