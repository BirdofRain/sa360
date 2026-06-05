export type SupportTicketStatus =
  | "OPEN"
  | "IN_PROGRESS"
  | "WAITING_ON_USER"
  | "RESOLVED"
  | "CLOSED";

export type SupportTicketPriority = "LOW" | "NORMAL" | "HIGH" | "URGENT";

export type SupportTicketCategory =
  | "GENERAL"
  | "BUG"
  | "DATA_ISSUE"
  | "GHL_CONNECTION"
  | "ROUTING"
  | "DELIVERY"
  | "WEBHOOK"
  | "SYNTHFLOW"
  | "FEATURE_REQUEST"
  | "BILLING"
  | "TRAINING";

export type SupportTicketSummary = {
  id: string;
  ticketNumber: number;
  status: SupportTicketStatus;
  priority: SupportTicketPriority;
  category: SupportTicketCategory;
  subject: string | null;
  descriptionPreview: string;
  clientAccountId: string | null;
  masterClientAccountId: string | null;
  relatedEntityType: string | null;
  relatedEntityId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SupportTicketInternalNote = {
  at: string;
  by: string;
  note: string;
};

export type SupportTicketDetail = SupportTicketSummary & {
  source: string;
  description: string;
  requesterName: string | null;
  requesterEmail: string | null;
  requesterUserId: string | null;
  assignedToName: string | null;
  assignedToUserId: string | null;
  subaccountIdGhl: string | null;
  pagePath: string | null;
  pageUrl: string | null;
  queryJson: unknown;
  contextJson: unknown;
  userAgent: string | null;
  internalNotes: SupportTicketInternalNote[] | unknown;
  resolutionSummary: string | null;
  closedAt: string | null;
};

export type SupportTicketStats = {
  open: number;
  inProgress: number;
  waiting: number;
  resolvedRecent: number;
};

export type SupportTicketCreateInput = {
  subject?: string;
  description: string;
  category?: SupportTicketCategory;
  priority?: SupportTicketPriority;
  requesterName?: string;
  requesterEmail?: string;
  clientAccountId?: string;
  masterClientAccountId?: string;
  subaccountIdGhl?: string;
  relatedEntityType?: string;
  relatedEntityId?: string;
  pagePath?: string;
  pageUrl?: string;
  queryJson?: Record<string, unknown>;
  contextJson?: Record<string, unknown>;
  userAgent?: string;
};

export type SupportTicketUpdateInput = {
  status?: SupportTicketStatus;
  priority?: SupportTicketPriority;
  category?: SupportTicketCategory;
  assignedToName?: string;
  resolutionSummary?: string;
  internalNote?: string;
  internalNoteBy?: string;
};

export type SupportTicketListQuery = {
  status?: SupportTicketStatus | "all";
  priority?: SupportTicketPriority | "all";
  category?: SupportTicketCategory | "all";
  search?: string;
  page?: number;
  limit?: number;
};

export const SUPPORT_TICKET_STATUSES: SupportTicketStatus[] = [
  "OPEN",
  "IN_PROGRESS",
  "WAITING_ON_USER",
  "RESOLVED",
  "CLOSED",
];

export const SUPPORT_TICKET_PRIORITIES: SupportTicketPriority[] = [
  "LOW",
  "NORMAL",
  "HIGH",
  "URGENT",
];

export const SUPPORT_TICKET_CATEGORIES: SupportTicketCategory[] = [
  "GENERAL",
  "BUG",
  "DATA_ISSUE",
  "GHL_CONNECTION",
  "ROUTING",
  "DELIVERY",
  "WEBHOOK",
  "SYNTHFLOW",
  "FEATURE_REQUEST",
  "BILLING",
  "TRAINING",
];

export type SupportTicketContextOverride = {
  relatedEntityType?: string;
  relatedEntityId?: string;
  clientAccountId?: string;
  masterClientAccountId?: string;
  subaccountIdGhl?: string;
  contextJson?: Record<string, unknown>;
};
