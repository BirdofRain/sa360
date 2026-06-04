/**
 * Demo-only lifecycle payload for Routing Dry Run test panel.
 * Fake contact + unique event_uuid — safe for meetings (shadow routing only).
 */

export const DEMO_DYLAN_ATTRIBUTION = {
  source_platform: "facebook",
  source_type: "facebook_lead_form",
  campaign_id: "120241930690720364",
  campaign_name: "Master Vet Pixel",
  ad_id: "120241930747440364",
  meta_dataset_id: "943556280266263",
  utm_campaign: "Dylan Diaz- Vet FEX (lead form) 2/18/26 (Andromeda)",
} as const;

export function buildDemoDylanLeadCreatedPayload(nowMs = Date.now()): Record<string, unknown> {
  const suffix = nowMs.toString(36);
  return {
    schema_version: "1",
    client_account_id: "lal_master_vet",
    contact: {
      lead_uid: `demo_dylan_lead_${suffix}`,
      contact_id_ghl: `demo_contact_${suffix}`,
      first_name: "Demo",
      last_name: "Dylan",
      phone_e164: "+15550100099",
      email: `demo.dylan.${suffix}@example.test`,
    },
    state: {
      lifecycle_stage: "LEAD_CREATED",
    },
    attribution: { ...DEMO_DYLAN_ATTRIBUTION },
    event: {
      event_uuid: `demo_dylan_evt_${suffix}`,
      event_name_internal: "lead_created",
      event_name_meta: "Lead Created (SA360 demo — shadow only)",
      send_to_meta: false,
    },
    routing: {
      niche_key: "vet",
      product_type: "fex",
    },
  };
}

export function demoDylanLeadCreatedPayloadJson(pretty = true): string {
  const payload = buildDemoDylanLeadCreatedPayload();
  return pretty ? JSON.stringify(payload, null, 2) : JSON.stringify(payload);
}
