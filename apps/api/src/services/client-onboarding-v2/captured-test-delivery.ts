import { createHash, randomUUID } from "node:crypto";

import { isCompanySheetsInternalPilotLead } from "@sa360/shared";

import { COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V3 } from "../../lib/company-google-sheets-env.js";
import { COMPANY_SHEETS_INTERNAL_TEST_CLIENT } from "../company-sheets-dispatch/company-sheets-campaign-pilot.js";
import {
  campaignLeadIdentityFromPayload,
  companySheetsCampaignRowValues,
} from "../company-sheets-delivery/company-sheets-campaign-row.js";

/**
 * Captured-lead delivery planner and orchestrator.
 *
 * Implemented here: validation, tenant checks, test identity, idempotency keys,
 * separate Sheets and GHL attempts, and fail-closed uncertainty.
 *
 * Not implemented here, and not enabled by any flag this module sets:
 * Prisma persistence for test runs, attempts, identities, and audit rows;
 * session-role authorization; Agent B's `buildOnboardingLeadNote`;
 * live Google appends; live GHL location calls.
 *
 * PR #228 acceptance item 17 allows a new send after an operator inspects an
 * uncertain run. That is weaker than the append-timeout rule: an absent row
 * does not prove the first request cannot still commit. Reconcile records the
 * inspection and does not authorize another send.
 */
export const CAPTURED_TEST_DELIVERY_CLASS = "onboarding_captured_test" as const;
export const CONFIRM_DELIVER = "DELIVER CAPTURED TEST LEAD";
export const CONFIRM_REPEAT = "REPEAT CAPTURED TEST LEAD";
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
  enrichmentMetadataJson: unknown;
  normalizedPayloadJson: unknown;
  receivedAt: string;
  sourceLeadId: string | null;
  deliveryResultJson: unknown;
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
};

export type CapturedTestWorld = {
  clientFound: boolean;
  event: StoredSourceEvent | null;
  identities: VerifiedTestIdentity[];
  sheets: SheetsTargetSnapshot | null;
  ghl: GhlTargetSnapshot | null;
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
  isolation?: { mode?: IsolationMode | null } | null;
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
    }
  | { ok: false; code: "note_too_long"; body: string; keptAnswerCount: number; posted: false }
  | { ok: false; code: "note_builder_pending_agent_b"; posted: false };

export type BuildOnboardingLeadNote = (input: OnboardingLeadNoteRequest) => OnboardingLeadNoteResult;

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
  | { status: "succeeded"; rowsWritten: number; externalCallExecuted: true }
  | { status: "failed"; externalCallExecuted: true; error: string }
  | {
      status: "uncertain";
      externalCallExecuted: true;
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
};

export type CapturedTestStore = {
  readonly durable: boolean;
  readonly persistence: "unavailable_pending_migration" | "injected_test_store";
  findByRequestId(clientAccountId: string, requestId: string): StoredTestRun | null;
  listForEvent(clientAccountId: string, sourceLeadEventId: string): StoredTestRun[];
  get(clientAccountId: string, testRunId: string): StoredTestRun | null;
  insert(run: StoredTestRun, audit: CapturedTestAudit): { persisted: boolean };
  tryBegin(
    run: StoredTestRun,
    audit: CapturedTestAudit,
    blockInput: PriorBlockInput
  ): { ok: true } | { ok: false; statusCode: number; error: string; discrepancy?: string; existing: StoredTestRun | null };
  finish(testRunId: string, patch: Pick<StoredTestRun, "status" | "attempts" | "warningCodes" | "previewJson">): void;
  reconcile(input: {
    clientAccountId: string;
    testRunId: string;
    observation: string;
    inspectedAbsentRow: boolean;
    at: string;
    audit: CapturedTestAudit;
  }): { ok: true; run: StoredTestRun } | { ok: false; statusCode: number; error: string };
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
  deliveryRowId: string;
  sourceLeadEventId: string;
  values: string[];
  valuesSha256: string;
  kind: "onboarding_captured_test";
  headerCompatible: boolean;
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
};

export type CapturedTestOutcome = CapturedTestError | CapturedTestSuccess;

export type CapturedTestDeps = {
  env?: NodeJS.ProcessEnv;
  now?: () => string;
  newId?: () => string;
  notes?: BuildOnboardingLeadNote;
  store?: CapturedTestStore;
  sheets?: CapturedTestSheetsAppendPort;
  ghl?: CapturedTestGhlLocationPort;
  syntheticSheets?: SyntheticSheetsTestPort;
  /** Route default. Unit tests pass injected_fakes with the ports above. */
  execution?: "disabled_pending_review" | "injected_fakes";
  priors?: StoredTestRun[];
  /**
   * Test seam. Production routes do not set it. A production-shaped key still
   * refuses before any Sheets or GHL port is called.
   */
  keyOverride?: string[];
};

type Flags = {
  config: boolean;
  captured: boolean;
  ghlSynthetic: boolean;
};

export function isOnboardingConfigEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SA360_CLIENT_ONBOARDING_V2_CONFIG_ENABLED === "true";
}

export function isCapturedTestEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SA360_CLIENT_ONBOARDING_V2_CAPTURED_TEST_ENABLED === "true";
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
  if (input.confirmation !== CONFIRM_DELIVER || input.repeatOfTestRunId) {
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
  const flagError = flagGate(input.kind, flags);
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
    : { sheet: null as PlannedSheet | null, error: null as CapturedTestError | null };
  if (sheet.error) return sheet.error;

  const warnings = [...(destinations.includes("ghl_location_api") ? [WARNING_DOWNSTREAM] : [])];
  if (sheet.sheet && !sheet.sheet.headerCompatible) warnings.push("canary_header_not_reviewed");

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
  const existing = input.requestId ? store.findByRequestId(input.clientAccountId, input.requestId) : null;
  if (existing) {
    if (existing.fingerprint !== fingerprintOf(input)) {
      return failure(409, "revision_conflict", { testRunId: existing.id });
    }
    return { ...replay(existing, world, store), duplicateRequest: true, externalCallsThisRequest: NO_EXTERNAL_CALLS };
  }

  const priors = [...(deps.priors ?? []), ...store.listForEvent(input.clientAccountId, input.sourceLeadEventId ?? "")];
  const testRunId = newId();
  const planned = planCapturedTestDelivery(input, world, {
    ...deps,
    testRunId,
    now: now(),
    priors,
  });
  if (!planned.ok) return planned;
  const plan = planned.plan;
  const createdAt = now();

  if (plan.kind === "preview" || plan.kind === "captured_event_replay") {
    const run = previewRun(plan, createdAt);
    const saved = store.insert(run, auditFor("preview", plan, createdAt));
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

  const executing = executionRun(plan, createdAt);
  const begun = store.tryBegin(executing, auditFor(plan.repeatOfTestRunId ? "repeat" : "execute", plan, createdAt), {
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

  const executed = await executeAttempts(plan, deps);
  store.finish(plan.testRunId, {
    status: executed.status,
    attempts: executed.attempts,
    warningCodes: plan.warningCodes,
    previewJson: previewPayload(plan),
  });
  const stored = store.get(plan.clientAccountId, plan.testRunId) ?? {
    ...executing,
    status: executed.status,
    attempts: executed.attempts,
  };
  return success(stored, plan, world, store, true, executed.calls);
}

export function reconcileCapturedTestRun(
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
): CapturedTestError | (CapturedTestSuccess & { discrepancy: string }) {
  const observation = input.observation?.trim() ?? "";
  if (!observation) return failure(400, "invalid_confirmation", { detail: "observation is required" });
  const existing = store.get(input.clientAccountId, input.testRunId);
  if (!existing) {
    return failure(404, "client_not_found", {
      detail: "test run is not in the injected store",
      discrepancy: PR228_RECONCILE_DISCREPANCY,
    });
  }
  const at = input.now ?? new Date().toISOString();
  const saved = store.reconcile({
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
  store.insert(run, auditFor("execute", plan, createdAt));
  return success(run, plan, world, store, store.durable, {
    providerWebhook: false,
    sheets: result.externalCallExecuted,
    ghl: false,
  });
}

async function executeAttempts(
  plan: CapturedTestPlan,
  deps: CapturedTestDeps
): Promise<{ status: RunStatus; attempts: StoredAttempt[]; calls: ExternalCallReport }> {
  const attempts: StoredAttempt[] = [];
  const calls: ExternalCallReport = { providerWebhook: false, sheets: false, ghl: false };
  let sheetsUncertain = false;

  if (plan.sheet && plan.destinations.includes("google_sheets")) {
    const outcome = await callSheets(plan, deps.sheets);
    if (outcome.externalCallExecuted) calls.sheets = true;
    if (outcome.status === "uncertain") sheetsUncertain = true;
    attempts.push(sheetAttempt(plan, outcome));
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
    return { status: rollup(attempts), attempts, calls };
  }
  if (sheetsUncertain) {
    attempts.push(notExecutedGhl(plan, "sheets outcome is uncertain; GHL was not started"));
    return { status: "uncertain", attempts, calls };
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
    return { status: rollup(attempts), attempts, calls };
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
    return { status: rollup(attempts), attempts, calls };
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
  return { status: rollup(attempts), attempts, calls };
}

async function callSheets(
  plan: CapturedTestPlan,
  port: CapturedTestSheetsAppendPort | undefined
): Promise<SheetsAppendOutcome> {
  const sheet = plan.sheet;
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

function portsReady(plan: CapturedTestPlan, deps: CapturedTestDeps): boolean {
  if (plan.destinations.includes("google_sheets") && !deps.sheets) return false;
  if (plan.destinations.includes("ghl_location_api") && !deps.ghl) return false;
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
    if (!identityMatches(event, world.identities)) return failure(403, "verified_test_identity_mismatch");
    if (world.sheets?.campaignDispatchEnabled && input.destinations.includes("google_sheets")) {
      return failure(409, "live_tab_test_refused");
    }
  }
  if (mode === "isolated_destination" && input.destinations.includes("google_sheets")) {
    if (!world.sheets?.canaryApproved || !world.sheets.canary) {
      return failure(409, "worksheet_blocked", { detail: "isolated sheets require canaryApproved and the Canary worksheet" });
    }
  }
  return { mode };
}

function sheetTargetBlock(input: CapturedTestRequest, world: CapturedTestWorld): CapturedTestError | null {
  const mode = input.isolation?.mode;
  const risk = mode === "isolated_destination" ? world.sheets?.canaryRisk : world.sheets?.campaignRisk;
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
    },
    error: null,
  };
}

function planSheet(
  input: CapturedTestRequest,
  world: CapturedTestWorld,
  event: StoredSourceEvent | null,
  testRunId: string
): { sheet: PlannedSheet | null; error: CapturedTestError | null } {
  const sheets = world.sheets;
  if (!sheets) return { sheet: null, error: failure(409, "worksheet_blocked", { detail: "sheets destination is not saved" }) };
  const isolated = input.isolation?.mode === "isolated_destination";
  const target = isolated ? sheets.canary : sheets.campaign;
  if (!target) return { sheet: null, error: failure(409, "worksheet_blocked") };
  const role = isolated ? "canary" : "campaign";
  const schemaVersion = sheets.campaign?.schemaVersion ?? COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V3;
  const deliveryRowId = capturedTestKey(testRunId, "sheets");
  const sourceLeadEventId = event?.id ?? "synthetic-preview";
  const values = companySheetsCampaignRowValues({
    schemaVersion,
    stableRowId: deliveryRowId,
    clientAccountId: input.clientAccountId,
    sourceLeadEventId,
    receivedAt: event?.receivedAt ?? "2026-10-26T15:00:00.000Z",
    sourceLeadId: event?.sourceLeadId ?? null,
    normalizedPayload: event?.normalizedPayloadJson ?? syntheticPreviewPayload(sheets),
  });
  if (!values) return { sheet: null, error: failure(409, "worksheet_blocked", { detail: "campaign row mapper returned no values" }) };
  const header = isolated ? sheets.canary?.header ?? [] : sheets.campaign?.header ?? [];
  const headerCompatible = header.length === values.length && header.every((cell, index) => cell.length >= 0) && !isolated;
  return {
    sheet: {
      spreadsheetId: sheets.spreadsheetId,
      worksheetId: target.worksheetId,
      worksheetTitle: target.worksheetTitle,
      worksheetRole: role,
      schemaVersion,
      deliveryRowId,
      sourceLeadEventId,
      values,
      valuesSha256: sha256Text(JSON.stringify(values)),
      kind: "onboarding_captured_test",
      headerCompatible: isolated ? header.length === values.length : headerCompatible,
    },
    error: null,
  };
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

function flagGate(kind: TestRunKind, flags: Flags): { statusCode: number; error: string } | null {
  if (kind === "preview" || kind === "captured_event_replay") {
    if (!flags.config) return { statusCode: 404, error: "onboarding_config_disabled" };
    return null;
  }
  if (!flags.captured) return { statusCode: 404, error: "captured_test_disabled" };
  return null;
}

function readFlags(env: NodeJS.ProcessEnv): Flags {
  return {
    config: isOnboardingConfigEnabled(env),
    captured: isCapturedTestEnabled(env),
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
          deliveryRowId: plan.sheet.deliveryRowId,
          sourceLeadEventId: plan.sheet.sourceLeadEventId,
          valuesSha256: plan.sheet.valuesSha256,
        }
      : null,
    noteBodySha256: plan.note?.bodySha256 ?? null,
    noteContract: plan.note?.contract ?? null,
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
  extraBlocked: string[] = []
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
