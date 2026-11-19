/**
 * Read-only campaign inventory for one ClientAccount.
 *
 * Candidates are grouped only by exact identifiers (campaign id, form id,
 * ad set id, ad id, provider funnel id, parent URL key). Display names, UTM
 * text, keyword patterns, niche, product, and Lead Type are shown and never
 * used as ownership. This module does not write, confirm a source, or create
 * a routing rule.
 */

import type { CampaignRoutingMatchType } from "@prisma/client";
import { campaignLeadTypeLabel, isCampaignLeadTypeKey } from "@sa360/shared";

import { isExactRoutingRuleMatchType } from "../routing-matcher.service.js";

export type InventoryEvidenceQuality = "high" | "partial" | "low" | "conflicting";

export type InventoryGrouping =
  | "exact_identifier"
  | "confirmed_source"
  | "suggested_source"
  | "exact_rule"
  | "loose_rule";

export type InventoryExactKind = "campaign_id" | "adset_id" | "ad_id" | "form_id" | "provider_funnel_id" | "parent_url_key";

export type InventorySource = {
  id: string;
  provider: string;
  providerFunnelId: string | null;
  parentUrlKey: string | null;
  pageSlug: string | null;
  observedFunnelName: string | null;
  nicheKey: string | null;
  associationStatus: "confirmed" | "suggested" | "unassociated";
  originClientAccountId: string | null;
  suggestedClientAccountId: string | null;
  leadTypeKey: string | null;
  lastSeenAt: string | null;
};

export type InventoryRule = {
  id: string;
  clientAccountId: string;
  matchType: CampaignRoutingMatchType;
  campaignId: string | null;
  campaignName: string | null;
  adsetId: string | null;
  adId: string | null;
  formId: string | null;
  utmCampaign: string | null;
  keywordPattern: string | null;
  nicheKey: string | null;
  productType: string | null;
  active: boolean;
  priority: number;
  deliveryEnabled: boolean;
  shadowDeliveryEnabled: boolean;
  deliveryMode: string;
  destinationWorkflowIdGhl: string | null;
  destinationSubaccountIdGhl: string | null;
};

export type InventoryOtherRule = {
  id: string;
  clientAccountId: string;
  matchType: CampaignRoutingMatchType;
  campaignId: string | null;
  adsetId: string | null;
  adId: string | null;
  formId: string | null;
};

export type InventoryAssociationRequest = {
  id: string;
  revision: number;
  status: string;
  providerFunnelId: string | null;
  parentUrlKey: string | null;
  providerCampaignId: string;
};

export type InventorySetup =
  | {
      readable: true;
      revision: number;
      status: string;
      providerFunnelId: string | null;
      parentUrlKey: string | null;
      providerCampaignId: string | null;
    }
  | {
      readable: false;
      revision: number;
      status: string;
    };

export type InventoryGhlDestination = {
  locationId: string;
  locationName: string | null;
  defaultWorkflowId: string | null;
  deliveryEnabled: boolean;
  deliveryMode: string;
  workflowTriggerMode: string;
};

export type InventoryColumnMap = {
  spreadsheetId: string;
  worksheetId: number;
  mapVersion: number;
  status: string;
  publishedAt: string | null;
  retiredAt: string | null;
};

export type InventorySheetsDestination = {
  spreadsheetId: string;
  spreadsheetTitle: string | null;
  spreadsheetUrl: string;
  worksheetId: number;
  worksheetTitle: string;
  enabled: boolean;
  campaignDispatchEnabled: boolean;
  deliveryExecution: string;
  accessStatus: string;
  writeReadiness: string;
  tabs: Array<{
    role: string;
    setupState: string;
    worksheetId: number | null;
    worksheetTitle: string | null;
  }>;
  columnMaps: InventoryColumnMap[];
};

export type InventorySourceEvent = {
  id: string;
  receivedAt: string;
  status: string;
  sourceCampaignId: string | null;
  sourceRouteKey: string | null;
  routingRuleIdResolved: string | null;
  clientAccountIdResolved: string | null;
};

export type ClientCampaignInventoryInput = {
  clientAccountId: string;
  primaryNicheKeys: string[];
  primaryProductTypes: string[];
  sources: InventorySource[];
  rules: InventoryRule[];
  otherClientRules: InventoryOtherRule[];
  associationRequest: InventoryAssociationRequest | null;
  setup: InventorySetup | null;
  ghl: InventoryGhlDestination | null;
  sheets: InventorySheetsDestination | null;
  sourceEvents: InventorySourceEvent[];
  foreignSourceEvents: InventorySourceEvent[];
  sourceEventLookupCapped: boolean;
  now?: Date;
};

export type InventoryFinding = {
  code: string;
  message: string;
  candidateKeys: string[];
};

export type CampaignCandidate = {
  inventoryKey: string;
  evidenceQuality: InventoryEvidenceQuality;
  grouping: InventoryGrouping;
  sources: Array<{
    id: string;
    provider: string;
    providerFunnelId: string | null;
    parentUrlKey: string | null;
    pageSlug: string | null;
    observedFunnelName: string | null;
    displayNameIsNotOwnership: true;
    nicheKey: string | null;
    associationStatus: InventorySource["associationStatus"];
    originConfirmed: boolean;
    leadTypeKey: string | null;
    leadTypeLabel: string | null;
    lastSeenAt: string | null;
  }>;
  rules: Array<{
    id: string;
    matchType: CampaignRoutingMatchType;
    exact: boolean;
    campaignId: string | null;
    campaignName: string | null;
    displayNameIsNotOwnership: true;
    adsetId: string | null;
    adId: string | null;
    formId: string | null;
    utmCampaign: string | null;
    keywordPattern: string | null;
    nicheKey: string | null;
    productType: string | null;
    active: boolean;
    priority: number;
    deliveryEnabled: boolean;
    shadowDeliveryEnabled: boolean;
    deliveryMode: string;
    destinationWorkflowIdGhl: string | null;
    destinationSubaccountIdGhl: string | null;
  }>;
  nicheKeys: string[];
  productTypes: string[];
  leadTypes: Array<{ key: string; label: string | null }>;
  routingAuthorities: Array<"exact_routing_rule" | "confirmed_source_association" | "loose_routing_rule">;
  authorityNote: string;
  exactIdentifiers: Array<{ kind: InventoryExactKind; value: string }>;
  ghl: {
    scope: "client_shared";
    locationId: string | null;
    locationName: string | null;
    clientDefaultWorkflowId: string | null;
    ruleWorkflowIds: string[];
    clientDeliveryEnabled: boolean | null;
    clientDeliveryMode: string | null;
    workflowTriggerMode: string | null;
  };
  sheets: {
    scope: "client_shared";
    configured: boolean;
    spreadsheetId: string | null;
    spreadsheetTitle: string | null;
    baseWorksheetId: number | null;
    baseWorksheetTitle: string | null;
    campaignTab: { setupState: string; worksheetId: number | null; worksheetTitle: string | null } | null;
    publishedMap: { mapVersion: number; worksheetId: number; status: "published" } | null;
    draftMapPresent: boolean;
    enabled: boolean | null;
    campaignDispatchEnabled: boolean | null;
    deliveryExecution: string | null;
    accessStatus: string | null;
    writeReadiness: string | null;
  };
  lastSourceEvent: {
    id: string;
    receivedAt: string;
    status: string;
    sourceCampaignId: string | null;
    sourceRouteKey: string | null;
    routingRuleIdResolved: string | null;
  } | null;
  observedDelivery: {
    anyRuleDeliveryEnabled: boolean;
    anyRuleActive: boolean;
    clientGhlDeliveryEnabled: boolean | null;
    sheetsEnabled: boolean | null;
    sheetsCampaignDispatchEnabled: boolean | null;
  };
  requestEvidence: { id: string; providerCampaignId: string; joined: false } | null;
  setupRequestMatchesCampaignId: boolean;
  conflicts: string[];
};

export type ClientCampaignInventory = {
  ok: true;
  readOnly: true;
  writesPerformed: false;
  clientAccountId: string;
  generatedAt: string;
  sourceEventLookupCapped: boolean;
  accountClassification: {
    primaryNicheKeys: string[];
    primaryProductTypes: string[];
    note: "Account classification is not a campaign and was not used to group sources.";
  };
  summary: {
    candidateCount: number;
    confirmedSourceCount: number;
    suggestedSourceCount: number;
    routingRuleCount: number;
    exactRuleCount: number;
    looseRuleCount: number;
  };
  ambiguities: InventoryFinding[];
  conflicts: InventoryFinding[];
  setupRequest: {
    revision: number;
    status: string;
    readable: boolean;
    providerFunnelId: string | null;
    parentUrlKey: string | null;
    providerCampaignId: string | null;
    operational: false;
  } | null;
  associationRequest: {
    id: string;
    revision: number;
    status: string;
    providerFunnelId: string | null;
    parentUrlKey: string | null;
    providerCampaignId: string;
    operational: false;
  } | null;
  ghlDestination: InventoryGhlDestination | null;
  sheetsDestination: {
    spreadsheetId: string;
    spreadsheetTitle: string | null;
    spreadsheetUrl: string;
    worksheetId: number;
    worksheetTitle: string;
    enabled: boolean;
    campaignDispatchEnabled: boolean;
    deliveryExecution: string;
    accessStatus: string;
    writeReadiness: string;
    campaignTabBound: boolean;
  } | null;
  candidates: CampaignCandidate[];
};

const FINDING_MESSAGES: Record<string, string> = {
  overlapping_exact_identifiers: "More than one rule or source uses the same exact identifier.",
  exact_identifier_on_other_client: "The same exact identifier is also stored on another client.",
  multiple_sources_in_candidate: "More than one source shares an exact identifier in this candidate.",
  classification_disagreement: "Niche, product, or Lead Type values on the joined records do not agree. None was chosen.",
  unknown_lead_type: "A source has a Lead Type key outside the controlled catalog.",
  missing_origin_confirmation: "No confirmed source origin is in this candidate. A suggestion or a routing rule is not origin confirmation.",
  absent_campaign_id: "No exact campaign id is stored for this candidate.",
  missing_lead_type: "No known Lead Type is stored. Lead Type was not inferred from niche, product, or URL.",
  missing_niche: "No niche is stored on the source or routing rule.",
  missing_product: "No product is stored on a routing rule for this candidate.",
  loose_rule_not_grouped: "This UTM or keyword rule was kept separate. Display name, UTM text, keyword, and niche were not used as ownership.",
  association_request_not_a_join: "The saved association request names records that do not share an exact identifier. The request was not treated as a link.",
  source_event_resolved_to_other_client: "A source event with this exact identifier was resolved to another client.",
  missing_ghl_destination: "No GoHighLevel destination is stored for this client.",
  missing_ghl_workflow: "No client default workflow and no rule workflow id are stored.",
  missing_sheets_destination: "No Company Sheets destination is stored for this client.",
  missing_sheets_campaign_tab: "No bound campaign tab contract is stored. The client worksheet was not assigned to a campaign.",
  missing_sheets_published_map: "No published column map is stored for the worksheet this inventory can see.",
  multiple_source_candidates: "This client has more than one source-backed candidate. They were not merged by niche, product, display name, or UTM.",
  single_setup_request_for_many_candidates: "Client setup stores one requested campaign id. It cannot represent every candidate.",
  association_request_unmatched: "The open association request does not match a source or an exact campaign id on this client.",
  setup_request_unreadable: "The saved setup request could not be read. It was not treated as empty.",
};

const HARD_CONFLICTS = new Set([
  "overlapping_exact_identifiers",
  "exact_identifier_on_other_client",
  "multiple_sources_in_candidate",
  "classification_disagreement",
  "unknown_lead_type",
  "source_event_resolved_to_other_client",
  "association_request_not_a_join",
]);

const ACCOUNT_CLASSIFICATION_NOTE =
  "Account classification is not a campaign and was not used to group sources." as const;

function text(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function distinctStored(values: Array<string | null | undefined>): string[] {
  const seen = new Map<string, string>();
  for (const value of values) {
    const trimmed = text(value);
    if (!trimmed) continue;
    const token = trimmed.toLowerCase();
    if (!seen.has(token)) seen.set(token, trimmed);
  }
  return [...seen.values()].sort((left, right) => left.localeCompare(right));
}

export function exactIdentifierForRule(rule: {
  matchType: CampaignRoutingMatchType;
  campaignId?: string | null;
  adsetId?: string | null;
  adId?: string | null;
  formId?: string | null;
}): { kind: "campaign_id" | "adset_id" | "ad_id" | "form_id"; value: string } | null {
  if (!isExactRoutingRuleMatchType(rule.matchType)) return null;
  if (rule.matchType === "campaign_id") {
    const value = text(rule.campaignId);
    return value ? { kind: "campaign_id", value } : null;
  }
  if (rule.matchType === "adset_id") {
    const value = text(rule.adsetId);
    return value ? { kind: "adset_id", value } : null;
  }
  if (rule.matchType === "ad_id") {
    const value = text(rule.adId);
    return value ? { kind: "ad_id", value } : null;
  }
  const value = text(rule.formId);
  return value ? { kind: "form_id", value } : null;
}

function sourceNode(id: string): string {
  return `source:${id}`;
}

function ruleNode(id: string): string {
  return `rule:${id}`;
}

function createUnion() {
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    const current = parent.get(id);
    if (!current) {
      parent.set(id, id);
      return id;
    }
    if (current === id) return id;
    const root = find(current);
    parent.set(id, root);
    return root;
  };
  const unite = (left: string, right: string) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent.set(leftRoot, rightRoot);
  };
  return { find, unite };
}

function leadTypePresentation(key: string | null): { key: string; label: string | null } | null {
  const trimmed = text(key);
  if (!trimmed) return null;
  if (isCampaignLeadTypeKey(trimmed)) return { key: trimmed, label: campaignLeadTypeLabel(trimmed) };
  return { key: trimmed, label: null };
}

function sheetsView(sheets: InventorySheetsDestination | null): CampaignCandidate["sheets"] {
  if (!sheets) {
    return {
      scope: "client_shared",
      configured: false,
      spreadsheetId: null,
      spreadsheetTitle: null,
      baseWorksheetId: null,
      baseWorksheetTitle: null,
      campaignTab: null,
      publishedMap: null,
      draftMapPresent: false,
      enabled: null,
      campaignDispatchEnabled: null,
      deliveryExecution: null,
      accessStatus: null,
      writeReadiness: null,
    };
  }
  const campaignTab = sheets.tabs.find((tab) => tab.role === "campaign" && tab.setupState === "bound") ?? null;
  const targetWorksheetId = campaignTab?.worksheetId ?? sheets.worksheetId;
  const onTarget = sheets.columnMaps.filter(
    (map) => map.spreadsheetId === sheets.spreadsheetId && map.worksheetId === targetWorksheetId && !map.retiredAt
  );
  const published = onTarget
    .filter((map) => map.status === "published")
    .sort((left, right) => right.mapVersion - left.mapVersion)[0];
  return {
    scope: "client_shared",
    configured: true,
    spreadsheetId: sheets.spreadsheetId,
    spreadsheetTitle: sheets.spreadsheetTitle,
    baseWorksheetId: sheets.worksheetId,
    baseWorksheetTitle: sheets.worksheetTitle,
    campaignTab: campaignTab
      ? {
          setupState: campaignTab.setupState,
          worksheetId: campaignTab.worksheetId,
          worksheetTitle: campaignTab.worksheetTitle,
        }
      : null,
    publishedMap: published
      ? { mapVersion: published.mapVersion, worksheetId: published.worksheetId, status: "published" }
      : null,
    draftMapPresent: onTarget.some((map) => map.status === "draft"),
    enabled: sheets.enabled,
    campaignDispatchEnabled: sheets.campaignDispatchEnabled,
    deliveryExecution: sheets.deliveryExecution,
    accessStatus: sheets.accessStatus,
    writeReadiness: sheets.writeReadiness,
  };
}

function destinationConflictCodes(ghl: InventoryGhlDestination | null, sheetsViewValue: CampaignCandidate["sheets"], ruleWorkflowIds: string[]): string[] {
  const codes: string[] = [];
  if (!ghl) codes.push("missing_ghl_destination");
  if (!text(ghl?.defaultWorkflowId) && ruleWorkflowIds.length === 0) codes.push("missing_ghl_workflow");
  if (!sheetsViewValue.configured) codes.push("missing_sheets_destination");
  else if (!sheetsViewValue.campaignTab) codes.push("missing_sheets_campaign_tab");
  if (sheetsViewValue.configured && !sheetsViewValue.publishedMap) codes.push("missing_sheets_published_map");
  return codes;
}

function authorityNote(authorities: CampaignCandidate["routingAuthorities"]): string {
  const exact = authorities.includes("exact_routing_rule");
  const confirmed = authorities.includes("confirmed_source_association");
  const loose = authorities.includes("loose_routing_rule");
  if (exact && confirmed) {
    return "An exact routing rule outranks confirmed source association. This inventory does not change that order.";
  }
  if (exact) return "An exact routing rule is the routing authority. No confirmed source is in this candidate.";
  if (confirmed) return "Confirmed source association is the routing authority for this candidate.";
  if (loose) return "A UTM or keyword rule is not a campaign identity. It was not grouped with other records.";
  return "A suggestion is not routing authority.";
}

function evidenceQuality(grouping: InventoryGrouping, conflicts: string[]): InventoryEvidenceQuality {
  if (conflicts.some((code) => HARD_CONFLICTS.has(code))) return "conflicting";
  if (grouping === "loose_rule" || grouping === "suggested_source") return "low";
  if (
    conflicts.some((code) =>
      code === "missing_origin_confirmation" ||
      code === "absent_campaign_id" ||
      code === "missing_lead_type" ||
      code === "missing_niche"
    )
  ) {
    return "partial";
  }
  return "high";
}

function groupingFor(sources: CampaignCandidate["sources"], rules: CampaignCandidate["rules"]): InventoryGrouping {
  const exact = rules.some((rule) => rule.exact);
  const confirmed = sources.some((source) => source.originConfirmed);
  const suggested = sources.some((source) => !source.originConfirmed);
  if (rules.length > 0 && rules.every((rule) => !rule.exact) && sources.length === 0) return "loose_rule";
  if (sources.length > 0 && exact) return "exact_identifier";
  if (rules.filter((rule) => rule.exact).length > 1) return "exact_identifier";
  if (confirmed) return "confirmed_source";
  if (suggested) return "suggested_source";
  if (exact) return "exact_rule";
  return "suggested_source";
}

function latestEvent(events: InventorySourceEvent[]): InventorySourceEvent | null {
  const ordered = [...events].sort((left, right) => {
    const time = Date.parse(right.receivedAt) - Date.parse(left.receivedAt);
    if (time !== 0) return time;
    return right.id.localeCompare(left.id);
  });
  return ordered[0] ?? null;
}

function finding(code: string, candidateKeys: string[]): InventoryFinding {
  return {
    code,
    message: FINDING_MESSAGES[code] ?? code,
    candidateKeys,
  };
}

export function buildClientCampaignInventory(input: ClientCampaignInventoryInput): ClientCampaignInventory {
  const clientAccountId = text(input.clientAccountId);
  const union = createUnion();
  const nodes: string[] = [];
  const sourcesById = new Map(input.sources.map((source) => [source.id, source]));
  const rulesById = new Map(input.rules.map((rule) => [rule.id, rule]));
  const funnelNodes = new Map<string, string[]>();
  const urlNodes = new Map<string, string[]>();

  for (const source of input.sources) {
    const node = sourceNode(source.id);
    nodes.push(node);
    union.find(node);
    const funnelId = text(source.providerFunnelId);
    const parentUrl = text(source.parentUrlKey);
    if (funnelId) {
      const list = funnelNodes.get(funnelId) ?? [];
      list.push(node);
      funnelNodes.set(funnelId, list);
    }
    if (parentUrl) {
      const list = urlNodes.get(parentUrl) ?? [];
      list.push(node);
      urlNodes.set(parentUrl, list);
    }
  }
  for (const rule of input.rules) {
    const node = ruleNode(rule.id);
    nodes.push(node);
    union.find(node);
  }
  for (const list of [...funnelNodes.values(), ...urlNodes.values()]) {
    for (let index = 1; index < list.length; index += 1) union.unite(list[0]!, list[index]!);
  }

  const exactNodes = new Map<string, string[]>();
  for (const rule of input.rules) {
    const identifier = exactIdentifierForRule(rule);
    if (!identifier) continue;
    const token = `${identifier.kind}:${identifier.value}`;
    const list = exactNodes.get(token) ?? [];
    list.push(ruleNode(rule.id));
    exactNodes.set(token, list);
  }
  for (const list of exactNodes.values()) {
    for (let index = 1; index < list.length; index += 1) union.unite(list[0]!, list[index]!);
  }
  for (const rule of input.rules) {
    const identifier = exactIdentifierForRule(rule);
    if (!identifier) continue;
    const node = ruleNode(rule.id);
    if (identifier.kind === "campaign_id") {
      for (const source of funnelNodes.get(identifier.value) ?? []) union.unite(node, source);
      for (const source of urlNodes.get(identifier.value) ?? []) union.unite(node, source);
    } else if (identifier.kind === "form_id") {
      for (const source of funnelNodes.get(identifier.value) ?? []) union.unite(node, source);
    }
  }

  const groups = new Map<string, { sources: InventorySource[]; rules: InventoryRule[] }>();
  for (const node of nodes) {
    const root = union.find(node);
    const group = groups.get(root) ?? { sources: [], rules: [] };
    if (node.startsWith("source:")) {
      const source = sourcesById.get(node.slice("source:".length));
      if (source) group.sources.push(source);
    } else {
      const rule = rulesById.get(node.slice("rule:".length));
      if (rule) group.rules.push(rule);
    }
    groups.set(root, group);
  }

  const sharedSheets = sheetsView(input.sheets);
  const draftCandidates: CampaignCandidate[] = [];

  for (const group of groups.values()) {
    const sources = [...group.sources].sort((left, right) => left.id.localeCompare(right.id));
    const rules = [...group.rules].sort((left, right) => left.id.localeCompare(right.id));
    const presentedSources = sources.map((source) => {
      const leadType = leadTypePresentation(source.leadTypeKey);
      const originConfirmed =
        source.associationStatus === "confirmed" && text(source.originClientAccountId) === clientAccountId;
      return {
        id: source.id,
        provider: source.provider,
        providerFunnelId: text(source.providerFunnelId) || null,
        parentUrlKey: text(source.parentUrlKey) || null,
        pageSlug: text(source.pageSlug) || null,
        observedFunnelName: text(source.observedFunnelName) || null,
        displayNameIsNotOwnership: true as const,
        nicheKey: text(source.nicheKey) || null,
        associationStatus: source.associationStatus,
        originConfirmed,
        leadTypeKey: leadType?.key ?? null,
        leadTypeLabel: leadType?.label ?? null,
        lastSeenAt: source.lastSeenAt,
      };
    });
    const presentedRules = rules.map((rule) => ({
      id: rule.id,
      matchType: rule.matchType,
      exact: isExactRoutingRuleMatchType(rule.matchType),
      campaignId: text(rule.campaignId) || null,
      campaignName: text(rule.campaignName) || null,
      displayNameIsNotOwnership: true as const,
      adsetId: text(rule.adsetId) || null,
      adId: text(rule.adId) || null,
      formId: text(rule.formId) || null,
      utmCampaign: text(rule.utmCampaign) || null,
      keywordPattern: text(rule.keywordPattern) || null,
      nicheKey: text(rule.nicheKey) || null,
      productType: text(rule.productType) || null,
      active: rule.active,
      priority: rule.priority,
      deliveryEnabled: rule.deliveryEnabled,
      shadowDeliveryEnabled: rule.shadowDeliveryEnabled,
      deliveryMode: rule.deliveryMode,
      destinationWorkflowIdGhl: text(rule.destinationWorkflowIdGhl) || null,
      destinationSubaccountIdGhl: text(rule.destinationSubaccountIdGhl) || null,
    }));
    const exactIdentifiers: CampaignCandidate["exactIdentifiers"] = [];
    const seenIdentifiers = new Set<string>();
    const pushIdentifier = (kind: InventoryExactKind, value: string | null) => {
      const trimmed = text(value);
      if (!trimmed) return;
      const token = `${kind}:${trimmed}`;
      if (seenIdentifiers.has(token)) return;
      seenIdentifiers.add(token);
      exactIdentifiers.push({ kind, value: trimmed });
    };
    for (const rule of rules) {
      const identifier = exactIdentifierForRule(rule);
      if (identifier) pushIdentifier(identifier.kind, identifier.value);
    }
    for (const source of presentedSources) {
      pushIdentifier("provider_funnel_id", source.providerFunnelId);
      pushIdentifier("parent_url_key", source.parentUrlKey);
    }
    exactIdentifiers.sort((left, right) => `${left.kind}:${left.value}`.localeCompare(`${right.kind}:${right.value}`));

    const identifierValues = new Set(exactIdentifiers.map((identifier) => identifier.value));
    const ruleIds = new Set(presentedRules.map((rule) => rule.id));
    const repeatedRuleKey = new Set<string>();
    const ruleKeyCounts = new Map<string, number>();
    for (const rule of rules) {
      const identifier = exactIdentifierForRule(rule);
      if (!identifier) continue;
      const token = `${identifier.kind}:${identifier.value}`;
      ruleKeyCounts.set(token, (ruleKeyCounts.get(token) ?? 0) + 1);
    }
    for (const [token, count] of ruleKeyCounts) {
      if (count > 1) repeatedRuleKey.add(token);
    }
    const funnelCounts = new Map<string, number>();
    const urlCounts = new Map<string, number>();
    for (const source of presentedSources) {
      if (source.providerFunnelId) funnelCounts.set(source.providerFunnelId, (funnelCounts.get(source.providerFunnelId) ?? 0) + 1);
      if (source.parentUrlKey) urlCounts.set(source.parentUrlKey, (urlCounts.get(source.parentUrlKey) ?? 0) + 1);
    }
    const otherClient = input.otherClientRules.some((rule) => {
      const identifier = exactIdentifierForRule(rule);
      if (!identifier) return false;
      if (seenIdentifiers.has(`${identifier.kind}:${identifier.value}`)) return true;
      if (identifier.kind === "campaign_id") {
        return presentedSources.some(
          (source) => source.providerFunnelId === identifier.value || source.parentUrlKey === identifier.value
        );
      }
      if (identifier.kind === "form_id") {
        return presentedSources.some((source) => source.providerFunnelId === identifier.value);
      }
      return false;
    });
    const foreignEvent = input.foreignSourceEvents.some((event) => {
      const values = [text(event.sourceCampaignId), text(event.sourceRouteKey)].filter(Boolean);
      return values.some((value) => identifierValues.has(value));
    });
    const nicheKeys = distinctStored([...presentedSources.map((source) => source.nicheKey), ...presentedRules.map((rule) => rule.nicheKey)]);
    const productTypes = distinctStored(presentedRules.map((rule) => rule.productType));
    const leadTypes = distinctStored(presentedSources.map((source) => source.leadTypeKey)).map((key) => {
      const presented = leadTypePresentation(key);
      return { key, label: presented?.label ?? null };
    });
    const conflicts: string[] = [];
    if (repeatedRuleKey.size > 0 || [...funnelCounts.values()].some((count) => count > 1) || [...urlCounts.values()].some((count) => count > 1)) {
      conflicts.push("overlapping_exact_identifiers");
    }
    if (otherClient) conflicts.push("exact_identifier_on_other_client");
    if (presentedSources.length > 1) conflicts.push("multiple_sources_in_candidate");
    if (nicheKeys.length > 1 || productTypes.length > 1 || leadTypes.length > 1) conflicts.push("classification_disagreement");
    if (presentedSources.some((source) => source.leadTypeKey && !source.leadTypeLabel)) conflicts.push("unknown_lead_type");
    if (!presentedSources.some((source) => source.originConfirmed)) conflicts.push("missing_origin_confirmation");
    if (!exactIdentifiers.some((identifier) => identifier.kind === "campaign_id")) conflicts.push("absent_campaign_id");
    if (leadTypes.length === 0 || leadTypes.every((leadType) => leadType.label == null)) conflicts.push("missing_lead_type");
    if (nicheKeys.length === 0) conflicts.push("missing_niche");
    if (presentedRules.length > 0 && productTypes.length === 0) conflicts.push("missing_product");
    if (foreignEvent) conflicts.push("source_event_resolved_to_other_client");

    const grouping = groupingFor(presentedSources, presentedRules);
    if (grouping === "loose_rule") conflicts.push("loose_rule_not_grouped");
    const ruleWorkflowIds = distinctStored(presentedRules.map((rule) => rule.destinationWorkflowIdGhl));
    conflicts.push(...destinationConflictCodes(input.ghl, sharedSheets, ruleWorkflowIds));

    const authorities: CampaignCandidate["routingAuthorities"] = [];
    if (presentedRules.some((rule) => rule.exact)) authorities.push("exact_routing_rule");
    if (presentedSources.some((source) => source.originConfirmed)) authorities.push("confirmed_source_association");
    if (presentedRules.some((rule) => !rule.exact)) authorities.push("loose_routing_rule");

    const matchedEvents = input.sourceEvents.filter((event) => {
      if (text(event.clientAccountIdResolved) && text(event.clientAccountIdResolved) !== clientAccountId) return false;
      if (event.routingRuleIdResolved && ruleIds.has(event.routingRuleIdResolved)) return true;
      if (event.sourceCampaignId && identifierValues.has(event.sourceCampaignId)) return true;
      if (event.sourceRouteKey && identifierValues.has(event.sourceRouteKey)) return true;
      return false;
    });
    const last = latestEvent(matchedEvents);
    const inventoryKey = [
      ...presentedSources.map((source) => `source:${source.id}`),
      ...presentedRules.map((rule) => `rule:${rule.id}`),
    ].join("|");

    draftCandidates.push({
      inventoryKey,
      evidenceQuality: evidenceQuality(grouping, conflicts),
      grouping,
      sources: presentedSources,
      rules: presentedRules,
      nicheKeys,
      productTypes,
      leadTypes,
      routingAuthorities: authorities,
      authorityNote: authorityNote(authorities),
      exactIdentifiers,
      ghl: {
        scope: "client_shared",
        locationId: input.ghl?.locationId ?? null,
        locationName: input.ghl?.locationName ?? null,
        clientDefaultWorkflowId: text(input.ghl?.defaultWorkflowId) || null,
        ruleWorkflowIds,
        clientDeliveryEnabled: input.ghl?.deliveryEnabled ?? null,
        clientDeliveryMode: input.ghl?.deliveryMode ?? null,
        workflowTriggerMode: input.ghl?.workflowTriggerMode ?? null,
      },
      sheets: sharedSheets,
      lastSourceEvent: last
        ? {
            id: last.id,
            receivedAt: last.receivedAt,
            status: last.status,
            sourceCampaignId: last.sourceCampaignId,
            sourceRouteKey: last.sourceRouteKey,
            routingRuleIdResolved: last.routingRuleIdResolved,
          }
        : null,
      observedDelivery: {
        anyRuleDeliveryEnabled: presentedRules.some((rule) => rule.deliveryEnabled),
        anyRuleActive: presentedRules.some((rule) => rule.active),
        clientGhlDeliveryEnabled: input.ghl?.deliveryEnabled ?? null,
        sheetsEnabled: input.sheets?.enabled ?? null,
        sheetsCampaignDispatchEnabled: input.sheets?.campaignDispatchEnabled ?? null,
      },
      requestEvidence: null,
      setupRequestMatchesCampaignId: false,
      conflicts,
    });
  }

  const candidates = draftCandidates.sort((left, right) => {
    const rank = (candidate: CampaignCandidate) => {
      if (candidate.sources.some((source) => source.originConfirmed)) return 0;
      if (candidate.rules.some((rule) => rule.exact)) return 1;
      if (candidate.sources.length > 0) return 2;
      return 3;
    };
    const difference = rank(left) - rank(right);
    if (difference !== 0) return difference;
    return left.inventoryKey.localeCompare(right.inventoryKey);
  });

  const request = input.associationRequest;
  if (request) {
    const sourceCandidate = candidates.find((candidate) =>
      candidate.sources.some(
        (source) =>
          (text(request.providerFunnelId) && source.providerFunnelId === text(request.providerFunnelId)) ||
          (text(request.parentUrlKey) && source.parentUrlKey === text(request.parentUrlKey))
      )
    );
    const campaignCandidate = candidates.find((candidate) =>
      candidate.exactIdentifiers.some(
        (identifier) => identifier.kind === "campaign_id" && identifier.value === text(request.providerCampaignId)
      )
    );
    if (sourceCandidate && campaignCandidate && sourceCandidate !== campaignCandidate) {
      for (const candidate of [sourceCandidate, campaignCandidate]) {
        candidate.conflicts.push("association_request_not_a_join");
        candidate.evidenceQuality = evidenceQuality(candidate.grouping, candidate.conflicts);
      }
    } else if (sourceCandidate || campaignCandidate) {
      const candidate = sourceCandidate ?? campaignCandidate;
      if (candidate) {
        candidate.requestEvidence = { id: request.id, providerCampaignId: request.providerCampaignId, joined: false };
      }
    }
  }

  const setupCampaignId = input.setup?.readable ? text(input.setup.providerCampaignId) : "";
  if (setupCampaignId) {
    for (const candidate of candidates) {
      candidate.setupRequestMatchesCampaignId = candidate.exactIdentifiers.some(
        (identifier) => identifier.kind === "campaign_id" && identifier.value === setupCampaignId
      );
    }
  }

  const ambiguities: InventoryFinding[] = [];
  const sourceBacked = candidates.filter((candidate) => candidate.sources.length > 0);
  if (sourceBacked.length > 1) {
    ambiguities.push(finding("multiple_source_candidates", sourceBacked.map((candidate) => candidate.inventoryKey)));
  }
  if (setupCampaignId && candidates.length > 1) {
    ambiguities.push(finding("single_setup_request_for_many_candidates", candidates.map((candidate) => candidate.inventoryKey)));
  }

  const conflicts: InventoryFinding[] = [];
  if (candidates.length === 0) {
    for (const code of destinationConflictCodes(input.ghl, sharedSheets, [])) conflicts.push(finding(code, []));
  }
  if (input.setup && !input.setup.readable) conflicts.push(finding("setup_request_unreadable", []));
  if (request) {
    const attached = candidates.some(
      (candidate) =>
        candidate.requestEvidence?.id === request.id || candidate.conflicts.includes("association_request_not_a_join")
    );
    if (!attached) conflicts.push(finding("association_request_unmatched", []));
  }
  const codes = new Map<string, string[]>();
  for (const candidate of candidates) {
    for (const code of candidate.conflicts) {
      const keys = codes.get(code) ?? [];
      keys.push(candidate.inventoryKey);
      codes.set(code, keys);
    }
  }
  for (const [code, keys] of [...codes.entries()].sort((left, right) => left[0].localeCompare(right[0]))) {
    conflicts.push(finding(code, keys));
  }
  conflicts.sort((left, right) => left.code.localeCompare(right.code));

  const boundCampaignTab = input.sheets?.tabs.some((tab) => tab.role === "campaign" && tab.setupState === "bound") ?? false;

  return {
    ok: true,
    readOnly: true,
    writesPerformed: false,
    clientAccountId,
    generatedAt: (input.now ?? new Date()).toISOString(),
    sourceEventLookupCapped: input.sourceEventLookupCapped,
    accountClassification: {
      primaryNicheKeys: distinctStored(input.primaryNicheKeys),
      primaryProductTypes: distinctStored(input.primaryProductTypes),
      note: ACCOUNT_CLASSIFICATION_NOTE,
    },
    summary: {
      candidateCount: candidates.length,
      confirmedSourceCount: input.sources.filter(
        (source) => source.associationStatus === "confirmed" && text(source.originClientAccountId) === clientAccountId
      ).length,
      suggestedSourceCount: input.sources.filter((source) => source.associationStatus === "suggested").length,
      routingRuleCount: input.rules.length,
      exactRuleCount: input.rules.filter((rule) => isExactRoutingRuleMatchType(rule.matchType)).length,
      looseRuleCount: input.rules.filter((rule) => !isExactRoutingRuleMatchType(rule.matchType)).length,
    },
    ambiguities,
    conflicts,
    setupRequest: input.setup
      ? {
          revision: input.setup.revision,
          status: input.setup.status,
          readable: input.setup.readable,
          providerFunnelId: input.setup.readable ? input.setup.providerFunnelId : null,
          parentUrlKey: input.setup.readable ? input.setup.parentUrlKey : null,
          providerCampaignId: input.setup.readable ? input.setup.providerCampaignId : null,
          operational: false,
        }
      : null,
    associationRequest: request ? { ...request, operational: false } : null,
    ghlDestination: input.ghl,
    sheetsDestination: input.sheets
      ? {
          spreadsheetId: input.sheets.spreadsheetId,
          spreadsheetTitle: input.sheets.spreadsheetTitle,
          spreadsheetUrl: input.sheets.spreadsheetUrl,
          worksheetId: input.sheets.worksheetId,
          worksheetTitle: input.sheets.worksheetTitle,
          enabled: input.sheets.enabled,
          campaignDispatchEnabled: input.sheets.campaignDispatchEnabled,
          deliveryExecution: input.sheets.deliveryExecution,
          accessStatus: input.sheets.accessStatus,
          writeReadiness: input.sheets.writeReadiness,
          campaignTabBound: boundCampaignTab,
        }
      : null,
    candidates,
  };
}
