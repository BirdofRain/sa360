import type { RoutingRuleCreateBody, RoutingMatchType } from "@/lib/clients/types";
import type { RoutingRuleWithReadinessItem } from "@/lib/delivery-readiness/types";

export const DUPLICATE_ROUTING_RULE_MESSAGE = "A matching routing rule already exists.";

/** Known source/master intake accounts. masterClientAccountId is the source, NOT the destination client. */
export const LEADCAPTURE_MASTER_CLIENT_ACCOUNT_ID = "leadcapture_io";
export const LAL_MASTER_VET_MASTER_CLIENT_ACCOUNT_ID = "lal_master_vet";

export const ROUTING_RULE_MASTER_HELPER_TEXT =
  "This is the source/master intake account, not the destination client. Use leadcapture_io for LeadCapture campaigns and lal_master_vet for legacy Master Vet GHL/Facebook lifecycle events.";

/** Source selector options for the Add Routing Rule form. */
export type RoutingRuleSourceOption = "leadcapture_io" | "lal_master_vet" | "custom";

export type AddRoutingRuleFormValues = {
  sourceOption: RoutingRuleSourceOption;
  masterClientAccountId: string;
  matchType: RoutingMatchType;
  priority: string;
  nicheKey: string;
  productType: string;
  campaignId: string;
  campaignName: string;
  utmCampaign: string;
};

function normLower(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

/** Map a chosen source option to its master/source intake account id ("" for custom). */
export function masterClientAccountIdForSourceOption(option: RoutingRuleSourceOption): string {
  if (option === "leadcapture_io") return LEADCAPTURE_MASTER_CLIENT_ACCOUNT_ID;
  if (option === "lal_master_vet") return LAL_MASTER_VET_MASTER_CLIENT_ACCOUNT_ID;
  return "";
}

/** Reverse map: classify a master/source intake account id into a source option. */
export function sourceOptionForMasterClientAccountId(
  masterClientAccountId: string | null | undefined
): RoutingRuleSourceOption {
  const m = normLower(masterClientAccountId);
  if (m === LEADCAPTURE_MASTER_CLIENT_ACCOUNT_ID) return "leadcapture_io";
  if (m === LAL_MASTER_VET_MASTER_CLIENT_ACCOUNT_ID) return "lal_master_vet";
  return "custom";
}

export type RoutingRuleSourceContext = {
  sourceProvider?: string | null;
  sourcePlatform?: string | null;
  sourceSystem?: string | null;
  /** Master/source ids already used by this client's existing routing rules (inference hint). */
  existingMasterClientAccountIds?: Array<string | null | undefined>;
};

/**
 * Resolve the default source/master for a new routing rule from source context — never a global
 * hardcoded default. LeadCapture providers/systems → leadcapture_io; GHL/Facebook/Master Vet
 * lifecycle → lal_master_vet; a single consistent existing-rule master → that master; otherwise
 * unknown → blank + "custom" so the operator must choose explicitly.
 */
export function resolveRoutingRuleSourceDefault(ctx: RoutingRuleSourceContext): {
  sourceOption: RoutingRuleSourceOption;
  masterClientAccountId: string;
} {
  const provider = normLower(ctx.sourceProvider) || normLower(ctx.sourcePlatform);
  const system = normLower(ctx.sourceSystem);

  if (provider === LEADCAPTURE_MASTER_CLIENT_ACCOUNT_ID || system.startsWith("leadcapture_io")) {
    return {
      sourceOption: "leadcapture_io",
      masterClientAccountId: LEADCAPTURE_MASTER_CLIENT_ACCOUNT_ID,
    };
  }
  if (
    provider === "ghl" ||
    provider === "ghl_lifecycle" ||
    provider === "facebook" ||
    provider === "meta" ||
    system === "m1a" ||
    system === "master_vet" ||
    system === "lal_master_vet"
  ) {
    return {
      sourceOption: "lal_master_vet",
      masterClientAccountId: LAL_MASTER_VET_MASTER_CLIENT_ACCOUNT_ID,
    };
  }

  const masters = [
    ...new Set((ctx.existingMasterClientAccountIds ?? []).map(normLower).filter(Boolean)),
  ];
  if (masters.length === 1) {
    const existing = masters[0]!;
    const option = sourceOptionForMasterClientAccountId(existing);
    return {
      sourceOption: option,
      masterClientAccountId: option === "custom" ? existing : masterClientAccountIdForSourceOption(option),
    };
  }

  // Unknown / mixed context — do NOT silently default to a master account.
  return { sourceOption: "custom", masterClientAccountId: "" };
}

export function defaultAddRoutingRuleFormValues(input: {
  defaultMasterClientAccountId: string;
  primaryNicheKey?: string;
  primaryProductType?: string;
  defaultPriority?: number;
}): AddRoutingRuleFormValues {
  return {
    sourceOption: sourceOptionForMasterClientAccountId(input.defaultMasterClientAccountId),
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
