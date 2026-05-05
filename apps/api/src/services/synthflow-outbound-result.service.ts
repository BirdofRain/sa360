import type { Prisma } from "@prisma/client";
import { redactWebhookPayloadForLog } from "@sa360/shared";
import { prisma } from "../lib/db.js";
import { logger } from "../lib/logger.js";
import type { SynthflowOutboundResultBody } from "../schemas/synthflow-outbound-result.schema.js";
import { normalizeToE164 } from "./phone-e164.service.js";

function parseAppointmentTime(raw: string | undefined): Date | null {
  if (!raw?.trim()) {
    return null;
  }
  const d = new Date(raw.trim());
  return Number.isNaN(d.getTime()) ? null : d;
}

export type PersistSynthflowOutboundResultInput = {
  requestId: string | undefined;
  body: SynthflowOutboundResultBody;
  rawBodyForRedaction: unknown;
};

export async function persistSynthflowOutboundResult(
  input: PersistSynthflowOutboundResultInput
): Promise<{ id: string } | { error: string }> {
  const cr = input.body.call_result;
  const fromE164 = normalizeToE164(cr.from_number);
  const toE164 = normalizeToE164(cr.to_number);

  let payloadRedacted: Prisma.InputJsonValue | undefined;
  try {
    payloadRedacted = redactWebhookPayloadForLog(input.rawBodyForRedaction) as Prisma.InputJsonValue;
  } catch {
    payloadRedacted = undefined;
  }

  try {
    const row = await prisma.synthflowOutboundResultLog.create({
      data: {
        requestId: input.requestId?.trim() || null,
        callId: cr.call_id.trim(),
        modelId: cr.model_id?.trim() || null,
        fromNumber: cr.from_number.trim(),
        toNumber: cr.to_number.trim(),
        fromNumberE164: fromE164 || null,
        toNumberE164: toE164 || null,
        contactIdGhl: cr.contact_id_ghl?.trim() || null,
        clientAccountId: cr.client_account_id?.trim() || null,
        subaccountIdGhl:
          cr.subaccount_id_ghl !== undefined ? String(cr.subaccount_id_ghl).trim() : null,
        outcome: cr.outcome,
        booked: cr.booked ?? false,
        appointmentTime: parseAppointmentTime(cr.appointment_time),
        transcriptSummary: cr.transcript_summary?.trim() || null,
        payloadRedacted: payloadRedacted ?? undefined,
      },
    });
    return { id: row.id };
  } catch (err) {
    logger.warn("synthflow_outbound_result.persist_failed", {
      callId: cr.call_id,
      error: err instanceof Error ? err.message : String(err),
    });
    return { error: "persist_failed" };
  }
}
