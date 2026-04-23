import {
  logInboundLookupError,
  logInboundLookupInfo,
  logInboundLookupWarn,
} from "../lib/inbound-lookup-log.js";
import {
  formatClientStatusForSynthflow,
  resolveClientStatusAfterGhlEvidence,
} from "../lib/inbound-contact-client-status.js";
import {
  getSynthflowLookupClientAccountId,
  getSynthflowLookupSubaccountIdGhl,
  isSynthflowInboundEnabled,
} from "../lib/synthflow-voice-env.js";
import type { SynthflowInboundLookupBody } from "../schemas/synthflow-inbound-lookup.schema.js";
import {
  findByNormalizedPhone,
  tryUpsertFromGhlFallback,
  type InboundContactLookupScope,
} from "./inbound-contact-index.service.js";
import { normalizeToE164 } from "./phone-e164.service.js";
import { searchGhlContactByPhone } from "./ghl-contact-search.service.js";

export type SynthflowInboundLookupResponse = {
  call_inbound: {
    override_model_id: string;
    custom_variables: {
      known_caller: string;
      customer_name: string;
      first_name: string;
      last_name: string;
      contact_id_ghl: string;
      state: string;
      assigned_agent_name: string;
      lifecycle_stage: string;
      appointment_status: string;
      policy_status: string;
      caller_phone_e164: string;
      matched_by: string;
      client_status: string;
    };
    metadata: {
      lookup_status: string;
      from_number: string;
      to_number: string;
      default_model_id: string;
    };
  };
};

function emptyResponse(
  input: SynthflowInboundLookupBody,
  fromE164: string,
  toE164: string,
  lookup_status: string
): SynthflowInboundLookupResponse {
  const defaultModelId = input.call_inbound.model_id ?? "";
  return {
    call_inbound: {
      override_model_id: "",
      custom_variables: {
        known_caller: "false",
        customer_name: "",
        first_name: "",
        last_name: "",
        contact_id_ghl: "",
        state: "",
        assigned_agent_name: "",
        lifecycle_stage: "",
        appointment_status: "",
        policy_status: "",
        caller_phone_e164: fromE164,
        matched_by: "",
        client_status: "",
      },
      metadata: {
        lookup_status,
        from_number: fromE164,
        to_number: toE164,
        default_model_id: defaultModelId,
      },
    },
  };
}

function lastFourDigits(e164: string): string {
  const d = e164.replace(/\D/g, "");
  return d.length >= 4 ? d.slice(-4) : "****";
}

export function phoneSuffixForLog(e164OrRaw: string): string {
  return lastFourDigits(e164OrRaw);
}

function extractBestEffortPhones(body: unknown): {
  fromRaw: string;
  toRaw: string;
  modelId: string;
} {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { fromRaw: "", toRaw: "", modelId: "" };
  }
  const root = body as Record<string, unknown>;
  const ci = root.call_inbound;
  if (!ci || typeof ci !== "object" || Array.isArray(ci)) {
    return { fromRaw: "", toRaw: "", modelId: "" };
  }
  const c = ci as Record<string, unknown>;
  const asStr = (v: unknown) =>
    typeof v === "string" ? v : typeof v === "number" && Number.isFinite(v) ? String(v) : "";
  return {
    fromRaw: asStr(c.from_number),
    toRaw: asStr(c.to_number),
    modelId: typeof c.model_id === "string" ? c.model_id : "",
  };
}

/**
 * Valid Synthflow-shaped response when the request body failed strict validation or an unexpected error occurred.
 * Does not log or echo raw body content.
 */
export function buildSynthflowGuardrailResponse(
  body: unknown,
  lookup_status: "invalid_payload" | "internal_error"
): SynthflowInboundLookupResponse {
  const { fromRaw, toRaw, modelId } = extractBestEffortPhones(body);
  const fromE164 = fromRaw ? normalizeToE164(fromRaw) : "";
  const toE164 = toRaw ? normalizeToE164(toRaw) : "";
  return {
    call_inbound: {
      override_model_id: "",
      custom_variables: {
        known_caller: "false",
        customer_name: "",
        first_name: "",
        last_name: "",
        contact_id_ghl: "",
        state: "",
        assigned_agent_name: "",
        lifecycle_stage: "",
        appointment_status: "",
        policy_status: "",
        caller_phone_e164: fromE164,
        matched_by: "",
        client_status: "",
      },
      metadata: {
        lookup_status,
        from_number: fromE164,
        to_number: toE164,
        default_model_id: modelId,
      },
    },
  };
}

export function logSynthflowLookupEvent(
  level: "info" | "warn" | "error",
  event: string,
  fields: Record<string, string | number | boolean | undefined>
) {
  const meta = {
    component: "synthflow_inbound_lookup",
    event,
    ...fields,
  };
  if (level === "error") {
    logInboundLookupError("synthflow_inbound_lookup", meta);
    return;
  }
  if (level === "warn") {
    logInboundLookupWarn("synthflow_inbound_lookup", meta);
    return;
  }
  logInboundLookupInfo("synthflow_inbound_lookup", meta);
}

function buildSynthflowLookupScope(): InboundContactLookupScope | undefined {
  const clientAccountId = getSynthflowLookupClientAccountId();
  if (!clientAccountId) {
    return undefined;
  }
  const subaccountIdGhl = getSynthflowLookupSubaccountIdGhl();
  if (subaccountIdGhl === undefined) {
    return { clientAccountId };
  }
  return { clientAccountId, subaccountIdGhl };
}

function hasLocalMatchSignal(row: {
  contactIdGhl: string | null;
  displayName: string | null;
  firstName: string | null;
  lastName: string | null;
}): boolean {
  const id = row.contactIdGhl?.trim() ?? "";
  const dn = row.displayName?.trim() ?? "";
  const fn = row.firstName?.trim() ?? "";
  const ln = row.lastName?.trim() ?? "";
  return Boolean(id || dn || fn || ln);
}

function str(v: string | null | undefined): string {
  return v ?? "";
}

export async function executeSynthflowInboundLookup(
  body: SynthflowInboundLookupBody
): Promise<SynthflowInboundLookupResponse> {
  let fromE164 = "";
  let toE164 = "";
  try {
    fromE164 = normalizeToE164(body.call_inbound.from_number);
    toE164 = normalizeToE164(body.call_inbound.to_number);
    const defaultModelId = body.call_inbound.model_id ?? "";

    if (!isSynthflowInboundEnabled()) {
      logSynthflowLookupEvent("info", "feature_disabled", {
        lookup_status: "disabled",
        caller_phone_suffix: lastFourDigits(fromE164),
        to_phone_suffix: lastFourDigits(toE164),
      });
      return emptyResponse(body, fromE164, toE164, "disabled");
    }

    const scope = buildSynthflowLookupScope();
    logSynthflowLookupEvent("info", "Synthflow inbound lookup called", {
      lookup_status: "started",
      caller_phone_e164: fromE164,
      to_phone_e164: toE164,
      clientAccountId: scope?.clientAccountId,
      subaccountIdGhl: scope?.subaccountIdGhl,
    });

    if (!fromE164) {
      logSynthflowLookupEvent("warn", "invalid phone", {
        lookup_status: "invalid_phone",
        caller_phone_e164: fromE164,
        to_phone_e164: toE164,
        clientAccountId: scope?.clientAccountId,
        subaccountIdGhl: scope?.subaccountIdGhl,
      });
      return emptyResponse(body, fromE164, toE164, "invalid_phone");
    }

    const local = await findByNormalizedPhone(fromE164, scope);

    if (local && hasLocalMatchSignal(local)) {
      const customerName =
        local.displayName?.trim() ||
        [local.firstName, local.lastName].filter(Boolean).join(" ").trim();

      logSynthflowLookupEvent("info", "local match hit", {
        lookup_status: "matched_local",
        caller_phone_e164: fromE164,
        to_phone_e164: toE164,
        clientAccountId: scope?.clientAccountId,
        subaccountIdGhl: scope?.subaccountIdGhl,
        matched_by: "local_phone",
      });

      return {
        call_inbound: {
          override_model_id: "",
          custom_variables: {
            known_caller: "true",
            customer_name: customerName,
            first_name: str(local.firstName),
            last_name: str(local.lastName),
            contact_id_ghl: str(local.contactIdGhl),
            state: str(local.state),
            assigned_agent_name: str(local.assignedAgentName),
            lifecycle_stage: str(local.lifecycleStage),
            appointment_status: str(local.appointmentStatus),
            policy_status: str(local.policyStatus),
            caller_phone_e164: fromE164,
            matched_by: "local_phone",
            client_status: formatClientStatusForSynthflow(local.clientStatus),
          },
          metadata: {
            lookup_status: "matched_local",
            from_number: fromE164,
            to_number: toE164,
            default_model_id: defaultModelId,
          },
        },
      };
    }

    logSynthflowLookupEvent("info", "local miss", {
      lookup_status: "local_miss",
      caller_phone_e164: fromE164,
      to_phone_e164: toE164,
      clientAccountId: scope?.clientAccountId,
      subaccountIdGhl: scope?.subaccountIdGhl,
      has_local_row: Boolean(local),
      has_match_signal: local ? hasLocalMatchSignal(local) : false,
    });

    logSynthflowLookupEvent("info", "GHL fallback started", {
      lookup_status: "ghl_fallback_started",
      caller_phone_e164: fromE164,
      to_phone_e164: toE164,
      clientAccountId: scope?.clientAccountId,
      subaccountIdGhl: scope?.subaccountIdGhl,
    });

    const ghl = await searchGhlContactByPhone(fromE164);

    if (ghl.kind === "matched") {
      const c = ghl.contact;
      logSynthflowLookupEvent("info", "GHL fallback matched", {
        lookup_status: "matched_ghl",
        caller_phone_e164: fromE164,
        to_phone_e164: toE164,
        clientAccountId: scope?.clientAccountId,
        subaccountIdGhl: scope?.subaccountIdGhl,
      });

      const cacheClientId = getSynthflowLookupClientAccountId();
      if (cacheClientId) {
        const subaccountIdGhl = getSynthflowLookupSubaccountIdGhl() ?? "";
        await tryUpsertFromGhlFallback({
          clientAccountId: cacheClientId,
          subaccountIdGhl,
          phoneE164: fromE164,
          contact: c,
        });
      } else {
        logSynthflowLookupEvent("warn", "local cache upsert from GHL skipped", {
          lookup_status: "matched_ghl",
          reason: "missing_SYNTHFLOW_LOOKUP_CLIENT_ACCOUNT_ID",
          caller_phone_e164: fromE164,
          to_phone_e164: toE164,
        });
      }

      const customerName =
        c.displayName.trim() ||
        [c.firstName, c.lastName].filter(Boolean).join(" ").trim();

      return {
        call_inbound: {
          override_model_id: "",
          custom_variables: {
            known_caller: "true",
            customer_name: customerName,
            first_name: c.firstName,
            last_name: c.lastName,
            contact_id_ghl: c.contactIdGhl,
            state: c.state,
            assigned_agent_name: c.assignedAgentName,
            lifecycle_stage: c.lifecycleStage,
            appointment_status: c.appointmentStatus,
            policy_status: c.policyStatus,
            caller_phone_e164: fromE164,
            matched_by: "ghl_phone",
            client_status: formatClientStatusForSynthflow(
              resolveClientStatusAfterGhlEvidence(null, c)
            ),
          },
          metadata: {
            lookup_status: "matched_ghl",
            from_number: fromE164,
            to_number: toE164,
            default_model_id: defaultModelId,
          },
        },
      };
    }

    if (ghl.kind === "error") {
      logSynthflowLookupEvent("warn", "GHL fallback error", {
        lookup_status: "lookup_error",
        caller_phone_e164: fromE164,
        to_phone_e164: toE164,
        clientAccountId: scope?.clientAccountId,
        subaccountIdGhl: scope?.subaccountIdGhl,
      });
      return emptyResponse(body, fromE164, toE164, "lookup_error");
    }

    if (ghl.kind === "skipped") {
      logSynthflowLookupEvent("info", "GHL fallback not found", {
        lookup_status: "not_found_local",
        ghl_outcome: "skipped",
        caller_phone_e164: fromE164,
        to_phone_e164: toE164,
        clientAccountId: scope?.clientAccountId,
        subaccountIdGhl: scope?.subaccountIdGhl,
      });
      return emptyResponse(body, fromE164, toE164, "not_found_local");
    }

    logSynthflowLookupEvent("info", "GHL fallback not found", {
      lookup_status: "not_found",
      ghl_outcome: "not_found",
      caller_phone_e164: fromE164,
      to_phone_e164: toE164,
      clientAccountId: scope?.clientAccountId,
      subaccountIdGhl: scope?.subaccountIdGhl,
    });
    return emptyResponse(body, fromE164, toE164, "not_found");
  } catch (err) {
    const name = err instanceof Error ? err.name : "unknown";
    logSynthflowLookupEvent("warn", "lookup_handler_error", {
      lookup_status: "error",
      caller_phone_e164: fromE164,
      to_phone_e164: toE164,
      error_name: name,
    });
    return emptyResponse(
      body,
      fromE164 || normalizeToE164(body.call_inbound.from_number),
      toE164 || normalizeToE164(body.call_inbound.to_number),
      "error"
    );
  }
}
