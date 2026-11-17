/**
 * Campaign Lead Type decision for one source event.
 *
 * The decision comes from the binding that won routing. A confirmed source
 * association contributes its configured key. An exact campaign rule does not
 * inherit a key from a source association it bypassed. A catalog key or exact
 * label only validates vocabulary. The value is trusted when it is the
 * integration field `sa360_campaign_lead_type` and that field is not a
 * consumer answer. URL text, niche, product, sheet headers, inventory, and
 * form answers are not evidence.
 *
 * The display label is copied onto the decision. A later catalog label change
 * does not rewrite a decision that was already stored.
 */

import type { CampaignRoutingMatchType } from "@prisma/client";
import {
  campaignLeadTypeKeyFromLabel,
  campaignLeadTypeLabel,
  isCampaignLeadTypeKey,
  type CampaignLeadTypeKey,
} from "@sa360/shared";

import { isExactRoutingRuleMatchType } from "../routing-matcher.service.js";

export const CAMPAIGN_LEAD_TYPE_DECISION_VERSION = 1 as const;

/** Integration metadata field. Not a LeadCapture answer key. */
export const AUTHORITATIVE_CAMPAIGN_LEAD_TYPE_FIELD = "sa360_campaign_lead_type" as const;

export const TRUSTED_CAMPAIGN_LEAD_TYPE_ADAPTER = AUTHORITATIVE_CAMPAIGN_LEAD_TYPE_FIELD;

export type CampaignLeadTypeStatus = "resolved" | "agreement" | "conflict" | "unresolved";

export type CampaignLeadTypeBindingKind =
  | "confirmed_source_association"
  | "campaign_routing_rule"
  | "operator_selected_destination"
  | "none";

export type CampaignLeadTypeDecision = {
  version: typeof CAMPAIGN_LEAD_TYPE_DECISION_VERSION;
  status: CampaignLeadTypeStatus;
  /** Stable key when the decision resolved or agreed. Null for conflict and unresolved. */
  leadTypeKey: CampaignLeadTypeKey | null;
  /** Exact display label copied at decision time. Null for conflict and unresolved. */
  leadTypeLabel: string | null;
  binding: {
    kind: CampaignLeadTypeBindingKind;
    id: string | null;
    /** Configured key on the winning binding, including when it was not emitted. */
    leadTypeKey: string | null;
  };
  evidence: {
    trustedKey: CampaignLeadTypeKey | null;
    trustedAdapter: string | null;
    bindingKey: string | null;
    bypassedSourceLeadTypeKey: string | null;
  };
};

export type TrustedCampaignLeadType = {
  key: CampaignLeadTypeKey;
  adapter: typeof TRUSTED_CAMPAIGN_LEAD_TYPE_ADAPTER;
};

const ROUTING_AUTHORITY_SOURCE_ASSOCIATION = "confirmed_source_association";
const ROUTING_AUTHORITY_CAMPAIGN_RULE = "campaign_routing_rule";
const ROUTING_AUTHORITY_OPERATOR = "operator_selected_destination";

const MATCH_TYPES = new Set<CampaignRoutingMatchType>([
  "campaign_id",
  "adset_id",
  "ad_id",
  "form_id_utm_campaign",
  "utm_campaign",
  "keyword_fallback",
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function trim(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asMatchType(value: string | null | undefined): CampaignRoutingMatchType | undefined {
  if (!value || !MATCH_TYPES.has(value as CampaignRoutingMatchType)) return undefined;
  return value as CampaignRoutingMatchType;
}

/**
 * Validate one explicit campaign lead type value.
 * A niche code, product name, or URL fragment does not pass.
 */
export function parseTrustedCampaignLeadTypeValue(raw: unknown): CampaignLeadTypeKey | null {
  const value = trim(raw);
  if (!value) return null;
  if (isCampaignLeadTypeKey(value)) return value;
  return campaignLeadTypeKeyFromLabel(value);
}

function answerContainerHas(
  root: Record<string, unknown>,
  field: typeof AUTHORITATIVE_CAMPAIGN_LEAD_TYPE_FIELD
): boolean {
  for (const containerKey of ["answers", "form"] as const) {
    const container = asRecord(root[containerKey]);
    if (!container || !(field in container)) continue;
    const value = container[field];
    if (value == null) continue;
    if (typeof value === "string" && value.trim() === "") continue;
    return true;
  }
  return false;
}

/**
 * Trust one integration field, and only when a consumer answer did not supply it.
 * A matching catalog key or label is vocabulary, not authority. `campaign_lead_type`
 * shares the LeadCapture answer namespace with survey fields, so it is ignored.
 * Nested `routing` copies, sheet headers, niche, and custom form answers are ignored.
 */
export function readTrustedCampaignLeadType(payload: unknown): TrustedCampaignLeadType | null {
  const root = asRecord(payload);
  if (!root) return null;
  if (answerContainerHas(root, AUTHORITATIVE_CAMPAIGN_LEAD_TYPE_FIELD)) return null;
  const candidate = root[AUTHORITATIVE_CAMPAIGN_LEAD_TYPE_FIELD];
  if (candidate == null) return null;
  if (typeof candidate === "string" && candidate.trim() === "") return null;
  const key = parseTrustedCampaignLeadTypeValue(candidate);
  if (!key) return null;
  return { key, adapter: TRUSTED_CAMPAIGN_LEAD_TYPE_ADAPTER };
}

function labelFor(
  key: CampaignLeadTypeKey,
  labels: Partial<Record<CampaignLeadTypeKey, string>> | undefined
): string {
  const override = labels?.[key];
  if (typeof override === "string" && override.trim().length > 0) return override;
  return campaignLeadTypeLabel(key);
}

function configuredKey(raw: string | null | undefined): CampaignLeadTypeKey | null {
  if (!raw || !isCampaignLeadTypeKey(raw)) return null;
  return raw;
}

export function resolveCampaignLeadType(input: {
  routingAuthority?: string | null;
  matched: boolean;
  matchedRuleId?: string | null;
  matchType?: string | null;
  sourceAssociation?: { id: string; leadTypeKey: string | null } | null;
  observedSource?: { id: string; leadTypeKey: string | null } | null;
  trusted?: TrustedCampaignLeadType | null;
  labels?: Partial<Record<CampaignLeadTypeKey, string>>;
}): CampaignLeadTypeDecision {
  let winning: {
    kind: Exclude<CampaignLeadTypeBindingKind, "none">;
    id: string | null;
    leadTypeKey: string | null;
  } | null = null;
  let bypassedSourceLeadTypeKey: string | null = null;

  if (
    input.routingAuthority === ROUTING_AUTHORITY_SOURCE_ASSOCIATION &&
    input.sourceAssociation?.id
  ) {
    winning = {
      kind: "confirmed_source_association",
      id: input.sourceAssociation.id,
      leadTypeKey: input.sourceAssociation.leadTypeKey,
    };
  } else if (
    input.matched &&
    input.matchedRuleId &&
    input.routingAuthority === ROUTING_AUTHORITY_CAMPAIGN_RULE
  ) {
    winning = {
      kind: "campaign_routing_rule",
      id: input.matchedRuleId,
      leadTypeKey: null,
    };
    if (isExactRoutingRuleMatchType(asMatchType(input.matchType))) {
      bypassedSourceLeadTypeKey =
        input.observedSource?.leadTypeKey ?? input.sourceAssociation?.leadTypeKey ?? null;
    }
  } else if (input.matched && input.routingAuthority === ROUTING_AUTHORITY_OPERATOR) {
    winning = {
      kind: "operator_selected_destination",
      id: null,
      leadTypeKey: null,
    };
  }

  const bindingKey = winning?.leadTypeKey ?? null;
  const usableKey = configuredKey(bindingKey);
  const trusted = input.trusted ?? null;
  const decision: CampaignLeadTypeDecision = {
    version: CAMPAIGN_LEAD_TYPE_DECISION_VERSION,
    status: "unresolved",
    leadTypeKey: null,
    leadTypeLabel: null,
    binding: {
      kind: winning?.kind ?? "none",
      id: winning?.id ?? null,
      leadTypeKey: bindingKey,
    },
    evidence: {
      trustedKey: trusted?.key ?? null,
      trustedAdapter: trusted?.adapter ?? null,
      bindingKey,
      bypassedSourceLeadTypeKey,
    },
  };

  if (!usableKey) return decision;
  if (trusted && trusted.key !== usableKey) {
    decision.status = "conflict";
    return decision;
  }
  decision.leadTypeKey = usableKey;
  decision.leadTypeLabel = labelFor(usableKey, input.labels);
  decision.status = trusted ? "agreement" : "resolved";
  return decision;
}

function nullableKey(value: unknown): CampaignLeadTypeKey | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string" || !isCampaignLeadTypeKey(value)) return undefined;
  return value;
}

function nullableString(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string" || value.trim().length === 0) return undefined;
  return value;
}

/** Read a previously stored decision without applying today's catalog labels. */
export function readCampaignLeadTypeDecision(routingResult: unknown): CampaignLeadTypeDecision | null {
  const root = asRecord(routingResult);
  const raw = asRecord(root?.campaignLeadType);
  if (!raw || raw.version !== CAMPAIGN_LEAD_TYPE_DECISION_VERSION) return null;
  const status = raw.status;
  if (
    status !== "resolved" &&
    status !== "agreement" &&
    status !== "conflict" &&
    status !== "unresolved"
  ) {
    return null;
  }
  const leadTypeKey = nullableKey(raw.leadTypeKey);
  const leadTypeLabel = nullableString(raw.leadTypeLabel);
  if (leadTypeKey === undefined || leadTypeLabel === undefined) return null;
  const binding = asRecord(raw.binding);
  const evidence = asRecord(raw.evidence);
  if (!binding || !evidence) return null;
  const kind = binding.kind;
  if (
    kind !== "confirmed_source_association" &&
    kind !== "campaign_routing_rule" &&
    kind !== "operator_selected_destination" &&
    kind !== "none"
  ) {
    return null;
  }
  const bindingId = binding.id === null ? null : trim(binding.id);
  if (binding.id !== null && !bindingId) return null;
  const bindingLeadTypeKey = binding.leadTypeKey === null ? null : trim(binding.leadTypeKey);
  if (binding.leadTypeKey !== null && bindingLeadTypeKey == null) return null;
  const trustedKey = nullableKey(evidence.trustedKey);
  if (trustedKey === undefined) return null;
  const trustedAdapter = evidence.trustedAdapter === null ? null : trim(evidence.trustedAdapter);
  if (evidence.trustedAdapter !== null && !trustedAdapter) return null;
  const evidenceBindingKey = evidence.bindingKey === null ? null : trim(evidence.bindingKey);
  if (evidence.bindingKey !== null && evidenceBindingKey == null) return null;
  const bypassed =
    evidence.bypassedSourceLeadTypeKey === null ? null : trim(evidence.bypassedSourceLeadTypeKey);
  if (evidence.bypassedSourceLeadTypeKey !== null && bypassed == null) return null;
  if ((status === "resolved" || status === "agreement") && (!leadTypeKey || !leadTypeLabel)) {
    return null;
  }
  if ((status === "conflict" || status === "unresolved") && (leadTypeKey || leadTypeLabel)) {
    return null;
  }
  return {
    version: CAMPAIGN_LEAD_TYPE_DECISION_VERSION,
    status,
    leadTypeKey,
    leadTypeLabel,
    binding: {
      kind,
      id: bindingId,
      leadTypeKey: bindingLeadTypeKey,
    },
    evidence: {
      trustedKey,
      trustedAdapter,
      bindingKey: evidenceBindingKey,
      bypassedSourceLeadTypeKey: bypassed,
    },
  };
}
