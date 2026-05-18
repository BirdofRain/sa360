import type { LifecycleEventSchema } from "../schemas/lifecycle-event.schema.js";

type StateSlice = LifecycleEventSchema["state"];

/** Default `state` fields when GHL omits them (index + dashboard read model). */
const EVENT_STATE_DEFAULTS: Partial<Record<string, Partial<StateSlice>>> = {
  appointment_set: {
    lifecycle_stage: "APPOINTMENT_SET",
    appointment_status: "Scheduled",
  },
  appointment_confirmed: {
    lifecycle_stage: "APPOINTMENT_SET",
    appointment_status: "Confirmed",
  },
  appointment_showed: {
    lifecycle_stage: "APPOINTMENT_SET",
    appointment_status: "Showed",
  },
  appointment_no_show: {
    lifecycle_stage: "NO_SHOW",
    appointment_status: "No Show",
  },
  no_show: {
    lifecycle_stage: "NO_SHOW",
    appointment_status: "No Show",
  },
  appointment_cancelled: {
    appointment_status: "Cancelled",
  },
  appointment_rescheduled: {
    lifecycle_stage: "APPOINTMENT_SET",
    appointment_status: "Rescheduled",
  },
  contact_replied: {
    lifecycle_stage: "AI_ENGAGED",
  },
  first_response: {
    lifecycle_stage: "AI_ENGAGED",
  },
  ai_responded: {
    lifecycle_stage: "AI_ENGAGED",
    ai_status: "engaged",
  },
  ai_engaged: {
    lifecycle_stage: "AI_ENGAGED",
    ai_status: "engaged",
  },
  ai_booked: {
    lifecycle_stage: "APPOINTMENT_SET",
    appointment_status: "Scheduled",
    ai_status: "booked_by_bot",
  },
  ai_booking_failed: {
    ai_status: "booking_failed",
  },
  call_attempt_logged: {
    lifecycle_stage: "ATTEMPTING_CONTACT",
  },
  call_connected: {
    lifecycle_stage: "ATTEMPTING_CONTACT",
  },
  call_no_answer: {
    lifecycle_stage: "ATTEMPTING_CONTACT",
    agent_disposition: "no_answer",
  },
  disposition_logged: {},
  follow_up_needed: {
    lifecycle_stage: "FOLLOW_UP",
    agent_disposition: "follow_up_needed",
  },
  quote_given: {
    lifecycle_stage: "POLICY_REVIEW",
    policy_status: "Quote sent",
  },
  sold: {
    lifecycle_stage: "SOLD",
    agent_disposition: "sold",
  },
  sale_logged: {
    lifecycle_stage: "SOLD",
    agent_disposition: "sold",
  },
  bad_number: {
    lifecycle_stage: "BAD_NUMBER",
    agent_disposition: "bad_number",
  },
  dnc: {
    lifecycle_stage: "DNC",
    agent_disposition: "dnc",
  },
  dead_lead: {
    lifecycle_stage: "DEAD",
    dead_lead_flag: true,
  },
  policy_issued: {
    lifecycle_stage: "EXISTING_CLIENT",
    policy_status: "Issued",
  },
  lead_created: {
    lifecycle_stage: "NEW",
  },
};

function pickStr(v: unknown): string | undefined {
  if (typeof v === "string" && v.trim()) return v.trim();
  return undefined;
}

function mergeState(base: StateSlice, patch: Partial<StateSlice>): StateSlice {
  const out: StateSlice = { ...base };
  for (const [key, value] of Object.entries(patch) as [keyof StateSlice, unknown][]) {
    if (value === undefined || value === null) continue;
    const cur = out[key];
    if (cur === undefined || cur === null || (typeof cur === "string" && !cur.trim())) {
      (out as Record<string, unknown>)[key] = value;
    }
  }
  return out;
}

/**
 * Merge optional `appointment` / `call` / `policy` / `ai` blocks and event-type defaults
 * into `state` before persisting LifecycleEvent and upserting InboundContactIndex.
 */
export function enrichLifecyclePayloadForIngest(
  payload: LifecycleEventSchema
): LifecycleEventSchema {
  let state: StateSlice = { ...payload.state };

  const appt = payload.appointment;
  if (appt) {
    state = mergeState(state, {
      appointment_status: pickStr(appt.status) ?? state.appointment_status,
      lifecycle_stage:
        appt.scheduled_at && !state.lifecycle_stage ? "APPOINTMENT_SET" : state.lifecycle_stage,
    });
    if (pickStr(appt.source)?.toLowerCase().includes("ai") && !state.ai_status) {
      state = mergeState(state, { ai_status: "booked_by_ai" });
    }
  }

  const call = payload.call;
  if (call) {
    const outcome = pickStr(call.outcome);
    if (outcome) {
      state = mergeState(state, {
        agent_disposition: state.agent_disposition ?? outcome,
      });
    }
    if (call.direction === "outbound" && !state.lifecycle_stage) {
      state = mergeState(state, { lifecycle_stage: "ATTEMPTING_CONTACT" });
    }
  }

  const policy = payload.policy;
  if (policy) {
    state = mergeState(state, {
      policy_status: pickStr(policy.policy_status) ?? state.policy_status,
    });
    if (pickStr(policy.status) === "issued" && !state.policy_status) {
      state = mergeState(state, { policy_status: "Issued" });
    }
  }

  const ai = payload.ai;
  if (ai) {
    const aiStatus =
      pickStr(ai.outcome) ??
      (ai.booked === true ? "booked_by_bot" : ai.booked === false ? "not_booked" : undefined) ??
      pickStr(ai.failure_reason);
    if (aiStatus) {
      state = mergeState(state, { ai_status: state.ai_status ?? aiStatus });
    }
    if (ai.booked === true) {
      state = mergeState(state, {
        lifecycle_stage: state.lifecycle_stage ?? "APPOINTMENT_SET",
        appointment_status: state.appointment_status ?? "Scheduled",
      });
    }
  }

  const defaults = EVENT_STATE_DEFAULTS[payload.event.event_name_internal];
  if (defaults) {
    state = mergeState(state, defaults);
  }

  if (payload.disposition?.code) {
    state = mergeState(state, {
      agent_disposition: state.agent_disposition ?? pickStr(payload.disposition.code),
    });
  }

  return {
    ...payload,
    attribution: payload.attribution ?? {},
    state,
  };
}
