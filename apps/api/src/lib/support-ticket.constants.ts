export const SUPPORT_TICKET_STATUSES = [
  "OPEN",
  "IN_PROGRESS",
  "WAITING_ON_USER",
  "RESOLVED",
  "CLOSED",
] as const;

export const SUPPORT_TICKET_PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;

export const SUPPORT_TICKET_CATEGORIES = [
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
] as const;

export type SupportTicketStatus = (typeof SUPPORT_TICKET_STATUSES)[number];
export type SupportTicketPriority = (typeof SUPPORT_TICKET_PRIORITIES)[number];
export type SupportTicketCategory = (typeof SUPPORT_TICKET_CATEGORIES)[number];

export const DEFAULT_SUPPORT_TICKET_STATUS: SupportTicketStatus = "OPEN";
export const DEFAULT_SUPPORT_TICKET_PRIORITY: SupportTicketPriority = "NORMAL";
export const DEFAULT_SUPPORT_TICKET_CATEGORY: SupportTicketCategory = "GENERAL";

export const CLOSED_SUPPORT_STATUSES = new Set<SupportTicketStatus>(["RESOLVED", "CLOSED"]);
