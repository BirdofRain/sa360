import { logger } from "../lib/logger.js";
import {
  getLookupMode,
  getMakeLookupTimeoutMs,
  getMakeLookupUrl,
  isSynthflowInboundEnabled,
} from "../lib/synthflow-voice-env.js";
import type { SynthflowInboundLookupBody } from "../schemas/synthflow-inbound-lookup.schema.js";
import { createCallerLookupService } from "./caller-lookup.service.js";
import { normalizeToE164 } from "./phone-e164.service.js";

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
    logger.error("synthflow_inbound_lookup", meta);
    return;
  }
  if (level === "warn") {
    logger.warn("synthflow_inbound_lookup", meta);
    return;
  }
  logger.info("synthflow_inbound_lookup", meta);
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
        from_suffix: lastFourDigits(fromE164),
        to_suffix: lastFourDigits(toE164),
      });
      return emptyResponse(body, fromE164, toE164, "disabled");
    }

    const lookupMode = getLookupMode();
    const makeUrl = getMakeLookupUrl();
    const lookup = createCallerLookupService(
      lookupMode,
      makeUrl,
      getMakeLookupTimeoutMs()
    );

    if (lookupMode !== "make" || !makeUrl) {
      logSynthflowLookupEvent("info", "lookup_skipped_config", {
        lookup_status: "skipped",
        from_suffix: lastFourDigits(fromE164),
        to_suffix: lastFourDigits(toE164),
      });
      return emptyResponse(body, fromE164, toE164, "skipped");
    }

    const row = await lookup.lookupByPhone(fromE164);
    const hasSignal =
      !!row &&
      (row.ghl_contact_id.trim() !== "" ||
        row.first_name.trim() !== "" ||
        row.last_name.trim() !== "");

    if (!row || !hasSignal) {
      logSynthflowLookupEvent("info", "lookup_finished", {
        lookup_status: "not_found",
        from_suffix: lastFourDigits(fromE164),
        to_suffix: lastFourDigits(toE164),
      });
      return emptyResponse(body, fromE164, toE164, "not_found");
    }

    const customerName = [row.first_name, row.last_name].filter(Boolean).join(" ").trim();

    logSynthflowLookupEvent("info", "lookup_finished", {
      lookup_status: "success",
      from_suffix: lastFourDigits(fromE164),
      to_suffix: lastFourDigits(toE164),
      matched_by: "make",
    });

    return {
      call_inbound: {
        override_model_id: "",
        custom_variables: {
          known_caller: "true",
          customer_name: customerName,
          first_name: row.first_name,
          last_name: row.last_name,
          contact_id_ghl: row.ghl_contact_id,
          state: row.lead_state,
          assigned_agent_name: row.assigned_agent_name,
          lifecycle_stage: row.lifecycle_stage,
          appointment_status: row.appointment_status,
          policy_status: row.policy_status,
          caller_phone_e164: fromE164,
          matched_by: "make",
        },
        metadata: {
          lookup_status: "success",
          from_number: fromE164,
          to_number: toE164,
          default_model_id: defaultModelId,
        },
      },
    };
  } catch (err) {
    const name = err instanceof Error ? err.name : "unknown";
    logSynthflowLookupEvent("warn", "lookup_handler_error", {
      lookup_status: "error",
      from_suffix: lastFourDigits(fromE164),
      to_suffix: lastFourDigits(toE164),
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
