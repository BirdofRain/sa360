import { createHash } from "node:crypto";
import type { LifecycleEventSchema } from "../../schemas/lifecycle-event.schema.js";
import { tryNormalizeToVerifiedE164 } from "../phone-e164.service.js";
import { extractSourceAttributesFromPayload } from "./source-attribute-extractor.service.js";
import {
  isLeadCaptureProviderPayload,
  materializeLeadCapturePayload,
  resolveLeadCaptureLeadId,
  resolveLeadCaptureRouteKey,
} from "./leadcapture-payload-resolver.js";
import {
  LEADCAPTURE_IO_MASTER_CLIENT_ACCOUNT_ID,
  type SourceRoutingKeyHints,
} from "./source-intake.types.js";

export type LeadCaptureIoSourceSystem = "leadcapture_io_legacy" | "leadcapture_io_nextgen";

const LEADCAPTURE_IO_PROVIDER = "leadcapture_io";

function trimOrUndefined(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t.length > 0 ? t : undefined;
}

function hashSubmittedAt(submittedAt: string): string {
  return createHash("sha256").update(submittedAt.trim()).digest("hex").slice(0, 12);
}

function resolveSourceSystem(raw: Record<string, unknown>): LeadCaptureIoSourceSystem {
  const explicit = trimOrUndefined(raw.sa360_source_system);
  if (explicit === "leadcapture_io_nextgen") return "leadcapture_io_nextgen";
  return "leadcapture_io_legacy";
}

function buildEventUuid(
  sourceSystem: LeadCaptureIoSourceSystem,
  routeKey: string,
  leadId: string,
  submittedAt: string
): string {
  const hash = hashSubmittedAt(submittedAt || leadId || "unknown");
  return `LCIO-${sourceSystem}-${routeKey}-lead_created-${leadId}-${hash}`;
}

function buildLeadUid(sourceSystem: LeadCaptureIoSourceSystem, leadId: string): string {
  return `leadcaptureio-${sourceSystem}-${leadId}`;
}

export function canNormalizeLeadCaptureIoWebhook(
  raw: unknown,
  routeKeyFromPath?: string
): raw is Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const r = raw as Record<string, unknown>;
  if (isLeadCaptureProviderPayload(r)) return true;
  if (trimOrUndefined(routeKeyFromPath) && Object.keys(r).length > 0) return true;
  return false;
}

export function inferLeadCaptureIoRoutingKeys(
  raw: Record<string, unknown>,
  routeKeyFromPath?: string
): SourceRoutingKeyHints {
  const routeKey = resolveLeadCaptureRouteKey(raw, routeKeyFromPath);
  const campaignName =
    trimOrUndefined(raw.sa360_campaign_name) ?? trimOrUndefined(raw.sa360_funnel_name);
  const sourceSystem = resolveSourceSystem(raw);
  return {
    sourceProvider: LEADCAPTURE_IO_PROVIDER,
    sourceSystem,
    sourceType: trimOrUndefined(raw.sa360_source_type) ?? "leadcapture_form",
    sourceRouteKey: routeKey,
    campaignId: routeKey,
    utmCampaign: campaignName ?? routeKey,
    funnelName: trimOrUndefined(raw.sa360_funnel_name),
    campaignName,
  };
}

export type NormalizeLeadCaptureOptions = {
  routeKeyFromPath?: string;
  routeAliasOverrides?: Record<string, readonly string[]>;
};

/** Normalize LeadCapture.io webhook body to SA360 MASTER 2.0 lifecycle payload. */
export function normalizeLeadCaptureIoWebhookToLifecyclePayload(
  raw: Record<string, unknown>,
  opts?: NormalizeLeadCaptureOptions
): LifecycleEventSchema {
  const effective = materializeLeadCapturePayload(raw, {
    routeKeyFromPath: opts?.routeKeyFromPath,
    routeAliasOverrides: opts?.routeAliasOverrides,
  });
  const sourceSystem = resolveSourceSystem(effective);
  const routeKey = resolveLeadCaptureRouteKey(effective, opts?.routeKeyFromPath);
  const { leadId, sourceLeadIdGenerated } = resolveLeadCaptureLeadId(effective, routeKey);
  const submittedAt = trimOrUndefined(effective.submitted_at) ?? new Date().toISOString();
  const campaignName =
    trimOrUndefined(effective.sa360_campaign_name) ??
    trimOrUndefined(effective.sa360_funnel_name) ??
    routeKey;
  const funnelName = trimOrUndefined(effective.sa360_funnel_name) ?? campaignName;

  const phoneRaw = trimOrUndefined(effective.phone) ?? "";
  const phoneResult = phoneRaw ? tryNormalizeToVerifiedE164(phoneRaw) : null;
  const phoneE164 = phoneResult?.ok ? phoneResult.e164 : undefined;

  const leadUid = buildLeadUid(sourceSystem, leadId);
  const eventUuid = buildEventUuid(sourceSystem, routeKey, leadId, submittedAt);

  const submittedAtIso = submittedAt;
  const extracted = extractSourceAttributesFromPayload(raw, {
    sourceSystem,
    receivedAt: submittedAtIso,
    routeAliasOverrides: opts?.routeAliasOverrides,
    leadCaptureMaterialized: effective,
  });

  const complianceMetadata = {
    ...extracted.sourceAttributes,
    email_verification_status: trimOrUndefined(effective.email_verification_status),
    verfi_proof_url: trimOrUndefined(effective.verfi_proof_url),
    anura_result: trimOrUndefined(effective.anura_result),
    anura_rule_sets: trimOrUndefined(effective.anura_rule_sets),
    anura_invalid_traffic_type: trimOrUndefined(effective.anura_invalid_traffic_type),
    anura_mobile: effective.anura_mobile,
    anura_ad_blocker: effective.anura_ad_blocker,
    anura_response_id: trimOrUndefined(effective.anura_response_id),
    session_recording_url: trimOrUndefined(effective.session_recording_url),
    is_partial_lead: effective.is_partial_lead,
    leadScoreSummary: trimOrUndefined(effective.leadScoreSummary),
    resume_url: trimOrUndefined(effective.resume_url),
    ttp: trimOrUndefined(effective.ttp),
    ttclid: trimOrUndefined(effective.ttclid),
  };

  return {
    schema_version: "MASTER 2.0",
    client_account_id: LEADCAPTURE_IO_MASTER_CLIENT_ACCOUNT_ID,
    subaccount_id_ghl: LEADCAPTURE_IO_MASTER_CLIENT_ACCOUNT_ID,
    contact: {
      lead_uid: leadUid,
      first_name: trimOrUndefined(effective.first_name),
      last_name: trimOrUndefined(effective.last_name),
      email: trimOrUndefined(effective.email),
      phone: phoneRaw || undefined,
      phone_e164: phoneE164,
      state: trimOrUndefined(effective.state),
    },
    attribution: {
      source_platform: "leadcapture_io",
      source_type: "leadcapture_form",
      utm_source: trimOrUndefined(effective.utm_source) ?? "leadcapture.io",
      utm_medium: trimOrUndefined(effective.utm_medium) ?? "landing_page",
      utm_campaign: trimOrUndefined(effective.utm_campaign) ?? campaignName,
      campaign_id: routeKey,
      campaign_name: trimOrUndefined(effective.utm_campaign) ?? campaignName,
      ad_id: trimOrUndefined(effective.ad_id),
      ad_name: trimOrUndefined(effective.ad_name),
      adset_id: trimOrUndefined(effective.adset_id),
      adset_name: trimOrUndefined(effective.adset_name),
      fbp: trimOrUndefined(effective.fbp),
      fbc: trimOrUndefined(effective.fbc),
      fbclid: trimOrUndefined(effective.fbclid),
    },
    state: {
      lifecycle_stage: "NEW",
      routing_status: "RECEIVED",
      lead_type: "VET",
    },
    event: {
      event_uuid: eventUuid,
      event_name_internal: "lead_created",
      event_name_meta: "Lead",
      send_to_meta: false,
    },
    routing: {
      niche_key: "VET",
      niche_label: "Veteran",
      product_type: "Final Expense",
      campaign_key: routeKey,
      lead_pool_id: `leadcaptureio-${sourceSystem}-${routeKey}`,
      source_intake: {
        provider: LEADCAPTURE_IO_PROVIDER,
        source_system: sourceSystem,
        source_type: "leadcapture_form",
        source_route_key: routeKey,
        funnel_name: funnelName,
        campaign_name: campaignName,
        lead_id: leadId,
        source_lead_id_generated: sourceLeadIdGenerated,
        submitted_at: submittedAt,
        sourceAttributes: extracted.sourceAttributes,
        unmappedSourceFieldsJson: extracted.unmappedSourceFields,
        compliance: complianceMetadata,
      },
    },
  };
}
