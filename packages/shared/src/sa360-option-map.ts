/** SA360 dropdown fields that require canonical → GHL option value mapping. */
export const SA360_OPTION_MAPPED_FIELD_KEYS = [
  "sa360_lifecycle_stage",
  "sa360_routing_status",
  "sa360_niche_key",
  "sa360_source_platform",
  "sa360_source_type",
] as const;

export type Sa360OptionMappedFieldKey = (typeof SA360_OPTION_MAPPED_FIELD_KEYS)[number];

export type Sa360CustomFieldOptionMap = Record<string, Record<string, string>>;

/** Smart Agent 360 Demo GHL dropdown option values (snapshot standard). */
export const SA360_DEMO_CUSTOM_FIELD_OPTION_MAP: Sa360CustomFieldOptionMap = {
  sa360_lifecycle_stage: {
    NEW: "new",
    ATTEMPTING_CONTACT: "attempting_contact",
    RESPONDED: "responded",
    AI_ENGAGED: "ai_engaged",
    APPOINTMENT_SET: "appointment_set",
    APPOINTMENT_SHOWED: "appointment_showed",
    FOLLOW_UP: "follow_up",
    QUOTED: "quoted",
    SOLD: "sold",
    ISSUED: "issued",
    RETENTION: "retention",
    DEAD: "dead",
  },
  sa360_routing_status: {
    NONE: "none",
    ASSIGNED: "assigned",
    CHANNEL_LOCKED: "channel_locked",
    WAITING_ON_TIMING_GATE: "waiting_on_timing_gate",
    REVIEW_REQUIRED: "review_required",
    FALLBACK_TRIGGERED: "fallback_triggered",
    BOOKED: "booked",
    STOPPED: "stopped",
    WAITING_ON_VOICE_RESPONSE: "waiting_on_voice_response",
  },
  sa360_niche_key: {
    FEX: "n_fex",
    MTG: "n_mtg",
    IUL: "n_iul",
    VET: "n_vet",
    NURSE: "n_nurse",
    HEALTH: "n_health",
    N_FEX: "n_fex",
    N_MTG: "n_mtg",
    N_IUL: "n_iul",
    N_VET: "n_vet",
    N_NURSE: "n_nurse",
    N_HEALTH: "n_health",
  },
};
