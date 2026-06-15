/** Canonical source attribute keys recognized by SA360 intake. */
export const CANONICAL_SOURCE_ATTRIBUTE_KEYS = [
  "military_status",
  "branch_of_service",
  "sex",
  "marital_status",
  "desired_coverage",
  "primary_reason",
  "beneficiary",
  "date_of_birth",
  "age",
  "best_time_to_call",
  "applied_for_other_insurance",
  "disability_rating",
  "placement",
  "ad_id",
  "ad_name",
  "adset_id",
  "adset_name",
  "fbclid",
  "parent_url",
  "trustedform_cert_url",
  "leadid_token",
  "phone_verified",
  "email_verified",
  "ip_address",
  "user_agent",
] as const;

export type CanonicalSourceAttributeKey = (typeof CANONICAL_SOURCE_ATTRIBUTE_KEYS)[number];

/** Default alias registry — exact and normalized key resolution only (no fuzzy auto-match). */
export const DEFAULT_SOURCE_FIELD_ALIASES: Record<
  CanonicalSourceAttributeKey,
  readonly string[]
> = {
  military_status: ["military_status", "military_status_"],
  branch_of_service: ["branch_of_service", "branch", "military_branch"],
  sex: ["sex", "gender"],
  marital_status: ["marital_status", "marital_status_"],
  desired_coverage: [
    "desired_coverage",
    "desired_coverage_amount",
    "coverage_amount",
    "requested_coverage",
    "please_select_your_desired_coverage_amount",
  ],
  primary_reason: [
    "primary_reason",
    "reason_for_insurance",
    "reason_for_wanting_insurance",
    "coverage_reason",
  ],
  beneficiary: [
    "beneficiary",
    "who_would_be_your_beneficiary",
    "who_is_coverage_for",
    "coverage_for",
  ],
  date_of_birth: ["date_of_birth", "dob", "birth_date", "date"],
  age: ["age"],
  best_time_to_call: [
    "best_time_to_call",
    "best_time_to_review",
    "best_time",
    "contact_time",
    "time_to_call",
  ],
  applied_for_other_insurance: ["applied_for_other_insurance"],
  disability_rating: ["disability_rating"],
  placement: ["placement"],
  ad_id: ["ad_id"],
  ad_name: ["ad_name"],
  adset_id: ["adset_id"],
  adset_name: ["adset_name"],
  fbclid: ["fbclid"],
  parent_url: ["parent_url"],
  trustedform_cert_url: ["trustedform_cert_url"],
  leadid_token: ["leadid_token", "leadid"],
  phone_verified: ["phone_verified"],
  email_verified: ["email_verified"],
  ip_address: ["ip_address"],
  user_agent: ["user_agent"],
};

const RESERVED_RAW_KEYS = new Set([
  "provider",
  "lead_id",
  "submitted_at",
  "first_name",
  "last_name",
  "full_name",
  "email",
  "phone",
  "state",
  "sa360_source_system",
  "sa360_source_platform",
  "sa360_source_type",
  "sa360_route_key",
  "sa360_campaign_name",
  "sa360_funnel_name",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "fbp",
  "fbc",
  "schema_version",
  "client_account_id",
]);

export function normalizeSourceFieldKey(key: string): string {
  return key
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

function buildAliasLookup(
  routeAliasOverrides?: Record<string, readonly string[]>
): Map<string, CanonicalSourceAttributeKey> {
  const lookup = new Map<string, CanonicalSourceAttributeKey>();

  for (const canonical of CANONICAL_SOURCE_ATTRIBUTE_KEYS) {
    lookup.set(normalizeSourceFieldKey(canonical), canonical);
    const aliases = [
      ...(DEFAULT_SOURCE_FIELD_ALIASES[canonical] ?? []),
      ...(routeAliasOverrides?.[canonical] ?? []),
    ];
    for (const alias of aliases) {
      lookup.set(normalizeSourceFieldKey(alias), canonical);
    }
  }

  if (routeAliasOverrides) {
    for (const [canonical, aliases] of Object.entries(routeAliasOverrides)) {
      if (!(CANONICAL_SOURCE_ATTRIBUTE_KEYS as readonly string[]).includes(canonical)) continue;
      for (const alias of aliases) {
        lookup.set(normalizeSourceFieldKey(alias), canonical as CanonicalSourceAttributeKey);
      }
    }
  }

  return lookup;
}

export function resolveCanonicalAttributeKey(
  sourceKey: string,
  routeAliasOverrides?: Record<string, readonly string[]>
): CanonicalSourceAttributeKey | null {
  const normalized = normalizeSourceFieldKey(sourceKey);
  if (!normalized) return null;
  const lookup = buildAliasLookup(routeAliasOverrides);
  return lookup.get(normalized) ?? null;
}

export function isReservedSourceRawKey(key: string): boolean {
  return RESERVED_RAW_KEYS.has(normalizeSourceFieldKey(key));
}

export function listIncomingAnswerKeys(raw: Record<string, unknown>): string[] {
  return Object.keys(raw).filter((k) => !isReservedSourceRawKey(k));
}
