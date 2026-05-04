export type WebhookRow = {
  id: string;
  ts: string;
  source: "GHL" | "Synthflow" | "Meta" | "Internal";
  event: string;
  client: string;
  subaccount: string;
  status: "success" | "failed" | "queued" | "retry";
  result: string;
  duration: string;
  payload: any;
  response: any;
};

export const webhooks: WebhookRow[] = [
  {
    id: "wh_01HX8KQ7N3",
    ts: "2026-04-30 14:22:18",
    source: "GHL",
    event: "lead_created",
    client: "Liberty Final Expense",
    subaccount: "loc_3xK29fA",
    status: "success",
    result: "indexed",
    duration: "184ms",
    payload: { type: "ContactCreate", contact: { id: "ctc_882", firstName: "Marlene", phone: "+13055550118", tags: ["Final Expense", "FB Lead"] }, locationId: "loc_3xK29fA" },
    response: { ok: true, contact_indexed: true, attribution_upserted: true, client_account_id: "cli_001" },
  },
  {
    id: "wh_01HX8KQ7N4",
    ts: "2026-04-30 14:21:55",
    source: "Synthflow",
    event: "inbound.lookup",
    client: "Veteran Benefits Group",
    subaccount: "loc_88aLp02",
    status: "success",
    result: "known_caller",
    duration: "92ms",
    payload: { from: "+17029990041", to: "+18335550199", call_id: "syn_4421" },
    response: { known_caller: true, matched_by: "local", contact_id: "ctc_771", model_id: "gpt-4o-mini", override_model_id: null, agent: "VBG_Inbound_Agent", variables: { lead_type: "Veteran", stage: "nurturing" } },
  },
  {
    id: "wh_01HX8KQ7N5",
    ts: "2026-04-30 14:20:11",
    source: "GHL",
    event: "appointment_set",
    client: "NurseLeads Pro",
    subaccount: "loc_kk441z",
    status: "success",
    result: "appointment_logged",
    duration: "221ms",
    payload: { type: "AppointmentCreate", contact: { id: "ctc_5511" }, calendarId: "cal_22", startTime: "2026-05-02T16:00:00Z" },
    response: { ok: true, first_response_recorded: true },
  },
  {
    id: "wh_01HX8KQ7N6",
    ts: "2026-04-30 14:18:42",
    source: "Meta",
    event: "capi.dispatch",
    client: "Liberty Final Expense",
    subaccount: "loc_3xK29fA",
    status: "failed",
    result: "invalid_token",
    duration: "412ms",
    payload: { event_name: "Lead", event_id: "evt_8821", user_data: { ph: "***", em: "***" } },
    response: { error: "OAuthException", message: "Invalid access token", code: 190 },
  },
  {
    id: "wh_01HX8KQ7N7",
    ts: "2026-04-30 14:17:30",
    source: "Synthflow",
    event: "inbound.lookup",
    client: "Liberty Final Expense",
    subaccount: "loc_3xK29fA",
    status: "success",
    result: "unknown_caller",
    duration: "118ms",
    payload: { from: "+19495550022", to: "+18555551020", call_id: "syn_4422" },
    response: { known_caller: false, matched_by: "not_found", contact_id: null, model_id: "gpt-4o-mini" },
  },
  {
    id: "wh_01HX8KQ7N8",
    ts: "2026-04-30 14:16:01",
    source: "GHL",
    event: "sale_logged",
    client: "Veteran Benefits Group",
    subaccount: "loc_88aLp02",
    status: "success",
    result: "attribution_upserted",
    duration: "176ms",
    payload: { type: "OpportunityStatusUpdate", contact: { id: "ctc_771" }, monetaryValue: 1480, status: "won" },
    response: { ok: true },
  },
  {
    id: "wh_01HX8KQ7N9",
    ts: "2026-04-30 14:14:22",
    source: "GHL",
    event: "lead_created",
    client: "NurseLeads Pro",
    subaccount: "loc_kk441z",
    status: "retry",
    result: "downstream_timeout",
    duration: "5021ms",
    payload: { type: "ContactCreate", contact: { id: "ctc_5530" } },
    response: { ok: false, retry_in: "30s" },
  },
  {
    id: "wh_01HX8KQ7NA",
    ts: "2026-04-30 14:12:09",
    source: "Internal",
    event: "review.created",
    client: "Liberty Final Expense",
    subaccount: "loc_3xK29fA",
    status: "queued",
    result: "pending_admin",
    duration: "—",
    payload: { reason: "duplicate_contact", contact_id: "ctc_882" },
    response: { queued: true },
  },
];

export type SynthflowRow = {
  id: string;
  ts: string;
  from: string;
  to: string;
  known: boolean;
  matchedBy: "local" | "ghl" | "not_found" | "error";
  modelId: string;
  overrideModelId: string | null;
  agent: string;
  client: string;
  variables: Record<string, string>;
};

export const synthflowCalls: SynthflowRow[] = [
  { id: "syn_4421", ts: "14:21:55", from: "+1 702 999 0041", to: "+1 833 555 0199", known: true, matchedBy: "local", modelId: "gpt-4o-mini", overrideModelId: null, agent: "VBG_Inbound_Agent", client: "Veteran Benefits Group", variables: { lead_type: "Veteran", stage: "nurturing", last_touch: "FB" } },
  { id: "syn_4422", ts: "14:17:30", from: "+1 949 555 0022", to: "+1 855 555 1020", known: false, matchedBy: "not_found", modelId: "gpt-4o-mini", overrideModelId: null, agent: "Liberty_Inbound_Agent", client: "Liberty Final Expense", variables: {} },
  { id: "syn_4423", ts: "14:09:11", from: "+1 305 555 0118", to: "+1 855 555 1020", known: true, matchedBy: "ghl", modelId: "gpt-4o", overrideModelId: "gpt-4o-2026-04", agent: "Liberty_Inbound_Agent", client: "Liberty Final Expense", variables: { lead_type: "Final Expense", stage: "appointment_set" } },
  { id: "syn_4424", ts: "13:55:02", from: "+1 615 555 0301", to: "+1 833 555 0810", known: false, matchedBy: "error", modelId: "gpt-4o-mini", overrideModelId: null, agent: "NurseLeads_Inbound", client: "NurseLeads Pro", variables: {} },
  { id: "syn_4425", ts: "13:42:20", from: "+1 702 999 0041", to: "+1 855 555 1020", known: true, matchedBy: "local", modelId: "gpt-4o-mini", overrideModelId: null, agent: "Liberty_Inbound_Agent", client: "Liberty Final Expense", variables: { lead_type: "Final Expense", stage: "first_response" } },
];

export type Client = {
  id: string;
  org: string;
  clientAccountId: string;
  ghlLocationId: string;
  status: "active" | "onboarding" | "paused";
  setup: "complete" | "in_progress" | "blocked";
  flags: { voice: boolean; blue: boolean; green: boolean; closeBot: boolean; ghlAi: boolean; metaSync: boolean };
  lastWebhook: string;
  lastSynth: string;
  needsAttention?: string;
};

export const clients: Client[] = [
  { id: "cli_001", org: "Liberty Final Expense", clientAccountId: "cli_001", ghlLocationId: "loc_3xK29fA", status: "active", setup: "complete", flags: { voice: true, blue: true, green: true, closeBot: true, ghlAi: false, metaSync: true }, lastWebhook: "30s ago", lastSynth: "5m ago", needsAttention: "Meta CAPI token expired" },
  { id: "cli_002", org: "Veteran Benefits Group", clientAccountId: "cli_002", ghlLocationId: "loc_88aLp02", status: "active", setup: "complete", flags: { voice: true, blue: true, green: false, closeBot: true, ghlAi: true, metaSync: true }, lastWebhook: "1m ago", lastSynth: "8m ago" },
  { id: "cli_003", org: "NurseLeads Pro", clientAccountId: "cli_003", ghlLocationId: "loc_kk441z", status: "active", setup: "complete", flags: { voice: true, blue: false, green: true, closeBot: false, ghlAi: true, metaSync: false }, lastWebhook: "2m ago", lastSynth: "35m ago", needsAttention: "Synthflow lookup error rate 4%" },
  { id: "cli_004", org: "Sunbelt Final Expense", clientAccountId: "cli_004", ghlLocationId: "loc_91zz4q", status: "onboarding", setup: "in_progress", flags: { voice: false, blue: true, green: false, closeBot: false, ghlAi: false, metaSync: false }, lastWebhook: "—", lastSynth: "—", needsAttention: "Webhook secret not verified" },
  { id: "cli_005", org: "PatriotCare Veteran", clientAccountId: "cli_005", ghlLocationId: "loc_77abc1", status: "active", setup: "complete", flags: { voice: true, blue: true, green: true, closeBot: true, ghlAi: true, metaSync: true }, lastWebhook: "12m ago", lastSynth: "22m ago" },
  { id: "cli_006", org: "Coastal Nurse Network", clientAccountId: "cli_006", ghlLocationId: "loc_55po9w", status: "paused", setup: "blocked", flags: { voice: false, blue: false, green: false, closeBot: false, ghlAi: false, metaSync: false }, lastWebhook: "3d ago", lastSynth: "—", needsAttention: "Account paused — billing" },
];

export type ReviewItem = {
  id: string;
  severity: "critical" | "high" | "medium" | "low";
  source: "GHL" | "Synthflow" | "Meta" | "Internal";
  reason: string;
  client: string;
  subaccount: string;
  contact: string;
  workflow: string;
  status: "open" | "ack" | "resolved";
  assigned: string;
  ts: string;
};

export const reviewItems: ReviewItem[] = [
  { id: "rev_1001", severity: "critical", source: "Meta", reason: "CAPI access token invalid", client: "Liberty Final Expense", subaccount: "loc_3xK29fA", contact: "—", workflow: "meta_capi_dispatch", status: "open", assigned: "Renee K.", ts: "10m ago" },
  { id: "rev_1002", severity: "high", source: "Synthflow", reason: "Unknown caller — no GHL match (3rd time)", client: "Liberty Final Expense", subaccount: "loc_3xK29fA", contact: "+1 949 555 0022", workflow: "synthflow_inbound", status: "open", assigned: "—", ts: "13m ago" },
  { id: "rev_1003", severity: "medium", source: "GHL", reason: "Duplicate contact created", client: "Liberty Final Expense", subaccount: "loc_3xK29fA", contact: "ctc_882", workflow: "lead_created", status: "ack", assigned: "Devon M.", ts: "22m ago" },
  { id: "rev_1004", severity: "high", source: "Synthflow", reason: "Lookup error: upstream 502", client: "NurseLeads Pro", subaccount: "loc_kk441z", contact: "+1 615 555 0301", workflow: "synthflow_inbound", status: "open", assigned: "—", ts: "34m ago" },
  { id: "rev_1005", severity: "low", source: "GHL", reason: "Attribution missing UTM source", client: "Veteran Benefits Group", subaccount: "loc_88aLp02", contact: "ctc_771", workflow: "attribution_upsert", status: "resolved", assigned: "Renee K.", ts: "1h ago" },
];

export type TimelineEvent = {
  id: string;
  ts: string;
  type: "lead_created" | "attribution_upserted" | "contact_indexed" | "first_response" | "appointment_set" | "synthflow_lookup" | "meta_dispatch" | "review_created" | "sale_logged";
  title: string;
  detail: string;
  status?: "ok" | "warn" | "err";
};

export const timeline: TimelineEvent[] = [
  { id: "t1", ts: "14:22:18", type: "lead_created", title: "lead_created", detail: "GHL ContactCreate · ctc_882 · Final Expense", status: "ok" },
  { id: "t2", ts: "14:22:18", type: "contact_indexed", title: "inbound contact indexed", detail: "client_account_id=cli_001 subaccount=loc_3xK29fA", status: "ok" },
  { id: "t3", ts: "14:22:19", type: "attribution_upserted", title: "attribution upserted", detail: "source=FB campaign=FE_Q2_Marlene", status: "ok" },
  { id: "t4", ts: "14:22:21", type: "first_response", title: "first_response", detail: "SMS template fe_intro_v3 · 3.1s SLA", status: "ok" },
  { id: "t5", ts: "14:23:08", type: "synthflow_lookup", title: "Synthflow lookup", detail: "+13055550118 → known_caller=true (local)", status: "ok" },
  { id: "t6", ts: "14:24:55", type: "appointment_set", title: "appointment_set", detail: "calendar=cal_22 start=2026-05-02 16:00 UTC", status: "ok" },
  { id: "t7", ts: "14:24:56", type: "meta_dispatch", title: "Meta dispatch attempt", detail: "event=Lead → 401 invalid_token", status: "err" },
  { id: "t8", ts: "14:24:57", type: "review_created", title: "review item created", detail: "rev_1001 · CAPI access token invalid", status: "warn" },
  { id: "t9", ts: "14:31:02", type: "sale_logged", title: "sale_logged", detail: "monetaryValue=$1,480 · status=won", status: "ok" },
];
