/**
 * View of the client-onboarding v2 read and config contracts.
 * Field names match the Admin API. This module does not decide delivery.
 */

export type OnboardingProofFlag = {
  satisfied: boolean;
  at?: string | null;
};

export type OnboardingSourceProof = {
  sourceKind: "leadcapture" | "meta_lead_ads" | "zapier_facebook";
  sourceFunnelId: string;
  associationStatus: string;
  identity: {
    provider: string;
    providerFunnelId: string | null;
    parentUrlKey: string | null;
    pageSlug: string | null;
  };
  nextAction?: string | null;
  proofs: {
    linked: OnboardingProofFlag;
    observed: OnboardingProofFlag & {
      sourceLeadEventId: string | null;
      intakeStage: string | null;
      captureOnly: boolean;
    };
    routingMatched: {
      satisfied: boolean;
      authority: string | null;
      routingDryRunDecisionId: string | null;
      matchedRuleId: string | null;
      looseRuleIgnored: string | null;
    };
    delivery: {
      satisfied: boolean;
      sheetsJobId: string | null;
      ghlReceiptId: string | null;
    };
  };
};

export type OnboardingGate = {
  id: string;
  required: boolean;
  satisfied: boolean;
  evidenceIds: string[];
};

export type OnboardingGhlMode = "unset" | "location_api" | "inbound_webhook" | "external_zapier";

export type OnboardingSummary = {
  ok: true;
  contractVersion: "client_onboarding_v2";
  client: {
    clientAccountId: string;
    clientDisplayName: string;
    status: string;
    primaryNicheKeys: string[];
    primaryProductTypes: string[];
  };
  setupRequest: {
    present: boolean;
    status: string | null;
    revision: number;
    destinationChoice: string | null;
    operational: false;
  };
  sources: OnboardingSourceProof[];
  evidenceTruncated?: boolean;
  sheets: {
    destinationSaved: boolean;
    spreadsheetId: string | null;
    campaignTab: string | null;
    campaignDispatchEnabled: boolean;
    campaignDispatchNotBefore: string | null;
    agedDispatchEnabled: boolean;
    writeReadiness: string | null;
    deliveryExecution: string | null;
    uncertainJob: boolean;
  };
  ghl: {
    mode: OnboardingGhlMode;
    locationIdPresent: boolean;
    workflowTriggerMode: string | null;
    workflowIdPresent: boolean;
    inboundWebhookArmed: boolean;
    notesEnabled: boolean;
    notesContractVersion: string | null;
  };
  externalZapier: { preserved: true; replacedByNative: false };
  destinationProfile?: {
    present: boolean;
    revision: number;
    sheetsSelected: boolean;
    ghlMode: OnboardingGhlMode;
    notesEnabled: boolean;
  };
  runtime?: {
    onboardingReadEnabled: boolean;
    onboardingConfigEnabled: boolean;
    capturedTestEnabled: boolean;
    ghlLocationTestAdapterApproved: boolean;
    ghlProductionHostAllowed: false;
    companySheetsEnabled: boolean;
    companySheetsExecutionEnabled: boolean;
    companySheetsDispatchEnabled: boolean;
    activationEnabled: false;
    clientStatus: string;
  };
  gates: OnboardingGate[];
  liveActivationPerformedByOnboarding: false;
  blockers: string[];
};

export type CompanyConnectionIdentity = {
  status: string;
  connected: boolean;
  googleEmail: string | null;
  googleDisplayName: string | null;
  connectedAt: string | null;
  liveDeliveryEnabled: false;
};

export type OnboardingDriveItem = {
  id: string;
  title: string;
  kind: "folder" | "spreadsheet" | "shortcut";
  trashed: boolean;
  shortcut: boolean;
  selectable: boolean;
  reason: string | null;
};

export type OnboardingDriveSearch = {
  saved: false;
  items: OnboardingDriveItem[];
  suggestions: OnboardingDriveItem[];
  nameMatch: "none" | "unique" | "ambiguous";
  selectedFolderId: null;
  nextPageToken: string | null;
};

export type OnboardingFolderResolve = {
  saved: false;
  linked?: false;
  folder: { folderId: string; title: string; driveId: string | null; basis: string };
  next?: {
    action: "browse_spreadsheets";
    method: "POST";
    path: string;
    savesFolder: false;
    savesDestination: false;
  };
};

export type OnboardingSpreadsheetListItem = {
  spreadsheetId: string;
  title: string;
  url: string;
};

export type OnboardingSheetClassification =
  | "v3_exact_header"
  | "v3_prefix_with_extra_columns"
  | "known_schema_exact"
  | "compatible_empty"
  | "legacy_custom_required"
  | "stats_excluded"
  | "not_grid"
  | "incompatible";

export type OnboardingWorksheetPreview = {
  worksheetId: number;
  title: string;
  grid: boolean;
  header: string[];
  headerColumnCount: number;
  historicalDataRows: "empty" | "has_rows" | "truncated";
  historicalDataRowCount?: number;
  classification: OnboardingSheetClassification | string;
  fastPath: boolean;
  deliveryEligible: boolean;
  requiresExplicitSelection: boolean;
  headerDrift?: boolean;
  reasons: string[];
};

export type OnboardingSheetPreview = {
  saved: false;
  spreadsheetId: string;
  spreadsheetTitle: string;
  recommendation: {
    worksheetId: number;
    title: string;
    classification: "v3_exact_header";
    fastPath: true;
    selected: false;
    bound: false;
    existingBinding: boolean;
    requiresExplicitSelection: true;
  } | null;
  selection: {
    worksheetTitle: string | null;
    worksheetId: number | null;
    applied: false;
    bound: false;
  } | null;
  worksheets: OnboardingWorksheetPreview[];
};

export type OnboardingWorkflowMatch = {
  workflowMatch: "unique" | "workflow_ambiguous" | "workflow_not_found" | string;
  workflowId: string | null;
  workflowName: string | null;
  matches: Array<{ id: string; name: string }>;
  discoveryWired: boolean;
  createdWorkflow: false;
  createdCustomField: false;
  error: string | null;
};

export type OnboardingWorkflowSave = {
  persisted: boolean;
  revision?: number | null;
  workflowId: string | null;
  workflowName: string | null;
  deliveryEnabled: boolean | null;
  clientCutoverApproved: boolean | null;
  workflowTriggerMode: string | null;
  createdWorkflow: false;
  createdCustomField: false;
};

export type OnboardingDestinationSave = {
  revision: number;
  notesEnabled: boolean;
  notesContractVersion: string | null;
  ghlMode: string;
  sheetsSelected: boolean;
  deliveryEnabled: boolean;
  campaignDispatchEnabled: boolean;
  deliverySwitchChanged: false;
  liveActivationPerformedByOnboarding: false;
};

export type OnboardingNotePreview = {
  posted: false;
  contractVersion: string | null;
  title: string | null;
  body: string | null;
  status: string | null;
  keptAnswerCount: number | null;
  qaEvidence: {
    status: "complete" | "discarded_duplicates" | "not_recoverable" | string;
    fullQaCompletenessAsserted: boolean;
    discardedDuplicateCount: number;
  } | null;
  externalCalls: { ghl: false; providerWebhook: false; sheets: false };
};

export type OnboardingTestAttempt = {
  id: string;
  destination: string;
  status: string;
  proves: string[];
  doesNotProve: string[];
  externalCallExecuted: boolean;
  downstreamExecuted: false;
  detail: string | null;
};

export type OnboardingTestPreviewSheet = {
  worksheetTitle: string | null;
  worksheetRole: string | null;
  schemaVersion: string | null;
  header: string[] | null;
  values: string[] | null;
  valuesSha256: string | null;
  deliveryRowId: string | null;
  sourceLeadEventId: string | null;
};

export type OnboardingTestRun = {
  testRunId: string | null;
  status: string | null;
  kind: string | null;
  persisted: boolean;
  warningCodes: string[];
  attempts: OnboardingTestAttempt[];
  sheet: OnboardingTestPreviewSheet | null;
  noteBodySha256: string | null;
  noteContract: string | null;
  externalCalls: { providerWebhook: boolean; sheets: boolean; ghl: boolean };
  sourceDeliverySatisfied: false;
  downstreamExecuted: false;
  resendAuthorized: false;
  appendStartedAtCleared: false;
  locksCleared: false;
};

export type OnboardingTestIdentity = {
  email: string | null;
  phoneE164: string | null;
  persisted: boolean;
};

export type OnboardingActivationIntent = {
  id: string;
  status: "ready_for_operator" | "blocked" | string;
  activatesDelivery: false;
  liveActivationPerformedByOnboarding: false;
};

export type OnboardingActionFailure = {
  ok: false;
  error: string;
  status: number;
};

export type OnboardingActionSuccess<T> = { ok: true; data: T };

export type OnboardingActionResult<T> = OnboardingActionSuccess<T> | OnboardingActionFailure;

export type OnboardingWorkspaceActions = {
  searchDrive: (input: {
    scope: "approved_parent" | "client_folder";
    query: string;
  }) => Promise<OnboardingActionResult<OnboardingDriveSearch>>;
  resolveFolder: (folder: string) => Promise<OnboardingActionResult<OnboardingFolderResolve>>;
  listSpreadsheets: () => Promise<OnboardingActionResult<OnboardingSpreadsheetListItem[]>>;
  browseResolvedFolder?: (folderId: string) => Promise<OnboardingActionResult<OnboardingSpreadsheetListItem[]>>;
  saveSpreadsheetDestination?: (input: {
    spreadsheetId: string;
    worksheetId: number;
  }) => Promise<OnboardingActionResult<{ spreadsheetId: string }>>;
  bindCampaignWorksheet?: (input: {
    worksheetId: number;
  }) => Promise<OnboardingActionResult<{ destinationRevision: number }>>;
  approveTestWorksheet?: (input: {
    spreadsheetId: string;
    worksheetId: number;
  }) => Promise<OnboardingActionResult<{ worksheetId: number }>>;
  probeSheetWrite?: (input: {
    spreadsheetId: string;
    worksheetId: number;
  }) => Promise<OnboardingActionResult<{ canEdit: boolean | null }>>;
  listTestRuns?: () => Promise<OnboardingActionResult<StoredTestRunView[]>>;
  previewSpreadsheet: (spreadsheetId: string) => Promise<OnboardingActionResult<OnboardingSheetPreview>>;
  saveDestination: (input: {
    expectedRevision: number;
    sheetsSelected: boolean;
    ghlMode: OnboardingGhlMode;
    notesEnabled: boolean;
  }) => Promise<OnboardingActionResult<OnboardingDestinationSave>>;
  loadWorkflows: () => Promise<OnboardingActionResult<OnboardingWorkflowMatch>>;
  saveWorkflow: (input: {
    expectedRevision: number;
    discoveredWorkflowId: string;
    discoveredName: string;
  }) => Promise<OnboardingActionResult<OnboardingWorkflowSave>>;
  previewNote: (sourceLeadEventId: string) => Promise<OnboardingActionResult<OnboardingNotePreview>>;
  saveTestIdentity: (input: {
    email: string;
    phoneE164: string;
  }) => Promise<OnboardingActionResult<OnboardingTestIdentity>>;
  previewStoredLead: (input: {
    sourceLeadEventId: string;
    destinations: Array<"google_sheets" | "ghl_location_api">;
  }) => Promise<OnboardingActionResult<OnboardingTestRun>>;
  recordActivationIntent: (input: {
    destination: "google_sheets_campaign" | "ghl_location_api";
    confirmation: string;
  }) => Promise<OnboardingActionResult<OnboardingActivationIntent>>;
};

export type StoredTestRunView = {
  id: string;
  kind: string;
  status: string;
  sourceLeadEventId: string | null;
  attempts: OnboardingTestAttempt[];
  sheet: OnboardingTestPreviewSheet | null;
  noteBody?: string | null;
  noteContract: string | null;
  qaEvidence?: OnboardingNotePreview["qaEvidence"];
  resendAuthorized: false;
  reconcileObservation: string | null;
};

export type TriState = "yes" | "no" | "unknown";
