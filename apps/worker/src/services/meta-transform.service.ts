import crypto from "node:crypto";
import type { LifecycleWebhookPayload } from "@sa360/shared";

function sha256(value?: string) {
  if (!value) return undefined;
  return crypto.createHash("sha256").update(value.trim().toLowerCase()).digest("hex");
}

export function buildMetaPayload(payload: LifecycleWebhookPayload) {
  return {
    data: [
      {
        event_name: payload.event.event_name_meta,
        event_time: payload.event.event_time_unix,
        event_id: payload.event.event_uuid,
        action_source: "system_generated",
        user_data: {
          em: sha256(payload.contact.email),
          ph: sha256(payload.contact.phone_e164),
          fn: sha256(payload.contact.first_name),
          ln: sha256(payload.contact.last_name),
          st: sha256(payload.contact.state),
          zp: sha256(payload.contact.zip),
          external_id: sha256(payload.contact.lead_uid),
          fbc: payload.attribution.fbclid,
        },
        custom_data: {
          value: payload.event.value_score ?? 0,
          currency: payload.event.currency ?? "USD",
          lead_uid: payload.contact.lead_uid,
          campaign_id: payload.attribution.campaign_id,
          ad_id: payload.attribution.ad_id,
          lead_type: payload.state.lead_type,
          agent_id: payload.ownership?.assigned_agent_id,
        },
      },
    ],
  };
}