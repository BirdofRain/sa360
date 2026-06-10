import { z } from "zod";

export const ghlLocationConfigQuerySchema = z.object({
  refresh: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
});

const nullableId = z.string().trim().min(1).nullable().optional();

const sa360FieldMapSchema = z.record(z.string().trim().min(1), z.string().trim().min(1)).optional();

export const routingRuleGhlConfigBodySchema = z
  .object({
    locationId: z.string().trim().min(1),
    destinationPipelineIdGhl: nullableId,
    destinationPipelineStageIdGhl: nullableId,
    destinationWorkflowIdGhl: nullableId,
    defaultAssignedUserIdGhl: nullableId,
    snapshotInstalled: z.boolean().optional(),
    requiredFieldsInstalled: z.boolean().optional(),
    sa360CustomFieldIdMapJson: sa360FieldMapSchema,
    customFieldStampRequired: z.boolean().optional(),
    confirmLocationMismatch: z.boolean().optional(),
  })
  .strict();

export type RoutingRuleGhlConfigBody = z.infer<typeof routingRuleGhlConfigBodySchema>;
