import { z } from "zod";

const phoneField = z.string().trim().min(1).max(40);
const optionalModelId = z.string().max(256).optional();

/**
 * Synthflow outbound context payload (POST /voice/synthflow/outbound-context).
 * `.passthrough()` tolerates extra Synthflow fields.
 */
export const synthflowOutboundContextBodySchema = z
  .object({
    event: z.literal("call_outbound_context"),
    call: z
      .object({
        model_id: optionalModelId,
        /** Lead / callee phone (indexed as contact phone). */
        to_number: phoneField,
        /** Outbound caller-id line (used for tenant resolution map + logging). */
        from_number: phoneField,
        contact_id_ghl: z.string().trim().min(1).max(128).optional(),
        client_account_id: z.string().trim().min(1).max(128).optional(),
        subaccount_id_ghl: z.string().max(128).optional(),
        lead_uid: z.string().trim().min(1).max(128).optional(),
      })
      .passthrough(),
  })
  .passthrough();

export type SynthflowOutboundContextBody = z.infer<typeof synthflowOutboundContextBodySchema>;
