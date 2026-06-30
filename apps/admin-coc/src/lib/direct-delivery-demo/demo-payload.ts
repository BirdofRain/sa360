/**
 * Direct Delivery Demo lead_created payloads.
 *
 * These conform to the current normalized source-intake / routing / delivery-plan flow
 * (the same shape the working Google Sheet source intake produces). Two builders:
 *   - buildDirectDemoPayloadFromDecision(): derive a payload from a selected matched
 *     Routing Dry Run decision (preferred — routes to the real matched destination).
 *   - buildDirectDemoFallbackPayload(): a valid fallback for the SA360 Demo destination,
 *     clearly labeled as not tied to a selected routing decision.
 *
 * Fake contact data only; unique event_uuid / lead_uid per load. Never triggers delivery.
 */

import { parseAttributionSnapshot } from "@/lib/routing-dry-run/routing-dry-run-display";
import type { RoutingDryRunDecisionItem } from "@/lib/routing-dry-run/types";
import { DIRECT_DEMO_CLIENT_ACCOUNT_ID, DIRECT_DEMO_LOCATION_ID } from "./types";

export const DIRECT_DEMO_SCHEMA_VERSION = "1.0";

/** Canonical lifecycle state block for a freshly received source lead (cutover rehearsal). */
export const DIRECT_DEMO_CANONICAL_STATE = {
  lifecycle_stage: "NEW",
  lead_status: "NEW",
  appointment_status: "NONE",
  agent_disposition: "NONE",
  policy_status: "NONE",
  ai_status: "NONE",
  routing_status: "SOURCE_RECEIVED",
} as const;

export const DEMO_SA360_ATTRIBUTION = {
  source_platform: "facebook",
  source_type: "facebook_lead_form",
  campaign_id: "120241930690720364",
  campaign_name: "Master Vet Pixel",
  utm_campaign: "SA360 Demo Vet FEX (test form)",
} as const;

type DirectDemoPayloadSource = "routing_decision" | "fallback_demo";

type BuildOpts = { nowMs?: number };

function suffixFrom(nowMs: number): string {
  return nowMs.toString(36);
}

function trimOrUndefined(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t.length > 0 ? t : undefined;
}

function baseContact(suffix: string): Record<string, unknown> {
  return {
    lead_uid: `demo_sa360_direct_${suffix}`,
    contact_id_ghl: `demo_contact_${suffix}`,
    first_name: "Test",
    last_name: "Lead",
    phone_e164: "+15550100999",
    email: `demo.direct.${suffix}@example.test`,
  };
}

function baseEvent(suffix: string): Record<string, unknown> {
  return {
    event_uuid: `demo_sa360_evt_${suffix}`,
    event_name_internal: "lead_created",
    event_name_meta: "Lead",
    send_to_meta: false,
  };
}

/**
 * Fallback demo payload for the SA360 Demo destination. Valid for the current schema, but
 * not tied to a selected routing decision. Labeled via `_demo_source: "fallback_demo"`.
 */
export function buildDirectDemoFallbackPayload(opts: BuildOpts = {}): Record<string, unknown> {
  const nowMs = opts.nowMs ?? Date.now();
  const suffix = suffixFrom(nowMs);
  const master = "lal_master_vet";
  return {
    schema_version: DIRECT_DEMO_SCHEMA_VERSION,
    client_account_id: master,
    _demo_source: "fallback_demo" satisfies DirectDemoPayloadSource,
    contact: baseContact(suffix),
    attribution: { ...DEMO_SA360_ATTRIBUTION },
    state: { ...DIRECT_DEMO_CANONICAL_STATE },
    event: baseEvent(suffix),
    routing: {
      routing_mode: "shadow",
      dry_run: true,
      master_client_account_id: master,
      target_client_account_id: DIRECT_DEMO_CLIENT_ACCOUNT_ID,
      target_subaccount_id_ghl: DIRECT_DEMO_LOCATION_ID,
      destination_client_account_id: DIRECT_DEMO_CLIENT_ACCOUNT_ID,
      destination_location_id_ghl: DIRECT_DEMO_LOCATION_ID,
      niche_key: "VET",
      product_type: "Final Expense",
      form_id: "demo_form_vet_fex",
      source_identity_id: `demo_identity_${suffix}`,
    },
  };
}

/**
 * Build a demo payload from a selected matched Routing Dry Run decision so the simulation
 * routes to the real matched destination. Falls back to demo values only for fields the
 * decision does not provide. Includes destination/routing fields and decision/plan ids.
 */
export function buildDirectDemoPayloadFromDecision(
  row: RoutingDryRunDecisionItem,
  opts: BuildOpts = {}
): Record<string, unknown> {
  const nowMs = opts.nowMs ?? Date.now();
  const suffix = suffixFrom(nowMs);
  const attr = parseAttributionSnapshot(row.attributionSnapshot);

  const master = trimOrUndefined(row.masterClientAccountId) ?? "lal_master_vet";
  const destClient =
    trimOrUndefined(row.destinationClientAccountId) ??
    trimOrUndefined(row.matchedRuleSummary?.clientAccountId) ??
    DIRECT_DEMO_CLIENT_ACCOUNT_ID;
  const destLocation =
    trimOrUndefined(row.destinationSubaccountIdGhl) ?? DIRECT_DEMO_LOCATION_ID;
  const nicheKey =
    trimOrUndefined(attr?.nicheKey) ??
    trimOrUndefined(row.matchedRuleSummary?.nicheKey) ??
    "VET";
  const productType =
    trimOrUndefined(attr?.productType) ??
    trimOrUndefined(row.matchedRuleSummary?.productType) ??
    "Final Expense";

  const attribution: Record<string, unknown> = {
    source_platform: trimOrUndefined(attr?.sourcePlatform) ?? DEMO_SA360_ATTRIBUTION.source_platform,
    source_type: trimOrUndefined(attr?.sourceType) ?? DEMO_SA360_ATTRIBUTION.source_type,
    campaign_id: trimOrUndefined(attr?.campaignId) ?? DEMO_SA360_ATTRIBUTION.campaign_id,
    campaign_name: trimOrUndefined(attr?.campaignName) ?? DEMO_SA360_ATTRIBUTION.campaign_name,
  };
  const adsetId = trimOrUndefined(attr?.adsetId);
  if (adsetId) attribution.adset_id = adsetId;
  const adId = trimOrUndefined(attr?.adId);
  if (adId) attribution.ad_id = adId;
  const utmCampaign = trimOrUndefined(attr?.utmCampaign);
  if (utmCampaign) attribution.utm_campaign = utmCampaign;

  return {
    schema_version: DIRECT_DEMO_SCHEMA_VERSION,
    client_account_id: master,
    _demo_source: "routing_decision" satisfies DirectDemoPayloadSource,
    contact: baseContact(suffix),
    attribution,
    state: { ...DIRECT_DEMO_CANONICAL_STATE },
    event: baseEvent(suffix),
    routing: {
      routing_mode: "shadow",
      dry_run: true,
      master_client_account_id: master,
      target_client_account_id: destClient,
      target_subaccount_id_ghl: destLocation,
      destination_client_account_id: destClient,
      destination_location_id_ghl: destLocation,
      niche_key: nicheKey,
      product_type: productType,
      // form_id is read by the routing matcher from routing.form_id.
      form_id: trimOrUndefined(attr?.formId) ?? "demo_form_vet_fex",
      source_identity_id: `demo_identity_${suffix}`,
      routing_dry_run_decision_id: trimOrUndefined(row.id),
      delivery_plan_id: trimOrUndefined(row.deliveryPlanSummary?.id) ?? null,
    },
  };
}

/** Back-compat helper: returns the fallback demo payload as JSON. */
export function directDemoLeadCreatedPayloadJson(pretty = true): string {
  const payload = buildDirectDemoFallbackPayload();
  return pretty ? JSON.stringify(payload, null, 2) : JSON.stringify(payload);
}

export function directDemoPayloadJsonFromDecision(
  row: RoutingDryRunDecisionItem,
  pretty = true
): string {
  const payload = buildDirectDemoPayloadFromDecision(row);
  return pretty ? JSON.stringify(payload, null, 2) : JSON.stringify(payload);
}

// ─── Validation ───────────────────────────────────────────────────────────────

export type DirectDemoPayloadValidation = {
  ok: boolean;
  errors: string[];
  /** Parsed source label when determinable. */
  source: DirectDemoPayloadSource | "unknown";
  destinationClientAccountId: string | null;
  destinationLocationIdGhl: string | null;
};

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/**
 * Local payload validation run before sending to the API, so invalid demo payloads never
 * create false API failures. Checks schema_version, identifiers, canonical lifecycle stage,
 * destination routing, and campaign/source attribution.
 */
export function validateDirectDemoPayload(payload: unknown): DirectDemoPayloadValidation {
  const errors: string[] = [];
  const root = asRecord(payload);
  const contact = asRecord(root?.contact);
  const event = asRecord(root?.event);
  const state = asRecord(root?.state);
  const attribution = asRecord(root?.attribution);
  const routing = asRecord(root?.routing);

  if (!root) {
    return {
      ok: false,
      errors: ["Payload must be a JSON object."],
      source: "unknown",
      destinationClientAccountId: null,
      destinationLocationIdGhl: null,
    };
  }

  if (root.schema_version !== DIRECT_DEMO_SCHEMA_VERSION) {
    errors.push(`schema_version must be "${DIRECT_DEMO_SCHEMA_VERSION}" (got ${JSON.stringify(root.schema_version)}).`);
  }
  if (!trimOrUndefined(event?.event_uuid)) {
    errors.push("event.event_uuid is required.");
  }
  if (!trimOrUndefined(contact?.lead_uid)) {
    errors.push("contact.lead_uid is required.");
  }

  const destClient = trimOrUndefined(routing?.destination_client_account_id);
  const destLocation = trimOrUndefined(routing?.destination_location_id_ghl);
  if (!destClient) errors.push("routing.destination_client_account_id is required.");
  if (!destLocation) errors.push("routing.destination_location_id_ghl is required.");

  const lifecycleStage = trimOrUndefined(state?.lifecycle_stage);
  if (lifecycleStage !== DIRECT_DEMO_CANONICAL_STATE.lifecycle_stage) {
    errors.push(`state.lifecycle_stage must be "${DIRECT_DEMO_CANONICAL_STATE.lifecycle_stage}" (got ${JSON.stringify(lifecycleStage)}).`);
  }

  if (!trimOrUndefined(attribution?.campaign_id)) {
    errors.push("attribution.campaign_id is required.");
  }
  if (!trimOrUndefined(attribution?.source_platform)) {
    errors.push("attribution.source_platform is required.");
  }
  if (!trimOrUndefined(attribution?.source_type)) {
    errors.push("attribution.source_type is required.");
  }

  const source =
    root._demo_source === "routing_decision" || root._demo_source === "fallback_demo"
      ? root._demo_source
      : "unknown";

  return {
    ok: errors.length === 0,
    errors,
    source,
    destinationClientAccountId: destClient ?? null,
    destinationLocationIdGhl: destLocation ?? null,
  };
}

/** Human label for which payload kind is loaded. */
export function describeDirectDemoPayloadSource(payload: unknown): string {
  const root = asRecord(payload);
  const routing = asRecord(root?.routing);
  const routingDecisionId =
    trimOrUndefined(routing?.routing_dry_run_decision_id) ??
    trimOrUndefined(routing?.routingDryRunDecisionId);
  const deliveryPlanId =
    trimOrUndefined(routing?.delivery_plan_id) ?? trimOrUndefined(routing?.deliveryPlanId);
  if (routingDecisionId || deliveryPlanId || root?._demo_source === "routing_decision") {
    return "Selected routing decision";
  }
  if (root?._demo_source === "fallback_demo") {
    return "Custom simulation payload";
  }
  return "Custom simulation payload";
}

// ─── Live canary guard ──────────────────────────────────────────────────────────

export type DirectDemoLiveGuardResult = { allowed: boolean; reason: string | null };

export function isDirectDemoLiveDeliveryAllowed(payload: unknown): DirectDemoLiveGuardResult {
  const root = asRecord(payload);
  const routing = asRecord(root?.routing);
  const routingMode = trimOrUndefined(routing?.routing_mode) ?? "shadow";
  if (routingMode === "live") {
    return {
      allowed: false,
      reason: "routing.routing_mode must be shadow or live_canary for the guarded demo; arbitrary live mode is not allowed from this page.",
    };
  }
  const routingDecisionId =
    trimOrUndefined(routing?.routing_dry_run_decision_id) ??
    trimOrUndefined(routing?.routingDryRunDecisionId);
  const deliveryPlanId =
    trimOrUndefined(routing?.delivery_plan_id) ?? trimOrUndefined(routing?.deliveryPlanId);
  if (!routingDecisionId && !deliveryPlanId) {
    return {
      allowed: false,
      reason: "Live canary requires a matched routing decision and delivery plan.",
    };
  }
  return { allowed: true, reason: null };
}

/**
 * Conservative niche/workflow mismatch heuristic. Returns a warning when the payload's niche
 * conflicts with an explicit workflow hint (e.g. a NURSE lead pointed at a Veteran M1A workflow).
 * Returns null when no explicit conflict can be determined.
 */
export function detectDirectDemoNicheWorkflowMismatch(payload: unknown): string | null {
  const root = asRecord(payload);
  const routing = asRecord(root?.routing);
  const niche = trimOrUndefined(routing?.niche_key)?.toUpperCase();
  const workflowHint = (
    trimOrUndefined(routing?.workflow_name) ??
    trimOrUndefined(routing?.destination_workflow_name) ??
    ""
  ).toUpperCase();
  if (!niche || !workflowHint) return null;

  const VETERAN_HINTS = ["VETERAN", "VET", "M1A"];
  const workflowLooksVeteran = VETERAN_HINTS.some((h) => workflowHint.includes(h));
  if (workflowLooksVeteran && niche !== "VET" && niche !== "VETERAN") {
    return `Selected workflow appears Veteran-specific ("${routing?.workflow_name ?? routing?.destination_workflow_name}") but lead niche is ${niche}. Verify workflow compatibility before live canary.`;
  }
  return null;
}
