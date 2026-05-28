import { z } from "zod";
import { GHL_ADAPTER_RUN_STATUSES } from "../lib/ghl-delivery-adapter-mode.js";

export const ghlAdapterSimulateBodySchema = z
  .object({
    checkLiveReadiness: z.boolean().optional(),
  })
  .strict()
  .optional();

export const ghlAdapterRunsListQuerySchema = z.object({
  masterClientAccountId: z.string().trim().min(1).optional(),
  destinationClientAccountId: z.string().trim().min(1).optional(),
  destinationSubaccountIdGhl: z.string().trim().min(1).optional(),
  status: z.enum(GHL_ADAPTER_RUN_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});
