import { z } from "zod";

const phoneField = z.string().trim().min(1).max(40);
const optionalModelId = z.string().max(256).optional();

/**
 * Strict Synthflow inbound payload. `.passthrough()` keeps forward-compatible with extra fields
 * Synthflow may send without failing validation.
 */
export const synthflowInboundLookupBodySchema = z
  .object({
    event: z.literal("call_inbound"),
    call_inbound: z
      .object({
        model_id: optionalModelId,
        from_number: phoneField,
        to_number: phoneField,
      })
      .passthrough(),
  })
  .passthrough();

export type SynthflowInboundLookupBody = z.infer<typeof synthflowInboundLookupBodySchema>;
