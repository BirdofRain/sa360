import { facebookFormProviderFunnelId, parseFacebookFormProviderFunnelId } from "./facebook-form-association.js";

/**
 * Read-only reconciliation of Meta Page + Form evidence with existing
 * ClientAccount, SourceFunnel, and CampaignRoutingRule rows.
 *
 * A candidate registry and a Graph discovery result are evidence. Neither one
 * creates a client or overwrites a confirmed SourceFunnel origin. A routing
 * rule is commercial configuration, not source ownership.
 */

export type MetaFormEvidenceOrigin = "graph" | "candidate" | "source_funnel";

export type MetaFormEvidence = {
  pageId: string;
  formId: string;
  formName?: string | null;
  formStatus?: string | null;
  campaignId?: string | null;
  campaignIds?: string[] | null;
  campaignName?: string | null;
  adsetId?: string | null;
  adId?: string | null;
  adAccountId?: string | null;
  origins: MetaFormEvidenceOrigin[];
};

export type MetaFunnelRecord = {
  id: string;
  providerFunnelId: string | null;
  originClientAccountId: string | null;
  suggestedClientAccountId: string | null;
  observedFunnelName: string | null;
};

export type MetaClientName = {
  clientAccountId: string;
  clientDisplayName: string;
};

export type MetaRoutingRuleRecord = {
  id: string;
  formId: string | null;
  campaignId: string | null;
  clientAccountId: string;
  active: boolean;
};

export type MetaCaptureReconciliation = {
  pageId: string;
  formId: string;
  providerFunnelId: string;
  formName: string | null;
  formStatus: string | null;
  campaignId: string | null;
  campaignIds: string[];
  sharedAcrossCampaigns: boolean;
  pageFormIdentifiesOneClient: false;
  campaignName: string | null;
  adsetId: string | null;
  adId: string | null;
  adAccountId: string | null;
  origins: MetaFormEvidenceOrigin[];
  association: "confirmed" | "suggested_not_authority" | "unassociated";
  clientAccountId: string | null;
  clientDisplayName: string | null;
  sourceFunnelId: string | null;
  ownershipAuthority: "source_funnel_origin" | "none";
  candidateEvidence: boolean;
  routingRuleIds: string[];
  routingNote: "routing_rule_present_not_ownership" | "no_routing_rule";
  createsClient: false;
  overwritesConfirmedAssociation: false;
};

function text(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function rememberCampaigns(target: MetaFormEvidence, source: MetaFormEvidence): void {
  const ids = new Set(target.campaignIds ?? []);
  for (const id of [target.campaignId, source.campaignId, ...(source.campaignIds ?? [])]) {
    const value = text(id);
    if (value) ids.add(value);
  }
  target.campaignIds = [...ids].sort();
  if (!text(target.campaignId) && target.campaignIds[0]) target.campaignId = target.campaignIds[0];
}

function mergeEvidence(items: MetaFormEvidence[]): MetaFormEvidence[] {
  const byKey = new Map<string, MetaFormEvidence>();
  for (const item of items) {
    const pageId = text(item.pageId);
    const formId = text(item.formId);
    if (!pageId || !formId) continue;
    const key = `${pageId}:${formId}`;
    const existing = byKey.get(key);
    if (!existing) {
      const created: MetaFormEvidence = {
        ...item,
        pageId,
        formId,
        origins: [...new Set(item.origins)],
      };
      rememberCampaigns(created, item);
      byKey.set(key, created);
      continue;
    }
    existing.origins = [...new Set([...existing.origins, ...item.origins])];
    existing.formName = existing.formName ?? item.formName;
    existing.formStatus = existing.formStatus ?? item.formStatus;
    rememberCampaigns(existing, item);
    existing.campaignName = existing.campaignName ?? item.campaignName;
    existing.adsetId = existing.adsetId ?? item.adsetId;
    existing.adId = existing.adId ?? item.adId;
    existing.adAccountId = existing.adAccountId ?? item.adAccountId;
  }
  return [...byKey.values()];
}

export function reconcileMetaCaptureForms(input: {
  evidence: MetaFormEvidence[];
  funnels: MetaFunnelRecord[];
  clients: MetaClientName[];
  routingRules: MetaRoutingRuleRecord[];
}): MetaCaptureReconciliation[] {
  const funnelsByKey = new Map<string, MetaFunnelRecord>();
  const evidence = mergeEvidence(input.evidence);
  for (const funnel of input.funnels) {
    const parsed = parseFacebookFormProviderFunnelId(funnel.providerFunnelId);
    if (!parsed) continue;
    funnelsByKey.set(`${parsed.pageId}:${parsed.formId}`, funnel);
    if (!evidence.some((item) => item.pageId === parsed.pageId && item.formId === parsed.formId)) {
      evidence.push({
        pageId: parsed.pageId,
        formId: parsed.formId,
        formName: funnel.observedFunnelName,
        origins: ["source_funnel"],
      });
    } else {
      const match = evidence.find((item) => item.pageId === parsed.pageId && item.formId === parsed.formId);
      if (match && !match.origins.includes("source_funnel")) match.origins.push("source_funnel");
      if (match && !match.formName) match.formName = funnel.observedFunnelName;
    }
  }
  const names = new Map(input.clients.map((client) => [client.clientAccountId, client.clientDisplayName]));
  return evidence
    .map((item) => {
      const funnel = funnelsByKey.get(`${item.pageId}:${item.formId}`) ?? null;
      const origin = text(funnel?.originClientAccountId);
      const suggested = text(funnel?.suggestedClientAccountId);
      const association: MetaCaptureReconciliation["association"] = origin
        ? "confirmed"
        : suggested
          ? "suggested_not_authority"
          : "unassociated";
      const clientAccountId = origin ?? null;
      const campaignIds = [...(item.campaignIds ?? [])].sort();
      const campaignId: string | null = text(item.campaignId) ?? campaignIds[0] ?? null;
      const routingRuleIds = input.routingRules
        .filter((rule) => rule.active)
        .filter((rule) => {
          const formMatch = text(rule.formId) === item.formId;
          const ruleCampaign = text(rule.campaignId);
          const campaignMatch = ruleCampaign !== null && campaignIds.includes(ruleCampaign);
          return formMatch || campaignMatch;
        })
        .map((rule) => rule.id);
      return {
        pageId: item.pageId,
        formId: item.formId,
        providerFunnelId: facebookFormProviderFunnelId(item.pageId, item.formId),
        formName: text(item.formName),
        formStatus: text(item.formStatus),
        campaignId,
        campaignIds,
        sharedAcrossCampaigns: campaignIds.length > 1,
        pageFormIdentifiesOneClient: false as const,
        campaignName: text(item.campaignName),
        adsetId: text(item.adsetId),
        adId: text(item.adId),
        adAccountId: text(item.adAccountId),
        origins: item.origins,
        association,
        clientAccountId,
        clientDisplayName: clientAccountId ? names.get(clientAccountId) ?? null : null,
        sourceFunnelId: funnel?.id ?? null,
        ownershipAuthority: (origin ? "source_funnel_origin" : "none") as MetaCaptureReconciliation["ownershipAuthority"],
        candidateEvidence: item.origins.includes("candidate"),
        routingRuleIds,
        routingNote: (routingRuleIds.length > 0
          ? "routing_rule_present_not_ownership"
          : "no_routing_rule") as MetaCaptureReconciliation["routingNote"],
        createsClient: false as const,
        overwritesConfirmedAssociation: false as const,
      };
    })
    .sort((a, b) => a.pageId.localeCompare(b.pageId) || a.formId.localeCompare(b.formId));
}
