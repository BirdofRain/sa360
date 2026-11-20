/**
 * Request-only view of the client campaign registry.
 * A campaign id is the server cuid. Display name, niche, product, and an
 * inventory key are not identities. An approved binding is not source
 * confirmation, and a destination selection is not live delivery.
 */

import { CLIENT_NICHE_OPTIONS, CLIENT_PRODUCT_OPTIONS } from "@/lib/clients/client-profile-options";

const CAMPAIGN_ID = /^c[a-z0-9]{24}$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CLIENT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

const BOUNDARY_FLAGS = [
  "routingRuleApplied",
  "sourceConfirmed",
  "deliveryArmed",
  "externalCall",
  "inventoryKeyUsed",
  "operationalReady",
  "originConfirmed",
  "changedClientDefaultWorkflow",
  "tabContractChanged",
] as const;

const SUCCESS_FLAGS = [
  "routingRuleApplied",
  "sourceConfirmed",
  "deliveryArmed",
  "externalCall",
  "inventoryKeyUsed",
  "operationalReady",
  "originConfirmed",
] as const;

export const CAMPAIGN_PROVIDERS = ["leadcapture_io", "facebook", "goat_leads", "manual_import", "google_sheets"] as const;
export const CAMPAIGN_BINDING_STATUSES = ["suggested", "recorded", "approved"] as const;
export const CAMPAIGN_CONFIG_STATUSES = ["draft", "review", "ready"] as const;
export const CAMPAIGN_TRIGGER_MODES = ["none", "direct_api", "tag_trigger"] as const;

const EXACT_FIELDS = ["providerFunnelId", "parentUrlKey", "campaignId", "formId", "adsetId", "adId"] as const;

const UNSTORED_ERRORS = new Set([
  "revision_conflict",
  "request_id_conflict",
  "identifier_inconsistent",
  "slug_conflict",
  "duplicate_identifier",
  "suggested_with_exact_identifier",
  "exact_identifier_required",
  "invalid_body",
  "unknown_source",
  "foreign_source",
  "unknown_routing_rule",
  "foreign_routing_rule",
  "utm_or_keyword_not_authority",
  "ghl_location_mismatch",
  "spreadsheet_mismatch",
  "provider_identity_missing",
  "identifier_invalid",
  "campaign_not_found",
  "client_not_found",
  "forbidden",
  "unauthorized",
  "client_campaign_registry_disabled",
  "feature_disabled",
]);

export type CampaignSummaryView = {
  id: string;
  clientAccountId: string;
  slug: string;
  displayName: string;
  nicheKey: string;
  productType: string;
  status: string;
  revision: number;
  bindingCount: number;
  destinationSaved: boolean;
};

export type CampaignIdentityView = {
  provider: string;
  kind: string;
  normalizedValue: string;
};

export type CampaignBindingView = {
  id: string;
  bindingKey: string;
  status: string;
  revision: number;
  sourceFunnelId: string | null;
  campaignRoutingRuleId: string | null;
  identities: CampaignIdentityView[];
  evidenceNote: string | null;
  observedLabel: string | null;
  usedAsJoinKey: false;
  originConfirmed: false;
};

export type CampaignDestinationView = {
  id: string;
  revision: number;
  ghlLocationId: string | null;
  workflowIdGhl: string | null;
  workflowTriggerMode: string | null;
  spreadsheetId: string | null;
  worksheetId: number | null;
  worksheetTitle: string | null;
  readinessWarnings: string[];
  workflowLiveVerified: false;
  mapPublished: false;
  operationalReady: false;
};

export type CampaignDetailView = {
  campaign: CampaignSummaryView;
  bindings: CampaignBindingView[];
  destination: CampaignDestinationView | null;
};

export type CampaignConflictView = {
  code: string;
  scope: string;
  identifierKind: string;
  bindingKey: string;
  campaignId: string | null;
};

export type CampaignCommandResult = {
  ok: boolean;
  uncertain: boolean;
  stored: boolean;
  recordedCommand: boolean;
  retainRequestId: boolean;
  code: string | null;
  outcome: "REVIEW_REQUIRED" | null;
  message: string;
  revision: number | null;
  requestId: string | null;
  replayed: boolean;
  conflicts: CampaignConflictView[];
  campaign: CampaignSummaryView | null;
  bindings: CampaignBindingView[] | null;
  destination: CampaignDestinationView | null;
  destinationIncluded: boolean;
};

export type ClientCampaignManagerModel =
  | { availability: "disabled"; message: string }
  | { availability: "error"; message: string }
  | { availability: "ready"; campaigns: CampaignSummaryView[] };

export type BindingDraftInput = {
  bindingKey: string;
  requestedStatus: (typeof CAMPAIGN_BINDING_STATUSES)[number];
  sourceFunnelId: string | null;
  campaignRoutingRuleId: string | null;
  provider: (typeof CAMPAIGN_PROVIDERS)[number] | null;
  providerFunnelId: string | null;
  parentUrlKey: string | null;
  campaignId: string | null;
  formId: string | null;
  adsetId: string | null;
  adId: string | null;
  evidence: { note: string | null; observedLabel: string | null } | null;
};

export function campaignCollectionPath(clientAccountId: string): string {
  return `/admin/v1/clients/${clientAccountId}/campaigns`;
}

export function campaignItemPath(clientAccountId: string, campaignId: string): string {
  return `/admin/v1/clients/${clientAccountId}/campaigns/${campaignId}`;
}

export function campaignBindingsPath(clientAccountId: string, campaignId: string): string {
  return `${campaignItemPath(clientAccountId, campaignId)}/source-bindings`;
}

export function campaignDestinationPath(clientAccountId: string, campaignId: string): string {
  return `${campaignItemPath(clientAccountId, campaignId)}/destination-selection`;
}

export function isRegistryCampaignId(value: string): boolean {
  return CAMPAIGN_ID.test(value);
}

export function nicheLabel(value: string): string {
  return CLIENT_NICHE_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

export function productLabel(value: string): string {
  return CLIENT_PRODUCT_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

export function warningLabel(code: string): string {
  switch (code) {
    case "selection_is_not_operational":
      return "This selection is a request only. It is not operational.";
    case "not_a_published_map":
      return "This is not a published map.";
    case "ghl_destination_missing":
      return "This client has no saved GHL destination.";
    case "workflow_not_live_verified":
      return "The workflow id is not live-verified.";
    case "sheets_destination_missing":
      return "This client has no saved Sheets destination.";
    case "worksheet_not_verified":
      return "The worksheet is not verified.";
    default:
      return code;
  }
}

export function conflictLabel(conflict: CampaignConflictView): string {
  const where =
    conflict.scope === "same_client" && conflict.campaignId
      ? ` It belongs to campaign ${conflict.campaignId}.`
      : conflict.scope === "other_client"
        ? " The other client is not shown."
        : "";
  switch (conflict.code) {
    case "exact_identifier_overlap":
      return `Another saved campaign already holds this ${conflict.identifierKind}.${where}`;
    case "routing_authority_overlap":
      return `A routing rule already covers this ${conflict.identifierKind}.${where}`;
    case "source_ownership_overlap":
      return `This source is already associated with another saved campaign.${where}`;
    case "source_not_confirmed":
      return "The source is not confirmed. An approved registry binding does not confirm it.";
    default:
      return `${conflict.code}.${where}`;
  }
}

export function disabledCampaignManagerMessage(): string {
  return "Campaign configuration is not available. Nothing was loaded and nothing was saved. The registry switch is separate from this page, and the guided setup below is unchanged.";
}

export function parseCampaignList(value: unknown, clientAccountId: string): CampaignSummaryView[] | null {
  if (!isRecord(value) || value.ok !== true || !boundaryClosed(value, true)) return null;
  if (value.clientAccountId !== clientAccountId || !Array.isArray(value.campaigns)) return null;
  const campaigns: CampaignSummaryView[] = [];
  for (const item of value.campaigns) {
    const campaign = parseSummary(item, clientAccountId);
    if (!campaign) return null;
    campaigns.push(campaign);
  }
  return campaigns;
}

export function parseCampaignDetail(value: unknown, clientAccountId: string, campaignId: string): CampaignDetailView | null {
  if (!isRecord(value) || value.ok !== true || !boundaryClosed(value, true)) return null;
  const campaign = parseSummary(value.campaign, clientAccountId);
  if (!campaign || campaign.id !== campaignId) return null;
  const bindings = parseBindings(value.bindings);
  if (!bindings) return null;
  if (!("destination" in value)) return null;
  const destination = value.destination === null ? null : parseDestination(value.destination);
  if (value.destination !== null && !destination) return null;
  return { campaign, bindings, destination };
}

export function interpretCampaignCommand(value: unknown): CampaignCommandResult | null {
  if (!isRecord(value) || !boundaryClosed(value, false)) return null;
  if (value.outcome === "REVIEW_REQUIRED") return reviewResult(value);
  if (value.ok === true) return storedResult(value);
  if (typeof value.error === "string" && UNSTORED_ERRORS.has(value.error)) return unstoredResult(value.error, value);
  return null;
}

export function validateCreateDraft(input: {
  clientAccountId: string;
  requestId: string;
  slug: string;
  displayName: string;
  nicheKey: string;
  productType: string;
}): { ok: true; body: Record<string, unknown> } | { ok: false; message: string } {
  if (!CLIENT_ID.test(input.clientAccountId)) return { ok: false, message: "That client id is not valid. Nothing was saved." };
  if (!UUID.test(input.requestId)) return { ok: false, message: "The request id is not valid. Nothing was saved." };
  const slug = input.slug.trim();
  const displayName = input.displayName.trim();
  if (!SLUG.test(slug) || slug.length > 80) {
    return { ok: false, message: "The slug must be lowercase words separated by hyphens. Nothing was saved." };
  }
  if (!displayName || displayName.length > 120) {
    return { ok: false, message: "The display name must be 1 to 120 characters. Nothing was saved." };
  }
  if (!CLIENT_NICHE_OPTIONS.some((option) => option.value === input.nicheKey)) {
    return { ok: false, message: "Choose a catalog niche. Nothing was saved." };
  }
  if (!CLIENT_PRODUCT_OPTIONS.some((option) => option.value === input.productType)) {
    return { ok: false, message: "Choose a catalog product. Nothing was saved." };
  }
  return {
    ok: true,
    body: {
      requestId: input.requestId,
      expectedRevision: 0,
      intent: "create",
      slug,
      displayName,
      nicheKey: input.nicheKey,
      productType: input.productType,
    },
  };
}

export function validateProfileUpdate(input: {
  clientAccountId: string;
  campaignId: string;
  requestId: string;
  expectedRevision: number;
  displayName: string;
  nicheKey: string;
  productType: string;
  status: string;
}): { ok: true; body: Record<string, unknown> } | { ok: false; message: string } {
  if (!isRegistryCampaignId(input.campaignId)) {
    return { ok: false, message: "That campaign id is not a saved configuration id. Nothing was saved." };
  }
  if (!UUID.test(input.requestId) || !integerRevision(input.expectedRevision)) {
    return { ok: false, message: "The request could not be checked. Nothing was saved." };
  }
  const displayName = input.displayName.trim();
  if (!displayName || displayName.length > 120) {
    return { ok: false, message: "The display name must be 1 to 120 characters. Nothing was saved." };
  }
  if (!CLIENT_NICHE_OPTIONS.some((option) => option.value === input.nicheKey)) {
    return { ok: false, message: "Choose a catalog niche. Nothing was saved." };
  }
  if (!CLIENT_PRODUCT_OPTIONS.some((option) => option.value === input.productType)) {
    return { ok: false, message: "Choose a catalog product. Nothing was saved." };
  }
  if (!CAMPAIGN_CONFIG_STATUSES.includes(input.status as (typeof CAMPAIGN_CONFIG_STATUSES)[number])) {
    return { ok: false, message: "Status can be draft, review, or ready. Nothing was saved." };
  }
  return {
    ok: true,
    body: {
      requestId: input.requestId,
      expectedRevision: input.expectedRevision,
      intent: "update",
      displayName,
      nicheKey: input.nicheKey,
      productType: input.productType,
      status: input.status,
    },
  };
}

export function validateBindingDrafts(
  bindings: BindingDraftInput[]
): { ok: true; bindings: BindingDraftInput[] } | { ok: false; message: string } {
  if (bindings.length > 20) return { ok: false, message: "A campaign can hold 20 source requests. Nothing was saved." };
  const keys = new Set<string>();
  const cleaned: BindingDraftInput[] = [];
  for (const binding of bindings) {
    const bindingKey = binding.bindingKey.trim();
    if (!SLUG.test(bindingKey) || bindingKey.length > 80) {
      return { ok: false, message: "Each source request needs a lowercase key. Nothing was saved." };
    }
    if (keys.has(bindingKey)) return { ok: false, message: "Source request keys must be unique. Nothing was saved." };
    keys.add(bindingKey);
    if (!CAMPAIGN_BINDING_STATUSES.includes(binding.requestedStatus)) {
      return { ok: false, message: "A source request can be suggested, recorded, or approved. Nothing was saved." };
    }
    const rawExact = EXACT_FIELDS.map((field) => binding[field]);
    if (binding.requestedStatus === "suggested" && rawExact.some((value) => value !== null && value.trim() !== "")) {
      return { ok: false, message: "A suggested request cannot include an exact identifier. Nothing was saved." };
    }
    if (binding.requestedStatus === "suggested" && binding.campaignRoutingRuleId?.trim()) {
      return { ok: false, message: "A suggested request cannot reference a routing rule. Nothing was saved." };
    }
    const exact = exactValues(binding);
    if (binding.requestedStatus !== "suggested") {
      if (!binding.provider || !CAMPAIGN_PROVIDERS.includes(binding.provider)) {
        return { ok: false, message: "A recorded or approved request needs a provider. Nothing was saved." };
      }
      if (rawExact.some((value, index) => value !== null && value.trim() !== "" && exact[index] === null)) {
        return { ok: false, message: "An exact identifier is not valid. Nothing was saved." };
      }
      if (!exact.some((value) => value !== null)) {
        return { ok: false, message: "A recorded or approved request needs one exact identifier. Nothing was saved." };
      }
    }
    cleaned.push({
      ...binding,
      bindingKey,
      provider: binding.requestedStatus === "suggested" ? null : binding.provider,
      providerFunnelId: exact[0],
      parentUrlKey: exact[1],
      campaignId: exact[2],
      formId: exact[3],
      adsetId: exact[4],
      adId: exact[5],
      campaignRoutingRuleId: blank(binding.campaignRoutingRuleId, 200),
      sourceFunnelId: blank(binding.sourceFunnelId, 200),
      evidence: cleanEvidence(binding.evidence),
    });
  }
  return { ok: true, bindings: cleaned };
}

export function validateDestinationDraft(input: {
  workflowIdGhl: string | null;
  workflowTriggerMode: string | null;
  ghlLocationId: string | null;
  spreadsheetId: string | null;
  worksheetId: number | null;
  worksheetTitle: string | null;
}): { ok: true; body: Record<string, unknown> } | { ok: false; message: string } {
  const workflowIdGhl = optionalToken(input.workflowIdGhl, 200);
  const ghlLocationId = optionalToken(input.ghlLocationId, 200);
  const spreadsheetId = optionalToken(input.spreadsheetId, 200);
  const worksheetTitle = optionalLabel(input.worksheetTitle, 120);
  if (workflowIdGhl === undefined || ghlLocationId === undefined || spreadsheetId === undefined || worksheetTitle === undefined) {
    return { ok: false, message: "A destination field is too long or contains a space. Nothing was saved." };
  }
  if (
    input.workflowTriggerMode !== null &&
    !CAMPAIGN_TRIGGER_MODES.includes(input.workflowTriggerMode as (typeof CAMPAIGN_TRIGGER_MODES)[number])
  ) {
    return { ok: false, message: "Choose a trigger mode or leave it empty. Nothing was saved." };
  }
  if (input.worksheetId !== null && (!Number.isSafeInteger(input.worksheetId) || input.worksheetId < 0)) {
    return { ok: false, message: "The worksheet id must be a whole number. Nothing was saved." };
  }
  return {
    ok: true,
    body: {
      workflowIdGhl,
      workflowTriggerMode: input.workflowTriggerMode,
      ghlLocationId,
      spreadsheetId,
      worksheetId: input.worksheetId,
      worksheetTitle,
    },
  };
}

export function bindingDraftFromView(binding: CampaignBindingView): BindingDraftInput {
  const byKind = new Map(binding.identities.map((identity) => [identity.kind, identity.normalizedValue]));
  const provider = CAMPAIGN_PROVIDERS.find((item) => item === binding.identities[0]?.provider) ?? null;
  const status = CAMPAIGN_BINDING_STATUSES.find((item) => item === binding.status) ?? "suggested";
  return {
    bindingKey: binding.bindingKey,
    requestedStatus: status,
    sourceFunnelId: binding.sourceFunnelId,
    campaignRoutingRuleId: binding.campaignRoutingRuleId,
    provider: status === "suggested" ? null : provider,
    providerFunnelId: status === "suggested" ? null : (byKind.get("provider_funnel_id") ?? null),
    parentUrlKey: status === "suggested" ? null : (byKind.get("parent_url_key") ?? null),
    campaignId: status === "suggested" ? null : (byKind.get("campaign_id") ?? null),
    formId: status === "suggested" ? null : (byKind.get("form_id") ?? null),
    adsetId: status === "suggested" ? null : (byKind.get("adset_id") ?? null),
    adId: status === "suggested" ? null : (byKind.get("ad_id") ?? null),
    evidence:
      binding.evidenceNote || binding.observedLabel
        ? { note: binding.evidenceNote, observedLabel: binding.observedLabel }
        : null,
  };
}

function reviewResult(value: Record<string, unknown>): CampaignCommandResult | null {
  if (value.ok !== false || value.error !== "review_required" || !boundaryClosed(value, true)) return null;
  const conflicts = parseConflicts(value.conflicts);
  const revision = integerRevision(value.revision) ? value.revision : null;
  const requestId = typeof value.requestId === "string" && UUID.test(value.requestId) ? value.requestId : null;
  if (!conflicts || revision === null || !requestId) return null;
  return {
    ...emptyResult(),
    ok: false,
    recordedCommand: true,
    retainRequestId: false,
    code: "review_required",
    outcome: "REVIEW_REQUIRED",
    message: "The review was recorded. The source binding was not changed.",
    revision,
    requestId,
    replayed: value.replayed === true,
    conflicts,
  };
}

function storedResult(value: Record<string, unknown>): CampaignCommandResult | null {
  if (!boundaryClosed(value, true)) return null;
  const campaign = parseSummary(value.campaign, typeof value.clientAccountId === "string" ? value.clientAccountId : "");
  if (!campaign || value.revision !== campaign.revision) return null;
  if (typeof value.requestId !== "string" || !UUID.test(value.requestId)) return null;
  const bindings = "bindings" in value ? parseBindings(value.bindings) : null;
  if ("bindings" in value && !bindings) return null;
  const destinationIncluded = "destination" in value;
  const destination = !destinationIncluded || value.destination === null ? null : parseDestination(value.destination);
  if (destinationIncluded && value.destination !== null && !destination) return null;
  const replayed = value.replayed === true;
  return {
    ...emptyResult(),
    ok: true,
    stored: true,
    code: null,
    message: replayed
      ? `This request was already saved as revision ${campaign.revision}. No second copy was written. It is not live delivery.`
      : `Saved revision ${campaign.revision}. This is configuration only. It does not route or deliver leads.`,
    revision: campaign.revision,
    requestId: value.requestId,
    replayed,
    campaign,
    bindings,
    destination,
    destinationIncluded,
  };
}

function unstoredResult(code: string, value: Record<string, unknown>): CampaignCommandResult {
  const normalized = code === "feature_disabled" ? "client_campaign_registry_disabled" : code;
  return {
    ...emptyResult(),
    code: normalized,
    message: unstoredMessage(normalized),
    retainRequestId: normalized !== "request_id_conflict" && normalized !== "client_campaign_registry_disabled",
    revision: integerRevision(value.revision) ? value.revision : null,
    requestId: typeof value.requestId === "string" ? value.requestId : null,
    replayed: value.replayed === true,
  };
}

function unstoredMessage(code: string): string {
  switch (code) {
    case "revision_conflict":
      return "This campaign changed since it was loaded. Reload it before saving again. Nothing new was stored.";
    case "request_id_conflict":
      return "That request id was already used for a different save. Start a new save. Nothing new was stored.";
    case "identifier_inconsistent":
      return "The exact identifier does not match the referenced source. The binding was not saved.";
    case "client_campaign_registry_disabled":
      return "The campaign registry is turned off. Nothing was saved.";
    case "slug_conflict":
      return "That slug is already used by another campaign for this client. Nothing was saved.";
    case "suggested_with_exact_identifier":
      return "A suggested request cannot include an exact identifier. Nothing was saved.";
    case "exact_identifier_required":
      return "A recorded or approved request needs one exact identifier. Nothing was saved.";
    case "duplicate_identifier":
      return "This save repeats an exact identifier. Nothing was stored.";
    case "ghl_location_mismatch":
      return "That location is not this client's saved GHL destination. Nothing was stored.";
    case "spreadsheet_mismatch":
      return "That spreadsheet is not this client's saved Sheets destination. Nothing was stored.";
    case "utm_or_keyword_not_authority":
      return "A UTM or keyword rule cannot authorize a source binding. Nothing was stored.";
    case "forbidden":
      return "This session cannot save campaign configuration. Nothing was saved.";
    default:
      return "The campaign configuration was not saved.";
  }
}

function emptyResult(): CampaignCommandResult {
  return {
    ok: false,
    uncertain: false,
    stored: false,
    recordedCommand: false,
    retainRequestId: false,
    code: null,
    outcome: null,
    message: "The campaign configuration was not saved.",
    revision: null,
    requestId: null,
    replayed: false,
    conflicts: [],
    campaign: null,
    bindings: null,
    destination: null,
    destinationIncluded: false,
  };
}

export function uncertainCampaignCommand(message: string): CampaignCommandResult {
  return { ...emptyResult(), uncertain: true, retainRequestId: true, message };
}

export function closedCampaignCommand(code: string, message: string, retainRequestId = true): CampaignCommandResult {
  return { ...emptyResult(), code, message, retainRequestId };
}

function parseSummary(value: unknown, clientAccountId: string): CampaignSummaryView | null {
  if (!isRecord(value) || !boundaryClosed(value, false)) return null;
  if (value.configurationStatusEffect !== "none" || value.operationalReady !== false) return null;
  if (typeof value.id !== "string" || !CAMPAIGN_ID.test(value.id)) return null;
  if (value.clientAccountId !== clientAccountId || typeof value.slug !== "string" || !SLUG.test(value.slug)) return null;
  if (typeof value.displayName !== "string" || !value.displayName.trim()) return null;
  if (typeof value.nicheKey !== "string" || typeof value.productType !== "string") return null;
  if (typeof value.status !== "string" || !integerRevision(value.revision)) return null;
  return {
    id: value.id,
    clientAccountId,
    slug: value.slug,
    displayName: value.displayName,
    nicheKey: value.nicheKey,
    productType: value.productType,
    status: value.status,
    revision: value.revision,
    bindingCount: typeof value.bindingCount === "number" ? value.bindingCount : 0,
    destinationSaved: value.destinationSaved === true,
  };
}

function parseBindings(value: unknown): CampaignBindingView[] | null {
  if (!Array.isArray(value)) return null;
  const bindings: CampaignBindingView[] = [];
  for (const item of value) {
    const binding = parseBinding(item);
    if (!binding) return null;
    bindings.push(binding);
  }
  return bindings;
}

function parseBinding(value: unknown): CampaignBindingView | null {
  if (!isRecord(value) || value.originConfirmed !== false) return null;
  if (typeof value.id !== "string" || typeof value.bindingKey !== "string" || typeof value.status !== "string") return null;
  if (!integerRevision(value.revision) || !Array.isArray(value.identities)) return null;
  const identities: CampaignIdentityView[] = [];
  for (const identity of value.identities) {
    if (!isRecord(identity)) return null;
    if (typeof identity.provider !== "string" || typeof identity.kind !== "string" || typeof identity.normalizedValue !== "string") {
      return null;
    }
    identities.push({ provider: identity.provider, kind: identity.kind, normalizedValue: identity.normalizedValue });
  }
  const evidence = isRecord(value.recordedEvidence) ? value.recordedEvidence : null;
  if (!evidence || evidence.usedAsJoinKey !== false) return null;
  return {
    id: value.id,
    bindingKey: value.bindingKey,
    status: value.status,
    revision: value.revision,
    sourceFunnelId: nullableString(value.sourceFunnelId),
    campaignRoutingRuleId: nullableString(value.campaignRoutingRuleId),
    identities,
    evidenceNote: nullableString(evidence.note),
    observedLabel: nullableString(evidence.observedLabel),
    usedAsJoinKey: false,
    originConfirmed: false,
  };
}

function parseDestination(value: unknown): CampaignDestinationView | null {
  if (!isRecord(value)) return null;
  if (value.workflowLiveVerified !== false || value.mapPublished !== false || value.operationalReady !== false) return null;
  if (value.changedClientDefaultWorkflow !== false || value.tabContractChanged !== false) return null;
  if (typeof value.id !== "string" || !integerRevision(value.revision)) return null;
  if (!Array.isArray(value.readinessWarnings) || value.readinessWarnings.some((item) => typeof item !== "string")) return null;
  const worksheetId = value.worksheetId === null ? null : value.worksheetId;
  if (worksheetId !== null && (typeof worksheetId !== "number" || !Number.isSafeInteger(worksheetId))) return null;
  return {
    id: value.id,
    revision: value.revision,
    ghlLocationId: nullableString(value.ghlLocationId),
    workflowIdGhl: nullableString(value.workflowIdGhl),
    workflowTriggerMode: nullableString(value.workflowTriggerMode),
    spreadsheetId: nullableString(value.spreadsheetId),
    worksheetId,
    worksheetTitle: nullableString(value.worksheetTitle),
    readinessWarnings: value.readinessWarnings.filter((item): item is string => typeof item === "string"),
    workflowLiveVerified: false,
    mapPublished: false,
    operationalReady: false,
  };
}

function parseConflicts(value: unknown): CampaignConflictView[] | null {
  if (!Array.isArray(value)) return null;
  const conflicts: CampaignConflictView[] = [];
  for (const item of value) {
    if (!isRecord(item)) return null;
    if (typeof item.code !== "string" || typeof item.scope !== "string") return null;
    if (typeof item.identifierKind !== "string" || typeof item.bindingKey !== "string") return null;
    const campaignId = typeof item.campaignId === "string" && CAMPAIGN_ID.test(item.campaignId) ? item.campaignId : null;
    conflicts.push({
      code: item.code,
      scope: item.scope,
      identifierKind: item.identifierKind,
      bindingKey: item.bindingKey,
      campaignId,
    });
  }
  return conflicts;
}

function boundaryClosed(value: Record<string, unknown>, requireSuccessFlags: boolean): boolean {
  for (const flag of BOUNDARY_FLAGS) {
    if (!(flag in value)) {
      if (requireSuccessFlags && SUCCESS_FLAGS.includes(flag as (typeof SUCCESS_FLAGS)[number])) return false;
      continue;
    }
    if (value[flag] !== false) return false;
  }
  return true;
}

function exactValues(binding: BindingDraftInput): Array<string | null> {
  if (binding.requestedStatus === "suggested") return [null, null, null, null, null, null];
  return EXACT_FIELDS.map((field) => {
    const value = binding[field];
    return blank(value, field === "parentUrlKey" ? 500 : 200);
  });
}

function cleanEvidence(
  evidence: BindingDraftInput["evidence"]
): { note: string | null; observedLabel: string | null } | null {
  if (!evidence) return null;
  const note = blank(evidence.note, 500);
  const observedLabel = blank(evidence.observedLabel, 200);
  if (!note && !observedLabel) return null;
  return { note, observedLabel };
}

function optionalToken(value: string | null, max: number): string | null | undefined {
  if (value === null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > max || /\s/.test(trimmed)) return undefined;
  return trimmed;
}

function optionalLabel(value: string | null, max: number): string | null | undefined {
  if (value === null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > max) return undefined;
  return trimmed;
}

function blank(value: string | null, max: number): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) return null;
  return trimmed;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function integerRevision(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
