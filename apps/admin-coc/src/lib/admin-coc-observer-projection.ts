/**
 * Diagnostic projections for SA360_OBSERVER responses.
 * Applied on the server before data is passed to a page or Server Action.
 * ADMIN callers keep the original objects.
 */

import type {
  AdminLeadTimelineResponse,
  AdminSynthflowDetail,
  AdminSynthflowListItem,
  AdminSynthflowOutboundResultDetail,
  AdminSynthflowOutboundResultListItem,
  AdminWebhookDetail,
  AdminWebhookListItem,
} from "./admin-api/types.ts";
import type { SourceLeadDetail, SourceLeadListItem } from "./source-intake/types.ts";

const ROUTING_KEYS = [
  "matched",
  "status",
  "outcome",
  "reason",
  "errorCode",
  "matchedRuleId",
  "destinationClientAccountId",
  "destinationLocationIdGhl",
  "confidence",
] as const;

const DUPLICATE_KEYS = [
  "status",
  "level",
  "decision",
  "duplicateStatus",
  "blocksDelivery",
  "reasonCode",
  "candidateCount",
] as const;

const DELIVERY_KEYS = [
  "mode",
  "status",
  "ok",
  "error",
  "errorCode",
  "inventoryCreated",
  "inventoryLotId",
  "dedupeStatus",
  "httpStatus",
] as const;

function pick(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    if (key in source && source[key] !== undefined) out[key] = source[key];
  }
  return out;
}

function stripEnrichment(
  preview: SourceLeadDetail["enrichmentPreview"]
): SourceLeadDetail["enrichmentPreview"] {
  if (!preview) return null;
  return {
    ...preview,
    unmappedSourceFieldKeys: [],
  };
}

export function projectObserverSourceLeadListItem(item: SourceLeadListItem): SourceLeadListItem {
  return {
    ...item,
    leadName: null,
    email: null,
    phone: null,
  };
}

export function projectObserverSourceLeadDetail(item: SourceLeadDetail): SourceLeadDetail {
  return {
    ...item,
    ...projectObserverSourceLeadListItem(item),
    rawPayloadJson: null,
    normalizedPayloadJson: null,
    enrichmentMetadataJson: null,
    routingResultJson: pick(item.routingResultJson, ROUTING_KEYS),
    duplicateRiskJson: pick(item.duplicateRiskJson, DUPLICATE_KEYS),
    deliveryResultJson: pick(item.deliveryResultJson, DELIVERY_KEYS),
    enrichmentPreview: stripEnrichment(item.enrichmentPreview),
  };
}

const PII_FIELD = /email|phone|e164|name|authorization|secret|password|token|credential|api[-_]?key/i;

function stripRecord(record: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!record) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (PII_FIELD.test(key)) continue;
    out[key] = value;
  }
  return out;
}

export function projectObserverWebhookListItem(item: AdminWebhookListItem): AdminWebhookListItem {
  return {
    ...item,
    leadName: undefined,
    leadFirstName: null,
    leadLastName: null,
    leadPhone: null,
    leadEmail: null,
  };
}

export function projectObserverWebhookDetail(detail: AdminWebhookDetail): AdminWebhookDetail {
  const debug = detail.debug;
  return {
    ...detail,
    ...projectObserverWebhookListItem(detail),
    requestBodyRedacted: null,
    responseBodyRedacted: null,
    debug: {
      ...debug,
      topLine: { ...debug.topLine, lead: null },
      identity: stripRecord(debug.identity as Record<string, unknown>) as AdminWebhookDetail["debug"]["identity"],
      requestBodyRedacted: null,
      responseBodyRedacted: null,
      sourceIntake: debug.sourceIntake
        ? {
            ...debug.sourceIntake,
            identity: stripRecord(debug.sourceIntake.identity as Record<string, unknown>) as NonNullable<
              AdminWebhookDetail["debug"]["sourceIntake"]
            >["identity"],
            sourceAttributes: stripRecord(
              debug.sourceIntake.sourceAttributes as Record<string, unknown>
            ) as NonNullable<AdminWebhookDetail["debug"]["sourceIntake"]>["sourceAttributes"],
          }
        : undefined,
    },
  };
}

export function projectObserverLeadTimeline(
  timeline: AdminLeadTimelineResponse
): AdminLeadTimelineResponse {
  return {
    ...timeline,
    identity: {
      ...timeline.identity,
      displayName: null,
      phoneE164: null,
      email: null,
    },
    timeline: timeline.timeline.map((entry) => ({
      ...entry,
      leadName: null,
      phoneE164: null,
      email: null,
    })),
  };
}

export function projectObserverSynthflowListItem(item: AdminSynthflowListItem): AdminSynthflowListItem {
  return {
    ...item,
    fromNumber: null,
    toNumber: null,
    phoneE164: null,
    customerName: null,
    assignedAgentName: null,
  };
}

export function projectObserverSynthflowDetail(detail: AdminSynthflowDetail): AdminSynthflowDetail {
  return {
    ...detail,
    ...projectObserverSynthflowListItem(detail),
    requestBodyRedacted: null,
    responseBodyRedacted: null,
  };
}

export function projectObserverSynthflowOutboundItem(
  item: AdminSynthflowOutboundResultListItem
): AdminSynthflowOutboundResultListItem {
  return {
    ...item,
    fromNumber: null,
    toNumber: null,
    fromNumberE164: null,
    toNumberE164: null,
  };
}

export function projectObserverSynthflowOutboundDetail(
  detail: AdminSynthflowOutboundResultDetail
): AdminSynthflowOutboundResultDetail {
  return {
    ...detail,
    ...projectObserverSynthflowOutboundItem(detail),
    transcriptSummary: null,
    payloadRedacted: null,
  };
}
