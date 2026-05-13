import type { InboundContactIndex } from "@prisma/client";
import { cleanSynthflowOutboundScalar } from "../lib/lifecycle-routing-calendar.js";
import { logger } from "../lib/logger.js";
import { isSynthflowOutboundContextEnabled } from "../lib/synthflow-voice-env.js";
import { resolveOutboundContextCalendar } from "../lib/synthflow-outbound-context-calendar-resolve.js";
import type { OutboundContextCalendarResolution } from "../lib/synthflow-outbound-context-calendar-resolve.js";
import {
  computeOutboundRescheduleAllowed,
  formatClientStatusForOutbound,
  outboundHasActiveAppointment,
  outboundLifecycleBadNumber,
  outboundLifecycleDoNotCall,
  resolveOutboundGuardrails,
} from "../lib/synthflow-outbound-context.logic.js";
import { resolveSynthflowOutboundTenant } from "../lib/synthflow-tenant-resolve.js";
import type { SynthflowOutboundContextBody } from "../schemas/synthflow-outbound-context.schema.js";
import {
  findByCompositeKey,
  findByContactIdGhl,
  findByLeadUid,
  findByNormalizedPhone,
  findByNormalizedPhoneGlobalFallback,
  type InboundContactLookupScope,
} from "../repositories/inbound-contact-index.repository.js";
import { normalizeToE164 } from "./phone-e164.service.js";

export type SynthflowOutboundContextResponse = {
  status: "success";
  custom_variables: Record<string, string>;
  metadata: {
    matched_by: string;
    lookup_status: string;
    scheduling_source: "ghl_native" | "precall_context";
    fallback_used: string;
    contact_found: "true" | "false";
    known_contact: "true" | "false";
  };
};

function str(v: string | null | undefined): string {
  return v ?? "";
}

function callStr(call: Record<string, unknown>, key: string): string {
  const v = call[key];
  if (typeof v === "string") {
    return v.trim();
  }
  return "";
}

function firstNonEmptyPhone(...parts: string[]): string {
  for (const p of parts) {
    const t = p.trim();
    if (t) {
      return t;
    }
  }
  return "";
}

function customerNameFromRow(row: InboundContactIndex): string {
  const dn = row.displayName?.trim();
  if (dn) {
    return dn;
  }
  return [row.firstName, row.lastName].filter(Boolean).join(" ").trim();
}

export function extractOutboundGuardrailPhones(body: unknown): {
  fromRaw: string;
  toRaw: string;
  modelId: string;
} {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { fromRaw: "", toRaw: "", modelId: "" };
  }
  const root = body as Record<string, unknown>;
  const call = root.call;
  if (!call || typeof call !== "object" || Array.isArray(call)) {
    return { fromRaw: "", toRaw: "", modelId: "" };
  }
  const c = call as Record<string, unknown>;
  return {
    fromRaw: cleanSynthflowOutboundScalar(c.from_number),
    toRaw: firstNonEmptyPhone(
      cleanSynthflowOutboundScalar(c.user_phone_number),
      cleanSynthflowOutboundScalar(c.to_number)
    ),
    modelId: cleanSynthflowOutboundScalar(c.model_id),
  };
}

function buildOutboundMetadata(args: {
  matched_by: string;
  lookup_status: string;
  scheduling_source: "ghl_native" | "precall_context";
  fallback_used: string;
  contact_found: boolean;
  known_contact: boolean;
}): SynthflowOutboundContextResponse["metadata"] {
  return {
    matched_by: args.matched_by,
    lookup_status: args.lookup_status,
    scheduling_source: args.scheduling_source,
    fallback_used: args.fallback_used,
    contact_found: args.contact_found ? "true" : "false",
    known_contact: args.known_contact ? "true" : "false",
  };
}

export function buildOutboundContextGuardrailResponse(
  body: unknown,
  lookup_status: "invalid_payload" | "internal_error"
): SynthflowOutboundContextResponse {
  const { fromRaw, toRaw, modelId } = extractOutboundGuardrailPhones(body);
  const fromE164 = fromRaw ? normalizeToE164(fromRaw) : "";
  const toE164 = toRaw ? normalizeToE164(toRaw) : "";
  return {
    status: "success",
    custom_variables: baseCustomVariables({
      customerName: "",
      row: null,
      fromE164,
      toE164,
      modelId,
      synthflowCallId: "",
      matchedBy: "none",
      lookupStatus: lookup_status,
      scriptGoal: "REVIEW_REQUIRED",
      bookingAllowed: false,
      doNotBookReason: lookup_status === "invalid_payload" ? "invalid_payload" : "internal_error",
      hasActiveAppointment: false,
      schedulingCalendarId: "",
      schedulingCalendarLink: "",
      assignedAgentCalendarId: "",
      assignedAgentCalendarLink: "",
      rescheduleAllowed: false,
      fallbackUsed: false,
      calendarSource: "none",
      calendarResolutionSynthflow: "none",
      doNotCallSignal: false,
      contactFound: false,
      knownContact: false,
    }),
    metadata: buildOutboundMetadata({
      matched_by: "none",
      lookup_status,
      scheduling_source: "ghl_native",
      fallback_used: "false",
      contact_found: false,
      known_contact: false,
    }),
  };
}

type LookupOutcome =
  | {
      row: InboundContactIndex;
      matchedBy: "composite_key" | "contact_id_ghl" | "lead_uid" | "phone_scoped" | "phone_global_fallback";
      lookupStatus: string;
    }
  | { row: null; matchedBy: "none"; lookupStatus: "not_found" };

function mergePhoneScope(args: {
  mergedClient: string;
  subFromPayload: boolean;
  mergedSub: string;
  tenantScope: InboundContactLookupScope | null;
}): InboundContactLookupScope | undefined {
  const { mergedClient, subFromPayload, mergedSub, tenantScope } = args;
  if (!mergedClient) {
    return tenantScope ?? undefined;
  }
  if (subFromPayload) {
    return { clientAccountId: mergedClient, subaccountIdGhl: mergedSub };
  }
  if (tenantScope?.clientAccountId === mergedClient && tenantScope.subaccountIdGhl !== undefined) {
    return { clientAccountId: mergedClient, subaccountIdGhl: tenantScope.subaccountIdGhl };
  }
  return { clientAccountId: mergedClient };
}

async function lookupOutboundContact(
  body: SynthflowOutboundContextBody,
  toE164: string,
  fromE164: string,
  modelId: string
): Promise<LookupOutcome> {
  const call = body.call as Record<string, unknown>;
  const explicitClient = callStr(call, "client_account_id");
  const tenant = resolveSynthflowOutboundTenant(modelId, fromE164);
  const mergedClient = explicitClient || tenant.resolvedClientAccountId.trim();
  const subFromPayload = Object.prototype.hasOwnProperty.call(call, "subaccount_id_ghl");
  const mergedSub = subFromPayload ? String(call.subaccount_id_ghl ?? "").trim() : tenant.resolvedSubaccountIdGhl;

  if (mergedClient && toE164) {
    const hit = await findByCompositeKey(mergedClient, mergedSub, toE164);
    if (hit) {
      return { row: hit, matchedBy: "composite_key", lookupStatus: "matched_composite" };
    }
  }

  const cid = callStr(call, "contact_id_ghl");
  if (cid) {
    const scope = mergedClient ? { clientAccountId: mergedClient } : undefined;
    const hit = await findByContactIdGhl(cid, scope);
    if (hit) {
      return { row: hit, matchedBy: "contact_id_ghl", lookupStatus: "matched_contact_id" };
    }
  }

  const leadUid = callStr(call, "lead_uid");
  if (leadUid) {
    const scope = mergedClient ? { clientAccountId: mergedClient } : undefined;
    const hit = await findByLeadUid(leadUid, scope);
    if (hit) {
      return { row: hit, matchedBy: "lead_uid", lookupStatus: "matched_lead_uid" };
    }
  }

  const phoneScope = mergePhoneScope({
    mergedClient,
    subFromPayload,
    mergedSub,
    tenantScope: tenant.scope,
  });

  if (toE164 && phoneScope?.clientAccountId) {
    const hit = await findByNormalizedPhone(toE164, phoneScope);
    if (hit) {
      return { row: hit, matchedBy: "phone_scoped", lookupStatus: "matched_phone_scoped" };
    }
  }

  if (toE164) {
    const g = await findByNormalizedPhoneGlobalFallback(toE164);
    if (g.row) {
      return {
        row: g.row,
        matchedBy: "phone_global_fallback",
        lookupStatus: "matched_phone_global",
      };
    }
  }

  return { row: null, matchedBy: "none", lookupStatus: "not_found" };
}

type BaseCvArgs = {
  customerName: string;
  row: InboundContactIndex | null;
  fromE164: string;
  toE164: string;
  modelId: string;
  synthflowCallId: string;
  matchedBy: string;
  lookupStatus: string;
  scriptGoal: string;
  bookingAllowed: boolean;
  doNotBookReason: string;
  hasActiveAppointment: boolean;
  /** Effective calendar from env map (agent or client default) — use for GHL-native scheduling URLs/IDs. */
  schedulingCalendarId: string;
  schedulingCalendarLink: string;
  /** Only when resolution came from `byAgentId` map (not client default). */
  assignedAgentCalendarId: string;
  assignedAgentCalendarLink: string;
  rescheduleAllowed: boolean;
  fallbackUsed: boolean;
  calendarSource: OutboundContextCalendarResolution["calendarSource"];
  /** `calendar_resolution` returned to Synthflow (`ghl_native` | `precall_context` | `none`). */
  calendarResolutionSynthflow: "ghl_native" | "precall_context" | "none";
  doNotCallSignal: boolean;
  contactFound: boolean;
  knownContact: boolean;
};

function baseCustomVariables(args: BaseCvArgs): Record<string, string> {
  const r = args.row;
  return {
    event: "call_outbound_context",
    model_id: args.modelId,
    synthflow_call_id: args.synthflowCallId,
    from_number_e164: args.fromE164,
    to_number_e164: args.toE164,
    lead_phone_e164: args.toE164,
    known_contact: args.knownContact ? "true" : "false",
    customer_name: args.customerName,
    contact_id_ghl: r ? str(r.contactIdGhl) : "",
    client_account_id: r ? str(r.clientAccountId) : "",
    subaccount_id_ghl: r ? str(r.subaccountIdGhl) : "",
    assigned_agent_id: r ? str(r.assignedAgentId) : "",
    assigned_agent_name: r ? str(r.assignedAgentName) : "",
    assigned_agent_calendar_id: args.assignedAgentCalendarId,
    assigned_agent_calendar_link: args.assignedAgentCalendarLink,
    scheduling_calendar_id: args.schedulingCalendarId,
    scheduling_calendar_link: args.schedulingCalendarLink,
    lifecycle_stage: r ? str(r.lifecycleStage) : "",
    appointment_status: r ? str(r.appointmentStatus) : "",
    has_active_appointment: args.hasActiveAppointment ? "true" : "false",
    booking_allowed: args.bookingAllowed ? "true" : "false",
    reschedule_allowed: args.rescheduleAllowed ? "true" : "false",
    script_goal: args.scriptGoal,
    do_not_book_reason: args.doNotBookReason,
    lead_uid: r?.leadUid?.trim() ?? "",
    policy_status: r ? str(r.policyStatus) : "",
    client_status: r ? formatClientStatusForOutbound(r.clientStatus) : "",
    matched_by: args.matchedBy,
    lookup_status: args.lookupStatus,
    calendar_resolution: args.calendarResolutionSynthflow,
    do_not_call_signal: args.doNotCallSignal ? "true" : "false",
    contact_found: args.contactFound ? "true" : "false",
    scheduling_fallback_used: args.fallbackUsed ? "true" : "false",
    calendar_id: args.schedulingCalendarId,
    calendar_link: args.schedulingCalendarLink,
  };
}

export async function executeSynthflowOutboundContext(
  body: SynthflowOutboundContextBody
): Promise<SynthflowOutboundContextResponse> {
  const call = body.call as Record<string, unknown>;
  const rawFrom = String(call["from_number"] ?? "");
  const rawTo = String(call["to_number"] ?? "");
  const modelId = String(call["model_id"] ?? "").trim();
  const synthflowCallId = callStr(call, "synthflow_call_id");
  const precallName = callStr(call, "customer_name");
  const precallLink = callStr(call, "scheduling_calendar_link");
  const precallId = callStr(call, "scheduling_calendar_id");

  let fromE164 = "";
  let toE164 = "";

  try {
    fromE164 = normalizeToE164(rawFrom);
    toE164 = normalizeToE164(rawTo);

    if (!isSynthflowOutboundContextEnabled()) {
      return {
        status: "success",
        custom_variables: baseCustomVariables({
          customerName: "",
          row: null,
          fromE164,
          toE164,
          modelId,
          synthflowCallId,
          matchedBy: "none",
          lookupStatus: "disabled",
          scriptGoal: "REVIEW_REQUIRED",
          bookingAllowed: false,
          doNotBookReason: "feature_disabled",
          hasActiveAppointment: false,
          schedulingCalendarId: "",
          schedulingCalendarLink: "",
          assignedAgentCalendarId: "",
          assignedAgentCalendarLink: "",
          rescheduleAllowed: false,
          fallbackUsed: false,
          calendarSource: "none",
          calendarResolutionSynthflow: "none",
          doNotCallSignal: false,
          contactFound: false,
          knownContact: false,
        }),
        metadata: buildOutboundMetadata({
          matched_by: "none",
          lookup_status: "disabled",
          scheduling_source: "ghl_native",
          fallback_used: "false",
          contact_found: false,
          known_contact: false,
        }),
      };
    }

    if (!toE164) {
      return {
        status: "success",
        custom_variables: baseCustomVariables({
          customerName: "",
          row: null,
          fromE164,
          toE164,
          modelId,
          synthflowCallId,
          matchedBy: "none",
          lookupStatus: "invalid_phone",
          scriptGoal: "REVIEW_REQUIRED",
          bookingAllowed: false,
          doNotBookReason: "invalid_phone",
          hasActiveAppointment: false,
          schedulingCalendarId: "",
          schedulingCalendarLink: "",
          assignedAgentCalendarId: "",
          assignedAgentCalendarLink: "",
          rescheduleAllowed: false,
          fallbackUsed: false,
          calendarSource: "none",
          calendarResolutionSynthflow: "none",
          doNotCallSignal: false,
          contactFound: false,
          knownContact: false,
        }),
        metadata: buildOutboundMetadata({
          matched_by: "none",
          lookup_status: "invalid_phone",
          scheduling_source: "ghl_native",
          fallback_used: "false",
          contact_found: false,
          known_contact: false,
        }),
      };
    }

    const outcome = await lookupOutboundContact(body, toE164, fromE164, modelId);
    const row = outcome.row;
    const contactFound = Boolean(row);
    const precallBookingEligible =
      !row && precallName.length > 0 && Boolean(toE164) && precallLink.length > 0;

    const customerName = row ? customerNameFromRow(row) : precallName;

    const hasActive =
      row != null &&
      outboundHasActiveAppointment({
        appointmentStatus: row.appointmentStatus,
        lifecycleStage: row.lifecycleStage,
      });

    const lc = row?.lifecycleStage ?? "";
    const doNotCallSignal =
      row != null &&
      (outboundLifecycleDoNotCall(lc) || outboundLifecycleBadNumber(lc));

    let calRes = await resolveOutboundContextCalendar(row);
    if (!row && precallBookingEligible) {
      calRes = {
        schedulingCalendarId: precallId,
        schedulingCalendarLink: precallLink,
        assignedAgentCalendarId: "",
        assignedAgentCalendarLink: "",
        calendarSource: "none",
        calendarIdPresent: Boolean(precallId || precallLink),
        newBookingCalendarReady: precallLink.length > 0,
        routingCalendarComplete: false,
      };
    }

    const schedulingCalendarId = calRes.schedulingCalendarId;
    const schedulingCalendarLink = calRes.schedulingCalendarLink;
    const assignedAgentCalendarId = calRes.assignedAgentCalendarId;
    const assignedAgentCalendarLink = calRes.assignedAgentCalendarLink;

    const usedPrecallCalendar = !row && precallBookingEligible;
    const calendarResolutionSynthflow: "ghl_native" | "precall_context" | "none" = usedPrecallCalendar
      ? "precall_context"
      : calRes.calendarSource === "none"
        ? "none"
        : "ghl_native";

    const fallbackUsed =
      calRes.calendarSource === "client_default" || outcome.matchedBy === "phone_global_fallback";

    const guard = resolveOutboundGuardrails({
      contactFound,
      precallBookingEligible,
      hasActiveAppointment: hasActive,
      calendarIdPresent: calRes.calendarIdPresent,
      newBookingCalendarReady: calRes.newBookingCalendarReady,
      assignedAgentId: row?.assignedAgentId,
      doNotCallSignal,
      routingCalendarComplete: calRes.routingCalendarComplete,
    });

    const scriptGoal = guard.scriptGoal;
    const bookingAllowed = guard.bookingAllowed;
    const doNotBookReason = guard.doNotBookReason;

    const rescheduleAllowed = computeOutboundRescheduleAllowed({
      contactFound,
      hasActiveAppointment: hasActive,
      schedulingCalendarLink,
      doNotCallSignal,
    });

    const knownContact = contactFound || precallBookingEligible;
    const indexResolved = contactFound;
    const schedulingMetaSource: "ghl_native" | "precall_context" =
      usedPrecallCalendar ? "precall_context" : "ghl_native";

    logger.info("synthflow_outbound_context", {
      outbound_context_requested: true,
      outbound_context_resolved: indexResolved,
      outbound_context_precall_booking: precallBookingEligible,
      synthflow_call_id: synthflowCallId || undefined,
      lookup_status: outcome.lookupStatus,
      matched_by: outcome.matchedBy,
      lead_phone_suffix: toE164.slice(-4),
      from_phone_suffix: fromE164 ? fromE164.slice(-4) : "",
      script_goal: scriptGoal,
      booking_allowed: bookingAllowed,
      do_not_book_reason: doNotBookReason,
      contact_found: contactFound,
      known_contact: knownContact,
      reschedule_allowed: rescheduleAllowed,
    });

    return {
      status: "success",
      custom_variables: baseCustomVariables({
        customerName,
        row,
        fromE164,
        toE164,
        modelId,
        synthflowCallId,
        matchedBy: outcome.matchedBy,
        lookupStatus: outcome.lookupStatus,
        scriptGoal,
        bookingAllowed,
        doNotBookReason,
        hasActiveAppointment: hasActive,
        schedulingCalendarId,
        schedulingCalendarLink,
        assignedAgentCalendarId,
        assignedAgentCalendarLink,
        rescheduleAllowed,
        fallbackUsed,
        calendarSource: calRes.calendarSource,
        calendarResolutionSynthflow,
        doNotCallSignal,
        contactFound,
        knownContact,
      }),
      metadata: buildOutboundMetadata({
        matched_by: outcome.matchedBy,
        lookup_status: outcome.lookupStatus,
        scheduling_source: schedulingMetaSource,
        fallback_used: fallbackUsed ? "true" : "false",
        contact_found: contactFound,
        known_contact: knownContact,
      }),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn("synthflow_outbound_context_error", { error: message });
    return buildOutboundContextGuardrailResponse(body, "internal_error");
  }
}
