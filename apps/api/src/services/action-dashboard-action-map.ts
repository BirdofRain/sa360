import type { LifecycleEventNameInternal } from "../schemas/lifecycle-event-names.js";
import type { ActionCenterActionCode } from "../schemas/action-dashboard-action.schema.js";
import type { ActionDashboardActionBody } from "../schemas/action-dashboard-action.schema.js";
import type { LifecycleEventSchema } from "../schemas/lifecycle-event.schema.js";
import { suggestMetaEventName } from "@sa360/shared";

export type BuiltLifecycleEventSpec = {
  eventNameInternal: LifecycleEventNameInternal;
  statePatch: Partial<LifecycleEventSchema["state"]>;
  dispositionCode?: string;
  appointment?: LifecycleEventSchema["appointment"];
  call?: LifecycleEventSchema["call"];
  policy?: LifecycleEventSchema["policy"];
  ai?: LifecycleEventSchema["ai"];
};

export const ACTION_CODE_TO_LIFECYCLE_EVENTS: Record<
  ActionCenterActionCode,
  BuiltLifecycleEventSpec[]
> = {
  CALL_ATTEMPT: [
    {
      eventNameInternal: "call_attempt_logged",
      statePatch: { lifecycle_stage: "ATTEMPTING_CONTACT" },
    },
  ],
  CALL_CONNECTED: [
    {
      eventNameInternal: "call_connected",
      statePatch: { lifecycle_stage: "ATTEMPTING_CONTACT" },
    },
  ],
  NO_ANSWER: [
    {
      eventNameInternal: "call_no_answer",
      statePatch: { lifecycle_stage: "ATTEMPTING_CONTACT", agent_disposition: "no_answer" },
    },
  ],
  BOOKED: [
    {
      eventNameInternal: "disposition_logged",
      statePatch: { agent_disposition: "booked" },
      dispositionCode: "booked",
    },
    {
      eventNameInternal: "appointment_set",
      statePatch: {
        lifecycle_stage: "APPOINTMENT_SET",
        appointment_status: "Scheduled",
      },
    },
  ],
  FOLLOW_UP: [
    {
      eventNameInternal: "disposition_logged",
      statePatch: { agent_disposition: "follow_up_needed" },
      dispositionCode: "follow_up_needed",
    },
    {
      eventNameInternal: "follow_up_needed",
      statePatch: { lifecycle_stage: "FOLLOW_UP" },
    },
  ],
  QUOTE_GIVEN: [
    {
      eventNameInternal: "disposition_logged",
      statePatch: { agent_disposition: "quote_given" },
      dispositionCode: "quote_given",
    },
    {
      eventNameInternal: "quote_given",
      statePatch: { lifecycle_stage: "POLICY_REVIEW", policy_status: "Quote sent" },
    },
  ],
  SOLD: [
    {
      eventNameInternal: "disposition_logged",
      statePatch: { agent_disposition: "sold" },
      dispositionCode: "sold",
    },
    {
      eventNameInternal: "sold",
      statePatch: { lifecycle_stage: "SOLD", policy_status: "Issued" },
    },
  ],
  NOT_INTERESTED: [
    {
      eventNameInternal: "disposition_logged",
      statePatch: { agent_disposition: "not_interested", dead_lead_flag: true },
      dispositionCode: "not_interested",
    },
  ],
  BAD_NUMBER: [
    {
      eventNameInternal: "disposition_logged",
      statePatch: { agent_disposition: "bad_number" },
      dispositionCode: "bad_number",
    },
    {
      eventNameInternal: "bad_number",
      statePatch: { lifecycle_stage: "BAD_NUMBER" },
    },
  ],
  DNC: [
    {
      eventNameInternal: "disposition_logged",
      statePatch: { agent_disposition: "dnc" },
      dispositionCode: "dnc",
    },
    {
      eventNameInternal: "dnc",
      statePatch: { lifecycle_stage: "DNC" },
    },
  ],
  DEAD_LEAD: [
    {
      eventNameInternal: "disposition_logged",
      statePatch: { agent_disposition: "dead_lead", dead_lead_flag: true },
      dispositionCode: "dead_lead",
    },
    {
      eventNameInternal: "dead_lead",
      statePatch: { lifecycle_stage: "DEAD", dead_lead_flag: true },
    },
  ],
};

function mergeActionNotes(body: ActionDashboardActionBody): string | undefined {
  const parts = [body.notes?.trim(), body.followUpDueAt?.trim() ? `Follow-up due: ${body.followUpDueAt.trim()}` : ""]
    .filter(Boolean);
  return parts.length ? parts.join("\n") : undefined;
}

export function resolvePhoneE164(
  body: ActionDashboardActionBody,
  indexPhone?: string | null
): string | null {
  const fromBody = body.phoneE164?.trim();
  if (fromBody) return fromBody;
  const fromIndex = indexPhone?.trim();
  if (fromIndex) return fromIndex;
  return null;
}

export function buildLifecyclePayloadsForAction(args: {
  body: ActionDashboardActionBody;
  actionId: string;
  indexRow?: {
    firstName?: string | null;
    lastName?: string | null;
    displayName?: string | null;
    email?: string | null;
    phoneE164?: string | null;
    leadUid?: string | null;
    lifecycleStage?: string | null;
    appointmentStatus?: string | null;
    policyStatus?: string | null;
    assignedAgentName?: string | null;
  } | null;
}): LifecycleEventSchema[] {
  const { body, actionId, indexRow } = args;
  const specs = ACTION_CODE_TO_LIFECYCLE_EVENTS[body.actionCode];
  const subaccount = body.locationId?.trim() ?? "";
  const phone = resolvePhoneE164(body, indexRow?.phoneE164);
  const leadUid =
    body.leadUid?.trim() ||
    indexRow?.leadUid?.trim() ||
    `lead_ac_${body.contactIdGhl.slice(0, 12)}`;
  const nowUnix = Math.floor(Date.now() / 1000);

  const callBlock =
    body.call ??
    (["CALL_ATTEMPT", "CALL_CONNECTED", "NO_ANSWER"].includes(body.actionCode)
      ? {
          direction: "outbound" as const,
          outcome:
            body.actionCode === "NO_ANSWER"
              ? "no_answer"
              : body.actionCode === "CALL_CONNECTED"
                ? "connected"
                : "attempted",
        }
      : undefined);

  const policyBlock = body.policy
    ? {
        policy_status: body.policy.policyStatus ?? "Issued",
        premium_estimate: body.policy.annualPremium ?? body.policy.monthlyPremium,
        carrier: body.policy.carrier,
        product_type: body.policy.productType,
      }
    : body.actionCode === "SOLD"
      ? { policy_status: "Issued" }
      : undefined;

  const appointmentBlock =
    body.actionCode === "BOOKED"
      ? {
          scheduled_at: body.appointmentStartAt ?? undefined,
          status: "Scheduled",
          source: "agent",
        }
      : undefined;

  const ownership =
    body.actor?.agentId || body.actor?.agentName || indexRow?.assignedAgentName
      ? {
          assigned_agent_id: body.actor?.agentId,
          assigned_agent_name: body.actor?.agentName ?? indexRow?.assignedAgentName ?? undefined,
          updated_by: body.actor?.source ?? "action_center",
        }
      : {
          assigned_agent_name: indexRow?.assignedAgentName ?? undefined,
          updated_by: "action_center",
        };

  return specs.map((spec, index) => {
    const eventUuid = `evt_ac_${actionId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 20)}_${index}`;
    const state: LifecycleEventSchema["state"] = {
      lead_type: undefined,
      lifecycle_stage:
        spec.statePatch.lifecycle_stage ??
        indexRow?.lifecycleStage ??
        undefined,
      appointment_status:
        spec.statePatch.appointment_status ?? indexRow?.appointmentStatus ?? undefined,
      agent_disposition: spec.statePatch.agent_disposition,
      policy_status: spec.statePatch.policy_status ?? indexRow?.policyStatus ?? undefined,
      ai_status: spec.statePatch.ai_status,
      dead_lead_flag: spec.statePatch.dead_lead_flag,
    };

    return {
      schema_version: "1.0",
      client_account_id: body.clientAccountId,
      subaccount_id_ghl: subaccount || undefined,
      contact: {
        lead_uid: leadUid,
        contact_id_ghl: body.contactIdGhl,
        first_name: indexRow?.firstName ?? undefined,
        last_name: indexRow?.lastName ?? undefined,
        email: indexRow?.email ?? undefined,
        phone_e164: phone,
      },
      state,
      event: {
        event_uuid: eventUuid,
        event_name_internal: spec.eventNameInternal,
        event_name_meta: suggestMetaEventName(spec.eventNameInternal),
        event_time_unix: nowUnix,
        send_to_meta: false,
      },
      ownership,
      disposition: spec.dispositionCode
        ? {
            code: spec.dispositionCode,
            notes: mergeActionNotes(body),
            logged_by: body.actor?.agentName ?? "action_center",
          }
        : mergeActionNotes(body)
          ? {
              code: body.actionCode.toLowerCase(),
              notes: mergeActionNotes(body),
              logged_by: body.actor?.agentName ?? "action_center",
            }
          : undefined,
      appointment: spec.eventNameInternal === "appointment_set" ? appointmentBlock : undefined,
      call: callBlock,
      policy: policyBlock,
      ai:
        body.actionCode === "BOOKED"
          ? { booked: true, channel: "action_center", provider: "agent" }
          : undefined,
    };
  });
}

export function listEventNamesForActionCode(code: ActionCenterActionCode): string[] {
  return ACTION_CODE_TO_LIFECYCLE_EVENTS[code].map((s) => s.eventNameInternal);
}
