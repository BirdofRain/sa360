/**
 * Operator view of GET /admin/v1/clients/:id/campaign-inventory.
 * The parser drops anything it does not understand instead of inventing a campaign.
 */

export type CampaignInventoryFinding = {
  code: string;
  message: string;
};

export type CampaignInventoryCandidateView = {
  inventoryKey: string;
  evidenceQuality: string;
  grouping: string;
  authorityNote: string;
  nicheKeys: string[];
  productTypes: string[];
  leadTypes: Array<{ key: string; label: string | null }>;
  routingAuthorities: string[];
  exactIdentifiers: Array<{ kind: string; value: string }>;
  sources: Array<{
    id: string;
    provider: string;
    providerFunnelId: string | null;
    parentUrlKey: string | null;
    associationStatus: string;
    originConfirmed: boolean;
    observedFunnelName: string | null;
  }>;
  rules: Array<{
    id: string;
    matchType: string;
    exact: boolean;
    campaignId: string | null;
    active: boolean;
    deliveryEnabled: boolean;
    deliveryMode: string;
    destinationWorkflowIdGhl: string | null;
  }>;
  ghlDefaultWorkflowId: string | null;
  ghlWorkflows: string[];
  sheetsTabTitle: string | null;
  publishedMapVersion: number | null;
  lastSourceEventId: string | null;
  lastSourceEventAt: string | null;
  observedDelivery: {
    anyRuleDeliveryEnabled: boolean;
    anyRuleActive: boolean;
    clientGhlDeliveryEnabled: boolean | null;
    sheetsEnabled: boolean | null;
    sheetsCampaignDispatchEnabled: boolean | null;
  };
  conflicts: string[];
};

export type CampaignInventoryView = {
  candidateCount: number;
  confirmedSourceCount: number;
  suggestedSourceCount: number;
  routingRuleCount: number;
  ambiguities: CampaignInventoryFinding[];
  conflicts: CampaignInventoryFinding[];
  accountNiches: string[];
  ghlLocationId: string | null;
  ghlDeliveryEnabled: boolean | null;
  sheetsTitle: string | null;
  sheetsCampaignTabBound: boolean;
  candidates: CampaignInventoryCandidateView[];
};

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function texts(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const parsed = text(item);
    return parsed ? [parsed] : [];
  });
}

function flag(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function findings(value: unknown): CampaignInventoryFinding[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const row = record(item);
    const code = text(row?.code);
    const message = text(row?.message);
    if (!row || !code || !message) return [];
    return [{ code, message }];
  });
}

function candidate(value: unknown): CampaignInventoryCandidateView | null {
  const row = record(value);
  const inventoryKey = text(row?.inventoryKey);
  if (!row || !inventoryKey) return null;
  const ghl = record(row.ghl);
  const sheets = record(row.sheets);
  const campaignTab = record(sheets?.campaignTab);
  const publishedMap = record(sheets?.publishedMap);
  const last = record(row.lastSourceEvent);
  const delivery = record(row.observedDelivery);
  const sources = Array.isArray(row.sources)
    ? row.sources.flatMap((item) => {
        const source = record(item);
        const id = text(source?.id);
        if (!source || !id) return [];
        return [
          {
            id,
            provider: text(source.provider) ?? "Unknown",
            providerFunnelId: text(source.providerFunnelId),
            parentUrlKey: text(source.parentUrlKey),
            associationStatus: text(source.associationStatus) ?? "Unknown",
            originConfirmed: source.originConfirmed === true,
            observedFunnelName: text(source.observedFunnelName),
          },
        ];
      })
    : [];
  const rules = Array.isArray(row.rules)
    ? row.rules.flatMap((item) => {
        const rule = record(item);
        const id = text(rule?.id);
        if (!rule || !id) return [];
        return [
          {
            id,
            matchType: text(rule.matchType) ?? "Unknown",
            exact: rule.exact === true,
            campaignId: text(rule.campaignId),
            active: rule.active === true,
            deliveryEnabled: rule.deliveryEnabled === true,
            deliveryMode: text(rule.deliveryMode) ?? "Unknown",
            destinationWorkflowIdGhl: text(rule.destinationWorkflowIdGhl),
          },
        ];
      })
    : [];
  const leadTypes = Array.isArray(row.leadTypes)
    ? row.leadTypes.flatMap((item) => {
        const leadType = record(item);
        const key = text(leadType?.key);
        if (!key) return [];
        return [{ key, label: text(leadType?.label) }];
      })
    : [];
  const exactIdentifiers = Array.isArray(row.exactIdentifiers)
    ? row.exactIdentifiers.flatMap((item) => {
        const identifier = record(item);
        const kind = text(identifier?.kind);
        const identifierValue = text(identifier?.value);
        if (!kind || !identifierValue) return [];
        return [{ kind, value: identifierValue }];
      })
    : [];
  return {
    inventoryKey,
    evidenceQuality: text(row.evidenceQuality) ?? "unknown",
    grouping: text(row.grouping) ?? "unknown",
    authorityNote: text(row.authorityNote) ?? "Routing authority was not stated.",
    nicheKeys: texts(row.nicheKeys),
    productTypes: texts(row.productTypes),
    leadTypes,
    routingAuthorities: texts(row.routingAuthorities),
    exactIdentifiers,
    sources,
    rules,
    ghlDefaultWorkflowId: text(ghl?.clientDefaultWorkflowId),
    ghlWorkflows: texts(ghl?.ruleWorkflowIds),
    sheetsTabTitle: text(campaignTab?.worksheetTitle),
    publishedMapVersion: typeof publishedMap?.mapVersion === "number" ? publishedMap.mapVersion : null,
    lastSourceEventId: text(last?.id),
    lastSourceEventAt: text(last?.receivedAt),
    observedDelivery: {
      anyRuleDeliveryEnabled: delivery?.anyRuleDeliveryEnabled === true,
      anyRuleActive: delivery?.anyRuleActive === true,
      clientGhlDeliveryEnabled: flag(delivery?.clientGhlDeliveryEnabled),
      sheetsEnabled: flag(delivery?.sheetsEnabled),
      sheetsCampaignDispatchEnabled: flag(delivery?.sheetsCampaignDispatchEnabled),
    },
    conflicts: texts(row.conflicts),
  };
}

export function parseClientCampaignInventory(value: unknown): CampaignInventoryView | null {
  const body = record(value);
  const summary = record(body?.summary);
  if (!body || body.ok !== true || body.readOnly !== true || !summary) return null;
  if (typeof summary.candidateCount !== "number") return null;
  const parsedCandidates = Array.isArray(body.candidates) ? body.candidates.map(candidate) : null;
  if (!parsedCandidates || parsedCandidates.some((item) => item == null)) return null;
  const account = record(body.accountClassification);
  const ghl = record(body.ghlDestination);
  const sheets = record(body.sheetsDestination);
  return {
    candidateCount: summary.candidateCount,
    confirmedSourceCount: typeof summary.confirmedSourceCount === "number" ? summary.confirmedSourceCount : 0,
    suggestedSourceCount: typeof summary.suggestedSourceCount === "number" ? summary.suggestedSourceCount : 0,
    routingRuleCount: typeof summary.routingRuleCount === "number" ? summary.routingRuleCount : 0,
    ambiguities: findings(body.ambiguities),
    conflicts: findings(body.conflicts),
    accountNiches: texts(account?.primaryNicheKeys),
    ghlLocationId: text(ghl?.locationId),
    ghlDeliveryEnabled: flag(ghl?.deliveryEnabled),
    sheetsTitle: text(sheets?.spreadsheetTitle),
    sheetsCampaignTabBound: sheets?.campaignTabBound === true,
    candidates: parsedCandidates.filter((item): item is CampaignInventoryCandidateView => item != null),
  };
}

export function campaignInventoryEvidenceLabel(quality: string): string {
  if (quality === "high") return "High";
  if (quality === "partial") return "Partial";
  if (quality === "low") return "Low";
  if (quality === "conflicting") return "Conflicting";
  return "Unknown";
}
