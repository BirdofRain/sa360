import { z } from "zod";
import { lifecycleEventSchema } from "./lifecycle-event.schema.js";

export const directDemoDeliveryBodySchema = z
  .object({
    payload: lifecycleEventSchema,
    mode: z.enum(["simulate", "live_canary"]),
    confirmLiveDeliveryRisk: z.boolean().optional().default(false),
    operatorConfirmationText: z.string().optional().default(""),
  })
  .strict();

export type DirectDemoDeliveryBody = z.infer<typeof directDemoDeliveryBodySchema>;
