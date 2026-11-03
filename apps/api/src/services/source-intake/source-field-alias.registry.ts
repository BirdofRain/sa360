import { isLeadCaptureUuidLeadId } from "../../lib/leadcapture-lead-id.js";

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
  "rig_type",
  "company_or_independent",
  "healthcare_profession",
  "primary_concern",
  "homeowner",
  "house_type",
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
  military_status: ["military_status", "military_status_", "veteran_status", "service_status"],
  branch_of_service: [
    "branch_of_service",
    "military_branch",
    "Branch of Service",
    "Military Branch",
    "service_branch",
    "armed_forces_branch",
  ],
  // `gender` is not an alias of `sex`. Consent text is not a granted-consent flag.
  sex: ["sex"],
  marital_status: ["marital_status", "marital_status_", "maritalStatus", "marriage_status"],
  desired_coverage: [
    "desired_coverage",
    "desired_coverage_amount",
    "coverage_amount",
    "Coverage Amount",
    "Desired Coverage",
    "coverageAmount",
    "requested_coverage",
    "coverage_requested",
    "please_select_your_desired_coverage_amount",
  ],
  primary_reason: [
    "primary_reason",
    "reason_for_insurance",
    "reason_for_wanting_insurance",
    "coverage_reason",
    "reason_for_coverage",
  ],
  beneficiary: [
    "beneficiary",
    "Beneficiary",
    "beneficiary_name",
    "Beneficiary Name",
    "who_would_be_your_beneficiary",
    "who_is_coverage_for",
    "coverage_for",
  ],
  date_of_birth: [
    "date_of_birth",
    "dob",
    "birth_date",
    "dateOfBirth",
    "birthDate",
    "birthday",
    "birth_day",
  ],
  age: ["age", "consumer_age", "consumerAge", "applicant_age", "age_in_years"],
  best_time_to_call: [
    "best_time_to_call",
    "best_time_to_review",
    "best_time",
    "contact_time",
    "time_to_call",
    "preferred_call_time",
    "best_contact_time",
  ],
  applied_for_other_insurance: ["applied_for_other_insurance"],
  disability_rating: [
    "disability_rating",
    "Disability Rating",
    "VA Disability Rating",
    "VA Rating",
    "disability_percentage",
  ],
  rig_type: ["rig_type", "Rig Type", "Truck Type", "type_of_rig"],
  company_or_independent: [
    "company_or_independent",
    "Company/Independent",
    "Company or Independent",
    "Driver Type",
    "owner_operator_status",
  ],
  healthcare_profession: [
    "healthcare_profession",
    "Healthcare Profession",
    "Medical Profession",
  ],
  primary_concern: [
    "primary_concern",
    "Primary Concern",
    "main_concern",
    "Primary Need",
  ],
  homeowner: [
    "homeowner",
    "Homeowner",
    "Home Owner",
    "owns_home",
    "home_ownership",
  ],
  house_type: [
    "house_type",
    "House Type",
    "Home Type",
    "property_type",
    "Property Type",
  ],
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
  "answers",
  "provider",
  "lead_id",
  "ref_id",
  "submitted_at",
  "first_name",
  "last_name",
  "full_name",
  "name",
  "email",
  "phone",
  "phone_number",
  "state",
  "date",
  "time",
  "is_dropoff",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_id",
  "utm_content",
  "utm_term",
  "fbclid",
  "fbp",
  "fbc",
  "utm_term",
  "fbclid",
  "fbp",
  "fbc",
  "timestamp",
  "created_at",
  "updated_at",
  "schema_version",
  "client_account_id",
  "sa360_source_system",
  "sa360_source_platform",
  "sa360_source_type",
  "sa360_route_key",
  "sa360_campaign_name",
  "sa360_funnel_name",
  // Recognized source/system metadata fields — preserved as non-blocking
  // metadata rather than surfaced as unmapped survey answers.
  "lead_form",
  "location",
  "niche",
  "niche_key",
  "product_type",
  "lead_proof",
]);

/**
 * One key shape for alias lookup.
 *
 * CamelCase boundaries become underscores before letters are lowercased, then
 * spaces, plus signs, and hyphens collapse the same way. `dateOfBirth` and
 * `date_of_birth` meet. `zipcode` does not become `zip_code`; that pair is an
 * explicit alias, not a normalization merge.
 */
export function normalizeSourceFieldKey(key: string): string {
  return key
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[\s+\-]+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * Contact fields. These are not survey attributes and are not renamed.
 * `name` maps to `full_name` only. Postal codes stay strings so leading zeros
 * survive. `zipcode` and `zip_code` are both listed because camelCase splitting
 * does not invent an underscore inside an already-lowercase word.
 */
export const INCOMING_IDENTITY_FIELD_ALIASES = {
  first_name: ["first_name", "firstName", "firstname", "given_name"],
  last_name: ["last_name", "lastName", "lastname", "surname", "family_name"],
  full_name: ["full_name", "fullName", "name"],
  email: ["email", "email_address", "emailAddress"],
  phone: ["phone", "phone_number", "phoneNumber", "mobile", "mobile_phone", "cell_phone"],
  state: ["state", "state_code", "state_of_residence"],
  zip: ["zip", "zip_code", "zipCode", "zipcode", "postal_code", "postalCode"],
} as const;

export type IncomingIdentityFieldKey = keyof typeof INCOMING_IDENTITY_FIELD_ALIASES;

/**
 * Names that are not safe as global aliases. They map only through
 * `SCOPED_INCOMING_FIELD_BINDINGS`.
 */
export const AMBIGUOUS_INCOMING_FIELD_KEYS = [
  "date",
  "time",
  "branch",
  "married",
  "is_married",
  "coverage",
  "reason",
  "status",
  "timestamp",
  "created_at",
] as const;

const AMBIGUOUS_INCOMING_FIELD_KEY_SET = new Set<string>(AMBIGUOUS_INCOMING_FIELD_KEYS);

export function isAmbiguousIncomingFieldKey(key: string): boolean {
  const normalized = normalizeSourceFieldKey(key);
  return Boolean(normalized) && AMBIGUOUS_INCOMING_FIELD_KEY_SET.has(normalized);
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
      const normalized = normalizeSourceFieldKey(alias);
      if (!normalized || isAmbiguousIncomingFieldKey(normalized)) continue;
      lookup.set(normalized, canonical);
    }
  }

  if (routeAliasOverrides) {
    for (const [canonical, aliases] of Object.entries(routeAliasOverrides)) {
      if (!(CANONICAL_SOURCE_ATTRIBUTE_KEYS as readonly string[]).includes(canonical)) continue;
      for (const alias of aliases) {
        const normalized = normalizeSourceFieldKey(alias);
        if (!normalized || isAmbiguousIncomingFieldKey(normalized)) continue;
        lookup.set(normalized, canonical as CanonicalSourceAttributeKey);
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

export type ScopedIncomingFieldBinding = {
  id: string;
  provider: string;
  sourceSystem: string;
  /**
   * SA360 `SourceFunnel.id`. This is not the LeadCapture funnel UUID.
   * When it is set, any other incoming id rejects this binding, including
   * its page.
   */
  sourceFunnelId?: string;
  /**
   * LeadCapture `SourceFunnel.providerFunnelId`. This is not `SourceFunnel.id`.
   * A supplied UUID may agree with this value. It never selects the binding by
   * itself, and a different UUID does not fall through to the page.
   */
  providerFunnelId?: string;
  /** Exact `hostname + pathname` from `normalizeLeadCaptureParentUrl`. */
  parentUrlKey?: string;
  /**
   * Exact legacy endpoint route key for a form that has no page URL in the
   * retained payload. Never `UNKNOWN_ROUTE`, and never used to treat `date`
   * as a birthday.
   */
  sourceRouteKey?: string;
  /**
   * Provider lead ids that identify an example submission. They are not
   * `SourceLeadEvent` ids and they do not select a binding.
   */
  knownSourceLeadIds?: readonly string[];
  aliases: Readonly<Record<string, CanonicalSourceAttributeKey>>;
};

/** Confirmed next-gen veteran page. `date` on this form is the birthday. */
export const CONFIRMED_JULIA_DODGE_PARENT_URL_KEY =
  "go.lifeinsuranceforvets.com/learn-julia-dodge";

export const CONFIRMED_JULIA_DODGE_SOURCE_FUNNEL_ID = "cmv8k6uui00q0lc0uyto17ld1";

/**
 * External LeadCapture funnel UUID for Julia's page, from the public funnel
 * config. The embed short id is not this UUID.
 */
export const CONFIRMED_JULIA_DODGE_PROVIDER_FUNNEL_ID = "b002eb13-43cc-4d90-99fd-e23bc02ac822";

/** Confirmed next-gen veteran page. `date` on this form is the birthday. */
export const CONFIRMED_ERIKS_VEIDEMANIS_PARENT_URL_KEY =
  "go.lifeinsuranceforvets.com/learn-eriks-veidemanis";

/**
 * External LeadCapture funnel UUID for Eriks's page. The SA360 SourceFunnel
 * id was not verified, so it is intentionally absent.
 */
export const CONFIRMED_ERIKS_VEIDEMANIS_PROVIDER_FUNNEL_ID =
  "c12cf351-0bc4-4127-8786-50a67643eadb";

/** Provider lead id from the confirmed example. Not a SourceLeadEvent id. */
export const CONFIRMED_ERIKS_VEIDEMANIS_SOURCE_LEAD_ID =
  "e452eaed-92c8-4916-9dd1-fbd001dafaac";

/** Confirmed next-gen veteran page. The public form's DOB step webhooks `date`. */
export const CONFIRMED_ALEX_GROSS_PARENT_URL_KEY = "go.lifeinsuranceforvets.com/learn-alex-gross";

/** External LeadCapture funnel UUID. The SA360 SourceFunnel id was not verified. */
export const CONFIRMED_ALEX_GROSS_PROVIDER_FUNNEL_ID = "68d9c95b-e186-4c99-8fc9-5b86b17d8eee";

/** Confirmed next-gen veteran page. The public form's DOB step webhooks `date`. */
export const CONFIRMED_JEAN_PEREZ_PARENT_URL_KEY = "go.lifeinsuranceforvets.com/learn-jean-perez";

/** External LeadCapture funnel UUID. The SA360 SourceFunnel id was not verified. */
export const CONFIRMED_JEAN_PEREZ_PROVIDER_FUNNEL_ID = "181b0e69-fd55-44e3-be68-a284c96435b0";

/** Confirmed next-gen nurse page. The public form's DOB step webhooks `date`. */
export const CONFIRMED_ANDRU_DURANSO_PARENT_URL_KEY =
  "healthcareworker.familylegacyprotection.com/learn-andru-duranso";

/** External LeadCapture funnel UUID. The SA360 SourceFunnel id was not verified. */
export const CONFIRMED_ANDRU_DURANSO_PROVIDER_FUNNEL_ID = "18c28feb-5c3d-4bd0-94d8-1ed33a6fa718";

/** Confirmed next-gen nurse page. The public form's DOB step webhooks `date`. */
export const CONFIRMED_ALEX_FEUERSTEIN_PARENT_URL_KEY =
  "healthcareworker.familylegacyprotection.com/learn-alex-feuerstein";

/** External LeadCapture funnel UUID. The SA360 SourceFunnel id was not verified. */
export const CONFIRMED_ALEX_FEUERSTEIN_PROVIDER_FUNNEL_ID = "22ac7ad2-97a3-4fce-bd4d-02124b6e4520";

/**
 * Live page `learn-5428`. LeadCapture names the embedded funnel Tori Haskell.
 * The page is unassociated: this binding does not name a receiving client.
 */
export const CONFIRMED_TORI_HASKELL_PARENT_URL_KEY = "go.lifeinsuranceforvets.com/learn-5428";

export const CONFIRMED_TORI_HASKELL_SOURCE_FUNNEL_ID = "cmw090p2c012skm0u1ku2cokp";

export const CONFIRMED_TORI_HASKELL_PROVIDER_FUNNEL_ID = "96b80928-a16d-491b-a8f7-f3528becf567";

/**
 * Agents page `learn-nick-agents`. This is not
 * `learn-nicholas-dambruoso`, whose birthday key is already `date_of_birth`.
 */
export const CONFIRMED_NICK_AGENTS_PARENT_URL_KEY = "go.lifeinsuranceforvets.com/learn-nick-agents";

export const CONFIRMED_NICK_AGENTS_SOURCE_FUNNEL_ID = "cmw0knqfk01ntkm0uorv5xrl7";

export const CONFIRMED_NICK_AGENTS_PROVIDER_FUNNEL_ID = "006e7d56-604f-4d19-a273-3044dcf143f2";

/** Confirmed next-gen veteran page. The public form's DOB step webhooks `date`. */
export const CONFIRMED_ROB_ARDEN_PARENT_URL_KEY = "go.lifeinsuranceforvets.com/learn-rob-arden";

export const CONFIRMED_ROB_ARDEN_SOURCE_FUNNEL_ID = "cmubqp3qv07htm00v2eva4jdl";

export const CONFIRMED_ROB_ARDEN_PROVIDER_FUNNEL_ID = "c5e832d0-ef1b-4837-960c-d312f7ebbd2b";

/** Confirmed next-gen veteran page. The public form's DOB step webhooks `date`. */
export const CONFIRMED_VERNON_BAKER_PARENT_URL_KEY = "go.lifeinsuranceforvets.com/learn-vernon-baker";

export const CONFIRMED_VERNON_BAKER_SOURCE_FUNNEL_ID = "cmuebit920awam00v7kheh6au";

export const CONFIRMED_VERNON_BAKER_PROVIDER_FUNNEL_ID = "5d0892ee-b3a1-45a3-a111-bcd3065e394b";

/**
 * Confirmed next-gen page `learn-daniel-gvili-new`. The older
 * `learn-daniel-gvili` page is a different source and is not this binding.
 */
export const CONFIRMED_DANIEL_GVILI_PARENT_URL_KEY =
  "go.lifeinsuranceforvets.com/learn-daniel-gvili-new";

export const CONFIRMED_DANIEL_GVILI_SOURCE_FUNNEL_ID = "cmubzdlct07vcm00v0ca90xhq";

export const CONFIRMED_DANIEL_GVILI_PROVIDER_FUNNEL_ID = "dd056ca1-dbf1-40af-8eb9-563281a80b8d";

/** Confirmed next-gen veteran page. The public form's DOB step webhooks `date`. */
export const CONFIRMED_JACOB_ZAPATA_PARENT_URL_KEY = "go.lifeinsuranceforvets.com/learn-jacob-zapata";

export const CONFIRMED_JACOB_ZAPATA_SOURCE_FUNNEL_ID = "cmubr493407ivm00v401jrwc8";

export const CONFIRMED_JACOB_ZAPATA_PROVIDER_FUNNEL_ID = "e8d5cef4-5713-4000-8313-bb141ef1fbbd";

/** Confirmed next-gen veteran page. The public form's DOB step webhooks `date`. */
export const CONFIRMED_DOM_SCALICE_PARENT_URL_KEY = "go.lifeinsuranceforvets.com/learn-dom-scalice";

export const CONFIRMED_DOM_SCALICE_SOURCE_FUNNEL_ID = "cmtwbyi5v00d1j50uf933qfsc";

export const CONFIRMED_DOM_SCALICE_PROVIDER_FUNNEL_ID = "d4d275e1-ce6a-4856-8ae4-ae9c7ce9ab38";

/** Confirmed next-gen veteran page. The public form's DOB step webhooks `date`. */
export const CONFIRMED_JAMES_LAIRD_PARENT_URL_KEY = "go.lifeinsuranceforvets.com/learn-james-laird";

export const CONFIRMED_JAMES_LAIRD_SOURCE_FUNNEL_ID = "cmvcejoyo01nzjh0u0jh07us0";

export const CONFIRMED_JAMES_LAIRD_PROVIDER_FUNNEL_ID = "aa7e4196-c8f8-4f84-abc0-5526f903460e";

/**
 * Legacy James Torrey veteran form. Retained fixtures send `branch` and use
 * `date` + `time` as the submission calendar, not a birthday.
 */
export const CONFIRMED_LEGACY_JAMES_TORREY_ROUTE_KEY =
  "LCIO_LEGACY_VET_LIFE_JAMES_TORREY_VET_FEX";

export const SCOPED_INCOMING_FIELD_BINDINGS: readonly ScopedIncomingFieldBinding[] = [
  {
    id: "leadcapture_io_nextgen_vet_julia_dodge",
    provider: "leadcapture_io",
    sourceSystem: "leadcapture_io_nextgen",
    sourceFunnelId: CONFIRMED_JULIA_DODGE_SOURCE_FUNNEL_ID,
    providerFunnelId: CONFIRMED_JULIA_DODGE_PROVIDER_FUNNEL_ID,
    parentUrlKey: CONFIRMED_JULIA_DODGE_PARENT_URL_KEY,
    aliases: {
      date: "date_of_birth",
      branch: "branch_of_service",
      married: "marital_status",
      is_married: "marital_status",
    },
  },
  {
    id: "leadcapture_io_nextgen_vet_eriks_veidemanis",
    provider: "leadcapture_io",
    sourceSystem: "leadcapture_io_nextgen",
    providerFunnelId: CONFIRMED_ERIKS_VEIDEMANIS_PROVIDER_FUNNEL_ID,
    parentUrlKey: CONFIRMED_ERIKS_VEIDEMANIS_PARENT_URL_KEY,
    knownSourceLeadIds: [CONFIRMED_ERIKS_VEIDEMANIS_SOURCE_LEAD_ID],
    aliases: {
      date: "date_of_birth",
    },
  },
  {
    id: "leadcapture_io_nextgen_vet_alex_gross",
    provider: "leadcapture_io",
    sourceSystem: "leadcapture_io_nextgen",
    providerFunnelId: CONFIRMED_ALEX_GROSS_PROVIDER_FUNNEL_ID,
    parentUrlKey: CONFIRMED_ALEX_GROSS_PARENT_URL_KEY,
    aliases: {
      date: "date_of_birth",
    },
  },
  {
    id: "leadcapture_io_nextgen_vet_jean_perez",
    provider: "leadcapture_io",
    sourceSystem: "leadcapture_io_nextgen",
    providerFunnelId: CONFIRMED_JEAN_PEREZ_PROVIDER_FUNNEL_ID,
    parentUrlKey: CONFIRMED_JEAN_PEREZ_PARENT_URL_KEY,
    aliases: {
      date: "date_of_birth",
    },
  },
  {
    id: "leadcapture_io_nextgen_nurse_andru_duranso",
    provider: "leadcapture_io",
    sourceSystem: "leadcapture_io_nextgen",
    providerFunnelId: CONFIRMED_ANDRU_DURANSO_PROVIDER_FUNNEL_ID,
    parentUrlKey: CONFIRMED_ANDRU_DURANSO_PARENT_URL_KEY,
    aliases: {
      date: "date_of_birth",
    },
  },
  {
    id: "leadcapture_io_nextgen_nurse_alex_feuerstein",
    provider: "leadcapture_io",
    sourceSystem: "leadcapture_io_nextgen",
    providerFunnelId: CONFIRMED_ALEX_FEUERSTEIN_PROVIDER_FUNNEL_ID,
    parentUrlKey: CONFIRMED_ALEX_FEUERSTEIN_PARENT_URL_KEY,
    aliases: {
      date: "date_of_birth",
    },
  },
  {
    id: "leadcapture_io_nextgen_vet_tori_haskell",
    provider: "leadcapture_io",
    sourceSystem: "leadcapture_io_nextgen",
    sourceFunnelId: CONFIRMED_TORI_HASKELL_SOURCE_FUNNEL_ID,
    providerFunnelId: CONFIRMED_TORI_HASKELL_PROVIDER_FUNNEL_ID,
    parentUrlKey: CONFIRMED_TORI_HASKELL_PARENT_URL_KEY,
    aliases: {
      date: "date_of_birth",
    },
  },
  {
    id: "leadcapture_io_nextgen_vet_nick_dambruoso_agents",
    provider: "leadcapture_io",
    sourceSystem: "leadcapture_io_nextgen",
    sourceFunnelId: CONFIRMED_NICK_AGENTS_SOURCE_FUNNEL_ID,
    providerFunnelId: CONFIRMED_NICK_AGENTS_PROVIDER_FUNNEL_ID,
    parentUrlKey: CONFIRMED_NICK_AGENTS_PARENT_URL_KEY,
    aliases: {
      date: "date_of_birth",
    },
  },
  {
    id: "leadcapture_io_nextgen_vet_rob_arden",
    provider: "leadcapture_io",
    sourceSystem: "leadcapture_io_nextgen",
    sourceFunnelId: CONFIRMED_ROB_ARDEN_SOURCE_FUNNEL_ID,
    providerFunnelId: CONFIRMED_ROB_ARDEN_PROVIDER_FUNNEL_ID,
    parentUrlKey: CONFIRMED_ROB_ARDEN_PARENT_URL_KEY,
    aliases: {
      date: "date_of_birth",
    },
  },
  {
    id: "leadcapture_io_nextgen_vet_vernon_baker",
    provider: "leadcapture_io",
    sourceSystem: "leadcapture_io_nextgen",
    sourceFunnelId: CONFIRMED_VERNON_BAKER_SOURCE_FUNNEL_ID,
    providerFunnelId: CONFIRMED_VERNON_BAKER_PROVIDER_FUNNEL_ID,
    parentUrlKey: CONFIRMED_VERNON_BAKER_PARENT_URL_KEY,
    aliases: {
      date: "date_of_birth",
    },
  },
  {
    id: "leadcapture_io_nextgen_vet_daniel_gvili",
    provider: "leadcapture_io",
    sourceSystem: "leadcapture_io_nextgen",
    sourceFunnelId: CONFIRMED_DANIEL_GVILI_SOURCE_FUNNEL_ID,
    providerFunnelId: CONFIRMED_DANIEL_GVILI_PROVIDER_FUNNEL_ID,
    parentUrlKey: CONFIRMED_DANIEL_GVILI_PARENT_URL_KEY,
    aliases: {
      date: "date_of_birth",
    },
  },
  {
    id: "leadcapture_io_nextgen_vet_jacob_zapata",
    provider: "leadcapture_io",
    sourceSystem: "leadcapture_io_nextgen",
    sourceFunnelId: CONFIRMED_JACOB_ZAPATA_SOURCE_FUNNEL_ID,
    providerFunnelId: CONFIRMED_JACOB_ZAPATA_PROVIDER_FUNNEL_ID,
    parentUrlKey: CONFIRMED_JACOB_ZAPATA_PARENT_URL_KEY,
    aliases: {
      date: "date_of_birth",
    },
  },
  {
    id: "leadcapture_io_nextgen_vet_dom_scalice",
    provider: "leadcapture_io",
    sourceSystem: "leadcapture_io_nextgen",
    sourceFunnelId: CONFIRMED_DOM_SCALICE_SOURCE_FUNNEL_ID,
    providerFunnelId: CONFIRMED_DOM_SCALICE_PROVIDER_FUNNEL_ID,
    parentUrlKey: CONFIRMED_DOM_SCALICE_PARENT_URL_KEY,
    aliases: {
      date: "date_of_birth",
    },
  },
  {
    id: "leadcapture_io_nextgen_vet_james_laird",
    provider: "leadcapture_io",
    sourceSystem: "leadcapture_io_nextgen",
    sourceFunnelId: CONFIRMED_JAMES_LAIRD_SOURCE_FUNNEL_ID,
    providerFunnelId: CONFIRMED_JAMES_LAIRD_PROVIDER_FUNNEL_ID,
    parentUrlKey: CONFIRMED_JAMES_LAIRD_PARENT_URL_KEY,
    aliases: {
      date: "date_of_birth",
    },
  },
  {
    id: "leadcapture_io_legacy_vet_james_torrey",
    provider: "leadcapture_io",
    sourceSystem: "leadcapture_io_legacy",
    sourceRouteKey: CONFIRMED_LEGACY_JAMES_TORREY_ROUTE_KEY,
    aliases: {
      branch: "branch_of_service",
    },
  },
];

export type ScopedIncomingFieldMatchInput = {
  provider?: string | null;
  sourceSystem?: string | null;
  /** SA360 `SourceFunnel.id`. A LeadCapture funnel UUID placed here is not this id. */
  sourceFunnelId?: string | null;
  /** LeadCapture funnel UUID from the payload. Not an internal SourceFunnel id. */
  providerFunnelId?: string | null;
  parentUrlKey?: string | null;
  sourceRouteKey?: string | null;
};

const PROVIDER_FUNNEL_ID_KEYS = ["funnel_id", "form_id", "sa360_form_id"] as const;

function payloadLayers(raw: Record<string, unknown>): Record<string, unknown>[] {
  const layers = [raw];
  const answers = raw.answers;
  if (answers && typeof answers === "object" && !Array.isArray(answers)) {
    layers.push(answers as Record<string, unknown>);
  }
  return layers;
}

/** UUID-shaped funnel/form id from the provider payload. Numeric lead_form is not included. */
export function readSuppliedProviderFunnelId(raw: Record<string, unknown> | null | undefined): string | null {
  if (!raw) return null;
  for (const key of PROVIDER_FUNNEL_ID_KEYS) {
    for (const layer of payloadLayers(raw)) {
      const value = layer[key];
      if (typeof value === "string" && isLeadCaptureUuidLeadId(value)) return value.trim().toLowerCase();
    }
  }
  return null;
}

/**
 * A verified internal id is a recorded `SourceFunnel.id`. Any other non-UUID
 * id is unverified, so a confirmed page may still match. A UUID is an external
 * funnel id: it may agree with `providerFunnelId`, and a mismatch does not
 * fall through to the page. A verified id for one confirmed form on another
 * confirmed form's page matches neither. UNKNOWN_ROUTE and fuzzy URLs never match.
 */
export function matchScopedIncomingFieldBinding(
  input: ScopedIncomingFieldMatchInput
): ScopedIncomingFieldBinding | null {
  const provider = input.provider?.trim() ?? "";
  const sourceSystem = input.sourceSystem?.trim() ?? "";
  let internalId = input.sourceFunnelId?.trim() ?? "";
  let providerId = input.providerFunnelId?.trim().toLowerCase() ?? "";
  const parentUrlKey = input.parentUrlKey?.trim() ?? "";
  const routeKey = input.sourceRouteKey?.trim() ?? "";
  const sameSystem = SCOPED_INCOMING_FIELD_BINDINGS.filter(
    (binding) => binding.provider === provider && binding.sourceSystem === sourceSystem
  );
  const knownInternal = new Set(
    sameSystem.flatMap((binding) => (binding.sourceFunnelId ? [binding.sourceFunnelId] : []))
  );
  const knownProvider = new Set(
    sameSystem.flatMap((binding) => (binding.providerFunnelId ? [binding.providerFunnelId.toLowerCase()] : []))
  );
  const confirmedPages = new Set(
    sameSystem.flatMap((binding) => (binding.parentUrlKey ? [binding.parentUrlKey] : []))
  );

  if (internalId && isLeadCaptureUuidLeadId(internalId)) {
    const misplaced = internalId.toLowerCase();
    if (providerId && providerId !== misplaced) return null;
    providerId = providerId || misplaced;
    internalId = "";
  }

  const internalIsVerified = internalId !== "" && knownInternal.has(internalId);
  const providerIsKnown = providerId !== "" && knownProvider.has(providerId);
  const providerIsUnknown = providerId !== "" && !knownProvider.has(providerId);
  const idMatches: ScopedIncomingFieldBinding[] = [];
  const pageMatches: ScopedIncomingFieldBinding[] = [];
  const routeMatches: ScopedIncomingFieldBinding[] = [];

  for (const binding of sameSystem) {
    const bindingProvider = binding.providerFunnelId?.toLowerCase() ?? "";
    const providerConflicts =
      providerId !== "" &&
      (providerIsUnknown ||
        (bindingProvider !== "" && providerId !== bindingProvider) ||
        (bindingProvider === "" && providerIsKnown));
    if (internalId && binding.sourceFunnelId && internalId === binding.sourceFunnelId) {
      const pageConflicts =
        parentUrlKey !== "" &&
        binding.parentUrlKey !== undefined &&
        parentUrlKey !== binding.parentUrlKey &&
        confirmedPages.has(parentUrlKey);
      if (pageConflicts || providerConflicts) continue;
      idMatches.push(binding);
      continue;
    }
    if (internalId && binding.sourceFunnelId) continue;
    if (internalIsVerified || providerConflicts) continue;
    if (binding.parentUrlKey && parentUrlKey === binding.parentUrlKey) {
      pageMatches.push(binding);
      continue;
    }
    if (
      !internalId &&
      !providerId &&
      binding.sourceRouteKey &&
      routeKey === binding.sourceRouteKey &&
      routeKey !== "UNKNOWN_ROUTE"
    ) {
      routeMatches.push(binding);
    }
  }

  if (idMatches.length > 0) return idMatches.length === 1 ? idMatches[0]! : null;
  const fallback = [...pageMatches, ...routeMatches];
  return fallback.length === 1 ? fallback[0]! : null;
}

export function bindingTreatsDateAsBirthday(binding: ScopedIncomingFieldBinding | null): boolean {
  return scopedAliasForKey(binding, "date") === "date_of_birth";
}

export function confirmedDateOfBirthBindings(): readonly ScopedIncomingFieldBinding[] {
  return SCOPED_INCOMING_FIELD_BINDINGS.filter((binding) => bindingTreatsDateAsBirthday(binding));
}

export function confirmedCampaignSourceLeadIds(): ReadonlyArray<{ bindingId: string; sourceLeadId: string }> {
  return SCOPED_INCOMING_FIELD_BINDINGS.flatMap((binding) =>
    (binding.knownSourceLeadIds ?? []).map((sourceLeadId) => ({ bindingId: binding.id, sourceLeadId }))
  );
}

export function scopedAliasForKey(
  binding: ScopedIncomingFieldBinding | null,
  key: string
): CanonicalSourceAttributeKey | null {
  if (!binding) return null;
  const normalized = normalizeSourceFieldKey(key);
  if (!normalized) return null;
  for (const [alias, canonical] of Object.entries(binding.aliases)) {
    if (normalizeSourceFieldKey(alias) === normalized) return canonical;
  }
  return null;
}

function assertUnambiguousGlobalAliases(): void {
  const owners = new Map<string, string>();
  const claim = (normalized: string, owner: string) => {
    if (!normalized) return;
    const prior = owners.get(normalized);
    if (prior && prior !== owner) {
      throw new Error(`incoming_field_alias_collision:${normalized}:${prior}:${owner}`);
    }
    owners.set(normalized, owner);
  };

  for (const canonical of CANONICAL_SOURCE_ATTRIBUTE_KEYS) {
    claim(normalizeSourceFieldKey(canonical), canonical);
    for (const alias of DEFAULT_SOURCE_FIELD_ALIASES[canonical] ?? []) {
      const normalized = normalizeSourceFieldKey(alias);
      if (isAmbiguousIncomingFieldKey(normalized)) {
        throw new Error(`ambiguous_incoming_field_is_global:${normalized}`);
      }
      claim(normalized, canonical);
    }
  }
  for (const [canonical, aliases] of Object.entries(INCOMING_IDENTITY_FIELD_ALIASES)) {
    claim(normalizeSourceFieldKey(canonical), `identity:${canonical}`);
    for (const alias of aliases) {
      const normalized = normalizeSourceFieldKey(alias);
      if (isAmbiguousIncomingFieldKey(normalized)) {
        throw new Error(`ambiguous_incoming_field_is_global:${normalized}`);
      }
      claim(normalized, `identity:${canonical}`);
    }
  }
}

function assertScopedBindings(): void {
  const pages = new Set<string>();
  for (const binding of SCOPED_INCOMING_FIELD_BINDINGS) {
    if (
      binding.providerFunnelId &&
      binding.sourceFunnelId &&
      binding.providerFunnelId === binding.sourceFunnelId
    ) {
      throw new Error(`provider_funnel_id_collides_with_source_funnel_id:${binding.id}`);
    }
    if (!binding.parentUrlKey) continue;
    const key = `${binding.provider}|${binding.sourceSystem}|${binding.parentUrlKey}`;
    if (pages.has(key)) throw new Error(`duplicate_scoped_page:${key}`);
    pages.add(key);
  }
}

assertUnambiguousGlobalAliases();
assertScopedBindings();
