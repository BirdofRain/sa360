import type {
  AppointmentStatus,
  DeliveryStatus,
  DialDisposition,
  FirstTouchStatus,
  FrontOfficeKpiTone,
  GhlContactStatus,
  LeadOrderStatus,
  MilestoneStatus,
  OrderAdminStatus,
  SoldStatus,
  TrustStatus,
  UrgentTaskSeverity,
} from "./types";

export const DELIVERY_STATUS_DISPLAY: Record<
  DeliveryStatus,
  { label: string; className: string }
> = {
  pending: {
    label: "Pending",
    className: "bg-slate-100 text-slate-700 border-slate-200",
  },
  in_progress: {
    label: "In progress",
    className: "bg-sky-50 text-sky-800 border-sky-200",
  },
  delivered: {
    label: "Delivered",
    className: "bg-emerald-50 text-emerald-800 border-emerald-200",
  },
  failed: {
    label: "Failed",
    className: "bg-red-50 text-red-800 border-red-200",
  },
  skipped: {
    label: "Skipped",
    className: "bg-amber-50 text-amber-800 border-amber-200",
  },
};

export const TRUST_STATUS_DISPLAY: Record<
  TrustStatus,
  { label: string; className: string }
> = {
  verified: {
    label: "Verified",
    className: "bg-emerald-50 text-emerald-800 border-emerald-200",
  },
  warning: {
    label: "Warning",
    className: "bg-amber-50 text-amber-800 border-amber-200",
  },
  needs_setup: {
    label: "Needs setup",
    className: "bg-sky-50 text-sky-800 border-sky-200",
  },
  failed: {
    label: "Failed",
    className: "bg-red-50 text-red-800 border-red-200",
  },
  not_connected: {
    label: "Not connected",
    className: "bg-slate-100 text-slate-600 border-slate-200",
  },
  mock: {
    label: "Preview",
    className: "bg-violet-50 text-violet-800 border-violet-200",
  },
};

export const ORDER_STATUS_DISPLAY: Record<
  LeadOrderStatus | OrderAdminStatus,
  { label: string; className: string }
> = {
  draft: {
    label: "Draft",
    className: "bg-slate-100 text-slate-600 border-slate-200",
  },
  submitted: {
    label: "Submitted",
    className: "bg-blue-50 text-blue-800 border-blue-200",
  },
  needs_setup: {
    label: "Needs setup",
    className: "bg-sky-50 text-sky-800 border-sky-200",
  },
  needs_compliance: {
    label: "Needs compliance",
    className: "bg-amber-50 text-amber-800 border-amber-200",
  },
  ready: {
    label: "Ready",
    className: "bg-violet-50 text-violet-800 border-violet-200",
  },
  active: {
    label: "Active",
    className: "bg-emerald-50 text-emerald-800 border-emerald-200",
  },
  paused: {
    label: "Paused",
    className: "bg-slate-100 text-slate-600 border-slate-200",
  },
  completed: {
    label: "Completed",
    className: "bg-emerald-50 text-emerald-700 border-emerald-200",
  },
  canceled: {
    label: "Canceled",
    className: "bg-red-50 text-red-700 border-red-200",
  },
};

export const URGENT_SEVERITY_DISPLAY: Record<
  UrgentTaskSeverity,
  { label: string; className: string }
> = {
  critical: {
    label: "Critical",
    className: "bg-red-50 text-red-800 border-red-200",
  },
  high: {
    label: "High",
    className: "bg-amber-50 text-amber-800 border-amber-200",
  },
  medium: {
    label: "Medium",
    className: "bg-sky-50 text-sky-800 border-sky-200",
  },
};

export const KPI_TONE_CLASS: Record<FrontOfficeKpiTone, string> = {
  good: "text-emerald-600",
  warn: "text-amber-600",
  bad: "text-red-600",
  neutral: "text-slate-600",
};

export const MILESTONE_STATUS_DOT: Record<MilestoneStatus, string> = {
  complete: "bg-emerald-500",
  pending: "bg-slate-300",
  failed: "bg-red-500",
  skipped: "bg-amber-400",
};

export const MILESTONE_LABELS: Record<string, string> = {
  source_lead_received: "Source lead received",
  lead_created: "Lead created",
  lead_matched: "Lead matched",
  lead_routed: "Lead routed",
  lead_delivery_started: "Delivery started",
  lead_delivered: "Lead delivered",
  client_contact_created: "Client contact created",
  client_workflow_started: "Workflow started",
  first_touch_sent: "First touch sent",
  contact_replied: "Contact replied",
  appointment_set: "Appointment set",
  appointment_showed: "Appointment showed",
  sold: "Sold",
};

export function formatGhlContact(status: GhlContactStatus): string {
  const map: Record<GhlContactStatus, string> = {
    created: "Created",
    existing: "Existing",
    failed: "Failed",
    "n/a": "N/A",
  };
  return map[status];
}

export function formatFirstTouch(status: FirstTouchStatus): string {
  const map: Record<FirstTouchStatus, string> = {
    pending: "Pending",
    sent: "Sent",
    replied: "Replied",
    failed: "Failed",
  };
  return map[status];
}

export function formatAppointment(status: AppointmentStatus): string {
  const map: Record<AppointmentStatus, string> = {
    none: "None",
    set: "Set",
    showed: "Showed",
    no_show: "No show",
  };
  return map[status];
}

export function formatSold(status: SoldStatus): string {
  const map: Record<SoldStatus, string> = {
    none: "None",
    quoted: "Quoted",
    sold: "Sold",
    issued: "Issued",
  };
  return map[status];
}

export const DISPOSITION_LABELS: Record<DialDisposition, string> = {
  contacted: "Contacted",
  set_appointment: "Set appointment",
  follow_up: "Follow up",
  bad_number: "Bad number",
  dnc: "DNC",
  no_show: "No show",
  sold: "Sold",
};

export function formatRelativeTime(iso: string): string {
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  } catch {
    return iso;
  }
}

export function formatDateTime(iso: string): string {
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
