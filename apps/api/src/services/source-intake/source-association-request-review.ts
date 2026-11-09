/**
 * Read-only comparison of a saved source/campaign request with the registries
 * that already exist.
 *
 * This does not confirm a SourceFunnel, stamp inventory, or create a
 * CampaignRoutingRule. Confirmed source association is already a live routing
 * authority, and a new routing rule is active unless a caller forces it off.
 * Neither write is a nonoperational association.
 */

export type SourceAssociationRequestStatus = "saved" | "rejected";

export type KnownSourceFunnel = {
  id: string;
  provider: string;
  providerFunnelId: string | null;
  parentUrlKey: string | null;
  pageSlug: string | null;
  associationStatus: string;
  originClientAccountId: string | null;
  suggestedClientAccountId: string | null;
};

export type KnownCampaignRule = {
  id: string;
  clientAccountId: string;
  campaignId: string | null;
  active: boolean;
  deliveryEnabled: boolean;
  effectiveStart?: Date | null;
  effectiveEnd?: Date | null;
};

export type SourceRegistryStatus =
  | "incomplete"
  | "not_registered"
  | "registered_unconfirmed"
  | "confirmed_for_client"
  | "confirmed_for_other_client"
  | "ambiguous";

export type CampaignRegistryStatus =
  | "incomplete"
  | "no_matching_rule"
  | "inactive_rule_only"
  | "live_routing_rule";

export type SourceCampaignRequestReview = {
  requestDisposition: "incomplete" | "saved_request" | "rejected" | "stale" | "duplicate_request";
  /** A saved request is never applied by this review. */
  canApply: false;
  snapshotCurrent: boolean;
  sourceStatus: SourceRegistryStatus;
  campaignStatus: CampaignRegistryStatus;
  /** True only when a loaded funnel is already confirmed to this client. */
  sourceAssociated: boolean;
  /** True only when a matching campaign rule has delivery enabled. Routing can still be live when this is false. */
  deliveryActivated: boolean;
  matchedSourceFunnelIds: string[];
  matchedRuleIds: string[];
  originClientAccountId: string | null;
  associationWrite: false;
  routingRuleWrite: false;
  blockers: string[];
};

export type SourceCampaignRequestReviewInput = {
  clientAccountId: string;
  requestId: string | null;
  seenRequestIds?: string[];
  requestStatus: SourceAssociationRequestStatus;
  loadedRevision: number;
  currentRevision: number;
  providerFunnelId?: string | null;
  parentUrlKey?: string | null;
  pageSlug?: string | null;
  providerCampaignId?: string | null;
  funnels: KnownSourceFunnel[];
  rules: KnownCampaignRule[];
  now?: Date;
};

function text(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function ruleIsLive(rule: KnownCampaignRule, now: Date): boolean {
  if (!rule.active) return false;
  if (rule.effectiveStart && rule.effectiveStart > now) return false;
  if (rule.effectiveEnd && rule.effectiveEnd < now) return false;
  return true;
}

function confirmedOrigin(funnel: KnownSourceFunnel): string | null {
  if (funnel.associationStatus !== "confirmed") return null;
  const origin = text(funnel.originClientAccountId);
  return origin || null;
}

function funnelMatches(funnel: KnownSourceFunnel, providerFunnelId: string, parentUrlKey: string): boolean {
  const funnelId = text(funnel.providerFunnelId);
  const funnelUrl = text(funnel.parentUrlKey);
  if (providerFunnelId && funnelId === providerFunnelId) return true;
  if (parentUrlKey && funnelUrl === parentUrlKey) return true;
  return false;
}

function blocked(partial: Omit<SourceCampaignRequestReview, "canApply" | "associationWrite" | "routingRuleWrite">): SourceCampaignRequestReview {
  return { ...partial, canApply: false, associationWrite: false, routingRuleWrite: false };
}

export function reviewSavedSourceCampaignRequest(input: SourceCampaignRequestReviewInput): SourceCampaignRequestReview {
  const clientAccountId = text(input.clientAccountId);
  const requestId = text(input.requestId);
  const providerFunnelId = text(input.providerFunnelId);
  const parentUrlKey = text(input.parentUrlKey);
  const pageSlug = text(input.pageSlug);
  const providerCampaignId = text(input.providerCampaignId);
  const now = input.now ?? new Date();
  const snapshotCurrent = input.loadedRevision === input.currentRevision;
  const duplicateRequest = Boolean(requestId && input.seenRequestIds?.some((id) => text(id) === requestId));
  const blockers: string[] = [];

  let requestDisposition: SourceCampaignRequestReview["requestDisposition"] = "saved_request";
  if (!clientAccountId) requestDisposition = "incomplete";
  else if (duplicateRequest) requestDisposition = "duplicate_request";
  else if (!snapshotCurrent) requestDisposition = "stale";
  else if (input.requestStatus === "rejected") requestDisposition = "rejected";

  if (!clientAccountId) blockers.push("A client id is required before a source can be reviewed.");
  if (duplicateRequest) blockers.push("This request id was already reviewed. Start a new request instead of applying it again.");
  if (!snapshotCurrent) blockers.push("The source list changed after it was loaded. Reload before reviewing it again.");
  if (input.requestStatus === "rejected") blockers.push("This request was rejected. It does not change source ownership or routing.");

  const identityPresent = Boolean(providerFunnelId || parentUrlKey);
  let sourceStatus: SourceRegistryStatus = "incomplete";
  let matchedFunnels: KnownSourceFunnel[] = [];
  if (!identityPresent) {
    blockers.push(pageSlug ? "A page slug alone is not a source identity." : "Enter a source funnel id or a canonical page URL before associating a source.");
  } else {
    matchedFunnels = input.funnels.filter((funnel) => funnelMatches(funnel, providerFunnelId, parentUrlKey));
    const providers = new Set(matchedFunnels.map((funnel) => text(funnel.provider)).filter(Boolean));
    const origins = matchedFunnels.map(confirmedOrigin).filter((origin): origin is string => Boolean(origin));
    const uniqueOrigins = new Set(origins);
    if (matchedFunnels.length === 0) sourceStatus = "not_registered";
    else if (providers.size > 1 || uniqueOrigins.size > 1) sourceStatus = "ambiguous";
    else if (origins.length === 1 && origins[0] === clientAccountId) sourceStatus = "confirmed_for_client";
    else if (origins.length === 1) sourceStatus = "confirmed_for_other_client";
    else sourceStatus = "registered_unconfirmed";
    if (providerFunnelId && parentUrlKey) {
      const byId = matchedFunnels.filter((funnel) => text(funnel.providerFunnelId) === providerFunnelId);
      const byUrl = matchedFunnels.filter((funnel) => text(funnel.parentUrlKey) === parentUrlKey);
      const idSet = new Set(byId.map((funnel) => funnel.id));
      const urlSet = new Set(byUrl.map((funnel) => funnel.id));
      const bothFound = byId.length > 0 && byUrl.length > 0;
      const sameRows = bothFound && [...idSet].every((id) => urlSet.has(id)) && [...urlSet].every((id) => idSet.has(id));
      if ((byId.length > 0 || byUrl.length > 0) && !sameRows) sourceStatus = "ambiguous";
    }
  }

  if (sourceStatus === "not_registered") blockers.push("That source is not in the registry. Registering it by confirming ownership would stamp lead inventory and can route later leads.");
  if (sourceStatus === "registered_unconfirmed") blockers.push("This source is registered but not confirmed. A suggestion is not a verified association and is not routing authority.");
  if (sourceStatus === "confirmed_for_other_client") blockers.push("This source is already confirmed to another client. Reassignment rewrites inventory origin and is not a setup request.");
  if (sourceStatus === "ambiguous") blockers.push("The source id and page URL do not point at one confirmed owner.");
  if (sourceStatus === "confirmed_for_client") blockers.push("This source is already confirmed to this client. Confirming it again is not required, and this review does not write.");

  let campaignStatus: CampaignRegistryStatus = "incomplete";
  let matchedRules: KnownCampaignRule[] = [];
  if (!providerCampaignId) {
    blockers.push("Enter a campaign id before reviewing campaign mapping.");
  } else {
    matchedRules = input.rules.filter((rule) => text(rule.campaignId) === providerCampaignId);
    const live = matchedRules.filter((rule) => ruleIsLive(rule, now));
    if (live.length > 0) campaignStatus = "live_routing_rule";
    else if (matchedRules.length > 0) campaignStatus = "inactive_rule_only";
    else campaignStatus = "no_matching_rule";
  }

  if (campaignStatus === "no_matching_rule") blockers.push("No routing rule uses this campaign id. Creating one would insert a live CampaignRoutingRule, which defaults to active.");
  if (campaignStatus === "inactive_rule_only") blockers.push("An inactive routing rule is still a CampaignRoutingRule. This review does not create or activate one. Delivery off is not the same as routing off.");
  if (campaignStatus === "live_routing_rule") {
    const otherOwner = matchedRules.some((rule) => ruleIsLive(rule, now) && text(rule.clientAccountId) !== clientAccountId);
    blockers.push(
      otherOwner
        ? "This campaign id already matches a live routing rule for another client. Existing rules are left unchanged."
        : "This campaign id already matches a live routing rule. An active rule is routing even when delivery is off. Existing rules are left unchanged."
    );
  }

  const deliveryActivated = matchedRules.some((rule) => ruleIsLive(rule, now) && rule.deliveryEnabled);
  if (sourceStatus === "confirmed_for_client" && !deliveryActivated) {
    blockers.push("Source associated and delivery activated are different. This confirmed source does not turn delivery on.");
  }

  return blocked({
    requestDisposition,
    snapshotCurrent,
    sourceStatus,
    campaignStatus,
    sourceAssociated: sourceStatus === "confirmed_for_client" && snapshotCurrent && !duplicateRequest,
    deliveryActivated,
    matchedSourceFunnelIds: matchedFunnels.map((funnel) => funnel.id),
    matchedRuleIds: matchedRules.map((rule) => rule.id),
    originClientAccountId: sourceStatus === "confirmed_for_client" || sourceStatus === "confirmed_for_other_client"
      ? confirmedOrigin(matchedFunnels.find((funnel) => confirmedOrigin(funnel)) ?? matchedFunnels[0]!) ?? null
      : null,
    blockers,
  });
}
