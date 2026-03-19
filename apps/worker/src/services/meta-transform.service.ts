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
        event_source_url: "https://app.gohighlevel.com/",
        action_source: "website",
        user_data: {
          em: payload.contact.email ? [sha256(payload.contact.email)] : undefined,
          ph: payload.contact.phone_e164 ? [sha256(payload.contact.phone_e164)] : undefined,
          fn: payload.contact.first_name ? [sha256(payload.contact.first_name)] : undefined,
          ln: payload.contact.last_name ? [sha256(payload.contact.last_name)] : undefined,
          st: payload.contact.state ? [sha256(payload.contact.state)] : undefined,
          zp: payload.contact.zip ? [sha256(payload.contact.zip)] : undefined,
          external_id: payload.contact.lead_uid ? [sha256(payload.contact.lead_uid)] : undefined,
          fbc: payload.attribution.fbclid || undefined,
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