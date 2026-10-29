import { createHash, randomUUID } from "node:crypto";

import { isCompanySheetsInternalPilotLead } from "@sa360/shared";

import {
  COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V3,
  COMPANY_SHEETS_CANARY_HEADER,
  COMPANY_SHEETS_CANARY_SCHEMA_VERSION,
  companySheetsCampaignHeader,
} from "../../lib/company-google-sheets-env.js";
import { COMPANY_SHEETS_INTERNAL_TEST_CLIENT } from "../company-sheets-dispatch/company-sheets-campaign-pilot.js";
import {
  campaignLeadIdentityFromPayload,
  companySheetsCampaignRowValues,
} from "../company-sheets-dispatch/company-sheets-onboarding-read.js";
import { COMPANY_SHEETS_CAMPAIGN_CUSTOM_SCHEMA } from "../company-sheets-delivery/company-sheets-custom-row.js";
import type {
  OnboardingGhlTestDeliveryReceipt,
  OnboardingGhlTestDeliveryRequest,
} from "./onboarding-ghl-test-adapter.js";
import { operatorOwnedIntake } from "./google-only-quarantine.js";
import {
  buildOnboardingGhlAggregateRequest,
  projectOnboardingGhlReceipt,
} from "./onboarding-ghl-aggregate-execution.js";
import {
  CONFIRM_ONE_CUSTOM_SHEETS_ROW,
  CUSTOM_CAMPAIGN_SHEETS_CONTRACT,
  isSyntheticCampaignTestEvent,
  planCustomCampaignSheet,
  type CustomCampaignSheetPlan,
  type PublishedCampaignMapSnapshot,
} from "./custom-captured-sheet.js";

export { CONFIRM_ONE_CUSTOM_SHEETS_ROW, CUSTOM_CAMPAIGN_SHEETS_CONTRACT };

/**
 * Captured-lead delivery planner and orchestrator.
 *
 * Implemented here: validation, tenant checks, test identity, idempotency keys,
 * separate Sheets and GHL attempts, and fail-closed uncertainty.
 *
 * Not implemented here, and not enabled by any flag this module sets:
 * Prisma persistence for test runs, attempts, identities, and audit rows;
 * session-role authorization; importing Agent B's formatter;
 * live Google appends; live GHL location calls.
 * `adaptAgentBLeadNotePlan` accepts a finished PR #229 note plan. It does not
 * format answers and it does not import that module.
 *
 * PR #228 acceptance item 17 allows a new send after an operator inspects an
 * uncertain run. That is weaker than the append-timeout rule: an absent row
 * does not prove the first request cannot still commit. Reconcile records the
 * inspection and does not authorize another send.
 */
export const CAPTURED_TEST_DELIVERY_CLASS = "onboarding_captured_test" as const;
export const CONFIRM_DELIVER = "DELIVER CAPTURED TEST LEAD";
export const CONFIRM_REPEAT = "REPEAT CAPTURED TEST LEAD";
/** One Sheets append. This phrase cannot select a GHL destination. */
export const CONFIRM_ONE_GOOGLE_SHEETS_ROW = "DELIVER ONE GOOGLE SHEETS TEST ROW";
export const GOOGLE_ONLY_PILOT_FLAG = "SA360_CLIENT_ONBOARDING_GOOGLE_ONLY_PILOT_ENABLED";
/** Enrichment recordClass for a future operator-owned test event. Not a customer lead. */
export const ONBOARDING_OPERATOR_OWNED_TEST_CLASS = "onboarding_operator_owned_test";
/** Stored on a one-shot run so a later request cannot append again. */
export const GOOGLE_ONLY_ONE_SHOT_WARNING = "google_only_one_shot";
/** Stored on a custom-tab captured test so REPEAT cannot append a second row. */
export const CUSTOM_CAPTURED_SHEETS_WARNING = "custom_captured_sheets_test";
export const WARNING_DOWNSTREAM = "ghl_workflow_may_start_downstream_automation";
export const PR228_RECONCILE_DISCREPANCY =
  "PR #228 reconcile treats operator inspection as enough to authorize a new captured delivery. An absent sheet row or an unknown GHL POST is not proof the first request cannot commit later. This module records the inspection, does not clear appendStartedAt or the worksheet lock, and keeps repeat_blocked_uncertain.";

export const PR228_ISOLATED_GHL_DISCREPANCY =
  "PR #228 refuses every isolated GHL target because it states there is no second location. A supplied distinct location id is still not a send. Isolated GHL stays ghl_isolation_unavailable until that contract and a schema field are reviewed.";

export const CAPTURED_TEST_BLOCKED_ON = [
  "prisma_migration_client_onboarding_test_run",
  "prisma_migration_client_onboarding_test_attempt",
  "prisma_migration_client_onboarding_verified_test_identity",
  "prisma_migration_client_onboarding_v2_audit_event",
  "authorization_session_role_review",
  "agent_b_buildOnboardingLeadNote",
  "external_execution_review",
] as const;

const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PRODUCTION_PREFIXES = ["lead:", "campaign:", "ghl-webhook:", "ghl-note:"] as const;

export type TestRunKind =
  | "preview"
  | "captured_event_replay"
  | "captured_event_delivery"
  | "synthetic_delivery";

export type TestDestination = "google_sheets" | "ghl_location_api" | "ghl_inbound_webhook";
export type IsolationMode = "verified_test_identity" | "isolated_destination";
export type SheetsContract = "exact_v3_test_worksheet" | "canary_v1_projection" | typeof CUSTOM_CAMPAIGN_SHEETS_CONTRACT;

const SELECTABLE_CONTROL = new Set(["company_created", "drive_owner_verified", "approved_shared_drive"]);
const EXACT_V3_HEADER = [...(companySheetsCampaignHeader(COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V3) ?? [])];
export type RunStatus = "previewed" | "executing" | "succeeded" | "failed" | "uncertain" | "note_too_long";
export type AttemptStatus = "previewed" | "executing" | "succeeded" | "failed" | "uncertain" | "not_executed";
export type NoteOverflow = "refuse" | "split_continuation";

export type ExternalCallReport = {
  providerWebhook: false;
  sheets: boolean;
  ghl: boolean;
};

export const NO_EXTERNAL_CALLS: ExternalCallReport = {
  providerWebhook: false,
  sheets: false,
  ghl: false,
};

export type ProductionSnapshot = {
  sourceLeadEventCount: number;
  inventoryCount: number;
  billingRowCount: number;
  dispatchIntentCount: number;
  eventStatus: string | null;
  eventDeliveryResult: unknown;
  campaignDispatchEnabled: boolean;
  agedDispatchEnabled: boolean;
};

export type StoredSourceEvent = {
  id: string;
  clientAccountIdResolved: string | null;
  status: string;
  sourceRouteKey: string | null;
  sourceProvider?: string | null;
  sourceSystem?: string | null;
  sourceType?: string | null;
  webhookRequestLogId?: string | null;
  enrichmentMetadataJson: unknown;
  normalizedPayloadJson: unknown;
  receivedAt: string;
  sourceLeadId: string | null;
  deliveryResultJson: unknown;
  /**
   * Counts for this event only. Absent means they were not read.
   * The one-shot Sheets phrase refuses an absent or non-zero snapshot.
   */
  downstream?: {
    inventoryCount: number;
    fulfillmentCount: number;
    allocationCount: number;
    dispatchIntentCount: number;
  };
};

export type VerifiedTestIdentity = {
  email: string | null;
  phoneE164: string | null;
};

export type WorksheetRisk = {
  uncertain: boolean;
  appendStartedAtHeld: boolean;
  campaignTestUnresolved?: boolean;
};

export type WorksheetControlSnapshot = {
  establishControl: string;
  checkedAt: string;
};

/** Operator-approved exact-v3 test destination. The planner reads it and does not insert it. */
export type ApprovedExactV3Worksheet = {
  spreadsheetId: string;
  worksheetId: number;
  worksheetTitle: string;
  schemaVersion: string;
  header: string[];
  headerSha256: string;
  destinationRevision: number;
  ownerClientAccountId: string;
  control: WorksheetControlSnapshot;
};

export type SheetsTargetSnapshot = {
  spreadsheetId: string;
  spreadsheetTitle: string | null;
  canaryApproved: boolean;
  campaignDispatchEnabled: boolean;
  agedDispatchEnabled: boolean;
  campaign: {
    worksheetId: number;
    worksheetTitle: string;
    schemaVersion: string;
    header: string[];
  } | null;
  canary: {
    worksheetId: number;
    worksheetTitle: string;
    header: string[];
  } | null;
  campaignRisk: WorksheetRisk;
  canaryRisk: WorksheetRisk;
  /** Company-control snapshot for the saved campaign worksheet. Required before an exact-v3 append. */
  campaignControl?: WorksheetControlSnapshot | null;
  destinationRevision?: number;
  /** One approved ClientOnboardingTestWorksheet. Absent until an operator records it. */
  approvedTestWorksheet?: ApprovedExactV3Worksheet | null;
  /** Published shared map for the bound custom campaign tab. Absent for preset tabs. */
  publishedCampaignMap?: PublishedCampaignMapSnapshot | null;
  approvedTestWorksheetRisk?: WorksheetRisk;
};

export type GhlTargetSnapshot = {
  locationId: string | null;
  /** Not a schema column. A future migration may supply a location that is not the client's. */
  isolatedLocationId: string | null;
  workflowId: string | null;
  workflowName: string | null;
  workflowTriggerMode: string | null;
  /** Not a schema column. Null means the reviewed profile has not confirmed notes. */
  notesEnabled: boolean | null;
  /** Stored snapshot only. Empty until a GhlLocationConfigSnapshot is loaded. */
  discoveredWorkflows?: ReadonlyArray<{
    id: string;
    name: string;
    status?: string | null;
    type?: string | null;
  }>;
};

export type CapturedStoredLead = {
  sourceLeadEventId: string;
  clientAccountId?: string | null;
  generatedAt?: string | null;
  fullName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  email?: string | null;
  state?: string | null;
  leadType?: string | null;
  sourceText?: string | null;
  sourceAttributes?: Record<string, unknown> | null;
  unmappedSourceFields?: Array<{ key: string; value: unknown }> | null;
  unmappedSourceFieldsJson?: Array<{ key: string; value: unknown }> | null;
  metaFieldData?: Array<{ name: string; values?: unknown }> | null;
  answerFields?: Array<{ key: string; name?: string | null; value: unknown; canonicalKey?: string | null }> | null;
  schemaDrift?: { possibleRenames?: Array<{ from: string; to: string; canonical?: string }> } | null;
};

export type CapturedTestWorld = {
  clientFound: boolean;
  event: StoredSourceEvent | null;
  identities: VerifiedTestIdentity[];
  sheets: SheetsTargetSnapshot | null;
  ghl: GhlTargetSnapshot | null;
  /** Approved stored-lead view of `event`. The GHL adapter formats Notes v2 from this. */
  storedLead?: CapturedStoredLead | null;
  /**
   * True when this event's email or phone is also a verified identity for another client.
   * Absent is not proof the contact belongs only to this client.
   */
  testIdentitySharedWithOtherClient?: boolean;
  production: ProductionSnapshot;
};

export type CapturedTestRequest = {
  requestId: string;
  kind: TestRunKind;
  clientAccountId: string;
  sourceLeadEventId?: string | null;
  destinations: TestDestination[];
  execute?: boolean;
  confirmation?: string | null;
  acknowledgeDownstreamAutomation?: boolean;
  isolation?: { mode?: IsolationMode | null; sheetsContract?: SheetsContract | null } | null;
  noteOverflow?: NoteOverflow;
  repeatOfTestRunId?: string | null;
  actorLabel?: string | null;
};

/**
 * Import contract for Agent B's `buildOnboardingLeadNote`.
 * This module does not format answers. The default port reports the formatter missing.
 */
export type OnboardingLeadNoteRequest = {
  contract: "sa360_lead_note_v2";
  sourceLeadEventId: string;
  testRunId: string | null;
  receivedAt: string | null;
  normalizedPayloadJson: unknown;
  noteOverflow: NoteOverflow;
  maxChars: number;
};

export type OnboardingLeadNotePart = { part: number; body: string };

export type OnboardingLeadNoteResult =
  | {
      ok: true;
      contract: "sa360_lead_note_v2";
      title: string;
      body: string;
      parts: OnboardingLeadNotePart[];
      keptAnswerCount: number;
      qaEvidence?: {
        status: "complete" | "discarded_duplicates" | "not_recoverable";
        fullQaCompletenessAsserted: boolean;
        discardedDuplicateCount: number;
      };
    }
  | { ok: false; code: "note_too_long"; body: string; keptAnswerCount: number; posted: false }
  | { ok: false; code: "note_builder_pending_agent_b"; posted: false }
  | { ok: false; code: "production_idempotency_guard"; key: string; posted: false };

export type BuildOnboardingLeadNote = (input: OnboardingLeadNoteRequest) => OnboardingLeadNoteResult;

/**
 * Structural subset of PR #229 `OnboardingLeadNotePlan | OnboardingLeadNoteFailure`.
 * Answers stay on that plan. This module does not read them.
 */
export type AgentBLeadNotePart = {
  part: number;
  body: string;
  idempotencyKey: string;
};

export type AgentBLeadNotePlan =
  | {
      ok: true;
      contractVersion: "sa360_lead_note_v2";
      title: string;
      body: string;
      keptAnswerCount: number;
      posted: false;
      status: "ready" | "note_too_long";
      error: "note_too_long" | null;
      parts: readonly AgentBLeadNotePart[];
    }
  | {
      ok: false;
      posted: false;
      error: "client_account_mismatch";
      contractVersion: "sa360_lead_note_v2";
    };

export const pendingOnboardingLeadNote: BuildOnboardingLeadNote = () => ({
  ok: false,
  code: "note_builder_pending_agent_b",
  posted: false,
});

export type SheetsAppendRequest = {
  kind: "onboarding_captured_test";
  idempotencyKey: string;
  deliveryRowId: string;
  sourceLeadEventId: string;
  clientAccountId: string;
  spreadsheetId: string;
  worksheetId: number;
  worksheetTitle: string;
  worksheetRole: "campaign" | "canary";
  schemaVersion: string;
  values: string[];
  testRunId: string;
  sa360DeliveryClass: typeof CAPTURED_TEST_DELIVERY_CLASS;
};

export type SheetsAppendOutcome =
  | { status: "succeeded"; rowsWritten: number; externalCallExecuted: boolean }
  | { status: "failed"; externalCallExecuted: boolean; error: string }
  | {
      status: "uncertain";
      externalCallExecuted: boolean;
      reason: "timeout" | "unknown" | "in_flight";
      appendStartedAt: string;
    };

/**
 * Production binding is `executeCompanySheetsDeliveryJob`: the company Sheets
 * append, worksheet lock, and RAW insert. The port has no method that clears
 * `appendStartedAt` or releases `CompanySheetsWorksheetLock`.
 */
export type CapturedTestSheetsAppendPort = {
  append(request: SheetsAppendRequest): Promise<SheetsAppendOutcome>;
};

/** Bound custom-tab test. Separate from the exact-v3 one-shot append port. */
export type CustomCapturedSheetEffects = {
  inventoryAffected: boolean;
  billingAffected: boolean;
  deliveryEnabled: boolean;
  cutoffChanged: boolean;
  duplicate: boolean;
};

export type CustomCapturedCampaignSheetsPort = {
  send(input: { clientAccountId: string; sourceLeadEventId: string }): Promise<{
    status: "succeeded" | "failed" | "uncertain";
    externalCallExecuted: boolean;
    error?: string;
  } & CustomCapturedSheetEffects>;
};

export type GhlContactRequest = {
  idempotencyKey: string;
  locationId: string;
  sourceLeadEventId: string;
  testRunId: string;
  email: string | null;
  phone: string | null;
  firstName: string | null;
  lastName: string | null;
  sa360DeliveryClass: typeof CAPTURED_TEST_DELIVERY_CLASS;
  sa360TestRunId: string;
};

export type GhlNoteRequest = {
  idempotencyKey: string;
  locationId: string;
  contactId: string;
  sourceLeadEventId: string;
  title: string;
  body: string;
  part: number;
};

export type GhlWorkflowRequest = {
  idempotencyKey: string;
  locationId: string;
  contactId: string;
  workflowId: string;
  triggerMode: "direct_api";
  sourceLeadEventId: string;
  testRunId: string;
};

export type GhlStepOutcome = {
  status: "succeeded" | "failed" | "uncertain";
  externalCallExecuted: boolean;
  httpStatus: number | null;
  externalId: string | null;
  error: string | null;
  reason: "timeout" | "unknown_post" | "http_5xx" | "rejected" | null;
};

/**
 * Production binding is the existing location API, not a second client:
 * POST /contacts/upsert, POST /contacts/{contactId}/notes,
 * POST /contacts/{contactId}/workflow/{workflowId} with `direct_api`.
 * HTTP 2xx on enrollment does not set `downstreamExecuted`.
 */
export type CapturedTestGhlLocationPort = {
  upsertContact(request: GhlContactRequest): Promise<GhlStepOutcome>;
  createNote(request: GhlNoteRequest): Promise<GhlStepOutcome>;
  enrollWorkflow(request: GhlWorkflowRequest): Promise<GhlStepOutcome>;
};

export type SyntheticSheetsResult = {
  externalCallExecuted: boolean;
  inventoryAffected: false;
  billingAffected: false;
  dispatchIntentCreated: false;
  sourceLeadEventCreated: false;
  campaignDispatchEnabled: false;
  status: "succeeded" | "failed" | "uncertain" | "not_called";
  error: string | null;
};

/**
 * Production binding is `sendCompanySheetsCampaignTestRow`, reached today by
 * POST /admin/v1/clients/:clientAccountId/google-sheets/campaign-test.
 * An uncertain prior campaign-test append is not retried.
 */
export type SyntheticSheetsTestPort = {
  send(clientAccountId: string): Promise<SyntheticSheetsResult>;
};

export type StoredAttempt = {
  id: string;
  destination: TestDestination;
  idempotencyKey: string;
  status: AttemptStatus;
  proves: string[];
  doesNotProve: string[];
  externalCallExecuted: boolean;
  downstreamExecuted: false;
  detail: string | null;
};

export type CapturedTestAudit = {
  action: "preview" | "execute" | "repeat" | "reconcile" | "refuse";
  requestId: string;
  actorLabel: string | null;
  auth: "admin_api_key";
  sourceLeadEventId: string | null;
  destinations: TestDestination[];
  isolationMode: IsolationMode | null;
  idempotencyKeys: string[];
  noteBodySha256: string | null;
  sheetRowSha256: string | null;
  createdAt: string;
};

export type StoredTestRun = {
  id: string;
  clientAccountId: string;
  kind: TestRunKind;
  sourceLeadEventId: string | null;
  destinations: TestDestination[];
  isolationMode: IsolationMode | null;
  repeatOfTestRunId: string | null;
  requestId: string;
  fingerprint: string;
  status: RunStatus;
  previewJson: unknown;
  warningCodes: string[];
  createdAt: string;
  attempts: StoredAttempt[];
  reconciledAt: string | null;
  reconcileObservation: string | null;
  /** Always false. Inspection does not authorize another external send. */
  resendAuthorized: false;
  appendStartedAtCleared: false;
  locksCleared: false;
  noteBodySha256: string | null;
  sheetRowSha256: string | null;
  sheetPlan?: PlannedSheet | null;
  qaEvidence?: {
    status: "complete" | "discarded_duplicates" | "not_recoverable";
    fullQaCompletenessAsserted: boolean;
    discardedDuplicateCount: number;
  } | null;
};

type MaybePromise<T> = T | Promise<T>;

export type CapturedTestStore = {
  readonly durable: boolean;
  readonly persistence: "unavailable_pending_migration" | "injected_test_store" | "prisma";
  findByRequestId(clientAccountId: string, requestId: string): MaybePromise<StoredTestRun | null>;
  listForEvent(clientAccountId: string, sourceLeadEventId: string): MaybePromise<StoredTestRun[]>;
  listForClient(clientAccountId: string): MaybePromise<StoredTestRun[]>;
  get(clientAccountId: string, testRunId: string): MaybePromise<StoredTestRun | null>;
  insert(run: StoredTestRun, audit: CapturedTestAudit): MaybePromise<{ persisted: boolean }>;
  tryBegin(
    run: StoredTestRun,
    audit: CapturedTestAudit,
    blockInput: PriorBlockInput
  ): MaybePromise<{ ok: true } | { ok: false; statusCode: number; error: string; discrepancy?: string; existing: StoredTestRun | null }>;
  finish(testRunId: string, patch: Pick<StoredTestRun, "status" | "attempts" | "warningCodes" | "previewJson">): MaybePromise<void>;
  reconcile(input: {
    clientAccountId: string;
    testRunId: string;
    observation: string;
    inspectedAbsentRow: boolean;
    at: string;
    audit: CapturedTestAudit;
  }): MaybePromise<{ ok: true; run: StoredTestRun } | { ok: false; statusCode: number; error: string }>;
};

export type PriorBlockInput = {
  clientAccountId: string;
  sourceLeadEventId: string;
  destinations: TestDestination[];
  confirmation: string | null;
  repeatOfTestRunId: string | null;
};

export type PlannedSheet = {
  spreadsheetId: string;
  worksheetId: number;
  worksheetTitle: string;
  worksheetRole: "campaign" | "canary";
  schemaVersion: string;
  header: string[];
  headerSha256: string;
  control: WorksheetControlSnapshot | null;
  ownerClientAccountId: string;
  destinationRevision: number;
  productionCampaignBind: boolean;
  sheetsContract: SheetsContract;
  deliveryRowId: string;
  sourceLeadEventId: string;
  values: string[];
  valuesSha256: string;
  kind: "onboarding_captured_test";
  headerCompatible: boolean;
  /** One-shot Sheets test refuses a reread whose body is not empty. */
  bodyMustBeEmpty?: boolean;
};

export type PlannedNotePart = { part: number; body: string; idempotencyKey: string };

export type CapturedTestPlan = {
  testRunId: string;
  requestId: string;
  fingerprint: string;
  kind: TestRunKind;
  clientAccountId: string;
  sourceLeadEventId: string | null;
  destinations: TestDestination[];
  isolationMode: IsolationMode | null;
  repeatOfTestRunId: string | null;
  actorLabel: string | null;
  warningCodes: string[];
  idempotencyKeys: string[];
  sheet: PlannedSheet | null;
  note: {
    contract: "sa360_lead_note_v2";
    available: boolean;
    blockedOn: "agent_b_note_formatter" | null;
    title: string | null;
    body: string | null;
    bodySha256: string | null;
    parts: PlannedNotePart[];
    posted: false;
    keptAnswerCount: number | null;
    qaEvidence?: {
      status: "complete" | "discarded_duplicates" | "not_recoverable";
      fullQaCompletenessAsserted: boolean;
      discardedDuplicateCount: number;
    } | null;
  } | null;
  ghl: {
    locationId: string;
    workflowId: string;
    contact: GhlContactRequest;
    workflowIdempotencyKey: string;
  } | null;
  webhook: {
    idempotencyKey: string;
    executed: false;
    envelope: {
      sa360DeliveryClass: typeof CAPTURED_TEST_DELIVERY_CLASS;
      sa360TestRunId: string;
    };
  } | null;
  synthetic: {
    sheetsDelegate: "sendCompanySheetsCampaignTestRow";
    route: "POST /admin/v1/clients/:clientAccountId/google-sheets/campaign-test";
  } | null;
  productionKeysReserved: string[];
  sourceDeliverySatisfied: false;
  downstreamExecuted: false;
};

export type CapturedTestError = {
  ok: false;
  statusCode: number;
  error: string;
  detail?: string;
  discrepancy?: string;
  warningCodes: string[];
  externalCalls: ExternalCallReport;
  externalCallsThisRequest: ExternalCallReport;
  posted?: false;
  noteBody?: string;
  keptAnswerCount?: number;
  blockedOn?: readonly string[];
  resendAuthorized: false;
  appendStartedAtCleared: false;
  locksCleared: false;
  sourceDeliverySatisfied: false;
  testRunId?: string;
  idempotencyKeys?: string[];
};

export type CapturedTestSuccess = {
  ok: true;
  statusCode: 200;
  run: StoredTestRun;
  plan: CapturedTestPlan;
  persisted: boolean;
  persistence: CapturedTestStore["persistence"];
  blockedOn: string[];
  externalCalls: ExternalCallReport;
  externalCallsThisRequest: ExternalCallReport;
  duplicateRequest: boolean;
  sourceDeliverySatisfied: false;
  downstreamExecuted: false;
  production: ProductionSnapshot;
  resendAuthorized: false;
  appendStartedAtCleared: false;
  locksCleared: false;
  effects?: CustomCapturedSheetEffects | null;
};

export type CapturedTestOutcome = CapturedTestError | CapturedTestSuccess;

export type CapturedTestDeps = {
  env?: NodeJS.ProcessEnv;
  now?: () => string;
  newId?: () => string;
  notes?: BuildOnboardingLeadNote;
  store?: CapturedTestStore;
  sheets?: CapturedTestSheetsAppendPort;
  /**
   * Step port used by unit tests. The mounted integration does not set this
   * when `ghlAggregate` is set, so the three callbacks cannot each post.
   */
  ghl?: CapturedTestGhlLocationPort;
  /**
   * Aggregate location adapter. When set, execute calls `deliver` once and
   * projects the receipt. It does not also call `ghl`.
   */
  ghlAggregate?: {
    deliver(request: OnboardingGhlTestDeliveryRequest): Promise<OnboardingGhlTestDeliveryReceipt>;
  };
  syntheticSheets?: SyntheticSheetsTestPort;
  /** Appends one captured event through the bound custom campaign writer. */
  customCampaignSheets?: CustomCapturedCampaignSheetsPort;
  /** Route default. Unit tests pass injected_fakes with the ports above. */
  execution?: "disabled_pending_review" | "injected_fakes";
  priors?: StoredTestRun[];
  /**
   * Test seam. Production routes do not set it. A production-shaped key still
   * refuses before any Sheets or GHL port is called.
   */
  keyOverride?: string[];
  /**
   * Execute reads row 1 again. A missing callback, a null or throwing reread,
   * or a difference from the planned snapshot blocks before the append port.
   */
  rereadSheet?: (sheet: PlannedSheet) => Promise<{
    header: string[];
    headerSha256: string;
    control: WorksheetControlSnapshot | null;
    ownerClientAccountId: string;
    destinationRevision: number;
    historicalDataRows?: "empty" | "has_rows" | "truncated" | "unproven";
  } | null>;
};

type Flags = {
  config: boolean;
  captured: boolean;
  googleOnlyPilot: boolean;
  ghlSynthetic: boolean;
};

export function isOnboardingConfigEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SA360_CLIENT_ONBOARDING_V2_CONFIG_ENABLED === "true";
}

export function isCapturedTestEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SA360_CLIENT_ONBOARDING_V2_CAPTURED_TEST_ENABLED === "true";
}

export function isGoogleOnlyPilotEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[GOOGLE_ONLY_PILOT_FLAG] === "true";
}

/** The only execution shape this release can authorize. Older phrases are not included. */
export function exclusiveGoogleOnlyRequest(input: {
  kind: TestRunKind;
  confirmation?: string | null;
  destinations: readonly TestDestination[];
  isolation?: { mode?: string | null; sheetsContract?: string | null } | null;
}): boolean {
  return (
    input.kind === "captured_event_delivery" &&
    input.confirmation === CONFIRM_ONE_GOOGLE_SHEETS_ROW &&
    input.destinations.length === 1 &&
    input.destinations[0] === "google_sheets" &&
    input.isolation?.mode === "isolated_destination" &&
    input.isolation.sheetsContract === "exact_v3_test_worksheet"
  );
}

/**
 * Mounted HTTP routes and runCapturedTestDelivery both use this gate.
 * Previews stay on the config flag. The exact-v3 one-shot still needs the
 * pilot flag. A custom campaign captured test needs the captured-test flag
 * and does not use the pilot flag.
 */
export function googleOnlyPilotExecutionGate(
  input: CapturedTestRequest,
  env: NodeJS.ProcessEnv = process.env
): { statusCode: number; error: string } | null {
  return executionGate(input, readFlags(env));
}

export function isGhlSyntheticEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SA360_CLIENT_ONBOARDING_GHL_SYNTHETIC_ENABLED === "true";
}

export function ghlNoteBodyMaxChars(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.SA360_GHL_NOTE_BODY_MAX_CHARS?.trim();
  if (!raw) return 10000;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) return 10000;
  return parsed;
}

export function sha256Text(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function reservedProductionIdempotencyKeys(clientAccountId: string, sourceLeadEventId: string): string[] {
  return [
    `campaign:${clientAccountId}:${sourceLeadEventId}`,
    `lead:${clientAccountId}:${sourceLeadEventId}`,
    `ghl-webhook:${clientAccountId}:${sourceLeadEventId}`,
    `ghl-note:${clientAccountId}:${sourceLeadEventId}`,
  ];
}

export function capturedTestKey(testRunId: string, suffix: string): string {
  return `onboarding-test:${testRunId}:${suffix}`;
}

/**
 * Map a finished PR #229 note plan onto this planner's note port.
 * A `note_too_long` plan is refused before any part is copied.
 * Each ready part key must be exactly `onboarding-test:{testRunId}:ghl-note:{part}`.
 * The planner still regenerates those keys. This function does not build an event.
 */
export function adaptAgentBLeadNotePlan(plan: AgentBLeadNotePlan, testRunId: string): OnboardingLeadNoteResult {
  if (!plan.ok || plan.contractVersion !== "sa360_lead_note_v2" || plan.posted !== false) {
    return { ok: false, code: "note_builder_pending_agent_b", posted: false };
  }
  if (plan.status === "note_too_long" || plan.error === "note_too_long") {
    return {
      ok: false,
      code: "note_too_long",
      body: plan.body,
      keptAnswerCount: plan.keptAnswerCount,
      posted: false,
    };
  }
  if (plan.status !== "ready" || plan.error !== null || !plan.title.trim() || !plan.body.trim() || plan.parts.length === 0) {
    return { ok: false, code: "note_builder_pending_agent_b", posted: false };
  }
  if (!Number.isInteger(plan.keptAnswerCount) || plan.keptAnswerCount < 0) {
    return { ok: false, code: "note_builder_pending_agent_b", posted: false };
  }
  const reserved = reservedProductionIdempotencyKeys("", "");
  const parts: OnboardingLeadNotePart[] = [];
  for (let index = 0; index < plan.parts.length; index += 1) {
    const part = plan.parts[index];
    const expected = capturedTestKey(testRunId, `ghl-note:${index + 1}`);
    if (!part || part.part !== index + 1 || !part.body.trim()) {
      return { ok: false, code: "note_builder_pending_agent_b", posted: false };
    }
    if (part.idempotencyKey !== expected || isProductionIdempotencyKey(part.idempotencyKey, reserved)) {
      return { ok: false, code: "production_idempotency_guard", key: part.idempotencyKey, posted: false };
    }
    parts.push({ part: part.part, body: part.body });
  }
  return {
    ok: true,
    contract: "sa360_lead_note_v2",
    title: plan.title,
    body: plan.body,
    parts,
    keptAnswerCount: plan.keptAnswerCount,
  };
}

/** Note port that serves one already-built PR #229 plan. The request payload is not formatted. */
export function agentBPlanNoteBuilder(plan: AgentBLeadNotePlan): BuildOnboardingLeadNote {
  return (input) => adaptAgentBLeadNotePlan(plan, input.testRunId ?? "");
}

/** True when a key is reserved for production intake, dispatch, webhooks, or notes. */
export function isProductionIdempotencyKey(key: string, reserved: readonly string[]): boolean {
  if (reserved.includes(key)) return true;
  return PRODUCTION_PREFIXES.some((prefix) => key.startsWith(prefix));
}

export function assertCapturedTestIdempotencyKeys(
  keys: readonly string[],
  reserved: readonly string[]
): { ok: true } | { ok: false; key: string } {
  for (const key of keys) {
    if (!key.startsWith("onboarding-test:") || isProductionIdempotencyKey(key, reserved)) {
      return { ok: false, key };
    }
  }
  return { ok: true };
}

/**
 * Timeout, a missing HTTP result, and HTTP 5xx are unknown commits.
 * A 4xx is a known rejection. Nothing in this classification authorizes a retry.
 */
export function classifyExternalHttp(input: {
  status: number | null;
  timedOut?: boolean;
  threw?: boolean;
}): "succeeded" | "failed" | "uncertain" {
  if (input.threw || input.timedOut || input.status == null) return "uncertain";
  if (input.status >= 500 || input.status === 408) return "uncertain";
  if (input.status >= 200 && input.status < 300) return "succeeded";
  return "failed";
}

export function priorDeliveryBlock(
  priors: readonly StoredTestRun[],
  input: PriorBlockInput
): { statusCode: number; error: string; discrepancy?: string } | null {
  const relevant = priors.filter(
    (run) =>
      run.kind === "captured_event_delivery" &&
      run.clientAccountId === input.clientAccountId &&
      run.sourceLeadEventId === input.sourceLeadEventId &&
      overlapsDestination(run, input.destinations)
  );
  if (relevant.some((run) => run.status === "executing" || run.attempts.some((attempt) => attempt.status === "executing"))) {
    return { statusCode: 409, error: "repeat_blocked_in_flight" };
  }
  if (relevant.some((run) => run.status === "uncertain" || run.attempts.some((attempt) => attempt.status === "uncertain"))) {
    return {
      statusCode: 409,
      error: "repeat_blocked_uncertain",
      discrepancy: PR228_RECONCILE_DISCREPANCY,
    };
  }
  if (relevant.some((run) => run.warningCodes.includes(GOOGLE_ONLY_ONE_SHOT_WARNING))) {
    return { statusCode: 409, error: "one_test_already_used" };
  }
  const customConfirmation = input.confirmation === CONFIRM_ONE_CUSTOM_SHEETS_ROW;
  const customSucceeded = relevant.some((run) => run.status === "succeeded" && isCustomCapturedRun(run));
  if (customConfirmation || customSucceeded) {
    if (relevant.some((run) => run.status === "succeeded")) {
      return { statusCode: 409, error: "captured_event_test_already_used" };
    }
    if (customConfirmation) {
      if (input.repeatOfTestRunId) return { statusCode: 400, error: "invalid_confirmation" };
      return null;
    }
  }
  const terminal = relevant
    .filter((run) => run.status === "succeeded" || run.status === "failed" || run.status === "note_too_long")
    .slice()
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  if (terminal.length > 0) {
    const latest = terminal[0];
    if (input.confirmation !== CONFIRM_REPEAT || input.repeatOfTestRunId !== latest?.id) {
      return { statusCode: 409, error: "repeat_of_required" };
    }
    return null;
  }
  const firstRun =
    input.confirmation === CONFIRM_DELIVER || input.confirmation === CONFIRM_ONE_GOOGLE_SHEETS_ROW;
  if (!firstRun || input.repeatOfTestRunId) {
    return { statusCode: 400, error: "invalid_confirmation" };
  }
  return null;
}

export function planCapturedTestDelivery(
  input: CapturedTestRequest,
  world: CapturedTestWorld,
  deps: Omit<CapturedTestDeps, "now"> & { testRunId: string; now: string; priors: readonly StoredTestRun[] }
): { ok: true; plan: CapturedTestPlan } | CapturedTestError {
  const flags = readFlags(deps.env ?? process.env);
  const shape = validateShape(input);
  if (shape) return failure(shape.statusCode, shape.error);
  const flagError = executionGate(input, flags);
  if (flagError) return failure(flagError.statusCode, flagError.error, { blockedOn: CAPTURED_TEST_BLOCKED_ON });
  if (!world.clientFound) return failure(404, "client_not_found");
  if (!RUN_ID.test(deps.testRunId)) return failure(400, "invalid_confirmation", { detail: "test run id must be a uuid" });

  if (input.kind === "synthetic_delivery") {
    return planSynthetic(input, world, deps, flags);
  }

  const destinations = input.destinations;
  if (input.kind !== "preview" && destinations.includes("ghl_inbound_webhook") && input.kind === "captured_event_replay") {
    return failure(400, "invalid_confirmation", { detail: "ghl_inbound_webhook is preview only" });
  }

  let event: StoredSourceEvent | null = null;
  if (input.kind === "captured_event_replay" || input.kind === "captured_event_delivery") {
    const owned = requireOwnedEvent(input, world);
    if ("ok" in owned) return owned;
    event = owned;
  }

  if (input.kind === "captured_event_delivery") {
    const held = priorDeliveryBlock(deps.priors, {
      clientAccountId: input.clientAccountId,
      sourceLeadEventId: event!.id,
      destinations,
      confirmation: input.confirmation ?? null,
      repeatOfTestRunId: input.repeatOfTestRunId ?? null,
    });
    if (
      held &&
      (held.error === "repeat_blocked_uncertain" ||
        held.error === "repeat_blocked_in_flight" ||
        held.error === "one_test_already_used")
    ) {
      return failure(held.statusCode, held.error, { discrepancy: held.discrepancy });
    }
    if (input.confirmation === CONFIRM_ONE_GOOGLE_SHEETS_ROW) {
      const pilot = requireGoogleOnlyPilot(input, world, event!);
      if (pilot) return pilot;
    }
    const isolation = requireIsolation(input, world, event!);
    if ("ok" in isolation) return isolation;
  }

  const reserved = reservedProductionIdempotencyKeys(
    input.clientAccountId,
    event?.id ?? "preview"
  );
  const notePlan = destinations.includes("ghl_location_api")
    ? buildNotePlan(input, world, event, deps)
    : { note: null as CapturedTestPlan["note"], error: null as CapturedTestError | null };
  if (notePlan.error && input.kind === "captured_event_delivery") return notePlan.error;

  const keys =
    deps.keyOverride ??
    collectKeys(deps.testRunId, destinations, notePlan.note?.parts.length ?? (destinations.includes("ghl_location_api") ? 1 : 0));
  const guarded = assertCapturedTestIdempotencyKeys(keys, reserved);
  if (!guarded.ok) {
    return failure(409, "production_idempotency_guard", { detail: guarded.key, idempotencyKeys: keys });
  }

  if (input.kind === "captured_event_delivery") {
    const block = priorDeliveryBlock(deps.priors, {
      clientAccountId: input.clientAccountId,
      sourceLeadEventId: event!.id,
      destinations,
      confirmation: input.confirmation ?? null,
      repeatOfTestRunId: input.repeatOfTestRunId ?? null,
    });
    if (block) {
      return failure(block.statusCode, block.error, {
        discrepancy: block.discrepancy,
        idempotencyKeys: keys,
      });
    }
    if (destinations.includes("ghl_location_api") && input.acknowledgeDownstreamAutomation !== true) {
      return failure(422, "downstream_automation_not_acknowledged");
    }
    const ghlReady = destinations.includes("ghl_location_api") ? requireGhlExecutionProfile(world.ghl, notePlan.note) : null;
    if (ghlReady) return ghlReady;
    const sheetBlock = destinations.includes("google_sheets") ? sheetTargetBlock(input, world) : null;
    if (sheetBlock) return sheetBlock;
  }

  const sheet = destinations.includes("google_sheets")
    ? planSheet(input, world, event, deps.testRunId)
    : { sheet: null as PlannedSheet | null, error: null as CapturedTestError | null, warnings: [] as string[] };
  if (sheet.error) return sheet.error;
  if (sheet.sheet && input.confirmation === CONFIRM_ONE_GOOGLE_SHEETS_ROW) {
    sheet.sheet.bodyMustBeEmpty = true;
    if (sheet.sheet.productionCampaignBind || sheet.sheet.spreadsheetId === world.sheets?.spreadsheetId) {
      return failure(409, "test_worksheet_not_approved", {
        detail: "the one-shot row must use a spreadsheet that is not the saved production file",
      });
    }
  }

  const warnings = [
    ...(destinations.includes("ghl_location_api") ? [WARNING_DOWNSTREAM] : []),
    ...(input.kind === "captured_event_delivery" && input.confirmation === CONFIRM_ONE_GOOGLE_SHEETS_ROW
      ? [GOOGLE_ONLY_ONE_SHOT_WARNING]
      : []),
    ...(input.kind === "captured_event_delivery" && input.confirmation === CONFIRM_ONE_CUSTOM_SHEETS_ROW
      ? [CUSTOM_CAPTURED_SHEETS_WARNING]
      : []),
    ...(sheet.warnings ?? []),
  ];

  const ghl = planGhl(input, world, event, deps.testRunId, notePlan.note);
  const plan: CapturedTestPlan = {
    testRunId: deps.testRunId,
    requestId: input.requestId,
    fingerprint: fingerprintOf(input),
    kind: input.kind,
    clientAccountId: input.clientAccountId,
    sourceLeadEventId: event?.id ?? null,
    destinations,
    isolationMode: input.isolation?.mode ?? null,
    repeatOfTestRunId: input.repeatOfTestRunId ?? null,
    actorLabel: input.actorLabel ?? null,
    warningCodes: warnings,
    idempotencyKeys: keys,
    sheet: sheet.sheet,
    note: notePlan.note,
    ghl,
    webhook: destinations.includes("ghl_inbound_webhook")
      ? {
          idempotencyKey: capturedTestKey(deps.testRunId, "ghl-webhook"),
          executed: false,
          envelope: {
            sa360DeliveryClass: CAPTURED_TEST_DELIVERY_CLASS,
            sa360TestRunId: deps.testRunId,
          },
        }
      : null,
    synthetic: null,
    productionKeysReserved: event ? reservedProductionIdempotencyKeys(input.clientAccountId, event.id) : [],
    sourceDeliverySatisfied: false,
    downstreamExecuted: false,
  };
  return { ok: true, plan };
}

export async function runCapturedTestDelivery(
  input: CapturedTestRequest,
  world: CapturedTestWorld,
  deps: CapturedTestDeps = {}
): Promise<CapturedTestOutcome> {
  const store = deps.store ?? unavailableCapturedTestStore;
  const now = deps.now ?? (() => new Date().toISOString());
  const newId = deps.newId ?? randomUUID;
  const existing = input.requestId ? await store.findByRequestId(input.clientAccountId, input.requestId) : null;
  if (existing) {
    if (existing.fingerprint !== fingerprintOf(input)) {
      return failure(409, "revision_conflict", { testRunId: existing.id });
    }
    return { ...replay(existing, world, store), duplicateRequest: true, externalCallsThisRequest: NO_EXTERNAL_CALLS };
  }

  const priors = [...(deps.priors ?? []), ...(await store.listForEvent(input.clientAccountId, input.sourceLeadEventId ?? ""))];
  const testRunId = newId();
  const planned = planCapturedTestDelivery(input, world, {
    ...deps,
    testRunId,
    now: now(),
    priors,
  });
  if (!planned.ok) return planned;
  const plan = planned.plan;
  if (plan.kind === "captured_event_delivery" && plan.sheet) {
    const drift = await sheetContractDrift(plan.sheet, deps.rereadSheet);
    if (drift) return drift;
  }
  const createdAt = now();

  if (plan.kind === "preview" || plan.kind === "captured_event_replay") {
    const run = previewRun(plan, createdAt);
    const saved = await store.insert(run, auditFor("preview", plan, createdAt));
    return success(run, plan, world, store, saved.persisted, NO_EXTERNAL_CALLS);
  }

  if (plan.kind === "synthetic_delivery") {
    return executeSynthetic(plan, world, deps, store, createdAt);
  }

  if (resolveExecution(deps) !== "injected_fakes" || !portsReady(plan, deps)) {
    return failure(409, "execution_pending_review", {
      blockedOn: CAPTURED_TEST_BLOCKED_ON,
      warningCodes: plan.warningCodes,
      idempotencyKeys: plan.idempotencyKeys,
      testRunId: plan.testRunId,
      detail: "External adapters stay unwired until schema, persistence, and authorization review.",
    });
  }

  if (
    plan.kind === "captured_event_delivery" &&
    plan.sheet?.sheetsContract === "exact_v3_test_worksheet" &&
    !deps.rereadSheet
  ) {
    return failure(409, "worksheet_blocked", {
      detail: "An exact-v3 captured test requires a sheet reread before any external call.",
      warningCodes: plan.warningCodes,
      idempotencyKeys: plan.idempotencyKeys,
      testRunId: plan.testRunId,
    });
  }

  const executing = executionRun(plan, createdAt);
  const begun = await store.tryBegin(executing, auditFor(plan.repeatOfTestRunId ? "repeat" : "execute", plan, createdAt), {
    clientAccountId: plan.clientAccountId,
    sourceLeadEventId: plan.sourceLeadEventId ?? "",
    destinations: plan.destinations,
    confirmation: input.confirmation ?? null,
    repeatOfTestRunId: input.repeatOfTestRunId ?? null,
  });
  if (!begun.ok) {
    if (begun.existing && begun.error === "duplicate_request") {
      return { ...replay(begun.existing, world, store), duplicateRequest: true, externalCallsThisRequest: NO_EXTERNAL_CALLS };
    }
    return failure(begun.statusCode, begun.error, {
      discrepancy: begun.discrepancy,
      testRunId: plan.testRunId,
      idempotencyKeys: plan.idempotencyKeys,
    });
  }

  const executed = await executeAttempts(plan, input, world, deps);
  await store.finish(plan.testRunId, {
    status: executed.status,
    attempts: executed.attempts,
    warningCodes: plan.warningCodes,
    previewJson: previewPayload(plan),
  });
  const stored = (await store.get(plan.clientAccountId, plan.testRunId)) ?? {
    ...executing,
    status: executed.status,
    attempts: executed.attempts,
  };
  return success(stored, plan, world, store, true, executed.calls, [], executed.effects ?? null);
}

export async function reconcileCapturedTestRun(
  store: CapturedTestStore,
  input: {
    clientAccountId: string;
    testRunId: string;
    requestId: string;
    actorLabel: string | null;
    observation: string;
    inspectedAbsentRow?: boolean;
    now?: string;
  }
): Promise<CapturedTestError | (CapturedTestSuccess & { discrepancy: string })> {
  const observation = input.observation?.trim() ?? "";
  if (!observation) return failure(400, "invalid_confirmation", { detail: "observation is required" });
  const existing = await store.get(input.clientAccountId, input.testRunId);
  if (!existing) {
    return failure(404, "client_not_found", {
      detail: "test run is not in the injected store",
      discrepancy: PR228_RECONCILE_DISCREPANCY,
    });
  }
  const at = input.now ?? new Date().toISOString();
  const saved = await store.reconcile({
    clientAccountId: input.clientAccountId,
    testRunId: input.testRunId,
    observation,
    inspectedAbsentRow: input.inspectedAbsentRow === true,
    at,
    audit: {
      action: "reconcile",
      requestId: input.requestId,
      actorLabel: input.actorLabel,
      auth: "admin_api_key",
      sourceLeadEventId: existing.sourceLeadEventId,
      destinations: existing.destinations,
      isolationMode: existing.isolationMode,
      idempotencyKeys: existing.attempts.map((attempt) => attempt.idempotencyKey),
      noteBodySha256: existing.noteBodySha256,
      sheetRowSha256: existing.sheetRowSha256,
      createdAt: at,
    },
  });
  if (!saved.ok) {
    return failure(saved.statusCode, saved.error, { discrepancy: PR228_RECONCILE_DISCREPANCY, testRunId: input.testRunId });
  }
  if (saved.run.status !== existing.status || saved.run.resendAuthorized !== false || saved.run.appendStartedAtCleared !== false) {
    return failure(409, "repeat_blocked_uncertain", { discrepancy: PR228_RECONCILE_DISCREPANCY, testRunId: input.testRunId });
  }
  const plan = saved.run.previewJson as CapturedTestPlan;
  return {
    ...success(saved.run, plan, emptyWorld(input.clientAccountId), store, true, NO_EXTERNAL_CALLS),
    discrepancy: PR228_RECONCILE_DISCREPANCY,
  };
}

export const unavailableCapturedTestStore: CapturedTestStore = {
  durable: false,
  persistence: "unavailable_pending_migration",
  findByRequestId() {
    return null;
  },
  listForEvent() {
    return [];
  },
  listForClient() {
    return [];
  },
  get() {
    return null;
  },
  insert() {
    return { persisted: false };
  },
  tryBegin() {
    return { ok: false, statusCode: 409, error: "execution_pending_review", existing: null };
  },
  finish() {
    return undefined;
  },
  reconcile() {
    return { ok: false, statusCode: 409, error: "execution_pending_review" };
  },
};

function planSynthetic(
  input: CapturedTestRequest,
  world: CapturedTestWorld,
  deps: Omit<CapturedTestDeps, "now"> & { testRunId: string },
  flags: Flags
): { ok: true; plan: CapturedTestPlan } | CapturedTestError {
  if (input.destinations.includes("ghl_location_api") || input.destinations.includes("ghl_inbound_webhook")) {
    if (!flags.ghlSynthetic) {
      return failure(404, "ghl_synthetic_disabled", { detail: "SA360_CLIENT_ONBOARDING_GHL_SYNTHETIC_ENABLED stays off" });
    }
    return failure(404, "ghl_synthetic_disabled", {
      detail: "This module does not add a GHL synthetic writer when the reserved flag is set.",
    });
  }
  const risk = world.sheets?.campaignRisk;
  if (risk?.uncertain || risk?.appendStartedAtHeld || risk?.campaignTestUnresolved) {
    return failure(409, "worksheet_blocked", { detail: "uncertain campaign-test append is not retried" });
  }
  const keys = [capturedTestKey(deps.testRunId, "synthetic-sheets-delegate")];
  const reserved = reservedProductionIdempotencyKeys(input.clientAccountId, "synthetic");
  const guarded = assertCapturedTestIdempotencyKeys(keys, reserved);
  if (!guarded.ok) return failure(409, "production_idempotency_guard", { detail: guarded.key });
  return {
    ok: true,
    plan: {
      testRunId: deps.testRunId,
      requestId: input.requestId,
      fingerprint: fingerprintOf(input),
      kind: "synthetic_delivery",
      clientAccountId: input.clientAccountId,
      sourceLeadEventId: null,
      destinations: input.destinations,
      isolationMode: null,
      repeatOfTestRunId: null,
      actorLabel: input.actorLabel ?? null,
      warningCodes: [],
      idempotencyKeys: keys,
      sheet: null,
      note: null,
      ghl: null,
      webhook: null,
      synthetic: {
        sheetsDelegate: "sendCompanySheetsCampaignTestRow",
        route: "POST /admin/v1/clients/:clientAccountId/google-sheets/campaign-test",
      },
      productionKeysReserved: reserved,
      sourceDeliverySatisfied: false,
      downstreamExecuted: false,
    },
  };
}

async function executeSynthetic(
  plan: CapturedTestPlan,
  world: CapturedTestWorld,
  deps: CapturedTestDeps,
  store: CapturedTestStore,
  createdAt: string
): Promise<CapturedTestOutcome> {
  if (resolveExecution(deps) !== "injected_fakes" || !deps.syntheticSheets) {
    const run = previewRun(plan, createdAt);
    run.status = "previewed";
    return success(run, plan, world, store, false, NO_EXTERNAL_CALLS, ["external_execution_review"]);
  }
  let result: SyntheticSheetsResult;
  try {
    result = await deps.syntheticSheets.send(plan.clientAccountId);
  } catch {
    result = {
      externalCallExecuted: true,
      inventoryAffected: false,
      billingAffected: false,
      dispatchIntentCreated: false,
      sourceLeadEventCreated: false,
      campaignDispatchEnabled: false,
      status: "uncertain",
      error: "synthetic delegate threw",
    };
  }
  if (
    result.inventoryAffected !== false ||
    result.billingAffected !== false ||
    result.dispatchIntentCreated !== false ||
    result.sourceLeadEventCreated !== false ||
    result.campaignDispatchEnabled !== false
  ) {
    return failure(409, "production_idempotency_guard", { detail: "synthetic delegate reported a production mutation" });
  }
  const status: RunStatus = result.status === "succeeded" ? "succeeded" : result.status === "uncertain" ? "uncertain" : "failed";
  const run = executionRun(plan, createdAt);
  run.status = status;
  run.attempts = [
    {
      id: `${plan.testRunId}:sheets`,
      destination: "google_sheets",
      idempotencyKey: plan.idempotencyKeys[0] ?? capturedTestKey(plan.testRunId, "synthetic-sheets-delegate"),
      status: result.status === "not_called" ? "not_executed" : result.status,
      proves: result.status === "succeeded" ? ["synthetic_row"] : [],
      doesNotProve: ["source_delivery", "campaign_dispatch", "inventory", "billing", "ghl"],
      externalCallExecuted: result.externalCallExecuted,
      downstreamExecuted: false,
      detail: result.error,
    },
  ];
  await store.insert(run, auditFor("execute", plan, createdAt));
  return success(run, plan, world, store, store.durable, {
    providerWebhook: false,
    sheets: result.externalCallExecuted,
    ghl: false,
  });
}

async function executeAttempts(
  plan: CapturedTestPlan,
  input: CapturedTestRequest,
  world: CapturedTestWorld,
  deps: CapturedTestDeps
): Promise<{
  status: RunStatus;
  attempts: StoredAttempt[];
  calls: ExternalCallReport;
  effects: CustomCapturedSheetEffects | null;
}> {
  const attempts: StoredAttempt[] = [];
  const calls: ExternalCallReport = { providerWebhook: false, sheets: false, ghl: false };
  let sheetsUncertain = false;
  let effects: CustomCapturedSheetEffects | null = null;

  if (plan.sheet && plan.destinations.includes("google_sheets")) {
    if (plan.sheet.sheetsContract === CUSTOM_CAMPAIGN_SHEETS_CONTRACT) {
      const custom = await callCustomSheets(plan, deps.customCampaignSheets);
      effects = custom.effects;
      if (custom.outcome.externalCallExecuted) calls.sheets = true;
      if (custom.outcome.status === "uncertain") sheetsUncertain = true;
      attempts.push(sheetAttempt(plan, custom.outcome));
    } else {
      const outcome = await callSheets(plan, deps.sheets);
      if (outcome.externalCallExecuted) calls.sheets = true;
      if (outcome.status === "uncertain") sheetsUncertain = true;
      attempts.push(sheetAttempt(plan, outcome));
    }
  }

  if (plan.webhook) {
    attempts.push({
      id: `${plan.testRunId}:webhook`,
      destination: "ghl_inbound_webhook",
      idempotencyKey: plan.webhook.idempotencyKey,
      status: "not_executed",
      proves: [],
      doesNotProve: ["http_accepted", "downstream_executed", "note_persisted"],
      externalCallExecuted: false,
      downstreamExecuted: false,
      detail: "deliverGhlInboundWebhookFromIntake is not called",
    });
  }

  if (!plan.ghl || !plan.destinations.includes("ghl_location_api")) {
    return { status: rollup(attempts), attempts, calls, effects };
  }
  if (sheetsUncertain) {
    attempts.push(notExecutedGhl(plan, "sheets outcome is uncertain; GHL was not started"));
    return { status: "uncertain", attempts, calls, effects };
  }

  if (deps.ghlAggregate) {
    const aggregate = await executeGhlAggregate(plan, input, world, deps);
    if (aggregate.callsGhl) calls.ghl = true;
    attempts.push(...aggregate.attempts);
    return { status: rollup(attempts), attempts, calls, effects };
  }

  const contactOutcome = await callGhl(() => deps.ghl!.upsertContact(plan.ghl!.contact));
  if (contactOutcome.externalCallExecuted) calls.ghl = true;
  const contactId = contactOutcome.status === "succeeded" ? contactOutcome.externalId : null;
  attempts.push({
    id: `${plan.testRunId}:ghl-contact`,
    destination: "ghl_location_api",
    idempotencyKey: plan.ghl.contact.idempotencyKey,
    status: contactOutcome.status === "succeeded" && !contactId ? "uncertain" : contactOutcome.status,
    proves: contactId ? ["contact_upsert_accepted"] : [],
    doesNotProve: ["downstream_executed", "note_persisted", "source_delivery"],
    externalCallExecuted: contactOutcome.externalCallExecuted,
    downstreamExecuted: false,
    detail: contactId ? null : contactOutcome.error ?? "contact id missing after POST",
  });
  if (!contactId || contactOutcome.status !== "succeeded") {
    return { status: rollup(attempts), attempts, calls, effects };
  }

  let notesStopped = false;
  for (const part of plan.note?.parts ?? []) {
    if (notesStopped) {
      attempts.push(noteAttempt(plan, part, skippedNote(part.part)));
      continue;
    }
    const noteOutcome = await callGhl(() =>
      deps.ghl!.createNote({
        idempotencyKey: part.idempotencyKey,
        locationId: plan.ghl!.locationId,
        contactId,
        sourceLeadEventId: plan.sourceLeadEventId ?? "",
        title: plan.note?.title ?? "SA360 lead",
        body: part.body,
        part: part.part,
      })
    );
    if (noteOutcome.externalCallExecuted) calls.ghl = true;
    const noteId = noteOutcome.status === "succeeded" ? noteOutcome.externalId : null;
    const status: AttemptStatus =
      noteOutcome.status === "succeeded" && !noteId ? "uncertain" : noteOutcome.status;
    attempts.push(noteAttempt(plan, part, { ...noteOutcome, status, externalId: noteId }));
    if (status !== "succeeded") notesStopped = true;
  }
  if (notesStopped || !(plan.note?.parts.length)) {
    return { status: rollup(attempts), attempts, calls, effects };
  }

  const workflow = await callGhl(() =>
    deps.ghl!.enrollWorkflow({
      idempotencyKey: plan.ghl!.workflowIdempotencyKey,
      locationId: plan.ghl!.locationId,
      contactId,
      workflowId: plan.ghl!.workflowId,
      triggerMode: "direct_api",
      sourceLeadEventId: plan.sourceLeadEventId ?? "",
      testRunId: plan.testRunId,
    })
  );
  if (workflow.externalCallExecuted) calls.ghl = true;
  attempts.push({
    id: `${plan.testRunId}:ghl-workflow`,
    destination: "ghl_location_api",
    idempotencyKey: plan.ghl.workflowIdempotencyKey,
    status: workflow.status,
    proves: workflow.status === "succeeded" ? ["http_accepted"] : [],
    doesNotProve: ["downstream_executed", "workflow_finished", "source_delivery"],
    externalCallExecuted: workflow.externalCallExecuted,
    downstreamExecuted: false,
    detail: workflow.error,
  });
  return { status: rollup(attempts), attempts, calls, effects };
}

async function callSheets(
  plan: CapturedTestPlan,
  port: CapturedTestSheetsAppendPort | undefined
): Promise<SheetsAppendOutcome> {
  const sheet = plan.sheet;
  if (sheet && sheet.values.length === EXACT_V3_HEADER.length && isCanaryHeader(sheet.header)) {
    return { status: "failed", externalCallExecuted: false, error: "canary_schema_mismatch" };
  }
  if (sheet?.sheetsContract === "canary_v1_projection") {
    return { status: "failed", externalCallExecuted: false, error: "canary_projection_not_a_v3_proof" };
  }
  if (!sheet || !port) {
    return {
      status: "uncertain",
      externalCallExecuted: true,
      reason: "unknown",
      appendStartedAt: new Date().toISOString(),
    };
  }
  try {
    return await port.append({
      kind: "onboarding_captured_test",
      idempotencyKey: sheet.deliveryRowId,
      deliveryRowId: sheet.deliveryRowId,
      sourceLeadEventId: sheet.sourceLeadEventId,
      clientAccountId: plan.clientAccountId,
      spreadsheetId: sheet.spreadsheetId,
      worksheetId: sheet.worksheetId,
      worksheetTitle: sheet.worksheetTitle,
      worksheetRole: sheet.worksheetRole,
      schemaVersion: sheet.schemaVersion,
      values: sheet.values,
      testRunId: plan.testRunId,
      sa360DeliveryClass: CAPTURED_TEST_DELIVERY_CLASS,
    });
  } catch {
    return {
      status: "uncertain",
      externalCallExecuted: true,
      reason: "unknown",
      appendStartedAt: new Date().toISOString(),
    };
  }
}

async function callCustomSheets(
  plan: CapturedTestPlan,
  port: CustomCapturedCampaignSheetsPort | undefined
): Promise<{ outcome: SheetsAppendOutcome; effects: CustomCapturedSheetEffects }> {
  const quiet: CustomCapturedSheetEffects = {
    inventoryAffected: false,
    billingAffected: false,
    deliveryEnabled: false,
    cutoffChanged: false,
    duplicate: false,
  };
  if (!port || !plan.sourceLeadEventId) {
    return {
      outcome: { status: "failed", externalCallExecuted: false, error: "execution_pending_review" },
      effects: quiet,
    };
  }
  try {
    const result = await port.send({
      clientAccountId: plan.clientAccountId,
      sourceLeadEventId: plan.sourceLeadEventId,
    });
    const effects: CustomCapturedSheetEffects = {
      inventoryAffected: result.inventoryAffected,
      billingAffected: result.billingAffected,
      deliveryEnabled: result.deliveryEnabled,
      cutoffChanged: result.cutoffChanged,
      duplicate: result.duplicate,
    };
    if (result.status === "succeeded") {
      return {
        outcome: {
          status: "succeeded",
          rowsWritten: result.duplicate ? 0 : 1,
          externalCallExecuted: result.externalCallExecuted,
        },
        effects,
      };
    }
    if (result.status === "uncertain") {
      return {
        outcome: {
          status: "uncertain",
          externalCallExecuted: result.externalCallExecuted,
          reason: "unknown",
          appendStartedAt: new Date().toISOString(),
        },
        effects,
      };
    }
    return {
      outcome: {
        status: "failed",
        externalCallExecuted: result.externalCallExecuted,
        error: result.error ?? "failed",
      },
      effects,
    };
  } catch {
    return {
      outcome: {
        status: "uncertain",
        externalCallExecuted: true,
        reason: "unknown",
        appendStartedAt: new Date().toISOString(),
      },
      effects: quiet,
    };
  }
}

async function callGhl(call: () => Promise<GhlStepOutcome>): Promise<GhlStepOutcome> {
  try {
    const outcome = await call();
    if (outcome.status === "succeeded" || outcome.status === "failed" || outcome.status === "uncertain") return outcome;
    return uncertainGhl("unknown_post");
  } catch {
    return uncertainGhl("timeout");
  }
}

function uncertainGhl(reason: "timeout" | "unknown_post"): GhlStepOutcome {
  return {
    status: "uncertain",
    externalCallExecuted: true,
    httpStatus: null,
    externalId: null,
    error: reason,
    reason,
  };
}

function skippedNote(part: number): {
  status: AttemptStatus;
  externalCallExecuted: boolean;
  httpStatus: number | null;
  externalId: string | null;
  error: string | null;
  reason: GhlStepOutcome["reason"];
} {
  return {
    status: "not_executed",
    externalCallExecuted: false,
    httpStatus: null,
    externalId: null,
    error: `note part ${part} was not posted after an earlier uncertain or failed part`,
    reason: null,
  };
}

function sheetAttempt(plan: CapturedTestPlan, outcome: SheetsAppendOutcome): StoredAttempt {
  const executed = outcome.externalCallExecuted === true;
  return {
    id: `${plan.testRunId}:sheets`,
    destination: "google_sheets",
    idempotencyKey: plan.sheet?.deliveryRowId ?? capturedTestKey(plan.testRunId, "sheets"),
    status: outcome.status,
    proves: outcome.status === "succeeded" ? ["row_appended"] : [],
    doesNotProve: ["source_delivery", "campaign_dispatch", "ghl", "inventory", "billing"],
    externalCallExecuted: executed,
    downstreamExecuted: false,
    detail: outcome.status === "failed" ? outcome.error : outcome.status === "uncertain" ? outcome.reason : null,
  };
}

function noteAttempt(
  plan: CapturedTestPlan,
  part: PlannedNotePart,
  outcome: {
    status: AttemptStatus;
    externalCallExecuted: boolean;
    externalId: string | null;
    error: string | null;
  }
): StoredAttempt {
  return {
    id: `${plan.testRunId}:ghl-note:${part.part}`,
    destination: "ghl_location_api",
    idempotencyKey: part.idempotencyKey,
    status: outcome.status,
    proves: outcome.status === "succeeded" && outcome.externalId ? ["note_persisted"] : [],
    doesNotProve: ["downstream_executed", "source_delivery"],
    externalCallExecuted: outcome.externalCallExecuted,
    downstreamExecuted: false,
    detail: outcome.error,
  };
}

function notExecutedGhl(plan: CapturedTestPlan, detail: string): StoredAttempt {
  return {
    id: `${plan.testRunId}:ghl-skipped`,
    destination: "ghl_location_api",
    idempotencyKey: plan.ghl?.contact.idempotencyKey ?? capturedTestKey(plan.testRunId, "ghl-contact"),
    status: "not_executed",
    proves: [],
    doesNotProve: ["contact_upsert_accepted", "note_persisted", "http_accepted", "downstream_executed"],
    externalCallExecuted: false,
    downstreamExecuted: false,
    detail,
  };
}

function rollup(attempts: StoredAttempt[]): RunStatus {
  const scored = attempts.filter((attempt) => attempt.destination !== "ghl_inbound_webhook");
  if (scored.some((attempt) => attempt.status === "uncertain")) return "uncertain";
  if (scored.some((attempt) => attempt.status === "failed" || attempt.status === "not_executed")) return "failed";
  if (scored.length > 0 && scored.every((attempt) => attempt.status === "succeeded")) return "succeeded";
  return "failed";
}

async function executeGhlAggregate(
  plan: CapturedTestPlan,
  input: CapturedTestRequest,
  world: CapturedTestWorld,
  deps: CapturedTestDeps
): Promise<{ attempts: StoredAttempt[]; callsGhl: boolean }> {
  const request = buildOnboardingGhlAggregateRequest(plan, input, world);
  if (!request || !deps.ghlAggregate) {
    return {
      attempts: [
        notExecutedGhl(plan, "The stored lead or Select Time Zone snapshot was not available, so GHL was not called."),
      ],
      callsGhl: false,
    };
  }
  try {
    const receipt = await deps.ghlAggregate.deliver(request);
    return {
      attempts: projectOnboardingGhlReceipt(plan, receipt),
      callsGhl: receipt.externalCallExecuted,
    };
  } catch {
    return {
      attempts: [
        {
          ...notExecutedGhl(plan, "GHL adapter threw before a classified POST outcome"),
          status: "uncertain",
          externalCallExecuted: true,
        },
      ],
      callsGhl: true,
    };
  }
}

function portsReady(plan: CapturedTestPlan, deps: CapturedTestDeps): boolean {
  if (plan.destinations.includes("google_sheets")) {
    if (plan.sheet?.sheetsContract === CUSTOM_CAMPAIGN_SHEETS_CONTRACT) {
      if (!deps.customCampaignSheets) return false;
    } else if (!deps.sheets) return false;
  }
  if (plan.destinations.includes("ghl_location_api") && !deps.ghl && !deps.ghlAggregate) return false;
  return true;
}

function requireOwnedEvent(
  input: CapturedTestRequest,
  world: CapturedTestWorld
): StoredSourceEvent | CapturedTestError {
  const event = world.event;
  if (!event || event.id !== input.sourceLeadEventId) return failure(409, "event_not_client_owned");
  if (!event.clientAccountIdResolved) return failure(409, "event_not_client_owned");
  if (event.clientAccountIdResolved !== input.clientAccountId) return failure(403, "tenant_mismatch");
  const pilot = isCompanySheetsInternalPilotLead({
    sourceRouteKey: event.sourceRouteKey,
    enrichmentMetadataJson: event.enrichmentMetadataJson,
  });
  if (pilot && input.clientAccountId !== COMPANY_SHEETS_INTERNAL_TEST_CLIENT) {
    return failure(409, "internal_pilot_not_client_proof");
  }
  return event;
}

function requireIsolation(
  input: CapturedTestRequest,
  world: CapturedTestWorld,
  event: StoredSourceEvent
): { mode: IsolationMode } | CapturedTestError {
  const mode = input.isolation?.mode ?? null;
  if (mode !== "verified_test_identity" && mode !== "isolated_destination") {
    return failure(422, "test_isolation_required");
  }
  if (mode === "isolated_destination" && input.destinations.includes("ghl_location_api")) {
    const isolated = world.ghl?.isolatedLocationId?.trim() ?? "";
    const production = world.ghl?.locationId?.trim() ?? "";
    const distinct = isolated.length > 0 && isolated !== production;
    return failure(409, "ghl_isolation_unavailable", {
      detail: distinct
        ? "A distinct isolated location id was supplied. PR #228 states there is no second GHL location, and this module does not send to one."
        : "No isolated GHL location exists. The client production location is not an isolated destination.",
      discrepancy: distinct ? PR228_ISOLATED_GHL_DISCREPANCY : undefined,
    });
  }
  if (mode === "verified_test_identity") {
    const custom = input.isolation?.sheetsContract === CUSTOM_CAMPAIGN_SHEETS_CONTRACT;
    if (custom) {
      if (world.sheets?.campaignDispatchEnabled && input.destinations.includes("google_sheets")) {
        return failure(409, "live_tab_test_refused");
      }
      if (isSyntheticCampaignTestEvent(event)) return failure(409, "synthetic_campaign_test_refused");
    } else {
      if (!identityMatches(event, world.identities)) return failure(403, "verified_test_identity_mismatch");
      if (world.sheets?.campaignDispatchEnabled && input.destinations.includes("google_sheets")) {
        return failure(409, "live_tab_test_refused");
      }
    }
  }
  if (input.destinations.includes("google_sheets") && !input.isolation?.sheetsContract) {
    return failure(422, "test_sheet_contract_required");
  }
  return { mode };
}

function sheetTargetBlock(input: CapturedTestRequest, world: CapturedTestWorld): CapturedTestError | null {
  const mode = input.isolation?.mode;
  const risk =
    mode === "isolated_destination"
      ? world.sheets?.approvedTestWorksheetRisk ?? world.sheets?.canaryRisk
      : world.sheets?.campaignRisk;
  if (risk?.uncertain || risk?.appendStartedAtHeld) {
    return failure(409, "worksheet_blocked", { detail: "target worksheet has an uncertain append or a held append marker" });
  }
  return null;
}

function requireGhlExecutionProfile(
  ghl: GhlTargetSnapshot | null,
  note: CapturedTestPlan["note"]
): CapturedTestError | null {
  if (!ghl?.locationId?.trim()) {
    return failure(409, "ghl_isolation_unavailable", { detail: "client GHL location is not set" });
  }
  if (ghl.workflowTriggerMode !== "direct_api" || !ghl.workflowId?.trim()) {
    return failure(409, "workflow_not_found");
  }
  if (ghl.notesEnabled !== true) {
    return failure(409, "note_builder_pending_agent_b", {
      detail: "notesEnabled is not true on the reviewed destination profile",
      blockedOn: ["agent_b_buildOnboardingLeadNote"],
    });
  }
  if (!note?.available || !note.body || !note.parts.length) {
    return failure(409, "note_builder_pending_agent_b", { blockedOn: ["agent_b_buildOnboardingLeadNote"] });
  }
  return null;
}

function buildNotePlan(
  input: CapturedTestRequest,
  world: CapturedTestWorld,
  event: StoredSourceEvent | null,
  deps: Omit<CapturedTestDeps, "now"> & { testRunId: string }
): { note: CapturedTestPlan["note"]; error: CapturedTestError | null } {
  const builder = deps.notes ?? pendingOnboardingLeadNote;
  if (!event) {
    return {
      note: {
        contract: "sa360_lead_note_v2",
        available: false,
        blockedOn: "agent_b_note_formatter",
        title: null,
        body: null,
        bodySha256: null,
        parts: [],
        posted: false,
        keptAnswerCount: null,
        qaEvidence: null,
      },
      error: null,
    };
  }
  let built: OnboardingLeadNoteResult;
  try {
    built = builder({
      contract: "sa360_lead_note_v2",
      sourceLeadEventId: event.id,
      testRunId: deps.testRunId,
      receivedAt: event.receivedAt,
      normalizedPayloadJson: event.normalizedPayloadJson,
      noteOverflow: input.noteOverflow ?? "refuse",
      maxChars: ghlNoteBodyMaxChars(deps.env ?? process.env),
    });
  } catch {
    built = { ok: false, code: "note_builder_pending_agent_b", posted: false };
  }
  if (!built.ok && built.code === "note_too_long") {
    return {
      note: null,
      error: failure(422, "note_too_long", {
        posted: false,
        noteBody: built.body,
        keptAnswerCount: built.keptAnswerCount,
      }),
    };
  }
  if (!built.ok && built.code === "production_idempotency_guard") {
    return {
      note: null,
      error: failure(409, "production_idempotency_guard", {
        detail: built.key,
        posted: false,
      }),
    };
  }
  if (!built.ok) {
    return {
      note: {
        contract: "sa360_lead_note_v2",
        available: false,
        blockedOn: "agent_b_note_formatter",
        title: null,
        body: null,
        bodySha256: null,
        parts: [],
        posted: false,
        keptAnswerCount: null,
        qaEvidence: null,
      },
      error:
        input.kind === "captured_event_delivery"
          ? failure(409, "note_builder_pending_agent_b", { blockedOn: ["agent_b_buildOnboardingLeadNote"] })
          : null,
    };
  }
  const marker = `SA360 test run: ${deps.testRunId}`;
  if (!built.body.includes(marker)) {
    return {
      note: null,
      error: failure(409, "note_builder_pending_agent_b", {
        detail: "test delivery note is missing the SA360 test run line",
        blockedOn: ["agent_b_buildOnboardingLeadNote"],
      }),
    };
  }
  const parts = (built.parts.length ? built.parts : [{ part: 1, body: built.body }]).map((part) => ({
    part: part.part,
    body: part.body,
    idempotencyKey: capturedTestKey(deps.testRunId, `ghl-note:${part.part}`),
  }));
  return {
    note: {
      contract: "sa360_lead_note_v2",
      available: true,
      blockedOn: null,
      title: built.title,
      body: built.body,
      bodySha256: sha256Text(built.body),
      parts,
      posted: false,
      keptAnswerCount: built.keptAnswerCount,
      qaEvidence: built.qaEvidence ?? null,
    },
    error: null,
  };
}

function plannedCustomSheet(
  input: CapturedTestRequest,
  sheets: SheetsTargetSnapshot,
  plan: CustomCampaignSheetPlan
): PlannedSheet {
  return {
    spreadsheetId: plan.spreadsheetId,
    worksheetId: plan.worksheetId,
    worksheetTitle: plan.worksheetTitle,
    worksheetRole: "campaign",
    schemaVersion: plan.schemaVersion,
    header: plan.header,
    headerSha256: sha256Text(JSON.stringify(plan.header)),
    control: sheets.campaignControl ?? null,
    ownerClientAccountId: input.clientAccountId,
    destinationRevision: sheets.destinationRevision ?? 1,
    productionCampaignBind: true,
    sheetsContract: CUSTOM_CAMPAIGN_SHEETS_CONTRACT,
    deliveryRowId: plan.deliveryRowId,
    sourceLeadEventId: plan.sourceLeadEventId,
    values: plan.values,
    valuesSha256: sha256Text(JSON.stringify(plan.values)),
    kind: "onboarding_captured_test",
    headerCompatible: true,
  };
}

function planSheet(
  input: CapturedTestRequest,
  world: CapturedTestWorld,
  event: StoredSourceEvent | null,
  testRunId: string
): { sheet: PlannedSheet | null; error: CapturedTestError | null; warnings?: string[] } {
  const sheets = world.sheets;
  if (!sheets) return { sheet: null, error: failure(409, "worksheet_blocked", { detail: "sheets destination is not saved" }) };
  const contract = input.isolation?.sheetsContract ?? null;
  const delivering = input.kind === "captured_event_delivery";
  if (delivering && !contract) return { sheet: null, error: failure(422, "test_sheet_contract_required") };
  if (contract === "canary_v1_projection") {
    if (delivering) {
      return { sheet: null, error: failure(409, "canary_projection_not_a_v3_proof") };
    }
    return { sheet: planCanaryProjection(input, sheets, event, testRunId), error: null };
  }

  const customBound = sheets.campaign?.schemaVersion === COMPANY_SHEETS_CAMPAIGN_CUSTOM_SCHEMA;
  if (contract === CUSTOM_CAMPAIGN_SHEETS_CONTRACT || (customBound && contract == null && !delivering)) {
    if (delivering && input.confirmation !== CONFIRM_ONE_CUSTOM_SHEETS_ROW) {
      return { sheet: null, error: failure(400, "invalid_confirmation") };
    }
    const planned = planCustomCampaignSheet({
      clientAccountId: input.clientAccountId,
      spreadsheetId: sheets.spreadsheetId,
      campaign: sheets.campaign,
      publishedMap: sheets.publishedCampaignMap ?? null,
      event: event
        ? {
            id: event.id,
            sourceLeadId: event.sourceLeadId,
            receivedAt: event.receivedAt,
            normalizedPayloadJson: event.normalizedPayloadJson,
            enrichmentMetadataJson: event.enrichmentMetadataJson,
          }
        : null,
    });
    if (!planned.applies) return { sheet: null, error: failure(409, "test_worksheet_not_approved") };
    if (!planned.ok) return { sheet: null, error: failure(planned.statusCode, planned.error) };
    return {
      sheet: plannedCustomSheet(input, sheets, planned.plan),
      error: null,
      warnings: planned.plan.warnings,
    };
  }

  const isolated = input.isolation?.mode === "isolated_destination";
  const selected = selectExactV3Target(input, sheets, isolated);
  if ("ok" in selected) return { sheet: null, error: selected };
  const deliveryRowId = capturedTestKey(testRunId, "sheets");
  const sourceLeadEventId = event?.id ?? "synthetic-preview";
  const values = companySheetsCampaignRowValues({
    schemaVersion: COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V3,
    stableRowId: deliveryRowId,
    clientAccountId: input.clientAccountId,
    sourceLeadEventId,
    receivedAt: event?.receivedAt ?? "2026-10-26T15:00:00.000Z",
    sourceLeadId: event?.sourceLeadId ?? null,
    normalizedPayload: event?.normalizedPayloadJson ?? syntheticPreviewPayload(sheets),
  });
  if (!values) return { sheet: null, error: failure(409, "worksheet_blocked", { detail: "campaign row mapper returned no values" }) };
  if (values.length === EXACT_V3_HEADER.length && isCanaryHeader(selected.header)) {
    return { sheet: null, error: failure(409, "canary_schema_mismatch") };
  }
  if (values.length !== selected.header.length || !headersEqual(selected.header, EXACT_V3_HEADER)) {
    return {
      sheet: null,
      error: failure(409, isCanaryHeader(selected.header) ? "canary_schema_mismatch" : "test_worksheet_not_approved"),
    };
  }
  return {
    sheet: {
      spreadsheetId: selected.spreadsheetId,
      worksheetId: selected.worksheetId,
      worksheetTitle: selected.worksheetTitle,
      worksheetRole: "campaign",
      schemaVersion: COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V3,
      header: [...selected.header],
      headerSha256: selected.headerSha256,
      control: selected.control,
      ownerClientAccountId: selected.ownerClientAccountId,
      destinationRevision: selected.destinationRevision,
      productionCampaignBind: selected.productionCampaignBind,
      sheetsContract: "exact_v3_test_worksheet",
      deliveryRowId,
      sourceLeadEventId,
      values,
      valuesSha256: sha256Text(JSON.stringify(values)),
      kind: "onboarding_captured_test",
      headerCompatible: true,
    },
    error: null,
  };
}

function planCanaryProjection(
  input: CapturedTestRequest,
  sheets: SheetsTargetSnapshot,
  event: StoredSourceEvent | null,
  testRunId: string
): PlannedSheet {
  const canary = sheets.canary;
  const header = [...(canary?.header ?? COMPANY_SHEETS_CANARY_HEADER)];
  const values = header.map(() => "");
  values[0] = capturedTestKey(testRunId, "sheets");
  return {
    spreadsheetId: sheets.spreadsheetId,
    worksheetId: canary?.worksheetId ?? 0,
    worksheetTitle: canary?.worksheetTitle ?? "Canary",
    worksheetRole: "canary",
    schemaVersion: COMPANY_SHEETS_CANARY_SCHEMA_VERSION,
    header,
    headerSha256: sha256Text(JSON.stringify(header)),
    control: null,
    ownerClientAccountId: input.clientAccountId,
    destinationRevision: sheets.destinationRevision ?? 1,
    productionCampaignBind: false,
    sheetsContract: "canary_v1_projection",
    deliveryRowId: capturedTestKey(testRunId, "sheets"),
    sourceLeadEventId: event?.id ?? "synthetic-preview",
    values,
    valuesSha256: sha256Text(JSON.stringify(values)),
    kind: "onboarding_captured_test",
    headerCompatible: false,
  };
}

type ExactV3Selection = {
  spreadsheetId: string;
  worksheetId: number;
  worksheetTitle: string;
  header: string[];
  headerSha256: string;
  control: WorksheetControlSnapshot;
  ownerClientAccountId: string;
  destinationRevision: number;
  productionCampaignBind: boolean;
};

function selectExactV3Target(
  input: CapturedTestRequest,
  sheets: SheetsTargetSnapshot,
  isolated: boolean
): ExactV3Selection | CapturedTestError {
  if (isolated) {
    const approved = sheets.approvedTestWorksheet ?? null;
    if (!approved) return failure(409, "test_worksheet_not_approved");
    if (approved.ownerClientAccountId !== input.clientAccountId) return failure(403, "tenant_mismatch");
    if (isStatsTitle(approved.worksheetTitle)) return failure(409, "test_worksheet_not_approved");
    if (
      approved.schemaVersion === COMPANY_SHEETS_CANARY_SCHEMA_VERSION ||
      isCanaryHeader(approved.header) ||
      (sheets.canary != null &&
        approved.worksheetId === sheets.canary.worksheetId &&
        approved.spreadsheetId === sheets.spreadsheetId)
    ) {
      return failure(409, "canary_schema_mismatch");
    }
    if (!isExactV3Header(approved.header) || approved.schemaVersion !== COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V3) {
      return failure(409, "test_worksheet_not_approved");
    }
    if (!controlSelectable(approved.control)) return failure(409, "worksheet_blocked", { detail: approved.control.establishControl });
    return {
      spreadsheetId: approved.spreadsheetId,
      worksheetId: approved.worksheetId,
      worksheetTitle: approved.worksheetTitle,
      header: approved.header,
      headerSha256: approved.headerSha256 || sha256Text(JSON.stringify(approved.header)),
      control: approved.control,
      ownerClientAccountId: approved.ownerClientAccountId,
      destinationRevision: approved.destinationRevision,
      productionCampaignBind: false,
    };
  }
  const campaign = sheets.campaign;
  if (!campaign) return failure(409, "test_worksheet_not_approved");
  if (isStatsTitle(campaign.worksheetTitle)) return failure(409, "test_worksheet_not_approved");
  if (campaign.schemaVersion === COMPANY_SHEETS_CANARY_SCHEMA_VERSION || isCanaryHeader(campaign.header)) {
    return failure(409, "canary_schema_mismatch");
  }
  if (!isExactV3Header(campaign.header) || campaign.schemaVersion !== COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V3) {
    return failure(409, "test_worksheet_not_approved");
  }
  const control = sheets.campaignControl ?? null;
  if (!control || !controlSelectable(control)) {
    return failure(409, "test_worksheet_not_approved");
  }
  return {
    spreadsheetId: sheets.spreadsheetId,
    worksheetId: campaign.worksheetId,
    worksheetTitle: campaign.worksheetTitle,
    header: campaign.header,
    headerSha256: sha256Text(JSON.stringify(campaign.header)),
    control,
    ownerClientAccountId: input.clientAccountId,
    destinationRevision: sheets.destinationRevision ?? 1,
    productionCampaignBind: true,
  };
}

function isCanaryHeader(header: readonly string[]): boolean {
  return (
    header.length === COMPANY_SHEETS_CANARY_HEADER.length &&
    COMPANY_SHEETS_CANARY_HEADER.every((cell, index) => header[index] === cell)
  );
}

function isExactV3Header(header: readonly string[]): boolean {
  return headersEqual(header, EXACT_V3_HEADER);
}

function headersEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && right.every((cell, index) => left[index] === cell);
}

function controlSelectable(control: WorksheetControlSnapshot): boolean {
  return SELECTABLE_CONTROL.has(control.establishControl) && control.checkedAt.trim().length >= 10;
}

function isStatsTitle(title: string): boolean {
  const trimmed = title.trim().toLowerCase();
  return trimmed === "daily stats" || trimmed === "weekly stats";
}

async function sheetContractDrift(
  sheet: PlannedSheet,
  reread: CapturedTestDeps["rereadSheet"]
): Promise<CapturedTestError | null> {
  if (sheet.sheetsContract !== "exact_v3_test_worksheet") return null;
  if (!reread) return null;
  let current: Awaited<ReturnType<NonNullable<CapturedTestDeps["rereadSheet"]>>>;
  try {
    current = await reread(sheet);
  } catch {
    return failure(409, "worksheet_blocked", { detail: "worksheet header could not be reread" });
  }
  if (
    !current ||
    !headersEqual(current.header, sheet.header) ||
    current.headerSha256 !== sheet.headerSha256 ||
    current.ownerClientAccountId !== sheet.ownerClientAccountId ||
    current.destinationRevision !== sheet.destinationRevision ||
    !current.control ||
    !controlSelectable(current.control) ||
    current.control.establishControl !== sheet.control?.establishControl
  ) {
    return failure(409, "header_changed");
  }
  if (sheet.bodyMustBeEmpty && current.historicalDataRows !== "empty") {
    return failure(409, "worksheet_blocked", {
      detail: "test worksheet body is not empty or the body read is incomplete",
    });
  }
  return null;
}

function requireGoogleOnlyPilot(
  input: CapturedTestRequest,
  world: CapturedTestWorld,
  event: StoredSourceEvent
): CapturedTestError | null {
  if (input.destinations.length !== 1 || input.destinations[0] !== "google_sheets") {
    return failure(409, "ghl_destination_not_allowed", {
      detail: "DELIVER ONE GOOGLE SHEETS TEST ROW accepts only google_sheets",
    });
  }
  if (input.isolation?.mode !== "isolated_destination" || input.isolation.sheetsContract !== "exact_v3_test_worksheet") {
    return failure(422, "test_isolation_required", {
      detail: "the one-shot row requires isolated_destination and exact_v3_test_worksheet",
    });
  }
  if (world.sheets?.campaignDispatchEnabled || world.sheets?.agedDispatchEnabled) {
    return failure(409, "live_tab_test_refused", {
      detail: "campaign and aged dispatch must stay off",
    });
  }
  const approved = world.sheets?.approvedTestWorksheet ?? null;
  if (!approved || approved.spreadsheetId === world.sheets?.spreadsheetId) {
    return failure(409, "test_worksheet_not_approved", {
      detail: "the approved worksheet must be a different spreadsheet from the saved production file",
    });
  }
  if (!operatorOwnedIntake(event)) {
    return failure(409, "quarantine_not_registered", {
      detail: "no durable quarantine authorization is registered for this event",
    });
  }
  if (recordClassOf(event) !== ONBOARDING_OPERATOR_OWNED_TEST_CLASS) {
    return failure(409, "event_not_operator_owned", {
      detail: "a recordClass label is not operator-owned provenance",
    });
  }
  if (event.deliveryResultJson != null) {
    return failure(409, "event_not_operator_owned", {
      detail: "the source event already has a delivery result",
    });
  }
  if (!identityMatches(event, world.identities)) {
    return failure(403, "verified_test_identity_mismatch");
  }
  if (world.testIdentitySharedWithOtherClient !== false) {
    return failure(403, "verified_test_identity_mismatch", {
      detail: "test identity exclusivity was not proven for this client",
    });
  }
  const contact = campaignLeadIdentityFromPayload(event.normalizedPayloadJson);
  if (syntheticContact(contact.email)) {
    return failure(409, "synthetic_contact_refused", {
      detail: "synthetic and .invalid addresses are not an operator-owned identity",
    });
  }
  const downstream = event.downstream;
  if (
    !downstream ||
    downstream.inventoryCount !== 0 ||
    downstream.fulfillmentCount !== 0 ||
    downstream.allocationCount !== 0 ||
    downstream.dispatchIntentCount !== 0
  ) {
    return failure(409, "event_not_operator_owned", {
      detail: "inventory, fulfillment, allocation, and dispatch intent counts must be read and zero",
    });
  }
  return null;
}

function recordClassOf(event: StoredSourceEvent): string {
  const meta = event.enrichmentMetadataJson;
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return "";
  const value = (meta as { recordClass?: unknown }).recordClass;
  return typeof value === "string" ? value : "";
}

function syntheticContact(email: string): boolean {
  const value = email.trim().toLowerCase();
  if (!value) return false;
  if (value.endsWith(".invalid") || value.endsWith("@example.com")) return true;
  return (
    value === "synthetic@example.invalid" ||
    value === "synthetic-preview@example.invalid" ||
    value === "sheets-pilot@example.invalid"
  );
}

function planGhl(
  input: CapturedTestRequest,
  world: CapturedTestWorld,
  event: StoredSourceEvent | null,
  testRunId: string,
  note: CapturedTestPlan["note"]
): CapturedTestPlan["ghl"] {
  if (!input.destinations.includes("ghl_location_api")) return null;
  const locationId = world.ghl?.locationId?.trim() ?? "";
  const workflowId = world.ghl?.workflowId?.trim() ?? "";
  if (!locationId || !workflowId || !event || !note?.available) return null;
  const identity = campaignLeadIdentityFromPayload(event.normalizedPayloadJson);
  return {
    locationId,
    workflowId,
    workflowIdempotencyKey: capturedTestKey(testRunId, "ghl-workflow"),
    contact: {
      idempotencyKey: capturedTestKey(testRunId, "ghl-contact"),
      locationId,
      sourceLeadEventId: event.id,
      testRunId,
      email: identity.email || null,
      phone: identity.phone || null,
      firstName: identity.firstName || null,
      lastName: identity.lastName || null,
      sa360DeliveryClass: CAPTURED_TEST_DELIVERY_CLASS,
      sa360TestRunId: testRunId,
    },
  };
}

function collectKeys(testRunId: string, destinations: TestDestination[], noteParts: number): string[] {
  const keys: string[] = [];
  if (destinations.includes("google_sheets")) keys.push(capturedTestKey(testRunId, "sheets"));
  if (destinations.includes("ghl_location_api")) {
    keys.push(capturedTestKey(testRunId, "ghl-contact"));
    keys.push(capturedTestKey(testRunId, "ghl-workflow"));
    const parts = Math.max(noteParts, 1);
    for (let part = 1; part <= parts; part += 1) keys.push(capturedTestKey(testRunId, `ghl-note:${part}`));
  }
  if (destinations.includes("ghl_inbound_webhook")) keys.push(capturedTestKey(testRunId, "ghl-webhook"));
  return keys;
}

function identityMatches(event: StoredSourceEvent, identities: VerifiedTestIdentity[]): boolean {
  const identity = campaignLeadIdentityFromPayload(event.normalizedPayloadJson);
  const email = identity.email.trim().toLowerCase();
  const phone = identity.phone.trim();
  return identities.some((row) => {
    const rowEmail = row.email?.trim().toLowerCase() ?? "";
    const rowPhone = row.phoneE164?.trim() ?? "";
    if (!rowEmail && !rowPhone) return false;
    if (rowEmail && email && rowEmail === email) return true;
    if (rowPhone && phone && rowPhone === phone) return true;
    return false;
  });
}

function overlapsDestination(run: StoredTestRun, destinations: TestDestination[]): boolean {
  return run.destinations.some((destination) => destination !== "ghl_inbound_webhook" && destinations.includes(destination));
}

function validateShape(input: CapturedTestRequest): { statusCode: number; error: string } | null {
  if (!input.requestId?.trim()) return { statusCode: 400, error: "invalid_confirmation" };
  if (!input.clientAccountId?.trim()) return { statusCode: 400, error: "client_account_mismatch" };
  if (!Array.isArray(input.destinations) || input.destinations.length === 0) return { statusCode: 400, error: "invalid_confirmation" };
  const allowed = new Set(input.destinations);
  if (allowed.size !== input.destinations.length) return { statusCode: 400, error: "invalid_confirmation" };
  for (const destination of input.destinations) {
    if (destination !== "google_sheets" && destination !== "ghl_location_api" && destination !== "ghl_inbound_webhook") {
      return { statusCode: 400, error: "invalid_confirmation" };
    }
  }
  if (input.kind === "preview" || input.kind === "captured_event_replay") {
    if (input.execute === true) return { statusCode: 400, error: "invalid_confirmation" };
  }
  if (input.kind === "captured_event_delivery" && input.execute !== true) {
    return { statusCode: 400, error: "invalid_confirmation" };
  }
  if ((input.kind === "captured_event_replay" || input.kind === "captured_event_delivery") && !input.sourceLeadEventId?.trim()) {
    return { statusCode: 409, error: "event_not_client_owned" };
  }
  return null;
}

function customCampaignSheetsShape(input: {
  kind: TestRunKind;
  destinations: readonly TestDestination[];
  isolation?: { mode?: string | null; sheetsContract?: string | null } | null;
}): boolean {
  return (
    input.kind === "captured_event_delivery" &&
    input.destinations.length === 1 &&
    input.destinations[0] === "google_sheets" &&
    input.isolation?.mode === "verified_test_identity" &&
    input.isolation.sheetsContract === CUSTOM_CAMPAIGN_SHEETS_CONTRACT
  );
}

function exclusiveCustomCampaignRequest(input: {
  kind: TestRunKind;
  confirmation?: string | null;
  destinations: readonly TestDestination[];
  isolation?: { mode?: string | null; sheetsContract?: string | null } | null;
}): boolean {
  return customCampaignSheetsShape(input) && input.confirmation === CONFIRM_ONE_CUSTOM_SHEETS_ROW;
}

function isCustomCapturedRun(run: StoredTestRun): boolean {
  return (
    run.warningCodes.includes(CUSTOM_CAPTURED_SHEETS_WARNING) ||
    run.sheetPlan?.sheetsContract === CUSTOM_CAMPAIGN_SHEETS_CONTRACT
  );
}

function executionGate(input: CapturedTestRequest, flags: Flags): { statusCode: number; error: string } | null {
  if (input.kind === "preview" || input.kind === "captured_event_replay") {
    if (!flags.config) return { statusCode: 404, error: "onboarding_config_disabled" };
    return null;
  }
  if (!flags.captured) return { statusCode: 404, error: "captured_test_disabled" };
  if (exclusiveCustomCampaignRequest(input)) return null;
  // REPEAT of a custom captured row is duplicate protection. It does not use the google-only pilot.
  if (customCampaignSheetsShape(input) && input.confirmation === CONFIRM_REPEAT) return null;
  if (!flags.googleOnlyPilot || !exclusiveGoogleOnlyRequest(input)) {
    return { statusCode: 409, error: "google_only_pilot_required" };
  }
  return null;
}

function readFlags(env: NodeJS.ProcessEnv): Flags {
  return {
    config: isOnboardingConfigEnabled(env),
    captured: isCapturedTestEnabled(env),
    googleOnlyPilot: isGoogleOnlyPilotEnabled(env),
    ghlSynthetic: isGhlSyntheticEnabled(env),
  };
}

function fingerprintOf(input: CapturedTestRequest): string {
  const destinations = input.destinations.slice().sort().join(",");
  return [
    input.kind,
    input.sourceLeadEventId ?? "",
    destinations,
    input.isolation?.mode ?? "",
    input.isolation?.sheetsContract ?? "",
    input.repeatOfTestRunId ?? "",
    input.confirmation ?? "",
  ].join("|");
}

function syntheticPreviewPayload(sheets: SheetsTargetSnapshot): unknown {
  return {
    contact: {
      first_name: "SYNTHETIC",
      last_name: "PREVIEW",
      email: "synthetic-preview@example.invalid",
      state: "NA",
    },
    phone: "SYNTHETIC",
    state: { lead_type: "SYNTHETIC" },
    routing: {
      source_intake: {
        lead_id: "synthetic-preview",
        submitted_at: "2026-10-26T14:00:00.000Z",
        unmappedSourceFieldsJson: [
          { key: "notes", value: `Preview only for ${sheets.spreadsheetId}. Not an inventory lead.` },
        ],
      },
    },
  };
}

function previewRun(plan: CapturedTestPlan, createdAt: string): StoredTestRun {
  return baseRun(plan, createdAt, "previewed", plan.idempotencyKeys.map((key) => ({
    id: key,
    destination: destinationForKey(key),
    idempotencyKey: key,
    status: "previewed" as const,
    proves: [],
    doesNotProve: ["row_appended", "http_accepted", "note_persisted", "downstream_executed", "source_delivery"],
    externalCallExecuted: false,
    downstreamExecuted: false as const,
    detail: null,
  })));
}

function executionRun(plan: CapturedTestPlan, createdAt: string): StoredTestRun {
  return baseRun(plan, createdAt, "executing", []);
}

function baseRun(plan: CapturedTestPlan, createdAt: string, status: RunStatus, attempts: StoredAttempt[]): StoredTestRun {
  return {
    id: plan.testRunId,
    clientAccountId: plan.clientAccountId,
    kind: plan.kind,
    sourceLeadEventId: plan.sourceLeadEventId,
    destinations: plan.destinations,
    isolationMode: plan.isolationMode,
    repeatOfTestRunId: plan.repeatOfTestRunId,
    requestId: plan.requestId,
    fingerprint: plan.fingerprint,
    status,
    previewJson: previewPayload(plan),
    warningCodes: plan.warningCodes,
    createdAt,
    attempts,
    reconciledAt: null,
    reconcileObservation: null,
    resendAuthorized: false,
    appendStartedAtCleared: false,
    locksCleared: false,
    noteBodySha256: plan.note?.bodySha256 ?? null,
    sheetRowSha256: plan.sheet?.valuesSha256 ?? null,
    sheetPlan: plan.sheet,
    qaEvidence: plan.note?.qaEvidence ?? null,
  };
}

function previewPayload(plan: CapturedTestPlan): unknown {
  return {
    kind: plan.kind,
    sourceLeadEventId: plan.sourceLeadEventId,
    idempotencyKeys: plan.idempotencyKeys,
    sheet: plan.sheet
      ? {
          worksheetTitle: plan.sheet.worksheetTitle,
          worksheetRole: plan.sheet.worksheetRole,
          schemaVersion: plan.sheet.schemaVersion,
          header: plan.sheet.header,
          deliveryRowId: plan.sheet.deliveryRowId,
          sourceLeadEventId: plan.sheet.sourceLeadEventId,
          values: plan.sheet.values,
          valuesSha256: plan.sheet.valuesSha256,
        }
      : null,
    noteBodySha256: plan.note?.bodySha256 ?? null,
    noteBody: plan.note?.body ?? null,
    noteContract: plan.note?.contract ?? null,
    qaEvidence: plan.note?.qaEvidence ?? null,
    synthetic: plan.synthetic,
    webhookExecuted: false,
    sourceDeliverySatisfied: false,
    downstreamExecuted: false,
  };
}

function destinationForKey(key: string): TestDestination {
  if (key.endsWith(":sheets") || key.includes("synthetic-sheets")) return "google_sheets";
  if (key.endsWith(":ghl-webhook")) return "ghl_inbound_webhook";
  return "ghl_location_api";
}

function auditFor(action: CapturedTestAudit["action"], plan: CapturedTestPlan, createdAt: string): CapturedTestAudit {
  return {
    action,
    requestId: plan.requestId,
    actorLabel: plan.actorLabel,
    auth: "admin_api_key",
    sourceLeadEventId: plan.sourceLeadEventId,
    destinations: plan.destinations,
    isolationMode: plan.isolationMode,
    idempotencyKeys: plan.idempotencyKeys,
    noteBodySha256: plan.note?.bodySha256 ?? null,
    sheetRowSha256: plan.sheet?.valuesSha256 ?? null,
    createdAt,
  };
}

function resolveExecution(deps: CapturedTestDeps): "disabled_pending_review" | "injected_fakes" {
  if (deps.execution !== "injected_fakes") return "disabled_pending_review";
  return "injected_fakes";
}

function replay(run: StoredTestRun, world: CapturedTestWorld, store: CapturedTestStore): CapturedTestSuccess {
  const plan = (run.previewJson ?? {}) as CapturedTestPlan;
  return success(run, plan, world, store, store.durable, NO_EXTERNAL_CALLS);
}

function success(
  run: StoredTestRun,
  plan: CapturedTestPlan,
  world: CapturedTestWorld,
  store: CapturedTestStore,
  persisted: boolean,
  calls: ExternalCallReport,
  extraBlocked: string[] = [],
  effects: CustomCapturedSheetEffects | null = null
): CapturedTestSuccess {
  return {
    ok: true,
    statusCode: 200,
    run,
    plan,
    persisted,
    persistence: store.persistence,
    blockedOn: extraBlocked,
    externalCalls: calls,
    externalCallsThisRequest: calls,
    duplicateRequest: false,
    sourceDeliverySatisfied: false,
    downstreamExecuted: false,
    production: world.production,
    resendAuthorized: false,
    appendStartedAtCleared: false,
    locksCleared: false,
    effects,
  };
}

function failure(
  statusCode: number,
  error: string,
  extra: Partial<CapturedTestError> = {}
): CapturedTestError {
  return {
    ok: false,
    statusCode,
    error,
    detail: extra.detail,
    discrepancy: extra.discrepancy,
    warningCodes: extra.warningCodes ?? [],
    externalCalls: NO_EXTERNAL_CALLS,
    externalCallsThisRequest: NO_EXTERNAL_CALLS,
    posted: extra.posted,
    noteBody: extra.noteBody,
    keptAnswerCount: extra.keptAnswerCount,
    blockedOn: extra.blockedOn,
    resendAuthorized: false,
    appendStartedAtCleared: false,
    locksCleared: false,
    sourceDeliverySatisfied: false,
    testRunId: extra.testRunId,
    idempotencyKeys: extra.idempotencyKeys,
  };
}

function emptyWorld(clientAccountId: string): CapturedTestWorld {
  return {
    clientFound: true,
    event: null,
    identities: [],
    sheets: null,
    ghl: null,
    production: {
      sourceLeadEventCount: 0,
      inventoryCount: 0,
      billingRowCount: 0,
      dispatchIntentCount: 0,
      eventStatus: null,
      eventDeliveryResult: null,
      campaignDispatchEnabled: false,
      agedDispatchEnabled: false,
    },
  };
}

export function externalCallsOf(run: StoredTestRun | null): ExternalCallReport {
  if (!run) return NO_EXTERNAL_CALLS;
  return {
    providerWebhook: false,
    sheets: run.attempts.some((attempt) => attempt.destination === "google_sheets" && attempt.externalCallExecuted),
    ghl: run.attempts.some((attempt) => attempt.destination === "ghl_location_api" && attempt.externalCallExecuted),
  };
}
