/**
 * Canonical SA360 logical custom field keys (contract).
 * GHL field UUIDs must never be hardcoded here — only logical keys.
 */

/** Required for delivery stamping when customFieldStampRequired is enabled. */
export const SA360_CORE_REQUIRED_FIELD_KEYS = [
  "sa360_lead_uid",
  "sa360_client_account_id",
  "sa360_lifecycle_stage",
  "sa360_routing_status",
  "sa360_backend_sync_status",
  "sa360_delivery_plan_id",
  "sa360_delivery_run_id",
  "sa360_event_uuid",
  "sa360_utm_campaign",
  "sa360_campaign_id",
  "sa360_source_platform",
] as const;

/** Optional keys used by delivery / adapter stamping. */
export const SA360_OPTIONAL_FIELD_KEYS = [
  "sa360_niche_key",
  "sa360_niche_label",
  "sa360_source_type",
  "sa360_campaign_name",
  "sa360_adset_id",
  "sa360_ad_id",
  "sa360_utm_content",
  "sa360_delivery_idempotency_key",
  "sa360_delivery_mode",
] as const;

export type Sa360CoreRequiredFieldKey = (typeof SA360_CORE_REQUIRED_FIELD_KEYS)[number];
export type Sa360OptionalFieldKey = (typeof SA360_OPTIONAL_FIELD_KEYS)[number];
export type Sa360LogicalFieldKey = Sa360CoreRequiredFieldKey | Sa360OptionalFieldKey;

export const SA360_ALL_LOGICAL_FIELD_KEYS: readonly Sa360LogicalFieldKey[] = [
  ...SA360_CORE_REQUIRED_FIELD_KEYS,
  ...SA360_OPTIONAL_FIELD_KEYS,
];

export function isSa360CoreRequiredFieldKey(key: string): key is Sa360CoreRequiredFieldKey {
  return (SA360_CORE_REQUIRED_FIELD_KEYS as readonly string[]).includes(key);
}
