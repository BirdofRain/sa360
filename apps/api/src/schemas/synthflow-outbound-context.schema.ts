import { z } from "zod";
import { cleanSynthflowOutboundScalar } from "../lib/lifecycle-routing-calendar.js";

function firstNonEmpty(...parts: string[]): string {
  for (const p of parts) {
    const t = p.trim();
    if (t) {
      return t;
    }
  }
  return "";
}

function optionalCleanString(v: unknown): string | undefined {
  const s = cleanSynthflowOutboundScalar(v);
  return s === "" ? undefined : s;
}

/**
 * Synthflow outbound context payload (POST /voice/synthflow/outbound-context).
 * Accepts Synthflow `call.*` variables; strips angle/curl placeholders; prefers
 * `user_phone_number` then `to_number` as the lead phone.
 */
export const synthflowOutboundContextBodySchema = z
  .object({
    event: z.literal("call_outbound_context"),
    call: z.record(z.string(), z.unknown()),
  })
  .passthrough()
  .transform((root) => {
    const c = root.call;
    const clean = (key: string) => cleanSynthflowOutboundScalar(c[key]);

    const leadPhone = firstNonEmpty(clean("user_phone_number"), clean("to_number"));
    const fromNumber = clean("from_number");
    const modelId = clean("model_id");

    const callOut: Record<string, unknown> = { ...c };
    callOut.model_id = modelId;
    callOut.from_number = fromNumber;
    callOut.to_number = leadPhone;
    callOut.user_phone_number = clean("user_phone_number");
    callOut.synthflow_call_id = firstNonEmpty(clean("synthflow_call_id"));
    if (c["contact_id_ghl"] !== undefined) {
      const v = optionalCleanString(c["contact_id_ghl"]);
      if (v !== undefined) {
        callOut.contact_id_ghl = v;
      } else {
        delete callOut.contact_id_ghl;
      }
    }
    if (c["client_account_id"] !== undefined) {
      const v = optionalCleanString(c["client_account_id"]);
      if (v !== undefined) {
        callOut.client_account_id = v;
      } else {
        delete callOut.client_account_id;
      }
    }
    if ("subaccount_id_ghl" in c) {
      callOut.subaccount_id_ghl = cleanSynthflowOutboundScalar(c["subaccount_id_ghl"]) || "";
    }
    if (c["lead_uid"] !== undefined) {
      const v = optionalCleanString(c["lead_uid"]);
      if (v !== undefined) {
        callOut.lead_uid = v;
      } else {
        delete callOut.lead_uid;
      }
    }
    callOut.customer_name = clean("customer_name");
    callOut.scheduling_calendar_link = clean("scheduling_calendar_link");
    callOut.scheduling_calendar_id = clean("scheduling_calendar_id");

    return {
      event: root.event,
      call: callOut,
    };
  })
  .superRefine((data, ctx) => {
    const call = data.call as { to_number?: unknown };
    const lead = typeof call.to_number === "string" ? call.to_number.trim() : "";
    if (!lead) {
      ctx.addIssue({
        code: "custom",
        message: "Lead phone required (call.user_phone_number or call.to_number)",
        path: ["call", "to_number"],
      });
    }
  });

export type SynthflowOutboundContextBody = z.output<typeof synthflowOutboundContextBodySchema>;
