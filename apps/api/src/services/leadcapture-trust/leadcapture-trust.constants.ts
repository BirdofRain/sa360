export const LEADCAPTURE_TRUST_PILOT_CLIENT_ACCOUNT_ID = "vet_life_james_torrey";
export const LEADCAPTURE_TRUST_PILOT_CAMPAIGN_KEY = "LCIO_LEGACY_VET_LIFE_JAMES_TORREY_VET_FEX";

/**
 * Legacy LeadCapture form / source-system numeric ID.
 * Use only for historical webhook/source routing metadata and documentation of the
 * old form system. Never use as a Data API `funnel_id`.
 */
export const LEADCAPTURE_TRUST_PILOT_LEGACY_FORM_ID = "23381";

/**
 * LeadCapture Data API funnel UUID for the James Torrey pilot.
 * Use for GET /v1/data/leads `funnel_id` filtering, provider `_meta.funnel_id`,
 * provider scope comparison, and Data API form/funnel allowlisting.
 *
 * Note: persisted / packet `providerFormId` stores this UUID for the Data API pilot.
 * The field name is retained for migration compatibility.
 */
export const LEADCAPTURE_TRUST_PILOT_PROVIDER_FUNNEL_ID =
  "d6f2157f-d612-441a-80af-88742ef084dc";

export const LEADCAPTURE_TRUST_PILOT_PROVIDER = "leadcapture_io";
export const LEADCAPTURE_TRUST_PILOT_SOURCE_LANE = "leadcapture_io";

export const LEADCAPTURE_TRUST_ATTACH_CONFIRMATION =
  "ATTACH ONE LEADCAPTURE TRUST FORM";

export const LEADCAPTURE_TRUST_IDENTITY_MATCH_WINDOW_MS = 15 * 60 * 1000;
export const LEADCAPTURE_TRUST_RECONCILE_MAX_RECORDS = 25;
