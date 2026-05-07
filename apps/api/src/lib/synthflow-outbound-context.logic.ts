import type { InboundContactClientStatus } from "@prisma/client";

export type OutboundScriptGoal =
  | "CONFIRM_EXISTING_APPOINTMENT"
  | "BOOK_APPOINTMENT"
  | "REVIEW_REQUIRED"
  | "DO_NOT_CALL";

function norm(s: string | null | undefined): string {
  return (s ?? "").trim();
}

function normLifecycle(s: string | null | undefined): string {
  return norm(s).toUpperCase().replace(/\s+/g, "_");
}

/** Active appointment: lifecycle APPOINTMENT_SET or appointment status tokens per product rules. */
export function outboundHasActiveAppointment(args: {
  appointmentStatus: string | null | undefined;
  lifecycleStage: string | null | undefined;
}): boolean {
  const lc = normLifecycle(args.lifecycleStage);
  if (lc === "APPOINTMENT_SET") {
    return true;
  }
  const apt = normLifecycle(args.appointmentStatus);
  if (!apt) {
    return false;
  }
  /** Exact tokens only — avoids substring bugs like `NOT_SET` matching `SET`. */
  const booked = new Set(["SET", "CONFIRMED", "APPOINTMENT_SET"]);
  if (booked.has(apt)) {
    return true;
  }
  if (apt.includes("APPOINTMENT_SET")) {
    return true;
  }
  return false;
}

export function outboundLifecycleDoNotCall(lifecycleStage: string | null | undefined): boolean {
  const raw = norm(lifecycleStage);
  if (!raw) {
    return false;
  }
  const u = raw.toUpperCase();
  return (
    /\bDNC\b/u.test(u) ||
    /\bDEAD\b/u.test(u) ||
    /\bDO_NOT_CONTACT\b/u.test(u) ||
    u.includes("DO NOT CONTACT")
  );
}

export function outboundLifecycleBadNumber(lifecycleStage: string | null | undefined): boolean {
  const raw = norm(lifecycleStage);
  if (!raw) {
    return false;
  }
  const u = raw.toUpperCase();
  return /\bBAD_NUMBER\b/u.test(u) || /\bINVALID_NUMBER\b/u.test(u);
}

export type OutboundGuardrailDecision = {
  scriptGoal: OutboundScriptGoal;
  bookingAllowed: boolean;
  doNotBookReason: string;
};

/**
 * Pure guardrail resolution for outbound voice — used by the API service and unit tests.
 */
export function resolveOutboundGuardrails(args: {
  contactFound: boolean;
  hasActiveAppointment: boolean;
  /** Calendar id available (routing or env) — used for display / id-only edge cases. */
  calendarIdPresent: boolean;
  /** True when a new appointment may be booked (routing needs id+link; env map allows id-only). */
  newBookingCalendarReady: boolean;
  assignedAgentId: string | null | undefined;
  doNotCallSignal: boolean;
  /**
   * GHL lifecycle stamped a full routing calendar (id + link). Allows BOOK_APPOINTMENT without assigned agent.
   */
  routingCalendarComplete: boolean;
}): OutboundGuardrailDecision {
  const missingCalendarReason = "missing_calendar";
  const missingCalendarLinkReason = "missing_calendar_link";
  const missingAgentReason = "missing_assigned_agent";
  const unknownReason = "contact_unknown";

  if (!args.contactFound) {
    return {
      scriptGoal: "REVIEW_REQUIRED",
      bookingAllowed: false,
      doNotBookReason: unknownReason,
    };
  }

  if (args.doNotCallSignal) {
    return {
      scriptGoal: "DO_NOT_CALL",
      bookingAllowed: false,
      doNotBookReason: "do_not_call_signal",
    };
  }

  if (args.hasActiveAppointment) {
    return {
      scriptGoal: "CONFIRM_EXISTING_APPOINTMENT",
      bookingAllowed: false,
      doNotBookReason: "active_appointment",
    };
  }

  const agentOk = Boolean(norm(args.assignedAgentId));
  const agentBypass = args.routingCalendarComplete && args.newBookingCalendarReady;
  if (!agentOk && !agentBypass) {
    return {
      scriptGoal: "REVIEW_REQUIRED",
      bookingAllowed: false,
      doNotBookReason: missingAgentReason,
    };
  }

  if (!args.newBookingCalendarReady) {
    if (args.calendarIdPresent) {
      return {
        scriptGoal: "REVIEW_REQUIRED",
        bookingAllowed: false,
        doNotBookReason: missingCalendarLinkReason,
      };
    }
    return {
      scriptGoal: "REVIEW_REQUIRED",
      bookingAllowed: false,
      doNotBookReason: missingCalendarReason,
    };
  }

  return {
    scriptGoal: "BOOK_APPOINTMENT",
    bookingAllowed: true,
    doNotBookReason: "",
  };
}

export function formatClientStatusForOutbound(cs: InboundContactClientStatus | null | undefined): string {
  if (!cs) {
    return "";
  }
  return String(cs);
}

/**
 * Outbound voice may offer reschedule only when we already see an active appointment **and**
 * have a resolved calendar (agent or client default) for GHL-native scheduling — without double-booking new slots.
 */
export function computeOutboundRescheduleAllowed(args: {
  contactFound: boolean;
  hasActiveAppointment: boolean;
  /** Reschedule UX requires a scheduling link. */
  schedulingCalendarLink: string;
  doNotCallSignal: boolean;
}): boolean {
  if (!args.contactFound || !args.hasActiveAppointment || args.doNotCallSignal) {
    return false;
  }
  return Boolean(norm(args.schedulingCalendarLink));
}
