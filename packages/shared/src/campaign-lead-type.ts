/**
 * Controlled campaign Lead Type catalog.
 *
 * The key is the stable value stored on a source. The label is the exact
 * display string Sheets, GHL, and other delivery writers should copy when a
 * resolved intake decision names that key. Changing a label here does not
 * rewrite a decision that was already stored.
 */

export const CAMPAIGN_LEAD_TYPE_KEYS = [
  "vet_web_form",
  "nurse_web_form",
  "trucker_web_form",
] as const;

export type CampaignLeadTypeKey = (typeof CAMPAIGN_LEAD_TYPE_KEYS)[number];

export const CAMPAIGN_LEAD_TYPE_LABELS: Record<CampaignLeadTypeKey, string> = {
  vet_web_form: "Vet Web Form",
  nurse_web_form: "Nurse Web Form",
  trucker_web_form: "Trucker Web Form",
};

export function isCampaignLeadTypeKey(value: string): value is CampaignLeadTypeKey {
  return (CAMPAIGN_LEAD_TYPE_KEYS as readonly string[]).includes(value);
}

export function campaignLeadTypeLabel(key: CampaignLeadTypeKey): string {
  return CAMPAIGN_LEAD_TYPE_LABELS[key];
}

/** Exact catalog label only. Case and spacing must match. */
export function campaignLeadTypeKeyFromLabel(label: string): CampaignLeadTypeKey | null {
  for (const key of CAMPAIGN_LEAD_TYPE_KEYS) {
    if (CAMPAIGN_LEAD_TYPE_LABELS[key] === label) return key;
  }
  return null;
}
