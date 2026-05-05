import type { Prisma } from "@prisma/client";
import { redactWebhookPayloadForLog } from "@sa360/shared";
import type { SynthflowInboundLookupResponse } from "./synthflow-inbound-lookup.service.js";
import type { SynthflowOutboundContextResponse } from "./synthflow-outbound-context.service.js";
import {
  deriveOutboundLookupProcessingStatus,
  deriveSynthflowProcessingStatus,
} from "../lib/synthflow-request-log-status.js";
import { prisma } from "../lib/db.js";
import { logger } from "../lib/logger.js";

export const SYNTHFLOW_INBOUND_LOOKUP_ROUTE = "/voice/synthflow/inbound-lookup";
export const SYNTHFLOW_INGEST_SOURCE = "synthflow_inbound_lookup";
export const SYNTHFLOW_OUTBOUND_CONTEXT_ROUTE = "/voice/synthflow/outbound-context";
export const SYNTHFLOW_OUTBOUND_CONTEXT_SOURCE = "synthflow_outbound_context";

export type SynthflowRequestLogHandle = {
  id: string;
  receivedAt: Date;
};

export type StartSynthflowLogInput = {
  requestId: string;
  rawBody: unknown;
  /** Defaults to inbound lookup route/source when omitted (backward compatible). */
  route?: string;
  source?: string;
};

export type CompleteSynthflowLogInput = {
  httpStatus: number;
  processingStatus: string;
  clientAccountId?: string | null;
  subaccountIdGhl?: string | null;
  fromNumber?: string | null;
  toNumber?: string | null;
  phoneE164?: string | null;
  modelId?: string | null;
  knownCaller?: string | null;
  matchedBy?: string | null;
  lookupStatus?: string | null;
  overrideModelId?: string | null;
  contactIdGhl?: string | null;
  assignedAgentName?: string | null;
  customerName?: string | null;
  responseBodyRedacted?: unknown;
  errorCode?: string | null;
  errorSummary?: string | null;
};

function capSummary(s: string, max = 2000): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
}

function emptyToNull(s: string | null | undefined): string | null {
  if (s === undefined || s === null) return null;
  const t = s.trim();
  return t === "" ? null : t;
}

export async function startSynthflowLog(
  input: StartSynthflowLogInput
): Promise<SynthflowRequestLogHandle | null> {
  try {
    const requestBodyRedacted = redactWebhookPayloadForLog(input.rawBody) as Prisma.InputJsonValue;
    const row = await prisma.synthflowRequestLog.create({
      data: {
        requestId: input.requestId,
        source: input.source ?? SYNTHFLOW_INGEST_SOURCE,
        route: input.route ?? SYNTHFLOW_INBOUND_LOOKUP_ROUTE,
        processingStatus: "received",
        httpStatus: null,
        durationMs: null,
        completedAt: null,
        requestBodyRedacted,
      },
    });
    return { id: row.id, receivedAt: row.receivedAt };
  } catch (err) {
    logger.warn("synthflow_request_log.start_failed", {
      requestId: input.requestId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export async function completeSynthflowLog(
  handle: SynthflowRequestLogHandle | null,
  input: CompleteSynthflowLogInput
): Promise<void> {
  if (!handle) return;
  try {
    const completedAt = new Date();
    const durationMs = Math.max(0, completedAt.getTime() - handle.receivedAt.getTime());
    const errorSummary =
      input.errorSummary !== undefined && input.errorSummary !== null
        ? capSummary(input.errorSummary)
        : null;
    const responseJson =
      input.responseBodyRedacted !== undefined
        ? (redactWebhookPayloadForLog(input.responseBodyRedacted) as Prisma.InputJsonValue)
        : undefined;

    await prisma.synthflowRequestLog.update({
      where: { id: handle.id },
      data: {
        completedAt,
        durationMs,
        processingStatus: input.processingStatus,
        httpStatus: input.httpStatus,
        clientAccountId: emptyToNull(input.clientAccountId ?? undefined),
        subaccountIdGhl:
          input.subaccountIdGhl === undefined || input.subaccountIdGhl === null
            ? null
            : emptyToNull(input.subaccountIdGhl),
        fromNumber: emptyToNull(input.fromNumber ?? undefined),
        toNumber: emptyToNull(input.toNumber ?? undefined),
        phoneE164: emptyToNull(input.phoneE164 ?? undefined),
        modelId: emptyToNull(input.modelId ?? undefined),
        knownCaller: emptyToNull(input.knownCaller ?? undefined),
        matchedBy: emptyToNull(input.matchedBy ?? undefined),
        lookupStatus: emptyToNull(input.lookupStatus ?? undefined),
        overrideModelId: emptyToNull(input.overrideModelId ?? undefined),
        contactIdGhl: emptyToNull(input.contactIdGhl ?? undefined),
        assignedAgentName: emptyToNull(input.assignedAgentName ?? undefined),
        customerName: emptyToNull(input.customerName ?? undefined),
        errorCode: emptyToNull(input.errorCode ?? undefined),
        errorSummary,
        ...(responseJson !== undefined ? { responseBodyRedacted: responseJson } : {}),
      },
    });
  } catch (err) {
    logger.warn("synthflow_request_log.complete_failed", {
      logId: handle.id,
      processingStatus: input.processingStatus,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Maps Synthflow-shaped JSON + outcome into log columns (no I/O). */
export function fieldsFromSynthflowResponse(response: SynthflowInboundLookupResponse): {
  processingStatus: string;
  fromNumber: string | null;
  toNumber: string | null;
  phoneE164: string | null;
  modelId: string | null;
  knownCaller: string | null;
  matchedBy: string | null;
  lookupStatus: string | null;
  overrideModelId: string | null;
  contactIdGhl: string | null;
  assignedAgentName: string | null;
  customerName: string | null;
} {
  const meta = response.call_inbound.metadata;
  const cv = response.call_inbound.custom_variables;
  const rawLs = meta.lookup_status ?? "";
  return {
    processingStatus: deriveSynthflowProcessingStatus(rawLs),
    fromNumber: emptyToNull(meta.from_number),
    toNumber: emptyToNull(meta.to_number),
    phoneE164: emptyToNull(cv.caller_phone_e164 || meta.from_number),
    modelId: emptyToNull(meta.default_model_id),
    knownCaller: emptyToNull(cv.known_caller),
    matchedBy: emptyToNull(cv.matched_by),
    lookupStatus: emptyToNull(rawLs),
    overrideModelId: emptyToNull(response.call_inbound.override_model_id),
    contactIdGhl: emptyToNull(cv.contact_id_ghl),
    assignedAgentName: emptyToNull(cv.assigned_agent_name),
    customerName: emptyToNull(cv.customer_name),
  };
}

export function fieldsFromOutboundContextResponse(response: SynthflowOutboundContextResponse): {
  processingStatus: string;
  fromNumber: string | null;
  toNumber: string | null;
  phoneE164: string | null;
  modelId: string | null;
  knownCaller: string | null;
  matchedBy: string | null;
  lookupStatus: string | null;
  overrideModelId: string | null;
  contactIdGhl: string | null;
  assignedAgentName: string | null;
  customerName: string | null;
} {
  const cv = response.custom_variables;
  const meta = response.metadata;
  const rawLs = meta.lookup_status ?? "";
  return {
    processingStatus: deriveOutboundLookupProcessingStatus(rawLs),
    fromNumber: emptyToNull(cv.from_number_e164),
    toNumber: emptyToNull(cv.to_number_e164),
    phoneE164: emptyToNull(cv.lead_phone_e164),
    modelId: emptyToNull(cv.model_id),
    knownCaller: emptyToNull(cv.contact_found),
    matchedBy: emptyToNull(cv.matched_by ?? meta.matched_by),
    lookupStatus: emptyToNull(rawLs),
    overrideModelId: null,
    contactIdGhl: emptyToNull(cv.contact_id_ghl),
    assignedAgentName: emptyToNull(cv.assigned_agent_name),
    customerName: emptyToNull(cv.customer_name),
  };
}
