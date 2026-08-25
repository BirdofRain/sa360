import type { SourceLeadEvent, WebhookRequestLog } from "@prisma/client";
import { presentLeadContactFields } from "./webhook-log-lead-identity.js";
import type { WebhookDetailFieldValue } from "./webhook-request-detail-parse.js";

export type LeadCaptureSourceIntakeDebug = {
  presentationMode: "source_intake";
  sourceLeadEventId: string | null;
  sourceLeadId: string | null;
  sourceLeadIdGenerated: boolean | null;
  normalizedLeadUid: string | null;
  sourceProvider: string | null;
  sourceSystem: string | null;
  sourceType: string | null;
  sourceRouteKey: string | null;
  campaignId: string | null;
  campaignName: string | null;
  funnelName: string | null;
  matchedRuleId: string | null;
  destinationClientAccountId: string | null;
  destinationLocationIdGhl: string | null;
  routingDryRunDecisionId: string | null;
  intakeStatus: string | null;
  enrichmentStatus: string | null;
  automationReadiness: string | null;
  sourceAttributes: Record<string, WebhookDetailFieldValue>;
  identity: Record<string, WebhookDetailFieldValue>;
  routing: Record<string, WebhookDetailFieldValue>;
  requestPayloadLabel: string;
};

function asRecord(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  return v as Record<string, unknown>;
}

function asString(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v.trim() === "" ? null : v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return null;
}

function asDetailValue(v: unknown): WebhookDetailFieldValue {
  if (v === null || v === undefined) return null;
  if (typeof v === "boolean") return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return asString(v);
}

function readEnrichmentString(enrichment: Record<string, unknown> | null, key: string): string | null {
  return asString(enrichment?.[key]);
}

const SOURCE_ONLY_LABEL = "source-only";
const UNRESOLVED_NICHE = "Unresolved";
const UNRESOLVED_DASH = "—";

function readSourceNicheFromRaw(raw: unknown): string | null {
  const rec = asRecord(raw);
  if (!rec) return null;
  const answers = asRecord(rec.answers);
  return asString(rec.niche_key) ?? asString(rec.niche) ?? asString(answers?.niche_key) ?? asString(answers?.niche);
}

/**
 * Capture-only / unmatched request detail must not invent VET / Veteran / Final Expense.
 * Resolved normalized routing wins; otherwise show source niche as source-only, or Unresolved.
 */
export function presentLeadCaptureRoutingNiche(input: {
  normalizedRouting: Record<string, unknown> | null;
  rawPayload: unknown;
}): {
  niche_key: string;
  niche_label: string | null;
  product_type: string | null;
} {
  const resolvedKey = asString(input.normalizedRouting?.niche_key);
  if (resolvedKey) {
    return {
      niche_key: resolvedKey,
      niche_label: asString(input.normalizedRouting?.niche_label),
      product_type: asString(input.normalizedRouting?.product_type),
    };
  }

  const sourceNiche = readSourceNicheFromRaw(input.rawPayload);
  if (sourceNiche) {
    return {
      niche_key: sourceNiche,
      niche_label: SOURCE_ONLY_LABEL,
      product_type: UNRESOLVED_DASH,
    };
  }

  return {
    niche_key: UNRESOLVED_NICHE,
    niche_label: UNRESOLVED_DASH,
    product_type: UNRESOLVED_DASH,
  };
}

export function buildLeadCaptureSourceIntakeDebug(input: {
  row: WebhookRequestLog;
  sourceEvent: SourceLeadEvent | null;
  responseBody: unknown;
}): LeadCaptureSourceIntakeDebug {
  const response = asRecord(input.responseBody);
  const normalized = asRecord(input.sourceEvent?.normalizedPayloadJson);
  const contact = asRecord(normalized?.contact);
  const attribution = asRecord(normalized?.attribution);
  const routingPayload = asRecord(normalized?.routing);
  const sourceIntake = asRecord(routingPayload?.source_intake);
  const routingResult = asRecord(input.sourceEvent?.routingResultJson);
  const enrichment = asRecord(input.sourceEvent?.enrichmentMetadataJson);

  const sourceAttributesRaw = asRecord(sourceIntake?.sourceAttributes) ?? {};
  const sourceAttributes: Record<string, WebhookDetailFieldValue> = {};
  for (const [key, value] of Object.entries(sourceAttributesRaw)) {
    sourceAttributes[key] = asDetailValue(value);
  }

  const routingNiche = presentLeadCaptureRoutingNiche({
    normalizedRouting: routingPayload,
    rawPayload: input.sourceEvent?.rawPayloadJson ?? input.row.requestBodyRedacted,
  });

  const generatedFlag = sourceIntake?.source_lead_id_generated === true || response?.sourceLeadIdGenerated === true;
  const presentedContact = presentLeadContactFields({
    normalizedContact: contact,
    requestBodyRedacted: input.row.requestBodyRedacted,
    responseBodyRedacted: input.row.responseBodyRedacted,
  });

  return {
    presentationMode: "source_intake",
    sourceLeadEventId:
      input.sourceEvent?.id ?? asString(response?.sourceEventId) ?? input.row.sourceLeadEventId,
    sourceLeadId:
      input.sourceEvent?.sourceLeadId ?? asString(response?.sourceLeadId) ?? asString(sourceIntake?.lead_id),
    sourceLeadIdGenerated: generatedFlag ? true : null,
    normalizedLeadUid:
      asString(contact?.lead_uid) ??
      input.row.normalizedLeadUid ??
      asString(response?.normalizedLeadUid),
    sourceProvider: asString(input.sourceEvent?.sourceProvider) ?? "leadcapture_io",
    sourceSystem: asString(input.sourceEvent?.sourceSystem) ?? asString(sourceIntake?.source_system),
    sourceType: asString(input.sourceEvent?.sourceType) ?? asString(sourceIntake?.source_type),
    sourceRouteKey:
      input.sourceEvent?.sourceRouteKey ??
      asString(response?.sourceRouteKey) ??
      asString(sourceIntake?.source_route_key),
    campaignId: asString(attribution?.campaign_id) ?? input.sourceEvent?.sourceCampaignId ?? null,
    campaignName:
      asString(attribution?.campaign_name) ?? input.sourceEvent?.sourceCampaignName ?? null,
    funnelName: input.sourceEvent?.sourceFunnelName ?? asString(sourceIntake?.funnel_name),
    matchedRuleId:
      input.sourceEvent?.routingRuleIdResolved ??
      asString(response?.matchedRuleId) ??
      asString(routingResult?.matchedRuleId),
    destinationClientAccountId:
      input.sourceEvent?.clientAccountIdResolved ??
      asString(response?.destinationClientAccountId) ??
      asString(routingResult?.destinationClientAccountId),
    destinationLocationIdGhl:
      input.sourceEvent?.destinationLocationIdResolved ??
      asString(response?.destinationLocationIdGhl) ??
      asString(routingResult?.destinationLocationIdGhl),
    routingDryRunDecisionId:
      input.sourceEvent?.routingDryRunDecisionId ??
      input.row.routingDryRunDecisionId ??
      asString(response?.routingDryRunDecisionId) ??
      asString(routingResult?.routingDryRunDecisionId),
    intakeStatus: readEnrichmentString(enrichment, "intakeStatus") ?? input.sourceEvent?.status ?? null,
    enrichmentStatus: readEnrichmentString(enrichment, "enrichmentStatus"),
    automationReadiness: readEnrichmentString(enrichment, "automationReadiness"),
    sourceAttributes,
    identity: {
      lead_name: presentedContact.lead_name,
      first_name: presentedContact.first_name,
      last_name: presentedContact.last_name,
      email: presentedContact.email,
      phone: presentedContact.phone,
      state: presentedContact.state,
      lead_uid: asString(contact?.lead_uid) ?? input.row.normalizedLeadUid,
      contact_id_ghl: asString(contact?.contact_id_ghl),
      client_account_id:
        input.sourceEvent?.clientAccountIdResolved ??
        asString(response?.destinationClientAccountId) ??
        input.row.clientAccountId,
      subaccount_id_ghl:
        input.sourceEvent?.destinationLocationIdResolved ??
        asString(response?.destinationLocationIdGhl) ??
        input.row.subaccountIdGhl,
    },
    routing: {
      matched: asDetailValue(routingResult?.matched ?? response?.matched),
      match_reason: asString(routingResult?.reason),
      match_type: asString(routingResult?.matchType),
      niche_key: routingNiche.niche_key,
      niche_label: routingNiche.niche_label,
      product_type: routingNiche.product_type,
      destination_client_account_id:
        input.sourceEvent?.clientAccountIdResolved ?? asString(response?.destinationClientAccountId),
      destination_location_id_ghl:
        input.sourceEvent?.destinationLocationIdResolved ?? asString(response?.destinationLocationIdGhl),
      routing_rule_id:
        input.sourceEvent?.routingRuleIdResolved ?? asString(response?.matchedRuleId),
      routing_dry_run_decision_id:
        input.sourceEvent?.routingDryRunDecisionId ?? asString(response?.routingDryRunDecisionId),
    },
    requestPayloadLabel: "Source webhook payload",
  };
}
