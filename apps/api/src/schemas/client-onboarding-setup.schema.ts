import { z } from "zod";

const optionalText = (max = 500) => z.string().trim().max(max).nullable().optional();
const optionalUrl = z
  .string()
  .trim()
  .max(2048)
  .url()
  .refine((value) => value.startsWith("https://") || value.startsWith("http://"), "Use an HTTP(S) URL")
  .nullable()
  .optional();

export const clientOnboardingSetupDataSchema = z
  .object({
    clientEmail: z.string().trim().email().max(320).nullable().optional(),
    clientPhone: optionalText(40),
    geography: optionalText(500),
    setupOwner: optionalText(200),
    plannedGoLiveDate: z.string().date().nullable().optional(),
    sourceProvider: z.enum(["nextgen", "other", "undecided"]).nullable().optional(),
    trafficSourceName: optionalText(200),
    nextgenFunnelName: optionalText(300),
    nextgenFunnelUrl: optionalUrl,
    providerFunnelId: optionalText(200),
    providerCampaignId: optionalText(200),
    sourceMissingInfoNotes: optionalText(2000),
    testLeadUuid: z.string().trim().uuid().nullable().optional(),
    testSubmissionAt: z.string().datetime({ offset: true }).nullable().optional(),
    webhookConfigured: z.boolean().optional(),
    sourceTestSubmitted: z.boolean().optional(),
    destinationChoice: z
      .enum(["ghl", "google_sheets", "both", "intake_only", "undecided"])
      .nullable()
      .optional(),
    ghlLocationId: optionalText(200),
    ghlWorkflowId: optionalText(200),
    ghlAssignedUserId: optionalText(200),
    sheetsMode: z.enum(["existing", "create_new"]).nullable().optional(),
    existingSpreadsheetUrl: optionalUrl,
    worksheetName: optionalText(200),
    googleAccountOwner: optionalText(320),
    requestedSpreadsheetName: optionalText(200),
    requestedFolder: optionalText(500),
    accessRecipient: z.string().trim().email().max(320).nullable().optional(),
    accessLevel: z.enum(["viewer", "commenter", "editor"]).nullable().optional(),
    reviewNotes: optionalText(4000),
  })
  .strict();

export const clientOnboardingSetupPatchSchema = z
  .object({
    requestId: z.string().uuid(),
    expectedRevision: z.number().int().nonnegative(),
    intent: z.enum([
      "save_draft",
      "submit",
      "needs_information",
      "setup_reviewed",
      "recover_draft",
    ]),
    data: clientOnboardingSetupDataSchema,
  })
  .strict();

export type ClientOnboardingSetupData = z.infer<typeof clientOnboardingSetupDataSchema>;
export type ClientOnboardingSetupPatch = z.infer<typeof clientOnboardingSetupPatchSchema>;
