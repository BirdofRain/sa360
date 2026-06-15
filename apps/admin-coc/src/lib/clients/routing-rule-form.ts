import type { RoutingRuleCreateBody, RoutingMatchType } from "@/lib/clients/types";
import type { RoutingRuleWithReadinessItem } from "@/lib/delivery-readiness/types";

export const DUPLICATE_ROUTING_RULE_MESSAGE = "A matching routing rule already exists.";

export type AddRoutingRuleFormValues = {
  masterClientAccountId: string;
  matchType: RoutingMatchType;
  priority: string;
  nicheKey: string;
  productType: string;
  campaignId: string;
  campaignName: string;
  utmCampaign: string;
};

export function defaultAddRoutingRuleFormValues(input: {
  defaultMasterClientAccountId: string;
  primaryNicheKey?: string;
  primaryProductType?: string;
  defaultPriority?: number;
}): AddRoutingRuleFormValues {
  return {
    masterClientAccountId: input.defaultMasterClientAccountId,
    matchType: "campaign_id",
    priority: String(input.defaultPriority ?? 100),
    nicheKey: input.primaryNicheKey ?? "",
    productType: input.primaryProductType ?? "",
    campaignId: "",
    campaignName: "",
    utmCampaign: "",
  };
}

function trimLower(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

/** Match key for duplicate detection based on match type. */
export function routingRuleMatchKey(
  matchType: RoutingMatchType,
  fields: {
    campaignId?: string | null;
    utmCampaign?: string | null;
    adsetId?: string | null;
    adId?: string | null;
    formId?: string | null;
    keywordPattern?: string | null;
  }
): string {
  switch (matchType) {
    case "campaign_id":
      return trimLower(fields.campaignId);
    case "utm_campaign":
      return trimLower(fields.utmCampaign);
    case "adset_id":
      return trimLower(fields.adsetId);
    case "ad_id":
      return trimLower(fields.adId);
    case "form_id_utm_campaign":
      return `${trimLower(fields.formId)}::${trimLower(fields.utmCampaign)}`;
    case "keyword_fallback":
      return trimLower(fields.keywordPattern);
    default:
      return "";
  }
}

export function findEquivalentRoutingRule(
  existingRules: RoutingRuleWithReadinessItem[],
  input: {
    masterClientAccountId: string;
    clientAccountId: string;
    destinationSubaccountIdGhl: string | null | undefined;
    matchType: RoutingMatchType;
    form: AddRoutingRuleFormValues;
  }
): RoutingRuleWithReadinessItem | null {
  const master = trimLower(input.masterClientAccountId);
  const client = trimLower(input.clientAccountId);
  const location = trimLower(input.destinationSubaccountIdGhl);
  const incomingKey = routingRuleMatchKey(input.matchType, {
    campaignId: input.form.campaignId,
    utmCampaign: input.form.utmCampaign,
  });
  if (!incomingKey) return null;

  return (
    existingRules.find((rule) => {
      if (trimLower(rule.masterClientAccountId) !== master) return false;
      if (trimLower(rule.clientAccountId) !== client) return false;
      if (trimLower(rule.destinationSubaccountIdGhl) !== location) return false;
      if (rule.matchType !== input.matchType) return false;
      return (
        routingRuleMatchKey(rule.matchType as RoutingMatchType, {
          campaignId: rule.campaignId,
          utmCampaign: rule.utmCampaign,
        }) === incomingKey
      );
    }) ?? null
  );
}

export function buildRoutingRuleCreateBody(input: {
  form: AddRoutingRuleFormValues;
  clientAccountId: string;
  clientDisplayName: string;
  destinationSubaccountIdGhl: string | null | undefined;
  defaultMasterClientAccountId: string;
}): { ok: true; body: RoutingRuleCreateBody } | { ok: false; error: string } {
  const master =
    input.form.masterClientAccountId.trim() || input.defaultMasterClientAccountId.trim();
  if (!master) {
    return { ok: false, error: "masterClientAccountId is required (set env or enter manually)." };
  }
  const priority = Number(input.form.priority);
  if (!Number.isFinite(priority)) {
    return { ok: false, error: "Priority must be a number." };
  }

  return {
    ok: true,
    body: {
      masterClientAccountId: master,
      clientAccountId: input.clientAccountId,
      clientDisplayName: input.clientDisplayName,
      destinationSubaccountIdGhl: input.destinationSubaccountIdGhl ?? undefined,
      nicheKey: input.form.nicheKey.trim() || null,
      productType: input.form.productType.trim() || null,
      campaignId: input.form.campaignId.trim() || null,
      campaignName: input.form.campaignName.trim() || null,
      utmCampaign: input.form.utmCampaign.trim() || null,
      matchType: input.form.matchType,
      priority,
      active: true,
    },
  };
}

export function isAddRoutingRuleSubmitBlocked(isPending: boolean): boolean {
  return isPending;
}

/** After API response — clear form only when creation succeeded. */
export function formAfterAddRoutingRuleApiResult(input: {
  currentForm: AddRoutingRuleFormValues;
  clearedForm: AddRoutingRuleFormValues;
  apiOk: boolean;
}): AddRoutingRuleFormValues {
  return input.apiOk ? input.clearedForm : input.currentForm;
}

export type SubmitAddRoutingRuleResult =
  | { status: "duplicate" }
  | { status: "invalid"; error: string }
  | { status: "success"; createBody: RoutingRuleCreateBody; clearedForm: AddRoutingRuleFormValues };

/** Pure submit planning — used by the panel and unit tests. */
export function planAddRoutingRuleSubmit(input: {
  form: AddRoutingRuleFormValues;
  existingRules: RoutingRuleWithReadinessItem[];
  clientAccountId: string;
  clientDisplayName: string;
  destinationSubaccountIdGhl: string | null | undefined;
  defaultMasterClientAccountId: string;
  primaryNicheKey?: string;
  primaryProductType?: string;
}): SubmitAddRoutingRuleResult {
  const duplicate = findEquivalentRoutingRule(input.existingRules, {
    masterClientAccountId:
      input.form.masterClientAccountId.trim() || input.defaultMasterClientAccountId,
    clientAccountId: input.clientAccountId,
    destinationSubaccountIdGhl: input.destinationSubaccountIdGhl,
    matchType: input.form.matchType,
    form: input.form,
  });
  if (duplicate) return { status: "duplicate" };

  const built = buildRoutingRuleCreateBody(input);
  if (!built.ok) return { status: "invalid", error: built.error };

  return {
    status: "success",
    createBody: built.body,
    clearedForm: defaultAddRoutingRuleFormValues({
      defaultMasterClientAccountId: input.defaultMasterClientAccountId,
      primaryNicheKey: input.primaryNicheKey,
      primaryProductType: input.primaryProductType,
    }),
  };
}
