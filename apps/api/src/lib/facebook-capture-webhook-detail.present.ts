import type { SourceLeadEvent, WebhookRequestLog } from "@prisma/client";

import type { LeadCaptureSourceIntakeDebug } from "./leadcapture-webhook-detail.present.js";
import { presentMetaLeadgenFetch } from "./meta-leadgen-fetch.present.js";
import { presentLeadContactFields } from "./webhook-log-lead-identity.js";
import type { WebhookDetailFieldValue } from "./webhook-request-detail-parse.js";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asDetail(value: unknown): WebhookDetailFieldValue {
  if (typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return asString(value);
}

/** Direct Meta leadgen webhook callbacks (signed `object: "page"` notifications). */
export const META_LEADGEN_WEBHOOK_ROUTES = ["/sources/facebook/lead-created", "/webhooks/meta/leadgen"] as const;

export function isMetaLeadgenWebhookRoute(route: string | null | undefined): boolean {
  const value = route ?? "";
  return META_LEADGEN_WEBHOOK_ROUTES.some((r) => value.includes(r));
}

export function shouldPresentFacebookSourceIntake(row: {
  source: string;
  route?: string | null;
  requestBodyRedacted?: unknown;
}): boolean {
  if (row.source !== "facebook_lead_ads") return false;
  const route = row.route ?? "";
  if (
    route.includes("/sources/zapier/facebook-lead") ||
    route.includes("/sources/leadconduit/facebook-lead") ||
    isMetaLeadgenWebhookRoute(route)
  ) {
    return true;
  }
  const body = asRecord(row.requestBodyRedacted);
  if (!body) return false;
  if (body.object === "page" && Array.isArray(body.entry)) return false;
  return Boolean(body.leadgen_id || body.leadgenId || body.form_id || body.formId);
}

function readMetaEnvelope(raw: unknown): Record<string, unknown> | null {
  const rec = asRecord(raw);
  return asRecord(rec?.envelope);
}

function presentGraphFetch(
  sourceEvent: SourceLeadEvent | null,
  response: Record<string, unknown> | null
): Record<string, WebhookDetailFieldValue> | undefined {
  const fetch = presentMetaLeadgenFetch(sourceEvent?.enrichmentMetadataJson);
  const firstResult = Array.isArray(response?.results) ? asRecord(response?.results[0]) : null;
  if (!fetch && !firstResult) return undefined;
  return {
    state: fetch?.state ?? (firstResult?.queued === true ? "queued" : asString(firstResult?.error)),
    job_id: fetch?.jobId ?? asString(firstResult?.jobId),
    attempt: fetch?.attempt !== null && fetch?.attempt !== undefined ? String(fetch.attempt) : null,
    queued_at: fetch?.queuedAt ?? null,
    requeued_at: fetch?.requeuedAt ?? null,
    fetch_started_at: fetch?.fetchStartedAt ?? null,
    fetch_finished_at: fetch?.fetchFinishedAt ?? null,
    graph_outcome: fetch?.graphOutcome ?? null,
    graph_status: fetch?.graphStatus !== null && fetch?.graphStatus !== undefined ? String(fetch.graphStatus) : null,
    graph_error_code: fetch?.graphErrorCode ?? null,
    graph_error_message: fetch?.graphErrorMessage ?? null,
    token_scope: fetch?.tokenScope ?? null,
    live_delivery: false,
    capi_dispatched: false,
  };
}

/**
 * Webhook monitor presentation for flat Facebook source bodies.
 * Raw request JSON stays in the request payload section. Contact identity and
 * source IDs come from the canonical normalized payload when one was stored.
 */
export function buildFacebookCaptureSourceIntakeDebug(input: {
  row: WebhookRequestLog;
  sourceEvent: SourceLeadEvent | null;
  responseBody: unknown;
}): LeadCaptureSourceIntakeDebug {
  const response = asRecord(input.responseBody);
  const normalized = asRecord(input.sourceEvent?.normalizedPayloadJson);
  const contact = asRecord(normalized?.contact);
  const source = asRecord(normalized?.source);
  const enrichment = asRecord(input.sourceEvent?.enrichmentMetadataJson);
  const storedAssociation = asRecord(enrichment?.association);
  const storedInventory = asRecord(enrichment?.inventory);
  const storedDelivery = asRecord(enrichment?.delivery);
  const isMetaWebhook = isMetaLeadgenWebhookRoute(input.row.route);
  const envelope = readMetaEnvelope(input.sourceEvent?.rawPayloadJson);
  const captureOnly = enrichment?.captureOnly === true;
  // Source client is decided by Page+Form association; a delivery destination
  // only exists once routing/approval sets one. Capture-only rows have no destination.
  const sourceClientAccountId = captureOnly
    ? asString(storedAssociation?.outcome) === "associated"
      ? asString(storedAssociation?.clientAccountId)
      : (input.sourceEvent?.clientAccountIdResolved ?? null)
    : null;
  const destinationClientAccountId = captureOnly ? null : (input.sourceEvent?.clientAccountIdResolved ?? null);
  const graphFetch = isMetaWebhook || input.sourceEvent?.sourceSystem === "meta_lead_ads"
    ? presentGraphFetch(input.sourceEvent, response)
    : undefined;
  const captureOutcome = input.sourceEvent
    ? "captured"
    : response?.ok === false
      ? "failed"
      : "captured";
  const presentedContact = presentLeadContactFields({
    normalizedContact: contact,
    requestBodyRedacted: input.row.requestBodyRedacted,
    responseBodyRedacted: input.row.responseBodyRedacted,
  });
  const associationOutcome =
    asString(storedAssociation?.outcome) ??
    asString(asRecord(response?.association)?.outcome) ??
    "not_evaluated";
  const associationExplanation =
    asString(storedAssociation?.explanation) ??
    asString(asRecord(response?.association)?.explanation) ??
    "Form association was not evaluated on this request. A missing client association does not block capture, and GHL delivery setup is not a capture requirement.";
  const responseInventory = asRecord(response?.inventory);
  const responseDelivery = asRecord(response?.delivery);
  const inventoryTracked =
    responseInventory?.tracked === true ||
    storedInventory?.tracked === true ||
    storedInventory?.historicalTracked === true;
  const explicitSaleEligible = responseInventory?.saleEligible ?? storedInventory?.saleEligible;
  const saleEligible: WebhookDetailFieldValue =
    explicitSaleEligible === true || explicitSaleEligible === false
      ? explicitSaleEligible
      : typeof explicitSaleEligible === "string" && explicitSaleEligible.trim()
        ? explicitSaleEligible.trim()
        : inventoryTracked
          ? "not_evaluated"
          : false;
  const responseAttempt =
    typeof responseDelivery?.thisRequestAttempted === "boolean"
      ? responseDelivery.thisRequestAttempted
      : typeof responseDelivery?.attempted === "boolean"
        ? responseDelivery.attempted
        : null;
  const storedAttempt =
    typeof storedDelivery?.thisRequestAttempted === "boolean"
      ? storedDelivery.thisRequestAttempted
      : typeof storedDelivery?.attempted === "boolean"
        ? storedDelivery.attempted
        : null;
  const thisRequestAttempted = responseAttempt ?? storedAttempt ?? false;
  const explicitHistorical =
    asString(responseDelivery?.historicalOutcome) ?? asString(storedDelivery?.historicalOutcome);
  const legacyStatus = asString(storedDelivery?.status) ?? asString(responseDelivery?.status);
  const historicalOutcome =
    explicitHistorical ??
    (input.sourceEvent?.deliveredAt || input.sourceEvent?.status === "delivered"
      ? "delivered"
      : input.sourceEvent?.status === "delivery_failed"
        ? "delivery_failed"
        : input.sourceEvent?.approvedAt || input.sourceEvent?.status === "approved"
          ? "approved"
          : legacyStatus && legacyStatus !== "not_attempted"
            ? legacyStatus
            : "not_recorded");

  return {
    presentationMode: "source_intake",
    sourceLeadEventId: input.sourceEvent?.id ?? asString(response?.sourceEventId) ?? input.row.sourceLeadEventId,
    sourceLeadId: input.sourceEvent?.sourceLeadId ?? asString(source?.leadgen_id),
    sourceLeadIdGenerated: null,
    normalizedLeadUid:
      asString(contact?.lead_uid) ??
      input.row.normalizedLeadUid ??
      asString(asRecord(response?.capture)?.normalizedLeadUid),
    sourceProvider: input.sourceEvent?.sourceProvider ?? "facebook",
    sourceSystem: input.sourceEvent?.sourceSystem ?? asString(source?.source_system),
    sourceType: input.sourceEvent?.sourceType ?? null,
    sourceRouteKey: input.sourceEvent?.sourceRouteKey ?? null,
    campaignId: asString(source?.campaign_id) ?? input.sourceEvent?.sourceCampaignId ?? null,
    campaignName: asString(source?.campaign_name) ?? input.sourceEvent?.sourceCampaignName ?? null,
    funnelName: input.sourceEvent?.sourceFunnelName ?? asString(source?.form_name),
    matchedRuleId: input.sourceEvent?.routingRuleIdResolved ?? null,
    destinationClientAccountId,
    destinationLocationIdGhl: input.sourceEvent?.destinationLocationIdResolved ?? null,
    routingDryRunDecisionId: input.sourceEvent?.routingDryRunDecisionId ?? null,
    intakeStatus: input.sourceEvent?.status ?? asString(asRecord(response?.capture)?.status),
    enrichmentStatus: null,
    automationReadiness: null,
    sourceAttributes: {
      leadgen_id: asDetail(source?.leadgen_id ?? input.sourceEvent?.sourceLeadId ?? envelope?.leadgenId),
      page_id: asDetail(source?.page_id ?? storedAssociation?.pageId ?? envelope?.pageId),
      form_id: asDetail(source?.form_id ?? storedAssociation?.formId ?? envelope?.formId),
      submitted_at: asDetail(source?.submitted_at ?? enrichment?.submittedAt ?? envelope?.createdTime),
      received_at: asDetail(
        source?.received_at ??
          (input.sourceEvent ? input.sourceEvent.receivedAt.toISOString() : null)
      ),
      intake_method: asDetail(
        source?.intake_method ?? enrichment?.intakeMethod ?? (isMetaWebhook ? "meta_lead_ads" : null)
      ),
      source_client_account_id: sourceClientAccountId,
    },
    identity: {
      lead_name: presentedContact.lead_name,
      first_name: presentedContact.first_name,
      last_name: presentedContact.last_name,
      email: presentedContact.email,
      phone: presentedContact.phone,
      state: presentedContact.state,
      lead_uid: asString(contact?.lead_uid) ?? input.row.normalizedLeadUid,
    },
    routing: {
      matched: input.sourceEvent?.routingRuleIdResolved ? true : false,
      routing_dry_run_decision_id: input.sourceEvent?.routingDryRunDecisionId ?? null,
      destination_client_account_id: destinationClientAccountId,
      destination_location_id_ghl: input.sourceEvent?.destinationLocationIdResolved ?? null,
    },
    requestPayloadLabel: isMetaWebhook ? "Raw Meta leadgen notification" : "Raw Facebook source request",
    outcomes: {
      capture: {
        outcome: captureOutcome,
        status: input.sourceEvent?.status ?? asString(asRecord(response?.capture)?.status),
        source_event_id: input.sourceEvent?.id ?? asString(response?.sourceEventId),
        ...(isMetaWebhook
          ? {
              accepted: asDetail(response?.accepted),
              duplicate: asDetail(response?.duplicate),
              queued: asDetail(response?.queued),
            }
          : {}),
      },
      association: {
        outcome: associationOutcome,
        client_account_id:
          asString(storedAssociation?.clientAccountId) ??
          input.sourceEvent?.clientAccountIdResolved ??
          null,
        source_funnel_id: asString(storedAssociation?.sourceFunnelId),
        page_id: asDetail(storedAssociation?.pageId ?? envelope?.pageId),
        form_id: asDetail(storedAssociation?.formId ?? envelope?.formId),
      },
      inventory: {
        tracked: inventoryTracked,
        mutated: false,
        sale_eligible: saleEligible,
        reason:
          asString(storedInventory?.reason) ??
          asString(responseInventory?.reason) ??
          (inventoryTracked ? "existing_inventory_item_not_modified" : "not_recorded_for_this_intake"),
      },
      delivery: {
        this_request_attempted: thisRequestAttempted,
        historical_outcome: historicalOutcome,
        historical_delivered_at:
          input.sourceEvent?.deliveredAt?.toISOString() ??
          asString(responseDelivery?.historicalDeliveredAt),
      },
      associationExplanation,
      normalizedSource: {
        leadgen_id: asDetail(source?.leadgen_id ?? input.sourceEvent?.sourceLeadId),
        page_id: asDetail(source?.page_id),
        form_id: asDetail(source?.form_id),
        submitted_at: asDetail(source?.submitted_at ?? enrichment?.submittedAt),
        received_at: asDetail(
          source?.received_at ??
            (input.sourceEvent ? input.sourceEvent.receivedAt.toISOString() : null)
        ),
        intake_method: asDetail(source?.intake_method ?? enrichment?.intakeMethod),
      },
      ...(graphFetch ? { graphFetch } : {}),
    },
  };
}
