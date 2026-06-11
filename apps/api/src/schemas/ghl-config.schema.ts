import { z } from "zod";

export const ghlLocationConfigQuerySchema = z.object({
  refresh: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
});

const nullableId = z.string().trim().min(1).nullable().optional();

const sa360FieldMapSchema = z.record(z.string().trim().min(1), z.string().trim().min(1)).optional();

const discoveryCustomFieldSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  key: z.string().nullable().optional(),
  fieldKey: z.string().nullable().optional(),
  dataType: z.string().nullable().optional(),
});

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
    discoveryCustomFields: z.array(discoveryCustomFieldSchema).max(500).optional(),
    customFieldStampRequired: z.boolean().optional(),
    ownerAssignmentRequired: z.boolean().optional(),
    workflowStartRequired: z.boolean().optional(),
    workflowTriggerMode: z.enum(["none", "direct_api", "tag_trigger"]).optional(),
    confirmLocationMismatch: z.boolean().optional(),
  })
  .strict();

export type RoutingRuleGhlConfigBody = z.infer<typeof routingRuleGhlConfigBodySchema>;
