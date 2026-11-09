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
 * Confirmed next-gen page. The public DOB step webhooks `date`.
 * The unassociated source is `go.lifeinsuranceforvets.com/learn-ryan-wooldridge`.
 * No receiving client is stored on this binding.
 */
export const CONFIRMED_RYAN_WOOLDRIDGE_PARENT_URL_KEY =
  "go.lifeinsuranceforvets.com/learn-ryan-wooldridge";

export const CONFIRMED_RYAN_WOOLDRIDGE_SOURCE_FUNNEL_ID = "cmtwxk42200vcj50usrthhi2e";

export const CONFIRMED_RYAN_WOOLDRIDGE_PROVIDER_FUNNEL_ID = "39d7cc47-07f9-47ca-b3a3-2c421bd0cdb9";

/**
 * Confirmed next-gen page `learn-robby-wells`. The public DOB step webhooks `date`.
 * The typo host `go.lifeinsuranceforvet.com` is a different source and is not this binding.
 */
export const CONFIRMED_ROBBY_WELLS_PARENT_URL_KEY = "go.lifeinsuranceforvets.com/learn-robby-wells";

export const CONFIRMED_ROBBY_WELLS_SOURCE_FUNNEL_ID = "cmuo20w7c02tvdz0vf6luhl8d";

export const CONFIRMED_ROBBY_WELLS_PROVIDER_FUNNEL_ID = "f422264d-acc5-40fd-b82d-f9462db19f27";

/**
 * Legacy James Torrey veteran form. Retained fixtures send `branch` and use
 * `date` + `time` as the submission calendar, not a birthday.
 */
export const CONFIRMED_LEGACY_JAMES_TORREY_ROUTE_KEY =
  "LCIO_LEGACY_VET_LIFE_JAMES_TORREY_VET_FEX";

/**
 * Pages whose public DOB step was read in the catalog pass.
 * `alias` is the webhook key on that step. No receiving client is stored here.
 * A shared provider UUID is the form embedded on more than one page.
 */
export const CONFIRMED_CATALOG_DOB_FORMS: readonly {
  id: string;
  parentUrlKey: string;
  sourceFunnelId: string;
  providerFunnelId: string;
  alias: "date" | "date_copy";
}[] = [
  {
    id: "leadcapture_io_nextgen_vet_andrew_walters",
    parentUrlKey: "go.lifeinsuranceforvets.com/learn-andrew-walters",
    sourceFunnelId: "cmuc51ou10896m00v55041omy",
    providerFunnelId: "d83b52ea-6443-42cc-9ba3-967f98a3c47e",
    alias: "date",
  },
  {
    id: "leadcapture_io_nextgen_vet_caleb_farina",
    parentUrlKey: "go.lifeinsuranceforvets.com/learn-caleb-farina",
    sourceFunnelId: "cmubub4l207nrm00vbihrzt5s",
    providerFunnelId: "a361494a-c698-4c64-8501-d3528e7ee5b4",
    alias: "date",
  },
  {
    id: "leadcapture_io_nextgen_vet_dom_green",
    parentUrlKey: "go.lifeinsuranceforvets.com/learn-dom-green",
    sourceFunnelId: "cmubvzbjg07pzm00vr9szpicc",
    providerFunnelId: "8e1e24c0-01d0-4ddf-ae88-bb0e560d501e",
    alias: "date",
  },
  {
    id: "leadcapture_io_nextgen_vet_domenic_boselli",
    parentUrlKey: "go.lifeinsuranceforvets.com/learn-domenic-boselli",
    sourceFunnelId: "cmtw96s120090j50uaohj8vff",
    providerFunnelId: "bef47ea9-a089-47f4-b6bc-3512983eb84e",
    alias: "date",
  },
  {
    id: "leadcapture_io_nextgen_vet_jake_donnelly",
    parentUrlKey: "go.lifeinsuranceforvets.com/learn-jake-donnelly",
    sourceFunnelId: "cmucy27qs0906m00vz99w0z30",
    providerFunnelId: "5cf9f74a-52fb-4207-b7ac-b491b8602e11",
    alias: "date",
  },
  {
    id: "leadcapture_io_nextgen_vet_logan_carlisle",
    parentUrlKey: "go.lifeinsuranceforvets.com/learn-logan-carlisle",
    sourceFunnelId: "cmvehzsfq07fhjh0u20pk617w",
    providerFunnelId: "14ad9c9a-7558-43c9-9a95-ffb37630ed59",
    alias: "date",
  },
  {
    id: "leadcapture_io_nextgen_vet_louie_mezzone",
    parentUrlKey: "go.lifeinsuranceforvets.com/learn-louie-mezzone",
    sourceFunnelId: "cmuc2n4d1084jm00v5jpeva93",
    providerFunnelId: "016f5ddb-499b-412b-987e-5e0e50f70012",
    alias: "date",
  },
  {
    id: "leadcapture_io_nextgen_vet_marcus_turo",
    parentUrlKey: "go.lifeinsuranceforvets.com/learn-marcus-turo",
    sourceFunnelId: "cmtw50cn10022j50uppu0xe86",
    providerFunnelId: "69504d6d-7b9b-4e5e-82af-2ef5754049e4",
    alias: "date",
  },
  {
    id: "leadcapture_io_nextgen_vet_marissa_preslar",
    parentUrlKey: "go.lifeinsuranceforvets.com/learn-marissa-preslar",
    sourceFunnelId: "cmubr358c07iom00vpy7vk7mp",
    providerFunnelId: "bcba7b64-3b2a-4767-a547-7fc7c5a78b23",
    alias: "date",
  },
  {
    id: "leadcapture_io_nextgen_vet_matt_mandeville",
    parentUrlKey: "go.lifeinsuranceforvets.com/learn-matt-mandeville",
    sourceFunnelId: "cmvlhd9gq00e1kg0u300lar2j",
    providerFunnelId: "50d5488d-cd21-4e20-8034-8d539d8ba74d",
    alias: "date",
  },
  {
    id: "leadcapture_io_nextgen_vet_matt_wilson",
    parentUrlKey: "go.lifeinsuranceforvets.com/learn-matt-wilson",
    sourceFunnelId: "cmubrx6ho07kkm00v85r2evau",
    providerFunnelId: "573ba578-f5d5-4d92-9319-9712eee7a503",
    alias: "date",
  },
  {
    id: "leadcapture_io_nextgen_vet_michael_coulter",
    parentUrlKey: "go.lifeinsuranceforvets.com/learn-michael-coulter",
    sourceFunnelId: "cmubu9sto07nlm00vearmlnup",
    providerFunnelId: "3ce8467f-2a3b-407b-a9dd-494b7f05dc02",
    alias: "date",
  },
  {
    id: "leadcapture_io_nextgen_vet_nick_richmond",
    parentUrlKey: "go.lifeinsuranceforvets.com/learn-nick-richmond",
    sourceFunnelId: "cmubsvmp407m2m00vcu75e34l",
    providerFunnelId: "80b7cd3c-0f81-4c3b-b972-4360dff70029",
    alias: "date",
  },
  {
    id: "leadcapture_io_nextgen_vet_reid_mazzuco",
    parentUrlKey: "go.lifeinsuranceforvets.com/learn-reid-mazzuco",
    sourceFunnelId: "cmubndr0b07frm00vb4dv25bh",
    providerFunnelId: "26a47233-753e-4162-8fac-76ac5502bf35",
    alias: "date",
  },
  {
    id: "leadcapture_io_nextgen_vet_ryan_okeefe",
    parentUrlKey: "go.lifeinsuranceforvets.com/learn-ryan-okeefe",
    sourceFunnelId: "cmubrjexo07jjm00vkl5887x9",
    providerFunnelId: "5a909ecf-dc08-484b-958f-efe4532e5ffc",
    alias: "date",
  },
  {
    id: "leadcapture_io_nextgen_nurse_abdel_zubi",
    parentUrlKey: "healthcareworker.familylegacyprotection.com/learn-abdel-zubi",
    sourceFunnelId: "cmvdy0ra705adjh0ucqwkrtbs",
    providerFunnelId: "07ac67a6-8bd0-4cc8-8605-3224ed6bab18",
    alias: "date",
  },
  {
    id: "leadcapture_io_nextgen_nurse_aleksandre_vayshelboym",
    parentUrlKey: "healthcareworker.familylegacyprotection.com/learn-aleksandre-vayshelboym",
    sourceFunnelId: "cmvxwnuoc05icm40uwf7bd69k",
    providerFunnelId: "0417fe5a-97fd-4833-a897-4b490147aaae",
    alias: "date",
  },
  {
    id: "leadcapture_io_nextgen_nurse_andrew_hearn",
    parentUrlKey: "healthcareworker.familylegacyprotection.com/learn-andrew-hearn",
    sourceFunnelId: "cmtw8tgc4008hj50u998vl8ms",
    providerFunnelId: "5164ed76-dadf-40ac-b148-1863f52c0e1a",
    alias: "date",
  },
  {
    id: "leadcapture_io_nextgen_nurse_daniel_saenz",
    parentUrlKey: "healthcareworker.familylegacyprotection.com/learn-daniel-saenz",
    sourceFunnelId: "cmvlfqleb007nkg0u9lsw8wlz",
    providerFunnelId: "2d8dbf90-3f7f-4ea5-9135-bf0f5667ecfb",
    alias: "date",
  },
  {
    id: "leadcapture_io_nextgen_nurse_domenic_boselli",
    parentUrlKey: "healthcareworker.familylegacyprotection.com/learn-domenic-boselli",
    sourceFunnelId: "cmvfrw9jv003xmv0ueo9n3ikn",
    providerFunnelId: "345daf8b-1381-48c1-88d7-d77545d66ff3",
    alias: "date",
  },
  {
    id: "leadcapture_io_nextgen_nurse_jackson_randall",
    parentUrlKey: "healthcareworker.familylegacyprotection.com/learn-jackson-randall",
    sourceFunnelId: "cmvb8xfu400o8jo0ubeqesm76",
    providerFunnelId: "fb917dcc-6887-4123-a74e-8bf00f1199a3",
    alias: "date",
  },
  {
    id: "leadcapture_io_nextgen_nurse_jordan_montero",
    parentUrlKey: "healthcareworker.familylegacyprotection.com/learn-jordan-montero",
    sourceFunnelId: "cmvlfkdnf007ckg0uymx2c113",
    providerFunnelId: "30449bc9-5987-4a3f-9ffd-f2ec81350ac0",
    alias: "date",
  },
  {
    id: "leadcapture_io_nextgen_nurse_josh_petley",
    parentUrlKey: "healthcareworker.familylegacyprotection.com/learn-josh-petley",
    sourceFunnelId: "cmvdxmnxx058pjh0uaogzn17w",
    providerFunnelId: "3af72d73-b35e-459b-9048-20b9b2d8e0c8",
    alias: "date",
  },
  {
    id: "leadcapture_io_nextgen_nurse_julia_dodge",
    parentUrlKey: "healthcareworker.familylegacyprotection.com/learn-julia-dodge",
    sourceFunnelId: "cmu6wgqj302d2m00vnpz58inh",
    providerFunnelId: "5164ed76-dadf-40ac-b148-1863f52c0e1a",
    alias: "date",
  },
  {
    id: "leadcapture_io_nextgen_nurse_michael_fediw",
    parentUrlKey: "healthcareworker.familylegacyprotection.com/learn-michael-fediw",
    sourceFunnelId: "cmtw5jm4g003vj50uryi4b84b",
    providerFunnelId: "0ce82c35-20cc-4053-8606-af344387e932",
    alias: "date",
  },
  {
    id: "leadcapture_io_nextgen_nurse_michael_panza",
    parentUrlKey: "healthcareworker.familylegacyprotection.com/learn-michael-panza",
    sourceFunnelId: "cmvi7ujpi02dvgt0vivze782r",
    providerFunnelId: "c5121b9f-20b3-4eb8-ac6a-59cf6e8d2264",
    alias: "date",
  },
  {
    id: "leadcapture_io_nextgen_nurse_simon_marte",
    parentUrlKey: "healthcareworker.familylegacyprotection.com/learn-simon-marte",
    sourceFunnelId: "cmvdy4dz705aojh0umifpvzjk",
    providerFunnelId: "f3e79e12-1b05-493b-a7a0-4d67499559c1",
    alias: "date",
  },
  {
    id: "leadcapture_io_nextgen_nurse_trey_tyree",
    parentUrlKey: "healthcareworker.familylegacyprotection.com/learn-trey-tyree",
    sourceFunnelId: "cmtw4dn3p0002j50u3fj237b6",
    providerFunnelId: "898d1946-ee60-4da4-b4b4-ceac96724266",
    alias: "date",
  },
  {
    id: "leadcapture_io_nextgen_hosted_madison_v2",
    parentUrlKey: "my.leadcapture.io/p/dn_omzoj",
    sourceFunnelId: "cmtx512kk000wmp0uzhh5hubt",
    providerFunnelId: "5a26bb9d-1dcf-4dc0-9202-44a62a941975",
    alias: "date",
  },
  {
    id: "leadcapture_io_nextgen_hosted_domenic_boselli",
    parentUrlKey: "my.leadcapture.io/p/046y3ex0",
    sourceFunnelId: "cmun0lx5001ejdz0v7syapnih",
    providerFunnelId: "bef47ea9-a089-47f4-b6bc-3512983eb84e",
    alias: "date",
  },
  {
    id: "leadcapture_io_nextgen_hosted_trey_tyree",
    parentUrlKey: "my.leadcapture.io/p/2jhvao_r",
    sourceFunnelId: "cmumqxxif0101dz0vlg8ufjcv",
    providerFunnelId: "898d1946-ee60-4da4-b4b4-ceac96724266",
    alias: "date",
  },
  {
    id: "leadcapture_io_nextgen_hosted_julia_dodge",
    parentUrlKey: "my.leadcapture.io/p/6khoj2_q",
    sourceFunnelId: "cmumqzd2m0105dz0vs2d54ilg",
    providerFunnelId: "5164ed76-dadf-40ac-b148-1863f52c0e1a",
    alias: "date",
  },
  {
    id: "leadcapture_io_nextgen_hosted_eriks_veidemanis",
    parentUrlKey: "my.leadcapture.io/p/iexkkbgh",
    sourceFunnelId: "cmuqzbbkr010zjn0vur4cmirs",
    providerFunnelId: "c12cf351-0bc4-4127-8786-50a67643eadb",
    alias: "date",
  },
  {
    id: "leadcapture_io_nextgen_vet_sam_test",
    parentUrlKey: "go.lifeinsuranceforvets.com/learn-sam-test",
    sourceFunnelId: "cmvpb65gf004hi70u6hphb3zu",
    providerFunnelId: "5b6959bf-5e41-4508-a802-500f0cc9279b",
    alias: "date",
  },
  {
    id: "leadcapture_io_nextgen_sehi_chandler_conrad",
    parentUrlKey: "go.selfemployedhi.com/chandler-bigagency",
    sourceFunnelId: "cmuc2z56g085bm00vcn3eki25",
    providerFunnelId: "f4e7acac-a55e-4cfe-963c-f992edf0dccb",
    alias: "date_copy",
  },
  {
    id: "leadcapture_io_nextgen_sehi_zach_busch",
    parentUrlKey: "go.selfemployedhi.com/zach-busch",
    sourceFunnelId: "cmueeuvki0b1tm00vyyl4d4et",
    providerFunnelId: "168f00d0-99a5-44bb-9356-bf5129b69393",
    alias: "date_copy",
  },
];

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
    id: "leadcapture_io_nextgen_vet_ryan_wooldridge",
    provider: "leadcapture_io",
    sourceSystem: "leadcapture_io_nextgen",
    sourceFunnelId: CONFIRMED_RYAN_WOOLDRIDGE_SOURCE_FUNNEL_ID,
    providerFunnelId: CONFIRMED_RYAN_WOOLDRIDGE_PROVIDER_FUNNEL_ID,
    parentUrlKey: CONFIRMED_RYAN_WOOLDRIDGE_PARENT_URL_KEY,
    aliases: {
      date: "date_of_birth",
    },
  },
  {
    id: "leadcapture_io_nextgen_vet_robby_wells",
    provider: "leadcapture_io",
    sourceSystem: "leadcapture_io_nextgen",
    sourceFunnelId: CONFIRMED_ROBBY_WELLS_SOURCE_FUNNEL_ID,
    providerFunnelId: CONFIRMED_ROBBY_WELLS_PROVIDER_FUNNEL_ID,
    parentUrlKey: CONFIRMED_ROBBY_WELLS_PARENT_URL_KEY,
    aliases: {
      date: "date_of_birth",
    },
  },
  ...CONFIRMED_CATALOG_DOB_FORMS.map(
    (form): ScopedIncomingFieldBinding => ({
      id: form.id,
      provider: "leadcapture_io",
      sourceSystem: "leadcapture_io_nextgen",
      sourceFunnelId: form.sourceFunnelId,
      providerFunnelId: form.providerFunnelId,
      parentUrlKey: form.parentUrlKey,
      aliases: { [form.alias]: "date_of_birth" },
    })
  ),
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
