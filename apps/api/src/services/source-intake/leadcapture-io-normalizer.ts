import { createHash } from "node:crypto";
import type { LifecycleEventSchema } from "../../schemas/lifecycle-event.schema.js";
import { tryNormalizeToVerifiedE164 } from "../phone-e164.service.js";
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

export function canNormalizeLeadCaptureIoWebhook(raw: unknown): raw is Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const r = raw as Record<string, unknown>;
  const provider = trimOrUndefined(r.provider);
  const platform = trimOrUndefined(r.sa360_source_platform);
  return provider === LEADCAPTURE_IO_PROVIDER || platform === LEADCAPTURE_IO_PROVIDER;
}

export function inferLeadCaptureIoRoutingKeys(raw: Record<string, unknown>): SourceRoutingKeyHints {
  const routeKey = trimOrUndefined(raw.sa360_route_key) ?? "";
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

/** Normalize LeadCapture.io webhook body to SA360 MASTER 2.0 lifecycle payload. */
export function normalizeLeadCaptureIoWebhookToLifecyclePayload(
  raw: Record<string, unknown>
): LifecycleEventSchema {
  const sourceSystem = resolveSourceSystem(raw);
  const routeKey = trimOrUndefined(raw.sa360_route_key) ?? "UNKNOWN_ROUTE";
  const leadId = trimOrUndefined(raw.lead_id) ?? "unknown_lead";
  const submittedAt = trimOrUndefined(raw.submitted_at) ?? new Date().toISOString();
  const campaignName =
    trimOrUndefined(raw.sa360_campaign_name) ?? trimOrUndefined(raw.sa360_funnel_name) ?? routeKey;
  const funnelName = trimOrUndefined(raw.sa360_funnel_name) ?? campaignName;

  const phoneRaw = trimOrUndefined(raw.phone) ?? "";
  const phoneResult = phoneRaw ? tryNormalizeToVerifiedE164(phoneRaw) : null;
  const phoneE164 = phoneResult?.ok ? phoneResult.e164 : undefined;

  const leadUid = buildLeadUid(sourceSystem, leadId);
  const eventUuid = buildEventUuid(sourceSystem, routeKey, leadId, submittedAt);

  const complianceMetadata = {
    military_status: trimOrUndefined(raw.military_status),
    branch_of_service: trimOrUndefined(raw.branch_of_service),
    sex: trimOrUndefined(raw.sex),
    marital_status: trimOrUndefined(raw.marital_status),
    desired_coverage: trimOrUndefined(raw.desired_coverage),
    primary_reason: trimOrUndefined(raw.primary_reason),
    beneficiary: trimOrUndefined(raw.beneficiary),
    date: trimOrUndefined(raw.date),
    best_time_to_call: trimOrUndefined(raw.best_time_to_call),
    trustedform_cert_url: trimOrUndefined(raw.trustedform_cert_url),
    leadid_token: trimOrUndefined(raw.leadid_token),
    verfi_proof_url: trimOrUndefined(raw.verfi_proof_url),
    phone_verified: raw.phone_verified,
    email_verified: raw.email_verified,
    email_verification_status: trimOrUndefined(raw.email_verification_status),
    anura_result: trimOrUndefined(raw.anura_result),
    anura_rule_sets: trimOrUndefined(raw.anura_rule_sets),
    anura_invalid_traffic_type: trimOrUndefined(raw.anura_invalid_traffic_type),
    anura_mobile: raw.anura_mobile,
    anura_ad_blocker: raw.anura_ad_blocker,
    anura_response_id: trimOrUndefined(raw.anura_response_id),
    ip_address: trimOrUndefined(raw.ip_address),
    user_agent: trimOrUndefined(raw.user_agent),
    parent_url: trimOrUndefined(raw.parent_url),
    session_recording_url: trimOrUndefined(raw.session_recording_url),
    is_partial_lead: raw.is_partial_lead,
    leadScoreSummary: trimOrUndefined(raw.leadScoreSummary),
    resume_url: trimOrUndefined(raw.resume_url),
    ttp: trimOrUndefined(raw.ttp),
    ttclid: trimOrUndefined(raw.ttclid),
  };

  return {
    schema_version: "MASTER 2.0",
    client_account_id: LEADCAPTURE_IO_MASTER_CLIENT_ACCOUNT_ID,
    subaccount_id_ghl: LEADCAPTURE_IO_MASTER_CLIENT_ACCOUNT_ID,
    contact: {
      lead_uid: leadUid,
      contact_id_ghl: leadUid,
      first_name: trimOrUndefined(raw.first_name),
      last_name: trimOrUndefined(raw.last_name),
      email: trimOrUndefined(raw.email),
      phone: phoneRaw || undefined,
      phone_e164: phoneE164,
      state: trimOrUndefined(raw.state),
    },
    attribution: {
      source_platform: "leadcapture_io",
      source_type: "leadcapture_form",
      utm_source: trimOrUndefined(raw.utm_source) ?? "leadcapture.io",
      utm_medium: trimOrUndefined(raw.utm_medium) ?? "landing_page",
      utm_campaign: campaignName,
      campaign_id: routeKey,
      campaign_name: campaignName,
      fbp: trimOrUndefined(raw.fbp),
      fbc: trimOrUndefined(raw.fbc),
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
        submitted_at: submittedAt,
        compliance: complianceMetadata,
      },
    },
  };
}
