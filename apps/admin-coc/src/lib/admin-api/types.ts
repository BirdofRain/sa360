/** Shapes returned by Fastify `/admin/v1/*` (JSON). */

export type AdminMetricsSummary = {
  webhookRequestsTotal: number;
  webhookRequestsToday: number;
  webhookFailures: number;
  webhookValidationFailures: number;
  webhookSkipped: number;
  webhookQueued: number;
  synthflowRequestsTotal: number;
  synthflowRequestsToday: number;
  synthflowKnownCallerCount: number;
  synthflowUnknownCallerCount: number;
  synthflowLookupErrors: number;
  synthflowGuardrails: number;
  averageWebhookDurationMs: number | null;
  averageSynthflowDurationMs: number | null;
  latestWebhookAt: string | null;
  latestSynthflowAt: string | null;
};

export type AdminWebhookListItem = {
  id: string;
  requestId: string;
  source: string;
  route: string;
  receivedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  processingStatus: string;
  httpStatus: number | null;
  clientAccountId: string | null;
  subaccountIdGhl: string | null;
  contactIdGhl: string | null;
  eventUuid: string | null;
  eventNameInternal: string | null;
  errorCode: string | null;
  errorSummary: string | null;
  /** Display label; optional for older API responses; UI falls back to "Unknown lead". */
  leadName?: string;
  leadFirstName?: string | null;
  leadLastName?: string | null;
  leadPhone?: string | null;
  leadEmail?: string | null;
};

export type AdminWebhookListResponse = {
  items: AdminWebhookListItem[];
  nextCursor: string | null;
};

export type AdminSynthflowListItem = {
  id: string;
  requestId: string;
  source: string;
  route: string;
  receivedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  httpStatus: number | null;
  processingStatus: string;
  clientAccountId: string | null;
  subaccountIdGhl: string | null;
  lookupStatus: string | null;
  knownCaller: string | null;
  matchedBy: string | null;
  fromNumber: string | null;
  toNumber: string | null;
  phoneE164: string | null;
  modelId: string | null;
  overrideModelId: string | null;
  contactIdGhl: string | null;
  assignedAgentName: string | null;
  customerName: string | null;
  errorCode: string | null;
  errorSummary: string | null;
};

export type AdminSynthflowListResponse = {
  items: AdminSynthflowListItem[];
  nextCursor: string | null;
};

/** Detail row from GET /admin/v1/coc/synthflow-requests/:id */
export type AdminSynthflowDetail = AdminSynthflowListItem & {
  requestBodyRedacted: unknown;
  responseBodyRedacted: unknown;
  createdAt: string;
  updatedAt: string;
};
