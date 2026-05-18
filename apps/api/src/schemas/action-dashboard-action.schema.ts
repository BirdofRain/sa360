import { z } from "zod";

export const actionCenterActionCodeSchema = z.enum([
  "CALL_ATTEMPT",
  "CALL_CONNECTED",
  "NO_ANSWER",
  "BOOKED",
  "FOLLOW_UP",
  "QUOTE_GIVEN",
  "SOLD",
  "NOT_INTERESTED",
  "BAD_NUMBER",
  "DNC",
  "DEAD_LEAD",
]);

export type ActionCenterActionCode = z.infer<typeof actionCenterActionCodeSchema>;

const HIGH_IMPACT = new Set<ActionCenterActionCode>([
  "SOLD",
  "DNC",
  "BAD_NUMBER",
  "DEAD_LEAD",
]);

export const actionDashboardActionBodySchema = z
  .object({
    clientAccountId: z.string().trim().min(1).max(128),
    locationId: z.string().trim().min(1).max(128).optional(),
    contactIdGhl: z.string().trim().min(1).max(128),
    leadUid: z.string().trim().min(1).max(128).optional(),
    phoneE164: z.string().trim().min(8).max(32).optional(),
    actionCode: actionCenterActionCodeSchema,
    notes: z.string().trim().max(8000).optional(),
    followUpDueAt: z.string().trim().max(64).optional(),
    appointmentStartAt: z.string().trim().max(64).optional(),
    policy: z
      .object({
        policyStatus: z.string().trim().max(256).optional(),
        monthlyPremium: z.coerce.number().finite().nonnegative().optional(),
        annualPremium: z.coerce.number().finite().nonnegative().optional(),
        carrier: z.string().trim().max(256).optional(),
        productType: z.string().trim().max(256).optional(),
      })
      .strict()
      .optional(),
    call: z
      .object({
        direction: z.enum(["inbound", "outbound"]).optional(),
        outcome: z.string().trim().max(256).optional(),
        durationSeconds: z.coerce.number().int().nonnegative().optional(),
      })
      .strict()
      .optional(),
    actor: z
      .object({
        agentId: z.string().trim().max(128).optional(),
        agentName: z.string().trim().max(256).optional(),
        source: z.literal("action_center").optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((body, ctx) => {
    if (body.actionCode === "FOLLOW_UP") {
      const hasNotes = Boolean(body.notes?.trim());
      const hasDue = Boolean(body.followUpDueAt?.trim());
      if (!hasNotes && !hasDue) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "FOLLOW_UP requires notes or followUpDueAt",
          path: ["followUpDueAt"],
        });
      }
    }
  });

export type ActionDashboardActionBody = z.infer<typeof actionDashboardActionBodySchema>;

export function isHighImpactActionCode(code: ActionCenterActionCode): boolean {
  return HIGH_IMPACT.has(code);
}
