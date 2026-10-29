import { COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V3 } from "@sa360/shared";

import type {
  OnboardingGate,
  OnboardingSourceProof,
  OnboardingSummary,
  OnboardingTestAttempt,
  TriState,
} from "./types.ts";

export const LIVE_DELIVERY_ADAPTERS_APPROVED = false;

export const ACTIVATION_INTENT_CONFIRMATION = "ACTIVATE CLIENT ONBOARDING DESTINATION";

export const UNCERTAIN_OUTCOME_LABEL = "Outcome uncertain — manual review required";

export const FULL_HISTORY_UNAVAILABLE = "Full history unavailable";

export const FOLDER_RESOLVED_NOT_LINKED = "Folder resolved — link or select it before browsing";

/** GET onboarding omits ClientOnboardingDestinationProfile.revision. setupRequest.revision is a different row. */
export const MISSING_PROFILE_REVISION_READ =
  "Missing read: GET /admin/v1/clients/:clientAccountId/onboarding must return ClientOnboardingDestinationProfile.revision. setupRequest.revision is the setup request and is not that profile. GET /admin/v1/clients/:clientAccountId/onboarding/ghl-workflows does not return it either.";

/** Linked-folder list cannot browse a folder that resolve left unsaved. */
export const MISSING_RESOLVED_FOLDER_BROWSE =
  "Missing read: no endpoint lists spreadsheets in a resolved folder without linking it. GET /admin/v1/clients/:clientAccountId/google-sheets/folder/spreadsheets lists only the already linked client folder. POST /admin/v1/clients/:clientAccountId/onboarding/drive/search does not accept a resolved folder id.";

/** Detail-by-id exists. A list does not, and the summary does not return run ids. */
export const MISSING_TEST_RUN_LIST =
  "Missing read: GET /admin/v1/clients/:clientAccountId/onboarding/test-runs is not a list. GET /admin/v1/clients/:clientAccountId/onboarding/test-runs/:testRunId reads one known id, and the onboarding summary does not return those ids.";

export const CLIENT_ONBOARDING_PATH_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

export const GHL_PROOF_FACTS = [
  "http_accepted",
  "contact_upserted",
  "note_persisted",
  "workflow_enrolled",
  "downstream_executed",
] as const;

export type GhlProofFact = (typeof GHL_PROOF_FACTS)[number];

const GATE_LABELS: Record<string, string> = {
  leadcapture_linked: "LeadCapture linked",
  leadcapture_observed: "LeadCapture observed",
  leadcapture_routing_matched: "LeadCapture routing verified",
  meta_capture_only_acknowledged: "Meta capture-only acknowledged",
  meta_linked: "Facebook linked",
  meta_routing_matched: "Facebook routing verified",
  sheets_destination_saved: "Sheets destination saved",
  sheets_control_verified: "Sheets control verified",
  sheets_tab_explicitly_bound: "Worksheet explicitly bound",
  sheets_header_dispatch_ready: "Header ready for dispatch",
  sheets_custom_map_published: "Custom column map published",
  sheets_permission_probe: "Sheets permission tested",
  sheets_writer_receipt: "Sheets writer receipt",
  sheets_no_uncertain_job: "No uncertain Sheets job",
  ghl_mode_explicit: "GHL mode explicit",
  ghl_location_configured: "GHL location configured",
  ghl_webhook_stored_disabled: "GHL webhook stored disabled",
  ghl_note_contract_ready: "Notes v2 contract ready",
  zapier_not_disabled: "External Zapier left in place",
  aged_not_activated_by_onboarding: "Aged dispatch not activated by onboarding",
};

const CLASSIFICATION_COPY: Record<string, string> = {
  v3_exact_header: "Exact v3 header. Fast path is available only after an explicit bind.",
  v3_prefix_with_extra_columns: "Starts with the v3 header and has extra columns. Not the fast path.",
  known_schema_exact: "Known v1 or v2 header. Not the v3 fast path.",
  compatible_empty: "Empty grid. Not a legacy map and not yet a v3 header.",
  legacy_custom_required: "Legacy header. Historical rows stay. Map these columns before delivery. This is not the v3 template review.",
  stats_excluded: "Stats worksheet. Preserved and excluded from delivery.",
  not_grid: "Not a grid worksheet.",
  incompatible: "Header is not a supported campaign schema.",
};

export function gateLabel(id: string): string {
  return GATE_LABELS[id] ?? id;
}

export function classificationCopy(classification: string): string {
  return CLASSIFICATION_COPY[classification] ?? classification;
}

export function schemaForClassification(classification: string): string | null {
  if (classification === "v3_exact_header") return COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V3;
  return null;
}

export function sourceIdentityLabel(source: OnboardingSourceProof): string {
  const identity = source.identity;
  if (source.sourceKind === "leadcapture") {
    return identity.parentUrlKey || identity.pageSlug || identity.providerFunnelId || "No form or parent URL is stored";
  }
  return identity.providerFunnelId || identity.parentUrlKey || "No page and form association is stored";
}

export function sourcesByKind(
  sources: readonly OnboardingSourceProof[],
  kinds: readonly OnboardingSourceProof["sourceKind"][]
): OnboardingSourceProof[] {
  return sources.filter((source) => kinds.includes(source.sourceKind));
}

export type SelectableLead = {
  sourceLeadEventId: string;
  sourceKind: OnboardingSourceProof["sourceKind"];
  at: string | null;
  captureOnly: boolean;
  identity: string;
  routingDryRunDecisionId: string | null;
};

/** Only an observed stored event is selectable. Linked alone is not a lead. */
export function selectableStoredLeads(sources: readonly OnboardingSourceProof[]): SelectableLead[] {
  const leads: SelectableLead[] = [];
  const seen = new Set<string>();
  for (const source of sources) {
    const id = source.proofs.observed.sourceLeadEventId;
    if (!source.proofs.observed.satisfied || !id || seen.has(id)) continue;
    seen.add(id);
    leads.push({
      sourceLeadEventId: id,
      sourceKind: source.sourceKind,
      at: source.proofs.observed.at ?? null,
      captureOnly: source.proofs.observed.captureOnly,
      identity: sourceIdentityLabel(source),
      routingDryRunDecisionId: source.proofs.routingMatched.routingDryRunDecisionId,
    });
  }
  return leads;
}

export type SheetDeliveryStates = {
  saved: TriState;
  bound: TriState;
  permissionTested: TriState;
  deliveryActive: TriState;
  writeReadiness: string | null;
};

export function sheetDeliveryStates(summary: OnboardingSummary | null): SheetDeliveryStates {
  if (!summary) {
    return {
      saved: "unknown",
      bound: "unknown",
      permissionTested: "unknown",
      deliveryActive: "unknown",
      writeReadiness: null,
    };
  }
  const bound = summary.gates.find((gate) => gate.id === "sheets_tab_explicitly_bound");
  const readiness = summary.sheets.writeReadiness;
  return {
    saved: summary.sheets.destinationSaved ? "yes" : "no",
    bound: bound ? (bound.satisfied ? "yes" : "no") : "no",
    permissionTested: readiness === "verified" ? "yes" : "no",
    deliveryActive: summary.sheets.campaignDispatchEnabled ? "yes" : "no",
    writeReadiness: readiness,
  };
}

export type SheetsMutationGate = "allowed" | "active" | "unknown";

export function knownProfileRevision(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) return null;
  return value;
}

export function sheetsMutationGate(
  summary: OnboardingSummary | null,
  dispatch: { campaignDispatchEnabled: boolean; agedDispatchEnabled: boolean } | null
): SheetsMutationGate {
  if (!summary || !dispatch) return "unknown";
  if (
    summary.sheets.campaignDispatchEnabled ||
    summary.sheets.agedDispatchEnabled ||
    dispatch.campaignDispatchEnabled ||
    dispatch.agedDispatchEnabled
  ) {
    return "active";
  }
  return "allowed";
}

export function clientSwitchLine(
  summary: OnboardingSummary | null,
  dispatch: { dispatchFlagEnabled: boolean } | null
): string {
  const campaign = summary ? (summary.sheets.campaignDispatchEnabled ? "yes" : "no") : "unknown";
  const aged = summary ? (summary.sheets.agedDispatchEnabled ? "yes" : "no") : "unknown";
  const global = dispatch ? (dispatch.dispatchFlagEnabled ? "yes" : "no") : "unknown";
  return `Client campaign switch: ${campaign}. Aged dispatch: ${aged}. Global infrastructure: ${global}. This workspace does not change those switches.`;
}

const SHEET_PREREQUISITE_IDS = new Set([
  "sheets_destination_saved",
  "sheets_control_verified",
  "sheets_tab_explicitly_bound",
  "sheets_header_dispatch_ready",
  "sheets_custom_map_published",
  "sheets_permission_probe",
  "sheets_no_uncertain_job",
]);

export function requiredGaps(gates: readonly OnboardingGate[]): OnboardingGate[] {
  return gates.filter((gate) => gate.required && !gate.satisfied);
}

/** Sheet gates that apply once the destination profile selects Sheets. A writer receipt is not one of them. */
export function sheetSelectionPrerequisites(gates: readonly OnboardingGate[]): OnboardingGate[] {
  return gates.filter((gate) => SHEET_PREREQUISITE_IDS.has(gate.id));
}

/**
 * Checking Sheets makes the sheet gates prerequisites immediately.
 * A custom map is one of those prerequisites when it is already required or when a published map already matches.
 */
export function sheetPrerequisiteRequired(gate: OnboardingGate, sheetsChecked: boolean): boolean {
  if (gate.required) return true;
  if (!sheetsChecked || !SHEET_PREREQUISITE_IDS.has(gate.id)) return false;
  if (gate.id === "sheets_custom_map_published") return gate.satisfied;
  return true;
}

/** Production receipt evidence. A missing receipt is visible here and is not a first-activation blocker. */
export function postActivationEvidence(gates: readonly OnboardingGate[]): OnboardingGate[] {
  return gates.filter((gate) => gate.role === "evidence" || gate.id === "sheets_writer_receipt");
}

export function ghlProofFromAttempts(
  attempts: readonly OnboardingTestAttempt[]
): Record<GhlProofFact, "proven" | "unproven"> {
  const proven = new Set(attempts.flatMap((attempt) => attempt.proves));
  return {
    http_accepted: proven.has("http_accepted") ? "proven" : "unproven",
    contact_upserted: proven.has("contact_upserted") ? "proven" : "unproven",
    note_persisted: proven.has("note_persisted") ? "proven" : "unproven",
    workflow_enrolled: proven.has("workflow_enrolled") ? "proven" : "unproven",
    downstream_executed: proven.has("downstream_executed") ? "proven" : "unproven",
  };
}

export function runNeedsManualReview(status: string | null | undefined): boolean {
  return status === "uncertain";
}

export function validDriveQuery(query: string): boolean {
  const trimmed = query.trim();
  if (!trimmed || trimmed.length > 80) return false;
  return !/[\u0000-\u001f\u007f]/.test(trimmed);
}

const ACTION_ERRORS: Record<string, string> = {
  onboarding_read_disabled:
    "Onboarding read is disabled. The read flag is off, so this screen is not showing a substitute client.",
  onboarding_config_disabled: "Onboarding config is disabled. The change was not saved.",
  captured_test_disabled: "Captured test delivery is disabled. No external call was made.",
  destination_disabled: "Company Sheets setup is disabled. Drive was not searched.",
  client_not_found: "This client was not found.",
  invalid_request: "That entry is not a valid search or folder reference.",
  invalid_body: "That entry does not match the onboarding contract.",
  invalid_confirmation: "The confirmation or test identity does not match the required value.",
  revision_conflict:
    "The destination profile revision does not match this screen. Nothing was overwritten. The selection on this screen was kept.",
  profile_revision_unavailable: MISSING_PROFILE_REVISION_READ,
  active_destination_unchanged:
    "This client's Sheets delivery is already on. This workspace did not pause, replace, or bind a different destination.",
  dispatch_unknown: "The client delivery switch was not loaded. Nothing was saved or bound.",
  pause_delivery_first:
    "Delivery is active on a different spreadsheet. This workspace did not pause it or replace the destination.",
  workflow_not_found: "Select Time Zone was not found in the stored location snapshot.",
  workflow_ambiguous: "More than one Select Time Zone workflow was found. None was selected.",
  workflow_name_mismatch: "The workflow name no longer matches Select Time Zone. It was not saved.",
  event_not_found: "That stored lead could not be loaded.",
  event_not_client_owned: "That lead is not owned by this client.",
  forbidden: "This session cannot call onboarding.",
  unauthorized: "Sign in is required.",
  request_failed: "The admin API did not return a usable onboarding response.",
  malformed_response: "The admin API response did not match the onboarding contract.",
  invalid_spreadsheet_ref: "That spreadsheet id is not a Google spreadsheet id.",
  delivery_not_paused: "Pause campaign Sheets delivery before changing the target or the column map.",
  destination_not_configured: "This client has no Sheets destination yet. The target was not saved.",
  stats_tab_not_a_delivery_target: "Stats and non-grid tabs stay in place. They are not delivery targets.",
  reconcile_incomplete: "The row probe was truncated, so this tab was not selected.",
  tenant_mismatch: "That spreadsheet is already saved for another client.",
  worksheet_blocked: "The change was refused because a delivery switch or cutoff moved.",
  header_changed:
    "The worksheet header changed. Delivery stopped before any append. Review the new headers and publish a new map. Existing rows were not rewritten.",
  mapping_required: "This tab needs a published column map before a row can be appended.",
  mapping_unresolved: "Every column needs an explicit mapped or unmapped decision before publish.",
  custom_writer_disabled: "The custom writer flag is off, so a live lead was not appended. A paused controlled test does not use that flag.",
  partial_row_confirmed: "Google inserted one row and a later cell update did not finish. That row was not appended again.",
  partial_row_hold:
    "This hold stays in place. RETRY AFTER RECONCILE does not append another row and does not release the lock. Use ACCEPT RECONCILED ROW after the inserted row is identified.",
  reconciled_row_mismatch: "That sheet row does not match the snapshotted delivery. The lock stays and nothing was appended.",
  cutoff_retained: "The destination still has a cutoff, so it was not deleted.",
  unresolved_delivery: "Unresolved delivery work is still open, so the destination was not deleted.",
  not_found: "The admin API does not have this onboarding route yet. Nothing was saved.",
  required_field_unmapped: "A phone, email, or name column is still unmapped.",
  duplicate_target: "Two columns map to the same lead field.",
  published_map_exists: "Retire the published map before publishing a replacement.",
  use_existing_v3_bind: "This header matches an existing campaign schema. Use that bind. A custom map was not created.",
  ambiguous_age_or_dob: "Age/DOB needs an explicit Age, DOB, or blank decision. Age is not calculated.",
  primary_reason_is_not_primary_concern: "Primary Reason and Primary Concern stay separate.",
  unknown_target: "That destination column is not a stored lead field.",
  blank_header: "A blank header cannot be mapped.",
  activation_disabled: "Activation is disabled. Delivery was not turned on.",
  test_worksheet_not_approved: "The exact-v3 worksheet reader is not mounted, so approval did not run.",
};

export function actionErrorCopy(error: string): string {
  return ACTION_ERRORS[error] ?? error;
}

export function triLabel(value: TriState, yes: string, no: string): string {
  if (value === "yes") return yes;
  if (value === "no") return no;
  return "Unknown";
}

export function noteEventFromSourceLead(detail: {
  id: string;
  leadName: string | null;
  email: string | null;
  phone: string | null;
  receivedAt: string;
  rawPayloadJson: unknown;
  normalizedPayloadJson: unknown;
  enrichmentMetadataJson: unknown;
}): Record<string, unknown> {
  const raw = asRecord(detail.rawPayloadJson);
  const normalized = asRecord(detail.normalizedPayloadJson);
  const enrichment = asRecord(detail.enrichmentMetadataJson);
  const contact = asRecord(normalized?.contact);
  return {
    sourceLeadEventId: detail.id,
    generatedAt: detail.receivedAt,
    fullName: detail.leadName,
    firstName: stringOrNull(contact?.first_name),
    lastName: stringOrNull(contact?.last_name),
    email: detail.email ?? stringOrNull(contact?.email),
    phone: detail.phone ?? stringOrNull(contact?.phone_e164) ?? stringOrNull(contact?.phone),
    sourceAttributes: asRecord(enrichment?.sourceAttributes) ?? asRecord(normalized?.sourceAttributes),
    unmappedSourceFields: arrayOrNull(enrichment?.unmappedSourceFields),
    answerFields: arrayOrNull(enrichment?.answerFields) ?? arrayOrNull(normalized?.answerFields),
    answers: asRecord(raw?.answers),
    form: asRecord(raw?.form),
    field_data: Array.isArray(raw?.field_data) ? raw.field_data : undefined,
    metaFieldData: Array.isArray(enrichment?.metaFieldData) ? enrichment.metaFieldData : undefined,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function arrayOrNull(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}
