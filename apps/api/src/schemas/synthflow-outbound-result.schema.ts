import { z } from "zod";

export const SYNTHFLOW_OUTBOUND_RESULT_OUTCOMES = [
  "no_answer",
  "voicemail",
  "booked",
  "already_scheduled_confirmed",
  "reschedule_requested",
  "not_interested",
  "wrong_number",
  "dnc_requested",
  "callback_requested",
  "failed",
] as const;

export type SynthflowOutboundResultOutcome = (typeof SYNTHFLOW_OUTBOUND_RESULT_OUTCOMES)[number];

const phoneField = z.string().trim().min(1).max(40);

/**
 * POST /voice/synthflow/outbound-result — Synthflow webhook-style payload.
 */
export const synthflowOutboundResultBodySchema = z
  .object({
    event: z.literal("call_outbound_result"),
    call_result: z
      .object({
        call_id: z.string().trim().min(1).max(256),
        model_id: z.string().max(256).optional(),
        to_number: phoneField,
        from_number: phoneField,
        contact_id_ghl: z.string().max(128).optional(),
        client_account_id: z.string().max(128).optional(),
        subaccount_id_ghl: z.string().max(128).optional(),
        outcome: z.enum(SYNTHFLOW_OUTBOUND_RESULT_OUTCOMES),
        booked: z.boolean().optional().default(false),
        appointment_time: z.string().max(128).optional(),
        transcript_summary: z.string().max(100_000).optional(),
      })
      .passthrough(),
  })
  .passthrough();

export type SynthflowOutboundResultBody = z.infer<typeof synthflowOutboundResultBodySchema>;
