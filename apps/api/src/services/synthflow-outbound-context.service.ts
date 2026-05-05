import type { InboundContactIndex } from "@prisma/client";
import { logger } from "../lib/logger.js";
import { isSynthflowOutboundContextEnabled } from "../lib/synthflow-voice-env.js";
import { resolveOutboundCalendarEntry } from "../lib/synthflow-outbound-calendar-env.js";
import {
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
    scheduling_source: "ghl_native";
    fallback_used: string;
  };
};

function str(v: string | null | undefined): string {
  return v ?? "";
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
  const asStr = (v: unknown) =>
    typeof v === "string" ? v : typeof v === "number" && Number.isFinite(v) ? String(v) : "";
  return {
    fromRaw: asStr(c.from_number),
    toRaw: asStr(c.to_number),
    modelId: typeof c.model_id === "string" ? c.model_id : "",
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
      matchedBy: "none",
      lookupStatus: lookup_status,
      scriptGoal: "REVIEW_REQUIRED",
      bookingAllowed: false,
      doNotBookReason: lookup_status === "invalid_payload" ? "invalid_payload" : "internal_error",
      hasActiveAppointment: false,
      calendarId: "",
      calendarLink: "",
      fallbackUsed: false,
      calendarSource: "none",
      doNotCallSignal: false,
      contactFound: false,
    }),
    metadata: {
      matched_by: "none",
      lookup_status,
      scheduling_source: "ghl_native",
      fallback_used: "false",
    },
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
  const call = body.call;
  const explicitClient = call.client_account_id?.trim();
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

  const cid = call.contact_id_ghl?.trim();
  if (cid) {
    const scope = mergedClient ? { clientAccountId: mergedClient } : undefined;
    const hit = await findByContactIdGhl(cid, scope);
    if (hit) {
      return { row: hit, matchedBy: "contact_id_ghl", lookupStatus: "matched_contact_id" };
    }
  }

  const leadUid = call.lead_uid?.trim();
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
  matchedBy: string;
  lookupStatus: string;
  scriptGoal: string;
  bookingAllowed: boolean;
  doNotBookReason: string;
  hasActiveAppointment: boolean;
  calendarId: string;
  calendarLink: string;
  fallbackUsed: boolean;
  calendarSource: "agent" | "client_default" | "none";
  doNotCallSignal: boolean;
  contactFound: boolean;
};

function baseCustomVariables(args: BaseCvArgs): Record<string, string> {
  const r = args.row;
  return {
    event: "call_outbound_context",
    model_id: args.modelId,
    from_number_e164: args.fromE164,
    to_number_e164: args.toE164,
    lead_phone_e164: args.toE164,
    customer_name: args.customerName,
    contact_id_ghl: r ? str(r.contactIdGhl) : "",
    lead_uid: r?.leadUid?.trim() ?? "",
    client_account_id: r ? str(r.clientAccountId) : "",
    subaccount_id_ghl: r ? str(r.subaccountIdGhl) : "",
    lifecycle_stage: r ? str(r.lifecycleStage) : "",
    appointment_status: r ? str(r.appointmentStatus) : "",
    policy_status: r ? str(r.policyStatus) : "",
    client_status: r ? formatClientStatusForOutbound(r.clientStatus) : "",
    assigned_agent_id: r ? str(r.assignedAgentId) : "",
    assigned_agent_name: r ? str(r.assignedAgentName) : "",
    matched_by: args.matchedBy,
    lookup_status: args.lookupStatus,
    has_active_appointment: args.hasActiveAppointment ? "true" : "false",
    booking_allowed: args.bookingAllowed ? "true" : "false",
    script_goal: args.scriptGoal,
    do_not_book_reason: args.doNotBookReason,
    calendar_id: args.calendarId,
    calendar_link: args.calendarLink,
    calendar_resolution: args.calendarSource,
    do_not_call_signal: args.doNotCallSignal ? "true" : "false",
    contact_found: args.contactFound ? "true" : "false",
    scheduling_fallback_used: args.fallbackUsed ? "true" : "false",
  };
}

export async function executeSynthflowOutboundContext(
  body: SynthflowOutboundContextBody
): Promise<SynthflowOutboundContextResponse> {
  const rawFrom = String(body.call.from_number ?? "");
  const rawTo = String(body.call.to_number ?? "");
  const modelId = String(body.call.model_id ?? "").trim();

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
          matchedBy: "none",
          lookupStatus: "disabled",
          scriptGoal: "REVIEW_REQUIRED",
          bookingAllowed: false,
          doNotBookReason: "feature_disabled",
          hasActiveAppointment: false,
          calendarId: "",
          calendarLink: "",
          fallbackUsed: false,
          calendarSource: "none",
          doNotCallSignal: false,
          contactFound: false,
        }),
        metadata: {
          matched_by: "none",
          lookup_status: "disabled",
          scheduling_source: "ghl_native",
          fallback_used: "false",
        },
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
          matchedBy: "none",
          lookupStatus: "invalid_phone",
          scriptGoal: "REVIEW_REQUIRED",
          bookingAllowed: false,
          doNotBookReason: "invalid_phone",
          hasActiveAppointment: false,
          calendarId: "",
          calendarLink: "",
          fallbackUsed: false,
          calendarSource: "none",
          doNotCallSignal: false,
          contactFound: false,
        }),
        metadata: {
          matched_by: "none",
          lookup_status: "invalid_phone",
          scheduling_source: "ghl_native",
          fallback_used: "false",
        },
      };
    }

    const outcome = await lookupOutboundContact(body, toE164, fromE164, modelId);
    const row = outcome.row;
    const contactFound = Boolean(row);
    const customerName = row ? customerNameFromRow(row) : "";

    const hasActive =
      row != null &&
      outboundHasActiveAppointment({
        appointmentStatus: row.appointmentStatus,
        lifecycleStage: row.lifecycleStage,
      });

    const lc = row?.lifecycleStage ?? "";
    const doNotCallSignal =
      row != null &&
      (outboundLifecycleDoNotCall(lc) ||
        outboundLifecycleBadNumber(lc));

    const clientAccountForCalendar = row?.clientAccountId?.trim() ?? "";
    const cal = resolveOutboundCalendarEntry({
      clientAccountId: clientAccountForCalendar,
      assignedAgentId: row?.assignedAgentId,
    });

    const calendarPresent = Boolean(cal.entry?.calendarId);
    const calendarId = cal.entry?.calendarId ?? "";
    const calendarLink = cal.entry?.calendarLink ?? "";

    const fallbackUsed =
      cal.source === "client_default" || outcome.matchedBy === "phone_global_fallback";

    const guard = resolveOutboundGuardrails({
      contactFound,
      hasActiveAppointment: hasActive,
      calendarPresent,
      assignedAgentId: row?.assignedAgentId,
      doNotCallSignal,
    });

    const scriptGoal = guard.scriptGoal;
    const bookingAllowed = guard.bookingAllowed;
    const doNotBookReason = guard.doNotBookReason;

    logger.info("synthflow_outbound_context", {
      lookup_status: outcome.lookupStatus,
      matched_by: outcome.matchedBy,
      lead_phone_suffix: toE164.slice(-4),
      from_phone_suffix: fromE164 ? fromE164.slice(-4) : "",
      script_goal: scriptGoal,
      booking_allowed: bookingAllowed,
    });

    return {
      status: "success",
      custom_variables: baseCustomVariables({
        customerName,
        row,
        fromE164,
        toE164,
        modelId,
        matchedBy: outcome.matchedBy,
        lookupStatus: outcome.lookupStatus,
        scriptGoal,
        bookingAllowed,
        doNotBookReason,
        hasActiveAppointment: hasActive,
        calendarId,
        calendarLink,
        fallbackUsed,
        calendarSource: cal.source,
        doNotCallSignal,
        contactFound,
      }),
      metadata: {
        matched_by: outcome.matchedBy,
        lookup_status: outcome.lookupStatus,
        scheduling_source: "ghl_native",
        fallback_used: fallbackUsed ? "true" : "false",
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn("synthflow_outbound_context_error", { error: message });
    return buildOutboundContextGuardrailResponse(body, "internal_error");
  }
}
