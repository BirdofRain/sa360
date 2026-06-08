/**
 * Demo-only lead_created payload for direct delivery (Smart Agent 360 Demo).
 * Fake contact data only — unique event_uuid / lead_uid per load.
 */

export const DEMO_SA360_ATTRIBUTION = {
  source_platform: "facebook",
  source_type: "facebook_lead_form",
  campaign_id: "120241930690720364",
  campaign_name: "Master Vet Pixel",
  ad_id: "120241930747440364",
  meta_dataset_id: "943556280266263",
  utm_campaign: "SA360 Demo Vet FEX (test form)",
} as const;

export function buildDirectDemoLeadCreatedPayload(nowMs = Date.now()): Record<string, unknown> {
  const suffix = nowMs.toString(36);
  return {
    schema_version: "1",
    client_account_id: "lal_master_vet",
    contact: {
      lead_uid: `demo_sa360_direct_${suffix}`,
      contact_id_ghl: `demo_contact_${suffix}`,
      first_name: "Test",
      last_name: "Lead",
      phone_e164: "+15550100999",
      email: `demo.direct.${suffix}@example.test`,
    },
    state: {
      lifecycle_stage: "LEAD_CREATED",
    },
    attribution: { ...DEMO_SA360_ATTRIBUTION },
    event: {
      event_uuid: `demo_sa360_evt_${suffix}`,
      event_name_internal: "lead_created",
      event_name_meta: "Lead Created (SA360 direct delivery demo — test only)",
      send_to_meta: false,
    },
    routing: {
      niche_key: "vet",
      product_type: "fex",
    },
  };
}

export function directDemoLeadCreatedPayloadJson(pretty = true): string {
  const payload = buildDirectDemoLeadCreatedPayload();
  return pretty ? JSON.stringify(payload, null, 2) : JSON.stringify(payload);
}
