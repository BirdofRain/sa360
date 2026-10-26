import { z } from "zod";

/** Path tenant. Same shape the onboarding contract requires. */
export const CLIENT_ONBOARDING_V2_CLIENT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

export const clientOnboardingV2DriveSearchSchema = z
  .object({
    scope: z.enum(["approved_parent", "client_folder"]),
    query: z.string(),
    pageToken: z.string().nullable().optional(),
    clientAccountId: z.string().optional(),
  })
  .strip();

export const clientOnboardingV2DriveResolveSchema = z
  .object({
    folder: z.unknown(),
    clientAccountId: z.string().optional(),
  })
  .strip();

export const clientOnboardingV2SheetPreviewSchema = z
  .object({
    spreadsheetId: z.string(),
    purpose: z.literal("campaign"),
    worksheetTitle: z.string().optional(),
    worksheetId: z.number().int().optional(),
    clientAccountId: z.string().optional(),
  })
  .strip();

export type ClientOnboardingV2DriveSearchBody = z.infer<typeof clientOnboardingV2DriveSearchSchema>;
export type ClientOnboardingV2SheetPreviewBody = z.infer<typeof clientOnboardingV2SheetPreviewSchema>;
