import { z } from "zod";

const stringListSchema = z.array(z.string().trim().min(1).max(80)).max(32);

export const clientAccountProfilePatchBodySchema = z
  .object({
    clientDisplayName: z.string().trim().min(1).max(200).optional(),
    portalDisplayName: z.string().trim().min(1).max(200).nullable().optional(),
    primaryNicheKeys: stringListSchema.optional(),
    primaryProductTypes: stringListSchema.optional(),
  })
  .strict();

export const clientAccountCompleteOnboardingBodySchema = clientAccountProfilePatchBodySchema;

export type ClientAccountProfilePatchBody = z.infer<typeof clientAccountProfilePatchBodySchema>;
export type ClientAccountCompleteOnboardingBody = z.infer<
  typeof clientAccountCompleteOnboardingBodySchema
>;
