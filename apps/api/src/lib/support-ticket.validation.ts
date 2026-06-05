import {
  DEFAULT_SUPPORT_TICKET_CATEGORY,
  DEFAULT_SUPPORT_TICKET_PRIORITY,
  DEFAULT_SUPPORT_TICKET_STATUS,
  SUPPORT_TICKET_CATEGORIES,
  SUPPORT_TICKET_PRIORITIES,
  SUPPORT_TICKET_STATUSES,
  type SupportTicketCategory,
  type SupportTicketPriority,
  type SupportTicketStatus,
} from "./support-ticket.constants.js";

export const SUPPORT_TICKET_MAX = {
  subject: 180,
  description: 5000,
  requesterName: 120,
  requesterEmail: 180,
  assignedToName: 120,
  resolutionSummary: 2000,
  internalNote: 2000,
} as const;

const STATUS_SET = new Set<string>(SUPPORT_TICKET_STATUSES);
const PRIORITY_SET = new Set<string>(SUPPORT_TICKET_PRIORITIES);
const CATEGORY_SET = new Set<string>(SUPPORT_TICKET_CATEGORIES);

export function trimOrNull(value: string | null | undefined, max: number): string | null {
  if (value == null) return null;
  const t = value.trim();
  if (!t) return null;
  if (t.length > max) return t.slice(0, max);
  return t;
}

export function requireDescription(value: string | null | undefined): string | null {
  if (value == null) return null;
  const t = value.trim();
  if (!t) return null;
  if (t.length > SUPPORT_TICKET_MAX.description) return null;
  return t;
}

export function normalizeSupportTicketStatus(value: string | null | undefined): SupportTicketStatus {
  const v = value?.trim().toUpperCase();
  if (v && STATUS_SET.has(v)) return v as SupportTicketStatus;
  return DEFAULT_SUPPORT_TICKET_STATUS;
}

export function normalizeSupportTicketPriority(value: string | null | undefined): SupportTicketPriority {
  const v = value?.trim().toUpperCase();
  if (v && PRIORITY_SET.has(v)) return v as SupportTicketPriority;
  return DEFAULT_SUPPORT_TICKET_PRIORITY;
}

export function normalizeSupportTicketCategory(value: string | null | undefined): SupportTicketCategory {
  const v = value?.trim().toUpperCase();
  if (v && CATEGORY_SET.has(v)) return v as SupportTicketCategory;
  return DEFAULT_SUPPORT_TICKET_CATEGORY;
}

export type SupportTicketInternalNote = {
  at: string;
  by: string;
  note: string;
};

export function parseInternalNotes(json: unknown): SupportTicketInternalNote[] {
  if (!Array.isArray(json)) return [];
  return json.filter(
    (row): row is SupportTicketInternalNote =>
      Boolean(row) &&
      typeof row === "object" &&
      typeof (row as SupportTicketInternalNote).at === "string" &&
      typeof (row as SupportTicketInternalNote).by === "string" &&
      typeof (row as SupportTicketInternalNote).note === "string"
  );
}

export function appendInternalNote(
  existing: unknown,
  note: string,
  by: string,
  at: Date
): SupportTicketInternalNote[] {
  const trimmed = note.trim().slice(0, SUPPORT_TICKET_MAX.internalNote);
  if (!trimmed) return parseInternalNotes(existing);
  const prev = parseInternalNotes(existing);
  return [...prev, { at: at.toISOString(), by: by.trim() || "admin", note: trimmed }];
}
