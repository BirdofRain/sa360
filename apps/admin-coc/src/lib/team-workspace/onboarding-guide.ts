import type { ClientSetupData } from "@/lib/clients/types";

import { isSafeTeamWorkspaceId } from "./contract";
import type { SourceCampaignRequestView } from "./source-campaign-request";
import type { SourceCampaignReviewView } from "./source-campaign-review";

/**
 * Guided setup talks only to the existing client account and setup-request
 * services. It does not create routing rules, write a GHL or Sheets
 * destination, or turn delivery on.
 *
 * Words used on the page:
 * - saved: stored on the client account or the setup request
 * - configured: an operational row already exists; this page did not write it
 * - verified: a reviewer marked the setup request reviewed
 * - active: delivery is already turned on somewhere else
 * Those four are not interchangeable. operational stays false.
 */

export const GUIDE_STEP_IDS = ["client", "information", "sources", "destination", "summary"] as const;
export type GuideStepId = (typeof GUIDE_STEP_IDS)[number];

export const GUIDE_ACCOUNT_STATUSES = ["onboarding", "paused", "active", "archived"] as const;
export type GuideAccountStatus = (typeof GUIDE_ACCOUNT_STATUSES)[number];

export const GUIDE_DESTINATION_CHOICES = ["ghl", "google_sheets", "both", "intake_only", "undecided"] as const;
export type GuideDestinationChoice = (typeof GUIDE_DESTINATION_CHOICES)[number];

export const GUIDE_SOURCE_PROVIDERS = ["nextgen", "other", "undecided"] as const;
export type GuideSourceProvider = (typeof GUIDE_SOURCE_PROVIDERS)[number];

export type GuideFactState =
  | "saved"
  | "configured"
  | "verified"
  | "active"
  | "pending"
  | "unavailable"
  | "blocked"
  | "not_applicable";

/**
 * Authoritative read of one configuration-request GET.
 * Disabled, unauthorized, and unreadable are explicit. They are not "no request".
 */
export type GuideDestinationRequestRead =
  | { availability: "disabled"; message: string }
  | { availability: "unauthorized"; message: string }
  | { availability: "unreadable"; message: string }
  | {
      availability: "ready";
      request: { requestId: string; revision: number } | null;
      operational: { configured: boolean; deliveryActive: boolean };
    };

export type GuideFact = {
  id: string;
  label: string;
  state: GuideFactState;
  detail: string;
};

export type GuidedSourceOption = {
  id: string;
  label: string;
  provider: string;
  providerFunnelId: string | null;
  associationStatus: "confirmed" | "suggested" | "unassociated";
};

export type GuidedCampaignOption = {
  label: string;
  campaignId: string | null;
  /** Routing rule is in use. This is not delivery. */
  ruleOn: boolean;
  deliveryEnabled: boolean;
};

export type GuidedSetupDocument = {
  status: "draft" | "submitted" | "needs_information" | "setup_reviewed";
  revision: number;
  repairRequired: boolean;
  missingRequiredFields: string[];
  data: ClientSetupData;
};

export type GuidedRecordedSetup = {
  present: boolean;
  status: string | null;
  revision: number;
  destinationChoice: GuideDestinationChoice;
};

export type GuidedOnboardingModel = {
  clientAccountId: string;
  /** Native client setup flag is on and a readable document was loaded. */
  setupWritable: boolean;
  setupUnavailableReason: string | null;
  account: {
    clientDisplayName: string;
    status: GuideAccountStatus;
    primaryNicheKeys: string[];
    primaryProductTypes: string[];
  } | null;
  setup: GuidedSetupDocument | null;
  /** The setup document and the Team Workspace read disagreed. Do not save over it. */
  setupStale: boolean;
  /** Team Workspace read of the setup request. Not a second source of truth. */
  recordedSetup: GuidedRecordedSetup | null;
  sources: { availability: "ready" | "unavailable"; items: GuidedSourceOption[] };
  campaigns: { availability: "ready" | "unavailable"; rules: GuidedCampaignOption[] };
  destinations: {
    ghl: { configured: boolean; deliveryEnabled: boolean };
    companySheets: { configured: boolean; campaignDispatchEnabled: boolean; agedDispatchEnabled: boolean };
  } | null;
  verification: { availability: "ready"; blockers: string[] } | { availability: "unavailable" | "error" };
  /**
   * Authoritative read of the saved request against source and campaign records.
   * Missing means the check was not loaded. It is not a verification.
   */
  sourceCampaignReview?: SourceCampaignReviewView | null;
  /** Current request-chain head. Missing means the request route was not read. */
  sourceCampaignRequest?: SourceCampaignRequestView | null;
  /** GET of the GoHighLevel configuration request. Not destinationChoice and not local form state. */
  ghlConfigurationRequest: GuideDestinationRequestRead;
  /** GET of the Company Sheets configuration request. Not destinationChoice and not local form state. */
  companySheetsConfigurationRequest: GuideDestinationRequestRead;
  /** A setup request is never an operational switch. */
  operational: false;
};

export type GuidedSetupDraft = {
  clientDisplayName: string;
  accountStatus: GuideAccountStatus;
  primaryNicheKeys: string[];
  primaryProductTypes: string[];
  clientEmail: string;
  clientPhone: string;
  geography: string;
  sourceProvider: "" | GuideSourceProvider;
  trafficSourceName: string;
  providerFunnelId: string;
  providerCampaignId: string;
  sourceMissingInfoNotes: string;
  destinationChoice: "" | GuideDestinationChoice;
};

export type GuideFieldError = { field: string; message: string };

export type GuideSaveRecovery = {
  message: string;
  action: "reload" | "new_request" | "retry" | "none";
};

export const GUIDE_LIMITATIONS = [
  "Creating or changing a campaign routing rule is not available in this guided setup.",
  "Linking a lead source to this client is not available in this guided setup. A source and campaign association request is a separate saved proposal.",
  "Intended GoHighLevel and Company Sheets configuration requests can be saved here. Applying a request to the operational destination is a separate step, and this page does not apply it.",
  "A Company Sheets column-header match does not prove GoHighLevel survey-field mapping, and it does not prove Age or date-of-birth source normalization.",
  "The setup request can store one source name, one funnel id, and one campaign id. That draft is not the association request.",
  "Saving this request does not turn delivery on.",
  "A saved, configured, or verified row is not authorization to activate.",
] as const;

const PROFILE_CONTRACT_FIELDS = ["primaryNicheKeys", "primaryProductTypes"] as const;

export const GHL_REQUEST_NOT_LOADED: GuideDestinationRequestRead = {
  availability: "unreadable",
  message: "The GoHighLevel configuration request was not loaded. It is not treated as saved.",
};

export const SHEETS_REQUEST_NOT_LOADED: GuideDestinationRequestRead = {
  availability: "unreadable",
  message: "The Company Sheets configuration request was not loaded. It is not treated as saved.",
};

const AWAITING_APPLICATION = "Request saved — awaiting application";

const SETUP_TEXT_KEYS = [
  "clientEmail",
  "clientPhone",
  "geography",
  "setupOwner",
  "plannedGoLiveDate",
  "trafficSourceName",
  "nextgenFunnelName",
  "nextgenFunnelUrl",
  "providerFunnelId",
  "providerCampaignId",
  "sourceMissingInfoNotes",
  "testLeadUuid",
  "testSubmissionAt",
  "ghlLocationId",
  "ghlWorkflowId",
  "ghlAssignedUserId",
  "existingSpreadsheetUrl",
  "worksheetName",
  "googleAccountOwner",
  "requestedSpreadsheetName",
  "requestedFolder",
  "accessRecipient",
  "reviewNotes",
] as const satisfies readonly (keyof ClientSetupData)[];

const STEP_TITLES: Record<GuideStepId, string> = {
  client: "Client",
  information: "Client information",
  sources: "Lead sources and campaigns",
  destination: "Delivery destination",
  summary: "Save and review",
};

export const GUIDE_STEP_EXPLANATIONS: Record<GuideStepId, string> = {
  client: "Choose a client that already exists, or create one. Creating a client does not turn on delivery.",
  information:
    "Check the name and account status, then save contact details. A niche or a product selection does not finish this step. Account status is not lead delivery.",
  sources:
    "Save a source and campaign association request. A confirmed source link and an active routing rule stay separate, and this step does not create them.",
  destination:
    "Choose GoHighLevel, Company Sheets, both, or intake only. A saved choice is not a configuration request. An existing operational destination stays configured without a new request.",
  summary:
    "Review persisted client information, association requests, configuration requests, operational destinations, verification, and delivery. A draft or a destination choice does not finish setup.",
};

export function parseGuideStep(value: unknown): GuideStepId | null {
  return GUIDE_STEP_IDS.find((step) => step === value) ?? null;
}

export function guideStepTitle(step: GuideStepId): string {
  return STEP_TITLES[step];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (!trimmed || trimmed.length > max) return null;
  if (/token|secret|password/i.test(trimmed)) return null;
  return trimmed;
}

export function normalizeProfileList(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const out: string[] = [];
  for (const value of values) {
    const cleaned = cleanText(value, 80);
    if (!cleaned || out.includes(cleaned)) continue;
    out.push(cleaned);
    if (out.length >= 32) break;
  }
  return out;
}

function readAccountStatus(value: unknown): GuideAccountStatus {
  return GUIDE_ACCOUNT_STATUSES.find((status) => status === value) ?? "onboarding";
}

function readDestination(value: unknown): GuideDestinationChoice | null {
  return GUIDE_DESTINATION_CHOICES.find((choice) => choice === value) ?? null;
}

function readProvider(value: unknown): GuideSourceProvider | null {
  return GUIDE_SOURCE_PROVIDERS.find((provider) => provider === value) ?? null;
}

export function isGuideEmail(value: string): boolean {
  return value.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function textField(data: ClientSetupData, key: keyof ClientSetupData): string {
  const value = data[key];
  return typeof value === "string" ? value : "";
}

export function sanitizeSetupData(value: unknown): ClientSetupData {
  if (!isRecord(value)) return {};
  const data: ClientSetupData = {};
  for (const key of SETUP_TEXT_KEYS) {
    const item = value[key];
    if (item === null) {
      data[key] = null;
      continue;
    }
    if (typeof item === "string") data[key] = item;
  }
  const sourceProvider = readProvider(value.sourceProvider);
  if (sourceProvider) data.sourceProvider = sourceProvider;
  else if (value.sourceProvider === null) data.sourceProvider = null;
  const destinationChoice = readDestination(value.destinationChoice);
  if (destinationChoice) data.destinationChoice = destinationChoice;
  else if (value.destinationChoice === null) data.destinationChoice = null;
  if (value.sheetsMode === "existing" || value.sheetsMode === "create_new") data.sheetsMode = value.sheetsMode;
  else if (value.sheetsMode === null) data.sheetsMode = null;
  if (value.accessLevel === "viewer" || value.accessLevel === "commenter" || value.accessLevel === "editor") {
    data.accessLevel = value.accessLevel;
  } else if (value.accessLevel === null) data.accessLevel = null;
  if (typeof value.webhookConfigured === "boolean") data.webhookConfigured = value.webhookConfigured;
  if (typeof value.sourceTestSubmitted === "boolean") data.sourceTestSubmitted = value.sourceTestSubmitted;
  return data;
}

function readSetupDocument(item: unknown): GuidedSetupDocument | null {
  if (!isRecord(item)) return null;
  const revision = item.revision;
  if (typeof revision !== "number" || !Number.isInteger(revision) || revision < 0) return null;
  const status = item.status;
  const known = status === "draft" || status === "submitted" || status === "needs_information" || status === "setup_reviewed";
  if (!known) return null;
  const missing = Array.isArray(item.missingRequiredFields)
    ? item.missingRequiredFields.filter((field): field is string => typeof field === "string" && /^[A-Za-z0-9_]{1,80}$/.test(field)).slice(0, 24)
    : [];
  return {
    status,
    revision,
    repairRequired: item.repairRequired === true,
    missingRequiredFields: missing,
    data: sanitizeSetupData(item.data),
  };
}

function readSources(body: unknown): GuidedSourceOption[] {
  if (!isRecord(body) || !Array.isArray(body.items)) return [];
  const items: GuidedSourceOption[] = [];
  for (const item of body.items) {
    if (!isRecord(item) || typeof item.id !== "string" || !item.id.trim()) continue;
    const label =
      cleanText(item.observedFunnelName, 120) ??
      cleanText(item.pageSlug, 120) ??
      cleanText(item.provider, 120) ??
      "Lead source";
    if (/https?:|@/i.test(label)) continue;
    const association = item.associationStatus;
    items.push({
      id: item.id.trim().slice(0, 80),
      label,
      provider: cleanText(item.provider, 80) ?? "unknown",
      providerFunnelId: cleanText(item.providerFunnelId, 200),
      associationStatus: association === "confirmed" || association === "suggested" ? association : "unassociated",
    });
    if (items.length >= 24) break;
  }
  return items;
}

function readCampaigns(account: unknown): GuidedCampaignOption[] {
  if (!isRecord(account) || !Array.isArray(account.routingRules)) return [];
  const rules: GuidedCampaignOption[] = [];
  for (const rule of account.routingRules) {
    if (!isRecord(rule)) continue;
    const label = cleanText(rule.campaignName, 120) ?? cleanText(rule.utmCampaign, 120) ?? cleanText(rule.matchType, 120);
    if (!label || /https?:|@/i.test(label)) continue;
    rules.push({
      label,
      campaignId: cleanText(rule.campaignId, 200),
      ruleOn: rule.active === true,
      deliveryEnabled: rule.deliveryEnabled === true,
    });
    if (rules.length >= 12) break;
  }
  return rules;
}

function readAccount(account: unknown): GuidedOnboardingModel["account"] {
  if (!isRecord(account)) return null;
  const name = cleanText(account.clientDisplayName, 200);
  if (!name) return null;
  return {
    clientDisplayName: name,
    status: readAccountStatus(account.status),
    primaryNicheKeys: normalizeProfileList(account.primaryNicheKeys),
    primaryProductTypes: normalizeProfileList(account.primaryProductTypes),
  };
}

function readDestinations(value: unknown): GuidedOnboardingModel["destinations"] {
  if (!isRecord(value)) return null;
  const ghl = isRecord(value.ghl) ? value.ghl : {};
  const sheets = isRecord(value.companySheets) ? value.companySheets : {};
  return {
    ghl: { configured: ghl.configured === true, deliveryEnabled: ghl.deliveryEnabled === true },
    companySheets: {
      configured: sheets.configured === true,
      campaignDispatchEnabled: sheets.campaignDispatchEnabled === true,
      agedDispatchEnabled: sheets.agedDispatchEnabled === true,
    },
  };
}

function readRecordedSetup(value: unknown): GuidedRecordedSetup | null {
  if (!isRecord(value)) return null;
  const choice = readDestination(value.destinationChoice);
  const revision = value.revision;
  if (!choice || typeof revision !== "number" || !Number.isInteger(revision) || revision < 0) return null;
  return {
    present: value.present === true,
    status: cleanText(value.status, 80),
    revision,
    destinationChoice: choice,
  };
}

export function guidedOnboardingFromReads(input: {
  clientAccountId: string;
  setupEnabled: boolean;
  account: unknown;
  setupItem: unknown;
  setupError: string | null;
  sourceBody: unknown;
  sourceError: string | null;
  destinations: unknown;
  recordedSetup: unknown;
  verification: GuidedOnboardingModel["verification"];
  ghlConfigurationRequest?: GuideDestinationRequestRead;
  companySheetsConfigurationRequest?: GuideDestinationRequestRead;
}): GuidedOnboardingModel {
  const setup = input.setupEnabled ? readSetupDocument(input.setupItem) : null;
  const recorded = readRecordedSetup(input.recordedSetup);
  let setupUnavailableReason: string | null = null;
  if (!input.setupEnabled) {
    setupUnavailableReason = "Saving a setup request is unavailable. Native client setup is turned off.";
  } else if (setup?.repairRequired) {
    setupUnavailableReason =
      "The stored setup request cannot be read. This guided setup will not replace it. Open the client screen to recover it.";
  } else if (!setup) {
    setupUnavailableReason = input.setupError
      ? "The setup request could not be loaded. Nothing was saved. Reload and try again."
      : "No setup request is stored yet. You can save a draft.";
  } else if (recorded && (recorded.revision !== setup.revision || (recorded.present && recorded.destinationChoice !== (setup.data.destinationChoice ?? "undecided")))) {
    setupUnavailableReason =
      "The setup request changed while this page was loading. Reload it before saving so a newer request is not overwritten.";
  }
  const disagreement =
    Boolean(setup) &&
    !setup?.repairRequired &&
    Boolean(recorded) &&
    (recorded?.revision !== setup?.revision ||
      (recorded?.present === true && recorded.destinationChoice !== (setup?.data.destinationChoice ?? "undecided")));
  const setupWritable = Boolean(input.setupEnabled && setup && !setup.repairRequired && !disagreement) || Boolean(input.setupEnabled && !setup && !input.setupError);
  return {
    clientAccountId: input.clientAccountId,
    setupWritable,
    setupUnavailableReason: setupWritable && !setup ? null : setupUnavailableReason,
    account: readAccount(input.account),
    setup,
    setupStale: disagreement,
    recordedSetup: recorded,
    sources: {
      availability: input.sourceError ? "unavailable" : "ready",
      items: input.sourceError ? [] : readSources(input.sourceBody),
    },
    campaigns: {
      availability: isRecord(input.account) ? "ready" : "unavailable",
      rules: readCampaigns(input.account),
    },
    destinations: readDestinations(input.destinations),
    verification: input.verification,
    ghlConfigurationRequest: input.ghlConfigurationRequest ?? GHL_REQUEST_NOT_LOADED,
    companySheetsConfigurationRequest: input.companySheetsConfigurationRequest ?? SHEETS_REQUEST_NOT_LOADED,
    operational: false,
  };
}

export function emptyDraft(): GuidedSetupDraft {
  return {
    clientDisplayName: "",
    accountStatus: "onboarding",
    primaryNicheKeys: [],
    primaryProductTypes: [],
    clientEmail: "",
    clientPhone: "",
    geography: "",
    sourceProvider: "",
    trafficSourceName: "",
    providerFunnelId: "",
    providerCampaignId: "",
    sourceMissingInfoNotes: "",
    destinationChoice: "",
  };
}

export function draftFromModel(model: GuidedOnboardingModel | null): GuidedSetupDraft {
  const draft = emptyDraft();
  if (!model) return draft;
  if (model.account) {
    draft.clientDisplayName = model.account.clientDisplayName;
    draft.accountStatus = model.account.status;
    draft.primaryNicheKeys = [...model.account.primaryNicheKeys];
    draft.primaryProductTypes = [...model.account.primaryProductTypes];
  }
  const data = model.setup?.data;
  if (!data) {
    if (model.recordedSetup?.present) draft.destinationChoice = model.recordedSetup.destinationChoice;
    return draft;
  }
  draft.clientEmail = textField(data, "clientEmail");
  draft.clientPhone = textField(data, "clientPhone");
  draft.geography = textField(data, "geography");
  draft.sourceProvider = data.sourceProvider ?? "";
  draft.trafficSourceName = textField(data, "trafficSourceName");
  draft.providerFunnelId = textField(data, "providerFunnelId");
  draft.providerCampaignId = textField(data, "providerCampaignId");
  draft.sourceMissingInfoNotes = textField(data, "sourceMissingInfoNotes");
  draft.destinationChoice = data.destinationChoice ?? "";
  return draft;
}

export function guideSyncToken(model: GuidedOnboardingModel | null): string {
  if (!model) return "none";
  return JSON.stringify({
    id: model.clientAccountId,
    revision: model.setup?.revision ?? model.recordedSetup?.revision ?? 0,
    writable: model.setupWritable,
    draft: draftFromModel(model),
  });
}

function blankToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function setupDataFromDraft(draft: GuidedSetupDraft, previous: ClientSetupData | null): ClientSetupData {
  return sanitizeSetupData({
    ...(previous ?? {}),
    clientEmail: blankToNull(draft.clientEmail),
    clientPhone: blankToNull(draft.clientPhone),
    geography: blankToNull(draft.geography),
    sourceProvider: draft.sourceProvider || null,
    trafficSourceName: blankToNull(draft.trafficSourceName),
    providerFunnelId: blankToNull(draft.providerFunnelId),
    providerCampaignId: blankToNull(draft.providerCampaignId),
    sourceMissingInfoNotes: blankToNull(draft.sourceMissingInfoNotes),
    destinationChoice: draft.destinationChoice || null,
  });
}

export function applyListedSource(draft: GuidedSetupDraft, source: GuidedSourceOption): GuidedSetupDraft {
  const provider = source.provider.toLowerCase().includes("nextgen") ? "nextgen" : draft.sourceProvider || "other";
  return {
    ...draft,
    sourceProvider: provider,
    trafficSourceName: source.label,
    providerFunnelId: source.providerFunnelId ?? "",
  };
}

export function applyListedCampaign(draft: GuidedSetupDraft, campaign: GuidedCampaignOption): GuidedSetupDraft {
  return {
    ...draft,
    providerCampaignId: campaign.campaignId || campaign.label,
    trafficSourceName: draft.trafficSourceName || campaign.label,
  };
}

export function validateDraft(draft: GuidedSetupDraft, mode: "account" | "setup"): GuideFieldError[] {
  const errors: GuideFieldError[] = [];
  const name = draft.clientDisplayName.trim();
  if (mode === "account") {
    if (!name) errors.push({ field: "clientDisplayName", message: "Enter the client name." });
    else if (name.length > 200) errors.push({ field: "clientDisplayName", message: "Use a client name of 200 characters or fewer." });
    if (!GUIDE_ACCOUNT_STATUSES.includes(draft.accountStatus)) {
      errors.push({ field: "accountStatus", message: "Choose an account status. This does not turn delivery on." });
    }
  }
  const email = draft.clientEmail.trim();
  if (email && !isGuideEmail(email)) {
    errors.push({ field: "clientEmail", message: "Enter a valid email, or leave email blank." });
  }
  if (draft.clientPhone.trim().length > 40) errors.push({ field: "clientPhone", message: "Use a phone number of 40 characters or fewer." });
  if (draft.geography.trim().length > 500) errors.push({ field: "geography", message: "Use a shorter geography description." });
  if (draft.trafficSourceName.trim().length > 200) {
    errors.push({ field: "trafficSourceName", message: "Use a source name of 200 characters or fewer." });
  }
  if (draft.providerFunnelId.trim().length > 200) {
    errors.push({ field: "providerFunnelId", message: "Use a funnel id of 200 characters or fewer." });
  }
  if (draft.providerCampaignId.trim().length > 200) {
    errors.push({ field: "providerCampaignId", message: "Use a campaign id of 200 characters or fewer." });
  }
  if (draft.sourceMissingInfoNotes.trim().length > 2000) {
    errors.push({ field: "sourceMissingInfoNotes", message: "Shorten the source note to 2000 characters or fewer." });
  }
  if (draft.destinationChoice && !GUIDE_DESTINATION_CHOICES.includes(draft.destinationChoice)) {
    errors.push({ field: "destinationChoice", message: "Choose GoHighLevel, Company Sheets, or both." });
  }
  return errors;
}

export function validateNewClient(input: { clientAccountId: string; clientDisplayName: string }): GuideFieldError[] {
  const errors: GuideFieldError[] = [];
  const name = input.clientDisplayName.trim();
  if (!name) errors.push({ field: "clientDisplayName", message: "Enter the client name." });
  else if (name.length > 200) errors.push({ field: "clientDisplayName", message: "Use a client name of 200 characters or fewer." });
  if (!isSafeTeamWorkspaceId(input.clientAccountId) || !/^[a-z][a-z0-9_]*$/.test(input.clientAccountId)) {
    errors.push({
      field: "clientAccountId",
      message: "Use lowercase letters, numbers, and underscores, beginning with a letter.",
    });
  }
  return errors;
}

function persistedDestinationChoice(model: GuidedOnboardingModel): GuideDestinationChoice | null {
  if (model.setupStale) return null;
  const fromSetup = model.setup?.data.destinationChoice;
  if (fromSetup && fromSetup !== "undecided") return fromSetup;
  if (!model.setup && model.recordedSetup?.present && model.recordedSetup.destinationChoice !== "undecided") {
    return model.recordedSetup.destinationChoice;
  }
  return null;
}

function destinationScope(choice: GuideDestinationChoice | null): {
  ghl: boolean;
  sheets: boolean;
  intakeOnly: boolean;
  chosen: boolean;
} {
  if (choice === "ghl") return { ghl: true, sheets: false, intakeOnly: false, chosen: true };
  if (choice === "google_sheets") return { ghl: false, sheets: true, intakeOnly: false, chosen: true };
  if (choice === "both") return { ghl: true, sheets: true, intakeOnly: false, chosen: true };
  if (choice === "intake_only") return { ghl: false, sheets: false, intakeOnly: true, chosen: true };
  return { ghl: false, sheets: false, intakeOnly: false, chosen: false };
}

type OperationalEvidence = { known: boolean; configured: boolean; active: boolean };

function operationalEvidence(
  workspace: { configured: boolean; active: boolean } | null,
  request: GuideDestinationRequestRead
): OperationalEvidence {
  const fromRequest = request.availability === "ready" ? request.operational : null;
  if (!workspace && !fromRequest) return { known: false, configured: false, active: false };
  return {
    known: true,
    configured: Boolean(workspace?.configured || fromRequest?.configured),
    active: Boolean(workspace?.active || fromRequest?.deliveryActive),
  };
}

function ghlOperational(model: GuidedOnboardingModel): OperationalEvidence {
  return operationalEvidence(
    model.destinations ? { configured: model.destinations.ghl.configured, active: model.destinations.ghl.deliveryEnabled } : null,
    model.ghlConfigurationRequest
  );
}

function sheetsOperational(model: GuidedOnboardingModel): OperationalEvidence {
  const sheets = model.destinations?.companySheets;
  return operationalEvidence(
    sheets
      ? { configured: sheets.configured, active: Boolean(sheets.campaignDispatchEnabled || sheets.agedDispatchEnabled) }
      : null,
    model.companySheetsConfigurationRequest
  );
}

function requestStored(read: GuideDestinationRequestRead): { requestId: string; revision: number } | null {
  return read.availability === "ready" ? read.request : null;
}

function clientInformationFact(model: GuidedOnboardingModel): GuideFact {
  if (!model.account) {
    return {
      id: "client_information",
      label: "Client information",
      state: "unavailable",
      detail: "Client information could not be loaded. A niche or product selection is not treated as saved.",
    };
  }
  if (!model.setup || model.setup.repairRequired) {
    return {
      id: "client_information",
      label: "Client information",
      state: "pending",
      detail: "Client information is pending. The stored setup request cannot confirm the checklist, so a niche or product selection is not treated as saved.",
    };
  }
  const missingProfile = PROFILE_CONTRACT_FIELDS.filter((field) => model.setup?.missingRequiredFields.includes(field));
  const nicheSaved = model.account.primaryNicheKeys.length > 0;
  const productSaved = model.account.primaryProductTypes.length > 0;
  const contact = [textField(model.setup.data, "clientEmail"), textField(model.setup.data, "clientPhone"), textField(model.setup.data, "geography")].filter(Boolean);
  if (!nicheSaved || !productSaved || missingProfile.length > 0) {
    const missingLabels = [
      !nicheSaved || missingProfile.includes("primaryNicheKeys") ? "niche" : null,
      !productSaved || missingProfile.includes("primaryProductTypes") ? "product" : null,
    ].filter((item): item is string => Boolean(item));
    return {
      id: "client_information",
      label: "Client information",
      state: "pending",
      detail: `Client information is pending. The setup checklist still needs ${missingLabels.join(" and ") || "the saved profile"}. Selecting a niche or a product does not finish this step.`,
    };
  }
  const contactDetail = contact.length > 0 ? ` Contact details on the setup request: ${contact.join(", ")}.` : " Contact details are not stored. The checklist does not add a contact field beyond niche and product.";
  return {
    id: "client_information",
    label: "Client information",
    state: "saved",
    detail: `Client information is saved. Niche and product are both on the stored account, and the setup checklist does not still list them.${contactDetail} Account status is not lead delivery.`,
  };
}

function sourceRequestFact(model: GuidedOnboardingModel): GuideFact & { awaitingApplication?: boolean } {
  const request = model.sourceCampaignRequest;
  if (!request) {
    return {
      id: "source_campaign_request",
      label: "Source and campaign request",
      state: "unavailable",
      detail: "The source and campaign request was not loaded. A setup draft, a confirmed source link, or a routing rule is not treated as that request.",
    };
  }
  if (request.availability === "disabled" || request.availability === "error") {
    return {
      id: "source_campaign_request",
      label: "Source and campaign request",
      state: "unavailable",
      detail: request.message,
    };
  }
  if (request.openRequest) {
    return {
      id: "source_campaign_request",
      label: "Source and campaign request",
      state: "saved",
      awaitingApplication: true,
      detail: `${AWAITING_APPLICATION}. Revision ${request.openRequest.revision}. This proposal is not a confirmed source link and not an active routing rule.`,
    };
  }
  return {
    id: "source_campaign_request",
    label: "Source and campaign request",
    state: "pending",
    detail: "No source and campaign association request is stored. A funnel or campaign on the setup draft is not that request. A confirmed source link and a routing rule are recorded separately.",
  };
}

function configurationRequestFact(input: {
  id: string;
  label: string;
  read: GuideDestinationRequestRead;
  required: boolean;
  intakeOnly: boolean;
  chosen: boolean;
  operational: OperationalEvidence;
}): GuideFact & { awaitingApplication?: boolean } {
  const stored = requestStored(input.read);
  if (input.read.availability === "disabled" || input.read.availability === "unauthorized" || input.read.availability === "unreadable") {
    return {
      id: input.id,
      label: input.label,
      state: "unavailable",
      detail: input.read.message,
    };
  }
  if (stored) {
    return {
      id: input.id,
      label: input.label,
      state: "saved",
      awaitingApplication: true,
      detail: `${input.label}: ${AWAITING_APPLICATION}. Revision ${stored.revision}. This stored request is not an operational destination, and it is not verified or active.${input.intakeOnly ? " Delivery is not ready." : ""}`,
    };
  }
  if (input.operational.configured) {
    return {
      id: input.id,
      label: input.label,
      state: "pending",
      detail: input.operational.active
        ? `No ${input.label} is stored. The existing destination is already active, and it is not relabeled as a new request.`
        : `No ${input.label} is stored. The existing destination is already configured, so a new request is not required to call it configured. Delivery on that destination is off.`,
    };
  }
  if (!input.required) {
    if (!input.chosen) {
      return {
        id: input.id,
        label: input.label,
        state: "pending",
        detail: `No ${input.label} is stored. A destination has not been saved, so this request is not required yet.`,
      };
    }
    return {
      id: input.id,
      label: input.label,
      state: "not_applicable",
      detail: input.intakeOnly
        ? `${input.label} is not applicable for intake only. No delivery destination is requested, and delivery is not ready.`
        : `${input.label} is not applicable for the saved destination. Nothing was inferred from the other destination.`,
    };
  }
  return {
    id: input.id,
    label: input.label,
    state: "pending",
    detail: `No ${input.label} is stored. A destination choice does not create one.`,
  };
}

export function guideFacts(model: GuidedOnboardingModel): Array<GuideFact & { awaitingApplication?: boolean }> {
  const destinationChoice = persistedDestinationChoice(model);
  const scope = destinationScope(destinationChoice);
  const ghlOps = ghlOperational(model);
  const sheetsOps = sheetsOperational(model);
  const deliveryAlreadyOn = Boolean(ghlOps.active || sheetsOps.active || model.campaigns.rules.some((rule) => rule.deliveryEnabled));

  const setupState: GuideFact = model.setupStale
    ? {
        id: "setup_request",
        label: "Setup request",
        state: "blocked",
        detail: model.setupUnavailableReason ?? "The setup request changed. Reload it before saving.",
      }
    : !model.setup
    ? {
        id: "setup_request",
        label: "Setup request",
        state: model.setupWritable ? "pending" : "unavailable",
        detail: model.setupUnavailableReason ?? "No setup request is stored yet. Saving one does not activate delivery.",
      }
    : model.setup.repairRequired
      ? {
          id: "setup_request",
          label: "Setup request",
          state: "blocked",
          detail: model.setupUnavailableReason ?? "The stored setup request cannot be read.",
        }
      : {
          id: "setup_request",
          label: "Setup request",
          state: "saved",
          detail: `Saved as ${model.setup.status.replaceAll("_", " ")}. Revision ${model.setup.revision}. A saved request is not a live configuration.`,
        };

  const reviewState: GuideFact =
    model.setup?.status === "setup_reviewed"
      ? {
          id: "setup_review",
          label: "Setup review",
          state: "verified",
          detail: "A reviewer marked this setup request reviewed. Verified is not delivery activation.",
        }
      : model.setup?.status === "needs_information"
        ? {
            id: "setup_review",
            label: "Setup review",
            state: "blocked",
            detail: "The setup request is waiting on information. It is not verified.",
          }
        : {
            id: "setup_review",
            label: "Setup review",
            state: model.setup ? "pending" : "unavailable",
            detail: "This request has not been marked reviewed. Saved does not mean verified.",
          };

  const confirmedSources = model.sources.items.filter((item) => item.associationStatus === "confirmed").length;
  const sourceRows: GuideFact =
    model.sources.availability !== "ready"
      ? {
          id: "linked_sources",
          label: "Linked lead sources",
          state: "unavailable",
          detail: "The lead-source list could not be loaded. Nothing was linked.",
        }
      : confirmedSources > 0
        ? {
            id: "linked_sources",
            label: "Linked lead sources",
            state: "configured",
            detail: `${confirmedSources} linked lead source${confirmedSources === 1 ? " is" : "s are"} already configured. This page did not change them.`,
          }
        : {
            id: "linked_sources",
            label: "Linked lead sources",
            state: "pending",
            detail: "No linked lead source is configured. Linking one is not available in this guided setup.",
          };

  const armedRules = model.campaigns.rules.filter((rule) => rule.deliveryEnabled).length;
  const campaignRows: GuideFact =
    model.campaigns.availability !== "ready"
      ? {
          id: "campaign_rules",
          label: "Campaign routing rules",
          state: "unavailable",
          detail: "Campaign rules could not be loaded. No rule was created.",
        }
      : armedRules > 0
        ? {
            id: "campaign_rules",
            label: "Campaign routing rules",
            state: "active",
            detail: "Delivery is already on for a campaign rule. This guided setup did not turn it on and will not change the rule.",
          }
        : model.campaigns.rules.length > 0
          ? {
              id: "campaign_rules",
              label: "Campaign routing rules",
              state: "configured",
              detail: `${model.campaigns.rules.length} routing rule${model.campaigns.rules.length === 1 ? " is" : "s are"} configured. Configured is not active, and this page cannot edit the rules.`,
            }
          : {
              id: "campaign_rules",
              label: "Campaign routing rules",
              state: "pending",
              detail: "No campaign routing rule is configured. Creating one is not available here.",
            };

  const ghlFact: GuideFact = destinationOperationalFact("ghl_destination", "GoHighLevel destination", ghlOps, "GoHighLevel");
  const sheetsFact: GuideFact = destinationOperationalFact("sheets_destination", "Company Sheets destination", sheetsOps, "Company Sheets");
  const ghlRequestFact = configurationRequestFact({
    id: "ghl_configuration_request",
    label: "GoHighLevel configuration request",
    read: model.ghlConfigurationRequest,
    required: scope.ghl,
    intakeOnly: scope.intakeOnly,
    chosen: scope.chosen,
    operational: ghlOps,
  });
  const sheetsRequestFact = configurationRequestFact({
    id: "sheets_configuration_request",
    label: "Company Sheets configuration request",
    read: model.companySheetsConfigurationRequest,
    required: scope.sheets,
    intakeOnly: scope.intakeOnly,
    chosen: scope.chosen,
    operational: sheetsOps,
  });
  const information = clientInformationFact(model);
  const sourceRequest = sourceRequestFact(model);

  const verificationFact: GuideFact =
    model.verification.availability !== "ready"
      ? {
          id: "verification",
          label: "Onboarding verification",
          state: "unavailable",
          detail: "Verification is unavailable. It was not treated as passed.",
        }
      : model.verification.blockers.length > 0
        ? {
            id: "verification",
            label: "Onboarding verification",
            state: "blocked",
            detail: `Verification is available and reported a blocker: ${model.verification.blockers.join(", ").replaceAll("_", " ")}. This page did not clear it.`,
          }
        : model.setup?.status === "setup_reviewed"
          ? {
              id: "verification",
              label: "Onboarding verification",
              state: "verified",
              detail: "Verification is available and the setup request was marked reviewed. That review is not delivery activation and not an applied destination.",
            }
          : {
              id: "verification",
              label: "Onboarding verification",
              state: "pending",
              detail: "Verification is available and reported no blocker. The setup request has not been marked reviewed, so verification has not passed.",
            };

  return [
    model.account
      ? {
          id: "client_account",
          label: "Client account",
          state: "saved",
          detail: `${model.account.clientDisplayName} is saved. Account status: ${model.account.status}. That status is not lead delivery.`,
        }
      : {
          id: "client_account",
          label: "Client account",
          state: "unavailable",
          detail: "Client details could not be loaded. Nothing was changed.",
        },
    information,
    setupState,
    reviewState,
    sourceRequest,
    sourceRows,
    campaignRows,
    scope.chosen
      ? {
          id: "destination_choice",
          label: "Destination choice",
          state: "saved",
          detail: scope.intakeOnly
            ? "Intake only is saved on the setup request. Delivery destinations are not applicable, and delivery is not ready."
            : "The intended destination is saved on the setup request. A saved choice is not a configuration request, not an operational destination, and not delivery.",
        }
      : {
          id: "destination_choice",
          label: "Destination choice",
          state: model.setupStale ? "blocked" : model.setupWritable || model.recordedSetup ? "pending" : "unavailable",
          detail: model.setupStale
            ? "The destination choice could not be confirmed because the setup request changed. Reload it before treating a choice as saved."
            : "GoHighLevel, Company Sheets, both, or intake only has not been saved on the setup request.",
        },
    ghlRequestFact,
    sheetsRequestFact,
    ghlFact,
    sheetsFact,
    verificationFact,
    {
      id: "activation",
      label: "Delivery activation",
      state: deliveryAlreadyOn ? "active" : "pending",
      detail: deliveryAlreadyOn
        ? "Delivery is already active on an existing destination or campaign rule. This is not a new configuration request, and this guided setup cannot change it."
        : scope.intakeOnly
          ? "Delivery is off. Intake only means delivery is not ready."
          : "Delivery is off. A saved configuration request does not turn it on.",
    },
  ];
}

function destinationOperationalFact(id: string, label: string, evidence: OperationalEvidence, name: string): GuideFact {
  if (!evidence.known) {
    return {
      id,
      label,
      state: "unavailable",
      detail: `The ${name} operational destination could not be read. A configuration request was not assumed, and this page did not create a destination.`,
    };
  }
  if (evidence.active) {
    return {
      id,
      label,
      state: "active",
      detail: `${name} delivery is already active on the existing destination. This is not a new configuration request. This guided setup did not turn it on and cannot turn it off.`,
    };
  }
  if (evidence.configured) {
    return {
      id,
      label,
      state: "configured",
      detail: `A ${name} destination is configured. Delivery is off. This is existing operational evidence, not a new configuration request, and this page cannot edit that destination.`,
    };
  }
  return {
    id,
    label,
    state: "pending",
    detail: `No ${name} operational destination is configured. A destination choice or a stored request does not create one.`,
  };
}

export type GuideStepProgress = {
  id: GuideStepId;
  title: string;
  state: GuideFactState;
  badge: string;
  explanation: string;
};

export type GuideProgress = {
  steps: GuideStepProgress[];
  summary: string;
  remaining: string[];
};

function badgeFor(state: GuideFactState, awaitingApplication = false): string {
  if (awaitingApplication) return AWAITING_APPLICATION;
  if (state === "saved") return "Saved";
  if (state === "configured") return "Configured";
  if (state === "verified") return "Verified";
  if (state === "active") return "Active";
  if (state === "blocked") return "Blocked";
  if (state === "unavailable") return "Unavailable";
  if (state === "not_applicable") return "Not applicable";
  return "Pending";
}

export function guideRemaining(model: GuidedOnboardingModel): string[] {
  const facts = guideFacts(model);
  const fact = (id: string) => facts.find((item) => item.id === id);
  const remaining: string[] = [];
  const information = fact("client_information");
  if (information?.state !== "saved") remaining.push(information?.detail ?? "Save client information from the stored account and setup checklist.");
  const source = fact("source_campaign_request");
  if (source?.state !== "saved") remaining.push(source?.detail ?? "Save a source and campaign association request.");
  else remaining.push(source.detail);
  for (const id of ["ghl_configuration_request", "sheets_configuration_request"] as const) {
    const request = fact(id);
    if (!request || request.state === "not_applicable") continue;
    remaining.push(request.detail);
  }
  const verification = fact("verification");
  if (verification) remaining.push(verification.detail);
  const activation = fact("activation");
  if (activation?.state !== "active") remaining.push(activation?.detail ?? "Delivery is off.");
  if (fact("ghl_destination")?.state === "configured" || fact("sheets_destination")?.state === "configured") {
    remaining.push("An existing operational destination is recognized on its own. A new configuration request is not required to call that destination configured.");
  }
  return remaining;
}

export function guideSummary(model: GuidedOnboardingModel | null): string {
  if (!model) return "Choose a client. Delivery is off.";
  const facts = guideFacts(model);
  const fact = (id: string) => facts.find((item) => item.id === id);
  const sentences = [
    fact("client_information")?.detail,
    fact("source_campaign_request")?.detail,
    fact("ghl_configuration_request")?.detail,
    fact("sheets_configuration_request")?.detail,
    fact("ghl_destination")?.detail,
    fact("sheets_destination")?.detail,
    fact("verification")?.detail,
    fact("activation")?.detail,
  ].filter((sentence): sentence is string => Boolean(sentence));
  return sentences.join(" ");
}

function destinationStep(model: GuidedOnboardingModel, facts: Array<GuideFact & { awaitingApplication?: boolean }>): { state: GuideFactState; badge: string } {
  const choice = persistedDestinationChoice(model);
  const scope = destinationScope(choice);
  const ghlRequest = facts.find((item) => item.id === "ghl_configuration_request");
  const sheetsRequest = facts.find((item) => item.id === "sheets_configuration_request");
  const ghlDestination = facts.find((item) => item.id === "ghl_destination");
  const sheetsDestination = facts.find((item) => item.id === "sheets_destination");
  if (!scope.chosen) {
    const destinationStates = [ghlDestination?.state, sheetsDestination?.state];
    if (ghlRequest?.state === "unavailable" || sheetsRequest?.state === "unavailable") {
      if (!destinationStates.some((state) => state === "configured" || state === "active")) {
        return { state: "unavailable", badge: "Unavailable" };
      }
    }
    if (ghlRequest?.awaitingApplication || sheetsRequest?.awaitingApplication) {
      return { state: "saved", badge: AWAITING_APPLICATION };
    }
    if (destinationStates.includes("active")) return { state: "active", badge: "Active" };
    if (destinationStates.includes("configured")) return { state: "configured", badge: "Configured" };
    return { state: model.setupStale ? "blocked" : "pending", badge: model.setupStale ? "Blocked" : "Pending" };
  }
  const required = [
    scope.ghl ? { request: ghlRequest, destination: ghlDestination } : null,
    scope.sheets ? { request: sheetsRequest, destination: sheetsDestination } : null,
  ].filter((item): item is { request: typeof ghlRequest; destination: typeof ghlDestination } => Boolean(item));
  if (scope.intakeOnly) {
    const stored = [ghlRequest, sheetsRequest].some((item) => item?.awaitingApplication);
    const unread = [ghlRequest, sheetsRequest].some((item) => item?.state === "unavailable");
    if (unread) return { state: "unavailable", badge: "Unavailable" };
    if (stored) return { state: "saved", badge: AWAITING_APPLICATION };
    return { state: "not_applicable", badge: "Not applicable" };
  }
  const settled = (state: GuideFactState | undefined) => state === "configured" || state === "active";
  const unreadRequired = required.some((item) => item.request?.state === "unavailable" && !settled(item.destination?.state));
  if (unreadRequired) return { state: "unavailable", badge: "Unavailable" };
  const pendingRequired = required.some((item) => item.request?.state === "pending" && !settled(item.destination?.state));
  if (pendingRequired) return { state: "pending", badge: "Pending" };
  const requestStillWaiting = required.some((item) => item.request?.awaitingApplication && !settled(item.destination?.state));
  if (requestStillWaiting) return { state: "saved", badge: AWAITING_APPLICATION };
  if (required.every((item) => item.destination?.state === "active")) return { state: "active", badge: "Active" };
  if (required.every((item) => settled(item.destination?.state))) return { state: "configured", badge: "Configured" };
  return { state: "pending", badge: "Pending" };
}

export function guideProgress(model: GuidedOnboardingModel | null): GuideProgress {
  const facts = model ? guideFacts(model) : [];
  const information = facts.find((item) => item.id === "client_information");
  const source = facts.find((item) => item.id === "source_campaign_request");
  const verification = facts.find((item) => item.id === "verification");
  const destination = model ? destinationStep(model, facts) : { state: "unavailable" as const, badge: "Unavailable" };
  const steps: GuideStepProgress[] = [
    {
      id: "client",
      title: STEP_TITLES.client,
      state: model?.account ? "saved" : "pending",
      badge: model?.account ? "Saved" : "Pending",
      explanation: GUIDE_STEP_EXPLANATIONS.client,
    },
    {
      id: "information",
      title: STEP_TITLES.information,
      state: information?.state ?? "unavailable",
      badge: badgeFor(information?.state ?? "unavailable"),
      explanation: GUIDE_STEP_EXPLANATIONS.information,
    },
    {
      id: "sources",
      title: STEP_TITLES.sources,
      state: source?.state ?? "unavailable",
      badge: badgeFor(source?.state ?? "unavailable", source?.awaitingApplication),
      explanation: GUIDE_STEP_EXPLANATIONS.sources,
    },
    {
      id: "destination",
      title: STEP_TITLES.destination,
      state: destination.state,
      badge: destination.badge,
      explanation: GUIDE_STEP_EXPLANATIONS.destination,
    },
    {
      id: "summary",
      title: STEP_TITLES.summary,
      state: model ? "pending" : "unavailable",
      badge: verification?.state === "unavailable" ? "Verification unavailable" : "In review",
      explanation: GUIDE_STEP_EXPLANATIONS.summary,
    },
  ];
  return {
    steps,
    summary: guideSummary(model),
    remaining: model ? guideRemaining(model) : ["Choose a client. Delivery is off."],
  };
}

export function guideBlockers(model: GuidedOnboardingModel): string[] {
  const blockers: string[] = [...GUIDE_LIMITATIONS];
  if (model.setupUnavailableReason && !model.setupWritable) blockers.unshift(model.setupUnavailableReason);
  if (model.sources.availability !== "ready") blockers.push("The lead-source list could not be loaded.");
  if (!model.destinations && model.ghlConfigurationRequest.availability !== "ready" && model.companySheetsConfigurationRequest.availability !== "ready") {
    blockers.push("Operational destinations could not be read, so configured and active are unknown.");
  }
  for (const read of [model.ghlConfigurationRequest, model.companySheetsConfigurationRequest]) {
    if (read.availability === "disabled" || read.availability === "unauthorized" || read.availability === "unreadable") {
      blockers.push(read.message);
    }
  }
  if (!model.sourceCampaignRequest) blockers.push("The source and campaign request was not loaded. It is not treated as saved.");
  else if (model.sourceCampaignRequest.availability !== "ready") blockers.push(model.sourceCampaignRequest.message);
  if (model.verification.availability !== "ready") blockers.push("Verification is unavailable. It was not treated as passed.");
  else if (model.verification.blockers.length > 0) {
    blockers.push(...model.verification.blockers.map((blocker) => blocker.replaceAll("_", " ")));
  }
  if (model.setup?.missingRequiredFields.length) {
    blockers.push(
      `Still empty before a later review submission: ${model.setup.missingRequiredFields.join(", ")}. A draft can be saved while these are empty.`
    );
  }
  return blockers;
}

export function readGuidedFailure(error: string): { code: string | null; message: string } {
  const start = error.indexOf("{");
  if (start >= 0) {
    try {
      const parsed = JSON.parse(error.slice(start)) as { code?: unknown; error?: unknown };
      const code = typeof parsed.code === "string" && /^[A-Za-z0-9_]{1,64}$/.test(parsed.code) ? parsed.code : null;
      const message = typeof parsed.error === "string" && parsed.error.trim() ? parsed.error.trim() : error;
      return { code, message };
    } catch {
      return { code: null, message: error };
    }
  }
  return { code: null, message: error };
}

export function guideSaveRecovery(code: string | null, error: string): GuideSaveRecovery {
  const parsed = readGuidedFailure(error);
  const resolved = code ?? parsed.code;
  const message = parsed.message || error || "The save did not finish.";
  if (resolved === "STALE_WRITE") return { message, action: "reload" };
  if (resolved === "REQUEST_ID_CONFLICT") {
    return {
      message: "This save id was already used for a different change. Start a new save.",
      action: "new_request",
    };
  }
  if (resolved === "SETUP_REPAIR_REQUIRED" || resolved === "FEATURE_DISABLED" || resolved === "OPERATIONAL_EFFECT" || resolved === "CONFLICT") {
    return { message, action: "none" };
  }
  if (resolved === "NOT_FOUND") return { message: "This client was not found. Return to the client list and choose the current account.", action: "reload" };
  if (resolved === "UNCERTAIN") {
    return {
      message: message || "The request did not finish. Try the same save again. Delivery was not turned on.",
      action: "retry",
    };
  }
  if (resolved === "VALIDATION") return { message, action: "retry" };
  return { message: message || "The save did not finish. Try again.", action: "retry" };
}
