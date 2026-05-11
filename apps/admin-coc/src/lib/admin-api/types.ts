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

/** List row from GET /admin/v1/coc/synthflow-outbound-results */
export type AdminSynthflowOutboundResultListItem = {
  id: string;
  requestId: string | null;
  callId: string;
  modelId: string | null;
  fromNumber: string | null;
  toNumber: string | null;
  fromNumberE164: string | null;
  toNumberE164: string | null;
  contactIdGhl: string | null;
  clientAccountId: string | null;
  subaccountIdGhl: string | null;
  outcome: string;
  booked: boolean;
  appointmentTime: string | null;
  receivedAt: string;
};

export type AdminSynthflowOutboundResultListResponse = {
  items: AdminSynthflowOutboundResultListItem[];
  nextCursor: string | null;
};

/**
 * Detail from GET /admin/v1/coc/synthflow-outbound-results/:id.
 * No call duration — not stored on SynthflowOutboundResultLog.
 */
export type AdminSynthflowOutboundResultDetail = AdminSynthflowOutboundResultListItem & {
  transcriptSummary: string | null;
  payloadRedacted: unknown;
};

/** Wire shape returned by GET /admin/v1/kanban/boards/:boardKey */
export type AdminKanbanCard = {
  id: string;
  boardKey: string;
  title: string;
  description: string;
  status: string;
  workstream: string;
  priority: string;
  dueDate: string | null;
  owner: string | null;
  blocked: boolean;
  dependencyCount: number;
  tags: string[];
  acceptanceCriteria: string[] | null;
  dependencies: string[] | null;
  notes: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type AdminKanbanBoard = {
  boardKey: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  cards: AdminKanbanCard[];
};

export type AdminKanbanReorderItem = {
  id: string;
  status: string;
  sortOrder: number;
};

export type AdminKanbanCardUpdate = Partial<{
  title: string;
  description: string;
  status: string;
  workstream: string;
  priority: string;
  dueDate: string | null;
  owner: string | null;
  blocked: boolean;
  dependencyCount: number;
  tags: string[];
  acceptanceCriteria: string[] | null;
  dependencies: string[] | null;
  notes: string | null;
  sortOrder: number;
}>;

export type AdminKanbanCardCreate = {
  boardKey: string;
  title: string;
  description?: string;
  status: string;
  workstream: string;
  priority: string;
  dueDate?: string | null;
  owner?: string | null;
  blocked?: boolean;
  dependencyCount?: number;
  tags?: string[];
  acceptanceCriteria?: string[] | null;
  dependencies?: string[] | null;
  notes?: string | null;
  sortOrder?: number;
};
