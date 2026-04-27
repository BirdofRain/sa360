import {
  logInboundLookupError,
  logInboundLookupInfo,
  logInboundLookupWarn,
} from "../lib/inbound-lookup-log.js";
import {
  formatClientStatusForSynthflow,
  resolveClientStatusAfterGhlEvidence,
} from "../lib/inbound-contact-client-status.js";
import { isSynthflowInboundEnabled } from "../lib/synthflow-voice-env.js";
import {
  resolveGhlIndexCacheTarget,
  resolveSynthflowInboundTenant,
} from "../lib/synthflow-tenant-resolve.js";
import type { SynthflowInboundLookupBody } from "../schemas/synthflow-inbound-lookup.schema.js";
import { findByNormalizedPhoneGlobalFallback } from "../repositories/inbound-contact-index.repository.js";
import {
  findByNormalizedPhone,
  tryUpsertFromGhlFallback,
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

function buildSynthflowDebugFields(args: {
  rawFrom: string;
  rawTo: string;
  fromE164: string;
  toE164: string;
  modelId: string;
  resolution: ReturnType<typeof resolveSynthflowInboundTenant>;
  lookupQueryUsed: string;
  lookupStatus: string;
  lookupError: string;
  matchedBy?: string;
}): Record<string, string | number | boolean | undefined> {
  return {
    raw_from_number: args.rawFrom,
    raw_to_number: args.rawTo,
    normalized_from_number: args.fromE164,
    to_number: args.toE164,
    model_id: args.modelId,
    resolved_client_account_id: args.resolution.resolvedClientAccountId,
    resolved_subaccount_id_ghl: args.resolution.resolvedSubaccountIdGhl,
    tenant_resolution_source: args.resolution.source,
    lookup_query_used: args.lookupQueryUsed,
    lookup_status: args.lookupStatus,
    lookup_error: args.lookupError,
    ...(args.matchedBy != null && args.matchedBy !== ""
      ? { matched_by: args.matchedBy }
      : {}),
  };
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
  const rawFrom = String(body.call_inbound.from_number ?? "");
  const rawTo = String(body.call_inbound.to_number ?? "");
  const defaultModelId = body.call_inbound.model_id ?? "";
  const modelId = defaultModelId.trim();

  let fromE164 = "";
  let toE164 = "";
  let resolution: ReturnType<typeof resolveSynthflowInboundTenant> | null = null;

  const safeResolution = () =>
    resolution ?? resolveSynthflowInboundTenant(modelId, toE164);

  try {
    fromE164 = normalizeToE164(rawFrom);
    toE164 = normalizeToE164(rawTo);
    resolution = resolveSynthflowInboundTenant(modelId, toE164);

    if (!isSynthflowInboundEnabled()) {
      logSynthflowLookupEvent("info", "feature_disabled", {
        ...buildSynthflowDebugFields({
          rawFrom,
          rawTo,
          fromE164,
          toE164,
          modelId: defaultModelId,
          resolution: safeResolution(),
          lookupQueryUsed: "none",
          lookupStatus: "disabled",
          lookupError: "",
        }),
        caller_phone_suffix: lastFourDigits(fromE164),
        to_phone_suffix: lastFourDigits(toE164),
      });
      return emptyResponse(body, fromE164, toE164, "disabled");
    }

    logSynthflowLookupEvent("info", "Synthflow inbound lookup called", {
      ...buildSynthflowDebugFields({
        rawFrom,
        rawTo,
        fromE164,
        toE164,
        modelId: defaultModelId,
        resolution: safeResolution(),
        lookupQueryUsed: "none",
        lookupStatus: "started",
        lookupError: "",
      }),
      caller_phone_suffix: lastFourDigits(fromE164),
      to_phone_suffix: lastFourDigits(toE164),
    });

    if (!fromE164) {
      logSynthflowLookupEvent("warn", "invalid phone", {
        ...buildSynthflowDebugFields({
          rawFrom,
          rawTo,
          fromE164,
          toE164,
          modelId: defaultModelId,
          resolution: safeResolution(),
          lookupQueryUsed: "none",
          lookupStatus: "invalid_phone",
          lookupError: "caller_e164_empty_after_normalize",
        }),
        caller_phone_suffix: lastFourDigits(fromE164),
        to_phone_suffix: lastFourDigits(toE164),
      });
      return emptyResponse(body, fromE164, toE164, "invalid_phone");
    }

    let local: Awaited<ReturnType<typeof findByNormalizedPhone>> = null;
    let lookupQueryUsed: string;
    let globalMode: "active_client_configs" | "unrestricted" | undefined;

    if (resolution.scope) {
      local = await findByNormalizedPhone(fromE164, resolution.scope);
      lookupQueryUsed = "inbound_index_scoped";
    } else {
      const g = await findByNormalizedPhoneGlobalFallback(fromE164);
      local = g.row;
      globalMode = g.mode;
      lookupQueryUsed =
        g.mode === "active_client_configs"
          ? "inbound_index_active_client_accounts"
          : "inbound_index_unrestricted";
    }

    if (local && hasLocalMatchSignal(local)) {
      const customerName =
        local.displayName?.trim() ||
        [local.firstName, local.lastName].filter(Boolean).join(" ").trim();

      const matchedBy = resolution.scope ? "local_phone" : "global_phone_fallback";

      logSynthflowLookupEvent("info", "local match hit", {
        ...buildSynthflowDebugFields({
          rawFrom,
          rawTo,
          fromE164,
          toE164,
          modelId: defaultModelId,
          resolution: safeResolution(),
          lookupQueryUsed,
          lookupStatus: "matched_local",
          lookupError: "",
          matchedBy,
        }),
        global_fallback_mode: globalMode ?? "n/a",
        caller_phone_suffix: lastFourDigits(fromE164),
        to_phone_suffix: lastFourDigits(toE164),
        has_local_row: true,
        has_match_signal: true,
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
            matched_by: matchedBy,
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
      ...buildSynthflowDebugFields({
        rawFrom,
        rawTo,
        fromE164,
        toE164,
        modelId: defaultModelId,
        resolution: safeResolution(),
        lookupQueryUsed,
        lookupStatus: "local_miss",
        lookupError: "",
      }),
      global_fallback_mode: globalMode ?? "n/a",
      has_local_row: Boolean(local),
      has_match_signal: local ? hasLocalMatchSignal(local) : false,
    });

    logSynthflowLookupEvent("info", "GHL fallback started", {
      ...buildSynthflowDebugFields({
        rawFrom,
        rawTo,
        fromE164,
        toE164,
        modelId: defaultModelId,
        resolution: safeResolution(),
        lookupQueryUsed: "ghl_contacts_api",
        lookupStatus: "ghl_fallback_started",
        lookupError: "",
      }),
    });

    const ghl = await searchGhlContactByPhone(fromE164);

    if (ghl.kind === "matched") {
      const c = ghl.contact;
      logSynthflowLookupEvent("info", "GHL fallback matched", {
        ...buildSynthflowDebugFields({
          rawFrom,
          rawTo,
          fromE164,
          toE164,
          modelId: defaultModelId,
          resolution: safeResolution(),
          lookupQueryUsed: "ghl_contacts_api",
          lookupStatus: "matched_ghl",
          lookupError: "",
        }),
      });

      const cache = resolveGhlIndexCacheTarget({ scope: resolution.scope });
      if (cache) {
        await tryUpsertFromGhlFallback({
          clientAccountId: cache.clientAccountId,
          subaccountIdGhl: cache.subaccountIdGhl,
          phoneE164: fromE164,
          contact: c,
        });
      } else {
        logSynthflowLookupEvent("warn", "local cache upsert from GHL skipped", {
          ...buildSynthflowDebugFields({
            rawFrom,
            rawTo,
            fromE164,
            toE164,
            modelId: defaultModelId,
            resolution: safeResolution(),
            lookupQueryUsed: "ghl_contacts_api",
            lookupStatus: "matched_ghl",
            lookupError: "no_tenant_for_ghl_cache_upsert",
          }),
          reason: "no_resolved_tenant_for_inbound_index_cache",
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
        ...buildSynthflowDebugFields({
          rawFrom,
          rawTo,
          fromE164,
          toE164,
          modelId: defaultModelId,
          resolution: safeResolution(),
          lookupQueryUsed: "ghl_contacts_api",
          lookupStatus: "lookup_error",
          lookupError: "ghl_contacts_api_error",
        }),
      });
      return emptyResponse(body, fromE164, toE164, "lookup_error");
    }

    if (ghl.kind === "skipped") {
      logSynthflowLookupEvent("info", "GHL fallback not found", {
        ...buildSynthflowDebugFields({
          rawFrom,
          rawTo,
          fromE164,
          toE164,
          modelId: defaultModelId,
          resolution: safeResolution(),
          lookupQueryUsed: "ghl_contacts_api",
          lookupStatus: "not_found_local",
          lookupError: "ghl_lookup_disabled_or_unconfigured",
        }),
        ghl_outcome: "skipped",
      });
      return emptyResponse(body, fromE164, toE164, "not_found_local");
    }

    logSynthflowLookupEvent("info", "GHL fallback not found", {
      ...buildSynthflowDebugFields({
        rawFrom,
        rawTo,
        fromE164,
        toE164,
        modelId: defaultModelId,
        resolution: safeResolution(),
        lookupQueryUsed: "ghl_contacts_api",
        lookupStatus: "not_found",
        lookupError: "",
      }),
      ghl_outcome: "not_found",
    });
    return emptyResponse(body, fromE164, toE164, "not_found");
  } catch (err) {
    const name = err instanceof Error ? err.name : "unknown";
    const message = err instanceof Error ? err.message : String(err);
    const r = safeResolution();
    logSynthflowLookupEvent("warn", "lookup_handler_error", {
      ...buildSynthflowDebugFields({
        rawFrom,
        rawTo,
        fromE164,
        toE164,
        modelId: defaultModelId,
        resolution: r,
        lookupQueryUsed: "none",
        lookupStatus: "error",
        lookupError: message,
      }),
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
