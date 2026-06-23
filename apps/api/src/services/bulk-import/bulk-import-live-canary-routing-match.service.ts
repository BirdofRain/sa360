import type { CampaignRoutingRule } from "@prisma/client";
import { lifecycleEventSchema } from "../../schemas/lifecycle-event.schema.js";
import {
  extractRoutingAttributionFromPayload,
  type RoutingAttributionInput,
} from "../../lib/routing-attribution-extract.js";
import { findSourceLeadEventById } from "../../repositories/source-lead-event.repository.js";
import {
  listBulkLeadImportRows,
} from "../../repositories/bulk-lead-import.repository.js";
import { matchCampaignRoutingRule } from "../routing-matcher.service.js";
import { isSimulationReadyRow } from "./bulk-import-simulation-eligibility.service.js";
import {
  listActiveRoutingRulesForBulkImportDelivery,
  prepareBulkImportPayloadForRoutingDryRun,
  resolveRoutingMasterClientAccountIdForDestination,
} from "./bulk-import-routing-master.service.js";
import {
  buildBulkImportRoutingDeliveryDiagnostics,
  formatBulkImportRoutingFailureLines,
  type BulkImportRoutingDeliveryDiagnostics,
} from "./bulk-import-routing-delivery-diagnostics.service.js";

export type BulkImportActiveRoutingRuleSummary = {
  id: string;
  masterClientAccountId: string;
  matchType: string;
  matchField: string;
  matchValue: string | null;
  destinationClientAccountId: string;
  destinationSubaccountIdGhl: string;
  nicheKey: string | null;
  productType: string | null;
  sourcePlatform: string | null;
  active: boolean;
};

export type BulkImportRowRoutingCheck = {
  rowId: string;
  rowNumber: number;
  matched: boolean;
  matchedRuleId: string | null;
  reason: string;
  routingMasterClientAccountId: string;
  attribution: Pick<
    RoutingAttributionInput,
    "campaignId" | "adsetId" | "adId" | "utmCampaign" | "formId" | "sourcePlatform" | "nicheKey" | "productType"
  >;
  diagnostics?: BulkImportRoutingDeliveryDiagnostics;
  failureLines?: string[];
};

export type BulkImportLiveCanaryRoutingMatch = {
  liveDeliveryRequiresRoutingRuleMatch: true;
  routingMasterClientAccountId: string;
  activeRules: BulkImportActiveRoutingRuleSummary[];
  rowChecks: BulkImportRowRoutingCheck[];
  eligibleRowCount: number;
  matchedRowCount: number;
  unmatchedRowCount: number;
  allEligibleRowsMatch: boolean;
};

export function resolveRoutingRuleMatchValue(rule: CampaignRoutingRule): {
  matchField: string;
  matchValue: string | null;
} {
  switch (rule.matchType) {
    case "campaign_id":
      return { matchField: "campaign_id", matchValue: rule.campaignId?.trim() || null };
    case "adset_id":
      return { matchField: "adset_id", matchValue: rule.adsetId?.trim() || null };
    case "ad_id":
      return { matchField: "ad_id", matchValue: rule.adId?.trim() || null };
    case "form_id_utm_campaign":
      return {
        matchField: "form_id + utm_campaign",
        matchValue: [rule.formId?.trim(), rule.utmCampaign?.trim()].filter(Boolean).join(" / ") || null,
      };
    case "utm_campaign":
      return { matchField: "utm_campaign", matchValue: rule.utmCampaign?.trim() || null };
    case "keyword_fallback":
      return { matchField: "keyword_pattern", matchValue: rule.keywordPattern?.trim() || null };
    default:
      return { matchField: rule.matchType, matchValue: null };
  }
}

function summarizeActiveRules(rules: CampaignRoutingRule[]): BulkImportActiveRoutingRuleSummary[] {
  return rules.map((rule) => {
    const { matchField, matchValue } = resolveRoutingRuleMatchValue(rule);
    return {
      id: rule.id,
      masterClientAccountId: rule.masterClientAccountId,
      matchType: rule.matchType,
      matchField,
      matchValue,
      destinationClientAccountId: rule.clientAccountId,
      destinationSubaccountIdGhl: rule.destinationSubaccountIdGhl,
      nicheKey: rule.nicheKey,
      productType: rule.productType,
      sourcePlatform: rule.sourcePlatform,
      active: rule.active,
    };
  });
}

function attributionPreview(
  input: RoutingAttributionInput
): BulkImportRowRoutingCheck["attribution"] {
  return {
    campaignId: input.campaignId,
    adsetId: input.adsetId,
    adId: input.adId,
    utmCampaign: input.utmCampaign,
    formId: input.formId,
    sourcePlatform: input.sourcePlatform,
    nicheKey: input.nicheKey,
    productType: input.productType,
  };
}

export async function evaluateBulkImportLiveCanaryRoutingMatch(input: {
  batchId: string;
  destinationClientAccountId: string;
  destinationLocationIdGhl?: string | null;
  rowLimit?: number;
}): Promise<BulkImportLiveCanaryRoutingMatch> {
  const destinationClientAccountId = input.destinationClientAccountId.trim();
  const routingMasterClientAccountId =
    await resolveRoutingMasterClientAccountIdForDestination(destinationClientAccountId);
  const activeRules = await listActiveRoutingRulesForBulkImportDelivery({
    destinationClientAccountId,
    destinationLocationIdGhl: input.destinationLocationIdGhl,
  });
  const ruleSummaries = summarizeActiveRules(activeRules);

  const rows = await listBulkLeadImportRows(input.batchId);
  const eligibleRows = rows
    .filter((row) => isSimulationReadyRow(row) && row.deliveryStatus === "simulated")
    .sort((a, b) => a.rowNumber - b.rowNumber);
  const limitedRows =
    typeof input.rowLimit === "number" && input.rowLimit > 0
      ? eligibleRows.slice(0, Math.floor(input.rowLimit))
      : eligibleRows;

  const rowChecks: BulkImportRowRoutingCheck[] = [];

  for (const row of limitedRows) {
    if (!row.sourceLeadEventId) {
      rowChecks.push({
        rowId: row.id,
        rowNumber: row.rowNumber,
        matched: false,
        matchedRuleId: null,
        routingMasterClientAccountId,
        reason: "Source lead event missing; routing cannot be evaluated.",
        attribution: {},
      });
      continue;
    }

    const event = await findSourceLeadEventById(row.sourceLeadEventId);
    const raw = event?.normalizedPayloadJson;
    if (!raw || typeof raw !== "object") {
      rowChecks.push({
        rowId: row.id,
        rowNumber: row.rowNumber,
        matched: false,
        matchedRuleId: null,
        routingMasterClientAccountId,
        reason: "Normalized lifecycle payload missing; routing cannot be evaluated.",
        attribution: {},
      });
      continue;
    }

    const parsed = lifecycleEventSchema.safeParse(raw);
    if (!parsed.success) {
      rowChecks.push({
        rowId: row.id,
        rowNumber: row.rowNumber,
        matched: false,
        matchedRuleId: null,
        routingMasterClientAccountId,
        reason: "Normalized lifecycle payload invalid; routing cannot be evaluated.",
        attribution: {},
      });
      continue;
    }

    const routingPayload = await prepareBulkImportPayloadForRoutingDryRun(
      parsed.data,
      destinationClientAccountId
    );
    const attribution = extractRoutingAttributionFromPayload(routingPayload);
    const match = matchCampaignRoutingRule(activeRules, attribution);
    const diagnostics = await buildBulkImportRoutingDeliveryDiagnostics({
      payload: routingPayload,
      destinationClientAccountId,
      destinationLocationIdGhl: input.destinationLocationIdGhl ?? event?.destinationLocationIdResolved ?? "",
      batchId: input.batchId,
      sourceLeadEventId: row.sourceLeadEventId,
    });
    rowChecks.push({
      rowId: row.id,
      rowNumber: row.rowNumber,
      matched: match.matched,
      matchedRuleId: match.matchedRuleId ?? null,
      routingMasterClientAccountId: attribution.masterClientAccountId,
      reason: match.reason,
      attribution: attributionPreview(attribution),
      diagnostics,
      failureLines: match.matched ? undefined : formatBulkImportRoutingFailureLines(diagnostics),
    });
  }

  const matchedRowCount = rowChecks.filter((row) => row.matched).length;
  const unmatchedRowCount = rowChecks.length - matchedRowCount;

  return {
    liveDeliveryRequiresRoutingRuleMatch: true,
    routingMasterClientAccountId,
    activeRules: ruleSummaries,
    rowChecks,
    eligibleRowCount: rowChecks.length,
    matchedRowCount,
    unmatchedRowCount,
    allEligibleRowsMatch: rowChecks.length > 0 && unmatchedRowCount === 0,
  };
}
