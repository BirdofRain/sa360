import { z } from "zod";

export const deliveryRuntimeModePostBodySchema = z
  .object({
    mode: z.enum(["simulate", "live_canary"]),
    durationMinutes: z.number().int().min(1).max(30).optional(),
    operatorConfirmationText: z.string().min(1),
    reason: z.string().max(500).optional(),
    enabledBy: z.string().max(200).optional(),
  })
  .strict();

export type DeliveryRuntimeModePostBody = z.infer<typeof deliveryRuntimeModePostBodySchema>;
