import type {
  SupportTicketCategory,
  SupportTicketPriority,
  SupportTicketStatus,
} from "@/lib/support-tickets/types";

export function supportTicketStatusLabel(status: SupportTicketStatus): string {
  return status.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

export function supportTicketStatusBadgeClass(status: SupportTicketStatus): string {
  switch (status) {
    case "OPEN":
      return "border-blue-600/30 bg-blue-50 text-blue-900 dark:bg-blue-950/40 dark:text-blue-100";
    case "IN_PROGRESS":
      return "border-violet-600/30 bg-violet-50 text-violet-900 dark:bg-violet-950/40 dark:text-violet-100";
    case "WAITING_ON_USER":
      return "border-amber-600/30 bg-amber-50 text-amber-950 dark:bg-amber-950/40 dark:text-amber-100";
    case "RESOLVED":
      return "border-emerald-600/30 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100";
    case "CLOSED":
      return "border-slate-400/30 bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200";
    default:
      return "bg-muted text-muted-foreground";
  }
}

export function supportTicketPriorityBadgeClass(priority: SupportTicketPriority): string {
  switch (priority) {
    case "URGENT":
      return "border-red-600/40 bg-red-50 text-red-900 dark:bg-red-950/40 dark:text-red-100";
    case "HIGH":
      return "border-orange-600/30 bg-orange-50 text-orange-950 dark:bg-orange-950/40 dark:text-orange-100";
    case "LOW":
      return "border-slate-300/50 bg-slate-50 text-slate-600";
    default:
      return "border-slate-200 bg-white text-slate-700";
  }
}

export function supportTicketCategoryLabel(category: SupportTicketCategory): string {
  return category.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

export function formatSupportTicketTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
