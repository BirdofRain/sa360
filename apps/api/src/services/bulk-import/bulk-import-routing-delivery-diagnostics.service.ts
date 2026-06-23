import type { CampaignRoutingRule } from "@prisma/client";
import type { LifecycleEventSchema } from "../../schemas/lifecycle-event.schema.js";
import {
  extractRoutingAttributionFromPayload,
  type RoutingAttributionInput,
} from "../../lib/routing-attribution-extract.js";
import {
  buildRoutingMatcherDebug,
  matchCampaignRoutingRule,
  type RoutingMatcherDebugRejection,
} from "../routing-matcher.service.js";
import { listActiveRoutingRulesForBulkImportDelivery } from "./bulk-import-routing-master.service.js";
import { resolveRoutingRuleMatchValue } from "./bulk-import-live-canary-routing-match.service.js";

export type BulkImportRoutingRuleConsidered = {
  id: string;
  masterClientAccountId: string;
  destinationClientAccountId: string;
  destinationLocationIdGhl: string;
  matchType: string;
  matchField: string;
  matchValue: string | null;
  nicheKey: string | null;
  productType: string | null;
  sourcePlatform: string | null;
  active: boolean;
  deliveryEnabled: boolean;
};

export type BulkImportRoutingDeliveryDiagnostics = {
  batchId: string | null;
  sourceLeadEventId: string | null;
  destinationClientAccountId: string;
  destinationLocationIdGhl: string;
  routingMasterClientAccountId: string;
  triedCampaignId: string | null;
  triedCampaignName: string | null;
  triedUtmCampaign: string | null;
  triedSourcePlatform: string | null;
  triedSourceType: string | null;
  triedNicheKey: string | null;
  triedProductType: string | null;
  normalizedAttribution: RoutingAttributionInput;
  preservedSourceAttributes: Record<string, unknown> | null;
  rulesConsidered: BulkImportRoutingRuleConsidered[];
  rulesConsideredCount: number;
  closestRuleMismatch: string | null;
  matched: boolean;
  matchedRuleId: string | null;
  reason: string;
};

function sourceAttributesFromPayload(payload: LifecycleEventSchema): Record<string, unknown> | null {
  const intake = payload.routing?.source_intake as { sourceAttributes?: unknown } | undefined;
  if (!intake?.sourceAttributes || typeof intake.sourceAttributes !== "object") return null;
  return intake.sourceAttributes as Record<string, unknown>;
}

function summarizeRule(rule: CampaignRoutingRule): BulkImportRoutingRuleConsidered {
  const { matchField, matchValue } = resolveRoutingRuleMatchValue(rule);
  return {
    id: rule.id,
    masterClientAccountId: rule.masterClientAccountId,
    destinationClientAccountId: rule.clientAccountId,
    destinationLocationIdGhl: rule.destinationSubaccountIdGhl,
    matchType: rule.matchType,
    matchField,
    matchValue,
    nicheKey: rule.nicheKey,
    productType: rule.productType,
    sourcePlatform: rule.sourcePlatform,
    active: rule.active,
    deliveryEnabled: rule.deliveryEnabled,
  };
}

function closestMismatchFromDebug(
  rejections: RoutingMatcherDebugRejection[],
  rules: CampaignRoutingRule[]
): string | null {
  if (rejections.length === 0) return null;
  const ruleById = new Map(rules.map((rule) => [rule.id, rule]));
  const preferred = rejections.find((rejection) => {
    const rule = ruleById.get(rejection.ruleId);
    return rule?.matchType === "campaign_id";
  }) ?? rejections[0];
  const rule = ruleById.get(preferred.ruleId);
  const expected = rule ? resolveRoutingRuleMatchValue(rule).matchValue : null;
  return `Rule ${preferred.ruleId} (${preferred.matchType}): ${preferred.reasons.join(", ")}${
    expected ? `; expected ${expected}` : ""
  }`;
}

export async function buildBulkImportRoutingDeliveryDiagnostics(input: {
  payload: LifecycleEventSchema;
  destinationClientAccountId: string;
  destinationLocationIdGhl: string;
  batchId?: string | null;
  sourceLeadEventId?: string | null;
}): Promise<BulkImportRoutingDeliveryDiagnostics> {
  const rules = await listActiveRoutingRulesForBulkImportDelivery({
    destinationClientAccountId: input.destinationClientAccountId,
    destinationLocationIdGhl: input.destinationLocationIdGhl,
  });
  const attribution = extractRoutingAttributionFromPayload(input.payload);
  const match = matchCampaignRoutingRule(rules, attribution);
  const debug = buildRoutingMatcherDebug(rules, attribution);

  return {
    batchId: input.batchId ?? null,
    sourceLeadEventId: input.sourceLeadEventId ?? null,
    destinationClientAccountId: input.destinationClientAccountId,
    destinationLocationIdGhl: input.destinationLocationIdGhl,
    routingMasterClientAccountId: attribution.masterClientAccountId,
    triedCampaignId: attribution.campaignId ?? null,
    triedCampaignName: attribution.campaignName ?? null,
    triedUtmCampaign: attribution.utmCampaign ?? null,
    triedSourcePlatform: attribution.sourcePlatform ?? null,
    triedSourceType: attribution.sourceType ?? null,
    triedNicheKey: attribution.nicheKey ?? null,
    triedProductType: attribution.productType ?? null,
    normalizedAttribution: attribution,
    preservedSourceAttributes: sourceAttributesFromPayload(input.payload),
    rulesConsidered: rules.map(summarizeRule),
    rulesConsideredCount: rules.length,
    closestRuleMismatch: match.matched
      ? null
      : closestMismatchFromDebug(debug.rejections, rules),
    matched: match.matched,
    matchedRuleId: match.matchedRuleId ?? null,
    reason: match.reason,
  };
}

export function formatBulkImportRoutingFailureLines(
  diagnostics: BulkImportRoutingDeliveryDiagnostics
): string[] {
  const lines = [
    `Tried campaign_id: ${diagnostics.triedCampaignId ?? "(missing)"}`,
    `Looked under masterClientAccountId: ${diagnostics.routingMasterClientAccountId}`,
    `Rules considered: ${diagnostics.rulesConsideredCount}`,
  ];
  if (diagnostics.closestRuleMismatch) {
    lines.push(`Closest rule mismatch: ${diagnostics.closestRuleMismatch}`);
  } else if (diagnostics.rulesConsideredCount === 0) {
    lines.push(
      "Closest rule mismatch: no active routing rules found for this destination/master client."
    );
  } else if (!diagnostics.triedCampaignId) {
    lines.push("Closest rule mismatch: campaign_id missing from normalized attribution.");
  } else {
    lines.push(`Closest rule mismatch: ${diagnostics.reason}`);
  }
  return lines;
}
