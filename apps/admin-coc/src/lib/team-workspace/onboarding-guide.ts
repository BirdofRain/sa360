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
  | "blocked";

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
  "Linking a lead source to this client is not available in this guided setup.",
  "Saving a GoHighLevel location or a Company Sheets spreadsheet is not available in this guided setup.",
  "The setup request can store one source name, one funnel id, and one campaign id.",
  "Saving this request does not turn delivery on.",
  "A saved, configured, or verified row is not authorization to activate.",
] as const;

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
    "Check the name and account status, then add contact details. Account status is not lead delivery.",
  sources:
    "Record the lead source and campaign you intend to use. This does not create a routing rule or link a source.",
  destination: "Choose GoHighLevel, Company Sheets, or both. The choice is a request. It does not arm delivery.",
  summary: "Save the setup request, then review what is saved, configured, verified, active, or still blocked.",
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

function choiceSaved(choice: GuideDestinationChoice | "" | null | undefined): boolean {
  return choice === "ghl" || choice === "google_sheets" || choice === "both" || choice === "intake_only";
}

function sourceRequestSaved(data: ClientSetupData | undefined): boolean {
  if (!data) return false;
  return Boolean(data.sourceProvider || textField(data, "trafficSourceName") || textField(data, "providerCampaignId"));
}

export function guideFacts(model: GuidedOnboardingModel): GuideFact[] {
  const data = model.setup?.data;
  const destinationChoice = data?.destinationChoice ?? (model.setup ? null : model.recordedSetup?.present ? model.recordedSetup.destinationChoice : null);
  const ghl = model.destinations?.ghl ?? null;
  const sheets = model.destinations?.companySheets ?? null;
  const deliveryAlreadyOn = Boolean(ghl?.deliveryEnabled || sheets?.campaignDispatchEnabled || sheets?.agedDispatchEnabled || model.campaigns.rules.some((rule) => rule.deliveryEnabled));

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

  const ghlFact: GuideFact = !ghl
    ? {
        id: "ghl_destination",
        label: "GoHighLevel destination",
        state: "unavailable",
        detail: "The GoHighLevel destination could not be read. This page did not create one.",
      }
    : ghl.deliveryEnabled
      ? {
          id: "ghl_destination",
          label: "GoHighLevel destination",
          state: "active",
          detail: "Live delivery is already on. This guided setup did not turn it on and cannot turn it off.",
        }
      : ghl.configured
        ? {
            id: "ghl_destination",
            label: "GoHighLevel destination",
            state: "configured",
            detail: "A GoHighLevel destination is configured. Live delivery is off. This page cannot edit that destination.",
          }
        : {
            id: "ghl_destination",
            label: "GoHighLevel destination",
            state: "pending",
            detail: "No GoHighLevel destination is configured. Saving a destination choice does not create one.",
          };

  const sheetsActive = Boolean(sheets?.campaignDispatchEnabled || sheets?.agedDispatchEnabled);
  const sheetsFact: GuideFact = !sheets
    ? {
        id: "sheets_destination",
        label: "Company Sheets destination",
        state: "unavailable",
        detail: "The Company Sheets destination could not be read. This page did not create one.",
      }
    : sheetsActive
      ? {
          id: "sheets_destination",
          label: "Company Sheets destination",
          state: "active",
          detail: "Sheets dispatch is already on. This guided setup did not turn it on and cannot turn it off.",
        }
      : sheets.configured
        ? {
            id: "sheets_destination",
            label: "Company Sheets destination",
            state: "configured",
            detail: "A Company Sheets destination is configured. Dispatch is off. This page cannot edit that destination.",
          }
        : {
            id: "sheets_destination",
            label: "Company Sheets destination",
            state: "pending",
            detail: "No Company Sheets destination is configured. Saving a destination choice does not create one.",
          };

  const verificationFact: GuideFact =
    model.verification.availability !== "ready"
      ? {
          id: "verification",
          label: "Onboarding verification",
          state: "unavailable",
          detail: "Onboarding verification could not be read, so this client is not marked verified.",
        }
      : model.verification.blockers.length > 0
        ? {
            id: "verification",
            label: "Onboarding verification",
            state: "blocked",
            detail: `Onboarding reported a blocker: ${model.verification.blockers.join(", ").replaceAll("_", " ")}. This page did not clear it.`,
          }
        : {
            id: "verification",
            label: "Onboarding verification",
            state: "pending",
            detail: "No onboarding blocker was reported. That is not a verification of live delivery.",
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
    setupState,
    reviewState,
    sourceRequestSaved(data)
      ? {
          id: "lead_source_request",
          label: "Source and campaign request",
          state: "saved",
          detail: "The source and campaign on the setup request are saved. This is not a routing rule.",
        }
      : {
          id: "lead_source_request",
          label: "Source and campaign request",
          state: model.setupWritable ? "pending" : "unavailable",
          detail: "No source or campaign is saved on the setup request yet.",
        },
    sourceRows,
    campaignRows,
    choiceSaved(destinationChoice)
      ? {
          id: "destination_choice",
          label: "Destination choice",
          state: "saved",
          detail: "The intended destination is saved on the setup request. Saved is not configured and not active.",
        }
      : {
          id: "destination_choice",
          label: "Destination choice",
          state: model.setupWritable || model.recordedSetup ? "pending" : "unavailable",
          detail: "GoHighLevel, Company Sheets, or both has not been chosen on the setup request.",
        },
    ghlFact,
    sheetsFact,
    verificationFact,
    {
      id: "activation",
      label: "Delivery activation",
      state: deliveryAlreadyOn ? "active" : "pending",
      detail: deliveryAlreadyOn
        ? "Delivery is already active somewhere on this client. This guided setup cannot change that, and saving a request does not authorize it."
        : "Delivery is not active from this setup. Saving the request does not turn it on.",
    },
  ];
}

export type GuideStepProgress = {
  id: GuideStepId;
  title: string;
  state: GuideFactState;
  explanation: string;
};

export function guideProgress(model: GuidedOnboardingModel | null): { steps: GuideStepProgress[]; savedCount: number } {
  const facts = model ? guideFacts(model) : [];
  const fact = (id: string) => facts.find((item) => item.id === id);
  const informationSaved = Boolean(
    model?.account &&
      (model.account.primaryNicheKeys.length > 0 ||
        model.account.primaryProductTypes.length > 0 ||
        model.setup?.data.clientEmail ||
        model.setup?.data.clientPhone ||
        model.setup?.data.geography)
  );
  const steps: GuideStepProgress[] = [
    {
      id: "client",
      title: STEP_TITLES.client,
      state: model?.account ? "saved" : "pending",
      explanation: GUIDE_STEP_EXPLANATIONS.client,
    },
    {
      id: "information",
      title: STEP_TITLES.information,
      state: model?.account ? (informationSaved ? "saved" : "pending") : "unavailable",
      explanation: GUIDE_STEP_EXPLANATIONS.information,
    },
    {
      id: "sources",
      title: STEP_TITLES.sources,
      state: fact("lead_source_request")?.state === "saved" ? "saved" : fact("campaign_rules")?.state === "configured" ? "configured" : fact("linked_sources")?.state === "configured" ? "configured" : model ? "pending" : "unavailable",
      explanation: GUIDE_STEP_EXPLANATIONS.sources,
    },
    {
      id: "destination",
      title: STEP_TITLES.destination,
      state: fact("destination_choice")?.state === "saved" ? "saved" : model ? "pending" : "unavailable",
      explanation: GUIDE_STEP_EXPLANATIONS.destination,
    },
    {
      id: "summary",
      title: STEP_TITLES.summary,
      state: fact("setup_request")?.state === "saved" ? "saved" : fact("setup_request")?.state === "blocked" ? "blocked" : model?.setupWritable ? "pending" : "unavailable",
      explanation: GUIDE_STEP_EXPLANATIONS.summary,
    },
  ];
  return {
    steps,
    savedCount: steps.filter((step) => step.state === "saved").length,
  };
}

export function guideBlockers(model: GuidedOnboardingModel): string[] {
  const blockers: string[] = [...GUIDE_LIMITATIONS];
  if (model.setupUnavailableReason && !model.setupWritable) blockers.unshift(model.setupUnavailableReason);
  if (model.sources.availability !== "ready") blockers.push("The lead-source list could not be loaded.");
  if (!model.destinations) blockers.push("Live destination rows could not be read, so configured and active are unknown.");
  if (model.verification.availability !== "ready") blockers.push("Onboarding verification is unavailable, so this client is not marked verified.");
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
