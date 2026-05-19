export const LEAD_TIMELINE_MILESTONES = [
  "lead_created",
  "contact_replied",
  "appointment_set",
  "appointment_confirmed",
  "appointment_showed",
  "appointment_no_show",
  "sold",
  "policy_issued",
  "bad_number",
  "dnc",
  "dead_lead",
] as const;

export type LeadTimelineMilestone = (typeof LEAD_TIMELINE_MILESTONES)[number];

export type LeadCorrelationKeys = {
  clientAccountId: string;
  subaccountIdGhl?: string;
  leadUid?: string;
  contactIdGhl?: string;
  phoneE164?: string;
  email?: string;
};

export type LeadTimelineValidity = "valid" | "invalid";

export type LeadTimelineEntry = {
  id: string;
  source: string;
  sourceTable: string;
  requestId: string | null;
  eventUuid: string | null;
  eventNameInternal: string | null;
  eventNameMeta: string | null;
  receivedAt: string;
  validity: LeadTimelineValidity;
  processingStatus: string;
  httpStatus: string | null;
  leadName: string | null;
  phoneE164: string | null;
  email: string | null;
  summary: string | null;
  errorSummary: string | null;
  /** WebhookRequestLog row id — open in Webhook Monitor drawer. */
  webhookLogId?: string | null;
};

export type LeadTimelineIdentity = {
  leadUid: string | null;
  contactIdGhl: string | null;
  displayName: string | null;
  phoneE164: string | null;
  email: string | null;
  clientAccountId: string;
  subaccountIdGhl: string | null;
};

export type LeadTimelineCurrentState = {
  lifecycleStage: string | null;
  appointmentStatus: string | null;
  agentDisposition: string | null;
  policyStatus: string | null;
  aiStatus: string | null;
  routingStatus: string | null;
  lastSeenAt: string | null;
};

export type LeadTimelineResponse = {
  ok: true;
  identity: LeadTimelineIdentity;
  currentState: LeadTimelineCurrentState;
  timeline: LeadTimelineEntry[];
  missingMilestones: LeadTimelineMilestone[];
  warnings: string[];
};

export type LeadTimelineQuery = {
  clientAccountId?: string;
  subaccountIdGhl?: string;
  leadUid?: string;
  contactIdGhl?: string;
  phoneE164?: string;
  email?: string;
  requestId?: string;
  sort?: "asc" | "desc";
  limit?: number;
  from?: string;
  to?: string;
};
