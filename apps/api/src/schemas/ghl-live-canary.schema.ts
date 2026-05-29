import { z } from "zod";
import { LIVE_CANARY_CONFIRMATION_TEXT } from "../lib/ghl-delivery-adapter-mode.js";

export const ghlLiveCanaryExecuteBodySchema = z
  .object({
    confirmLiveDeliveryRisk: z.literal(true),
    operatorConfirmationText: z
      .string()
      .trim()
      .refine((v) => v === LIVE_CANARY_CONFIRMATION_TEXT, {
        message: `Confirmation text must be exactly "${LIVE_CANARY_CONFIRMATION_TEXT}".`,
      }),
  })
  .strict();

export const ghlLiveDeliveryRunsListQuerySchema = z.object({
  masterClientAccountId: z.string().optional(),
  destinationClientAccountId: z.string().optional(),
  destinationSubaccountIdGhl: z.string().optional(),
  status: z.string().optional(),
  leadDeliveryPlanId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export const ghlLiveDeliveryMarkRolledBackBodySchema = z
  .object({
    notes: z.string().max(2000).optional(),
  })
  .strict();
