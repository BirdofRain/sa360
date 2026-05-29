import { z } from "zod";

export const duplicateRiskReviewPatchSchema = z.object({
  operatorOverrideStatus: z.enum(["same_person", "separate_person", "ignored_test"]),
  operatorNotes: z.string().max(4000).optional().nullable(),
  operatorUpdatedBy: z.string().max(200).optional().nullable(),
});

export type DuplicateRiskReviewPatch = z.infer<typeof duplicateRiskReviewPatchSchema>;
