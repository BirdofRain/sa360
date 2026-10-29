/**
 * Prisma persistence for onboarding test runs.
 * One attempt row per destination. Extra GHL note and workflow keys are
 * ClientOnboardingTestAttemptKey rows. This store does not call Google or GHL.
 */

import { Prisma, type PrismaClient } from "@prisma/client";

import { prisma } from "../../lib/db.js";
import { assertGoogleOnlyReservation } from "./google-only-quarantine.js";
import {
  CONFIRM_ONE_GOOGLE_SHEETS_ROW,
  CUSTOM_CAMPAIGN_SHEETS_CONTRACT,
  priorDeliveryBlock,
  type AttemptStatus,
  type CapturedTestAudit,
  type CapturedTestStore,
  type IsolationMode,
  type PlannedSheet,
  type PriorBlockInput,
  type RunStatus,
  type StoredAttempt,
  type StoredTestRun,
  type TestDestination,
  type TestRunKind,
} from "./captured-test-delivery.js";

type Db = PrismaClient | Prisma.TransactionClient;

export type CapturedTestReservationConflict = "duplicate_request" | "fail_closed";

/**
 * A unique requestId collision is an already-accepted reservation.
 * Any other database error, including a different unique target, fails closed.
 */
export function classifyCapturedTestReservationError(err: unknown): CapturedTestReservationConflict {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== "P2002") return "fail_closed";
  const target = err.meta?.target;
  const fields = Array.isArray(target) ? target.map(String) : typeof target === "string" ? [target] : [];
  if (fields.length === 0) return "fail_closed";
  const requestIdentity = fields.every(
    (field) =>
      field === "requestId" ||
      field === "ClientOnboardingTestRun_requestId_key" ||
      field === "ClientOnboardingV2AuditEvent_requestId_key"
  );
  return requestIdentity ? "duplicate_request" : "fail_closed";
}

function sameDestinationSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const seen = new Set(right);
  return left.every((destination) => seen.has(destination));
}

const ATTEMPT_STATUS = new Set<AttemptStatus>([
  "previewed",
  "executing",
  "succeeded",
  "failed",
  "uncertain",
  "not_executed",
]);
const RUN_STATUS = new Set<RunStatus>([
  "previewed",
  "executing",
  "succeeded",
  "failed",
  "uncertain",
  "note_too_long",
]);

const runInclude = {
  attempts: { include: { keys: true } },
} satisfies Prisma.ClientOnboardingTestRunInclude;

type RunRow = Prisma.ClientOnboardingTestRunGetPayload<{ include: typeof runInclude }>;

export function createPrismaCapturedTestStore(db: PrismaClient = prisma): CapturedTestStore {
  return {
    durable: true,
    persistence: "prisma",
    findByRequestId(clientAccountId, requestId) {
      return findByRequestId(db, clientAccountId, requestId);
    },
    listForEvent(clientAccountId, sourceLeadEventId) {
      return listForEvent(db, clientAccountId, sourceLeadEventId);
    },
    listForClient(clientAccountId) {
      return listForClient(db, clientAccountId);
    },
    get(clientAccountId, testRunId) {
      return getRun(db, clientAccountId, testRunId);
    },
    async insert(run, audit) {
      const existing = await findByRequestId(db, run.clientAccountId, run.requestId);
      if (existing) return { persisted: true };
      const ready = sheetReady(run);
      if (!ready.ok) return { persisted: false };
      await db.$transaction(async (tx) => {
        await insertRun(tx, run, audit, ready.sheet);
      });
      return { persisted: true };
    },
    async tryBegin(run, audit, blockInput) {
      const ready = sheetReady(run);
      if (!ready.ok) return { ok: false, statusCode: 409, error: "worksheet_blocked", existing: null };
      try {
        return await db.$transaction(async (tx) => {
          if (
            run.clientAccountId !== blockInput.clientAccountId ||
            (run.sourceLeadEventId ?? "") !== blockInput.sourceLeadEventId ||
            !sameDestinationSet(run.destinations, blockInput.destinations)
          ) {
            return { ok: false as const, statusCode: 409, error: "event_not_client_owned", existing: null };
          }
          // Two-int transaction lock. Every Prisma client and API process on this
          // database waits here, then re-reads the same client and source event.
          await tx.$queryRaw(
            Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(CAST(${blockInput.clientAccountId} AS text)), hashtext(CAST(${blockInput.sourceLeadEventId} AS text)))::text AS locked`
          );
          const existing = await findByRequestId(tx, run.clientAccountId, run.requestId);
          if (existing) return { ok: false as const, statusCode: 200, error: "duplicate_request", existing };
          const priors = await listForEvent(tx, blockInput.clientAccountId, blockInput.sourceLeadEventId);
          const block = priorDeliveryBlock(priors, blockInput);
          if (block) {
            return {
              ok: false as const,
              statusCode: block.statusCode,
              error: block.error,
              discrepancy: block.discrepancy,
              existing: null,
            };
          }
          if (blockInput.confirmation === CONFIRM_ONE_GOOGLE_SHEETS_ROW) {
            const quarantine = await assertGoogleOnlyReservation(tx, blockInput.clientAccountId, blockInput.sourceLeadEventId);
            if (!quarantine.ok) {
              return { ok: false as const, statusCode: 409, error: quarantine.error, existing: null };
            }
          }
          await insertRun(tx, run, audit, ready.sheet);
          return { ok: true as const };
        });
      } catch (err) {
        if (classifyCapturedTestReservationError(err) === "duplicate_request") {
          try {
            const existing = await findByRequestId(db, run.clientAccountId, run.requestId);
            if (existing) return { ok: false as const, statusCode: 200, error: "duplicate_request", existing };
          } catch {
            return { ok: false as const, statusCode: 503, error: "persistence_unavailable", existing: null };
          }
        }
        return { ok: false as const, statusCode: 503, error: "persistence_unavailable", existing: null };
      }
    },
    async finish(testRunId, patch) {
      await db.$transaction(async (tx) => {
        const current = await tx.clientOnboardingTestRun.findUnique({
          where: { id: testRunId },
          include: runInclude,
        });
        if (!current) return;
        if (current.status === "uncertain" || current.status === "previewed" || current.status === "succeeded" || current.status === "failed") {
          return;
        }
        const stored = toStoredRun(current, null);
        const ready = sheetReady({ ...stored, attempts: patch.attempts, sheetPlan: stored.sheetPlan });
        if (!ready.ok) return;
        await tx.clientOnboardingTestRun.update({
          where: { id: testRunId },
          data: {
            status: patch.status,
            warningCodes: patch.warningCodes,
            previewJson: asObject(patch.previewJson),
          },
        });
        if (current.attempts.length === 0 && ready.ok) {
          await createAttempts(tx, { ...stored, attempts: patch.attempts, status: patch.status }, ready.sheet);
        }
      });
    },
    async reconcile(input) {
      const existing = await getRun(db, input.clientAccountId, input.testRunId);
      if (!existing) return { ok: false, statusCode: 404, error: "client_not_found" };
      const keys = existing.attempts.map((attempt) => attempt.idempotencyKey);
      await db.clientOnboardingV2AuditEvent.create({
        data: auditData(
          {
            ...input.audit,
            idempotencyKeys: input.audit.idempotencyKeys.length > 0 ? input.audit.idempotencyKeys : keys,
          },
          existing,
          {
            testRunId: input.testRunId,
            observation: safeText(input.observation),
            inspectedAbsentRow: input.inspectedAbsentRow,
            reconciledAt: input.at,
            resendAuthorized: false,
            appendStartedAtCleared: false,
            locksCleared: false,
          }
        ),
      });
      const run = await getRun(db, input.clientAccountId, input.testRunId);
      if (!run || run.status !== existing.status || run.resendAuthorized !== false) {
        return { ok: false, statusCode: 409, error: "repeat_blocked_uncertain" };
      }
      return { ok: true, run };
    },
  };
}

async function findByRequestId(db: Db, clientAccountId: string, requestId: string): Promise<StoredTestRun | null> {
  const row = await db.clientOnboardingTestRun.findFirst({
    where: { clientAccountId, requestId },
    include: runInclude,
  });
  if (!row) return null;
  return toStoredRun(row, await latestReconcile(db, clientAccountId, row.id));
}

async function listForEvent(db: Db, clientAccountId: string, sourceLeadEventId: string): Promise<StoredTestRun[]> {
  if (!sourceLeadEventId) return [];
  const rows = await db.clientOnboardingTestRun.findMany({
    where: { clientAccountId, sourceLeadEventId },
    include: runInclude,
    orderBy: { createdAt: "desc" },
  });
  return rows.map((row) => toStoredRun(row, null));
}

async function listForClient(db: Db, clientAccountId: string): Promise<StoredTestRun[]> {
  const rows = await db.clientOnboardingTestRun.findMany({
    where: { clientAccountId },
    include: runInclude,
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return rows.map((row) => toStoredRun(row, null));
}

async function getRun(db: Db, clientAccountId: string, testRunId: string): Promise<StoredTestRun | null> {
  const row = await db.clientOnboardingTestRun.findFirst({
    where: { id: testRunId, clientAccountId },
    include: runInclude,
  });
  if (!row) return null;
  return toStoredRun(row, await latestReconcile(db, clientAccountId, testRunId));
}

async function latestReconcile(db: Db, clientAccountId: string, testRunId: string) {
  return db.clientOnboardingV2AuditEvent.findFirst({
    where: {
      clientAccountId,
      action: "reconcile",
      metadataJson: { path: ["testRunId"], equals: testRunId },
    },
    orderBy: { createdAt: "desc" },
  });
}

async function insertRun(tx: Prisma.TransactionClient, run: StoredTestRun, audit: CapturedTestAudit, sheet: PlannedSheet | null) {
  await tx.clientOnboardingTestRun.create({
    data: {
      id: run.id,
      clientAccountId: run.clientAccountId,
      kind: run.kind,
      sourceLeadEventId: run.sourceLeadEventId,
      destinations: run.destinations,
      isolationMode: run.isolationMode,
      sheetsContract: persistedSheetsContract(sheet),
      repeatOfTestRunId: run.repeatOfTestRunId,
      requestId: run.requestId,
      status: run.status,
      requestSnapshot: requestSnapshot(run, sheet),
      previewJson: asObject(run.previewJson),
      warningCodes: run.warningCodes,
      qaEvidenceJson: qaOrNull(run.qaEvidence),
      noteBodySha256: run.noteBodySha256,
      sheetRowSha256: run.sheetRowSha256,
      resendAuthorized: false,
      appendStartedAtCleared: false,
      locksCleared: false,
      providerWebhookCalled: false,
    },
  });
  await createAttempts(tx, run, sheet);
  await tx.clientOnboardingV2AuditEvent.create({ data: auditData(audit, run, { testRunId: run.id }) });
}

async function createAttempts(tx: Prisma.TransactionClient, run: StoredTestRun, sheet: PlannedSheet | null) {
  for (const group of collapseAttempts(run.attempts)) {
    // The attempt check allows an exact-v3 header or a headerless synthetic key.
    // A 15-cell custom map cannot be stored on the attempt row. The mapped cells
    // stay on previewJson. The Sheets job key is captured-event-test:…
    const custom = isCustomCampaignSheet(sheet) && group.destination === "google_sheets";
    const storedKey = custom ? `onboarding-test:${run.id}:synthetic-sheets-delegate` : group.primaryKey;
    const storedKeys = custom ? [storedKey] : group.keys;
    const sheets = group.destination === "google_sheets" && !storedKey.endsWith(":synthetic-sheets-delegate");
    const canary = sheets && sheet?.schemaVersion === "company_sheets_canary_v1";
    await tx.clientOnboardingTestAttempt.create({
      data: {
        testRunId: run.id,
        destination: group.destination,
        idempotencyKey: storedKey,
        status: group.status,
        proves: group.proves,
        doesNotProve: group.doesNotProve,
        externalCallExecuted: group.externalCallExecuted,
        downstreamExecuted: false,
        uncertainReason: group.status === "uncertain" ? safeText(group.detail ?? "uncertain") : null,
        appendStartedAt: sheets && group.externalCallExecuted ? new Date() : null,
        spreadsheetId: sheets ? sheet?.spreadsheetId ?? null : null,
        worksheetId: sheets ? sheet?.worksheetId ?? null : null,
        worksheetTitle: sheets ? sheet?.worksheetTitle ?? null : null,
        schemaVersion: sheets ? sheet?.schemaVersion ?? null : null,
        header: sheets && sheet ? (sheet.header as Prisma.InputJsonValue) : undefined,
        headerSha256: sheets ? sheet?.headerSha256 ?? null : null,
        control: sheets && sheet?.control ? (sheet.control as Prisma.InputJsonValue) : undefined,
        ownerClientAccountId: run.clientAccountId,
        destinationRevision: sheets && !canary ? sheet?.destinationRevision ?? null : sheet?.destinationRevision ?? null,
        productionCampaignBind: sheets ? sheet?.productionCampaignBind === true && !canary : false,
        keys: {
          create: storedKeys.map((idempotencyKey) => ({
            idempotencyKey,
            callKind: callKind(idempotencyKey),
          })),
        },
      },
    });
  }
}

function sheetReady(run: StoredTestRun): { ok: true; sheet: PlannedSheet | null } | { ok: false } {
  const needsSheet = run.attempts.some(
    (attempt) => attempt.destination === "google_sheets" && attempt.idempotencyKey.endsWith(":sheets")
  ) || run.destinations.includes("google_sheets");
  if (!needsSheet) return { ok: true, sheet: run.sheetPlan ?? null };
  const sheet = run.sheetPlan ?? null;
  if (!sheet) return run.attempts.length === 0 ? { ok: true, sheet: null } : { ok: false };
  if (sheet.schemaVersion === "company_sheets_canary_v1") {
    if (sheet.productionCampaignBind || sheet.header.length !== 4) return { ok: false };
    return { ok: true, sheet };
  }
  if (isCustomCampaignSheet(sheet)) {
    if (!sheet.productionCampaignBind || sheet.header.length < 1 || sheet.destinationRevision < 1) return { ok: false };
    return { ok: true, sheet };
  }
  if (sheet.schemaVersion !== "company_sheets_campaign_v3" || sheet.header.length !== 35) return { ok: false };
  if (!sheet.control || sheet.destinationRevision < 1) return { ok: false };
  return { ok: true, sheet };
}

function collapseAttempts(attempts: StoredAttempt[]): Array<{
  destination: TestDestination;
  primaryKey: string;
  keys: string[];
  status: AttemptStatus;
  proves: string[];
  doesNotProve: string[];
  externalCallExecuted: boolean;
  detail: string | null;
}> {
  const groups = new Map<TestDestination, StoredAttempt[]>();
  for (const attempt of attempts) {
    const list = groups.get(attempt.destination) ?? [];
    list.push(attempt);
    groups.set(attempt.destination, list);
  }
  const collapsed = [];
  for (const [destination, list] of groups) {
    const keys = [...new Set(list.map((attempt) => attempt.idempotencyKey))];
    const primaryKey = primaryFor(destination, keys);
    if (!primaryKey) continue;
    collapsed.push({
      destination,
      primaryKey,
      keys,
      status: worstStatus(list.map((attempt) => attempt.status)),
      proves: [...new Set(list.flatMap((attempt) => attempt.proves))],
      doesNotProve: [...new Set(list.flatMap((attempt) => attempt.doesNotProve))],
      externalCallExecuted: list.some((attempt) => attempt.externalCallExecuted),
      detail: list.find((attempt) => attempt.detail)?.detail ?? null,
    });
  }
  return collapsed;
}

function primaryFor(destination: TestDestination, keys: string[]): string | null {
  if (destination === "google_sheets") {
    return keys.find((key) => key.endsWith(":sheets") || key.endsWith(":synthetic-sheets-delegate")) ?? null;
  }
  if (destination === "ghl_inbound_webhook") return keys.find((key) => key.endsWith(":ghl-webhook")) ?? null;
  return keys.find((key) => key.endsWith(":ghl-contact")) ?? null;
}

function worstStatus(statuses: AttemptStatus[]): AttemptStatus {
  const rank: AttemptStatus[] = ["uncertain", "failed", "not_executed", "executing", "previewed", "succeeded"];
  for (const status of rank) {
    if (statuses.includes(status)) return status;
  }
  return "failed";
}

function callKind(key: string): string {
  if (key.endsWith(":sheets")) return "sheets";
  if (key.endsWith(":synthetic-sheets-delegate")) return "synthetic_sheets_delegate";
  if (key.endsWith(":ghl-contact")) return "ghl_contact";
  if (key.endsWith(":ghl-workflow")) return "ghl_workflow";
  if (key.endsWith(":ghl-webhook")) return "ghl_webhook";
  return "ghl_note";
}

function requestSnapshot(run: StoredTestRun, sheet: PlannedSheet | null): Prisma.InputJsonValue {
  return {
    requestId: run.requestId,
    kind: run.kind,
    fingerprint: run.fingerprint,
    confirmation: run.fingerprint.split("|").at(-1) ?? "",
    destinations: run.destinations,
    isolationMode: run.isolationMode,
    sheetsContract: sheet?.sheetsContract ?? null,
    sheet: sheet
      ? {
          spreadsheetId: sheet.spreadsheetId,
          worksheetId: sheet.worksheetId,
          worksheetTitle: sheet.worksheetTitle,
          schemaVersion: sheet.schemaVersion,
          header: sheet.header,
          headerSha256: sheet.headerSha256,
          control: sheet.control,
          destinationRevision: sheet.destinationRevision,
          productionCampaignBind: sheet.productionCampaignBind,
          ownerClientAccountId: sheet.ownerClientAccountId,
          sheetsContract: sheet.sheetsContract,
        }
      : null,
  };
}

function auditData(
  audit: CapturedTestAudit,
  run: Pick<StoredTestRun, "clientAccountId" | "qaEvidence">,
  metadata: Record<string, unknown>
): Prisma.ClientOnboardingV2AuditEventCreateInput {
  return {
    clientAccountId: run.clientAccountId,
    historicalClientAccountId: run.clientAccountId,
    requestId: audit.requestId,
    action: audit.action,
    actorLabel: audit.actorLabel,
    auth: "admin_api_key",
    sourceLeadEventId: audit.sourceLeadEventId,
    destinations: audit.destinations,
    isolationMode: audit.isolationMode,
    idempotencyKeys: audit.idempotencyKeys,
    noteBodySha256: audit.noteBodySha256,
    sheetRowSha256: audit.sheetRowSha256,
    qaEvidenceJson: qaOrNull(run.qaEvidence),
    metadataJson: metadata as Prisma.InputJsonValue,
  };
}

function toStoredRun(
  row: RunRow,
  reconcile: { createdAt: Date; metadataJson: Prisma.JsonValue } | null
): StoredTestRun {
  const snapshot = asRecord(row.requestSnapshot);
  const metadata = asRecord(reconcile?.metadataJson);
  const sheet = sheetFromSnapshot(snapshot?.sheet);
  return {
    id: row.id,
    clientAccountId: row.clientAccountId,
    kind: row.kind as TestRunKind,
    sourceLeadEventId: row.sourceLeadEventId,
    destinations: stringList(row.destinations) as TestDestination[],
    isolationMode: (row.isolationMode as IsolationMode | null) ?? null,
    repeatOfTestRunId: row.repeatOfTestRunId,
    requestId: row.requestId,
    fingerprint: typeof snapshot?.fingerprint === "string" ? snapshot.fingerprint : "",
    status: RUN_STATUS.has(row.status as RunStatus) ? (row.status as RunStatus) : "failed",
    previewJson: row.previewJson,
    warningCodes: stringList(row.warningCodes),
    createdAt: row.createdAt.toISOString(),
    attempts: row.attempts.flatMap((attempt) => expandAttempt(attempt)),
    reconciledAt: reconcile?.createdAt.toISOString() ?? null,
    reconcileObservation: typeof metadata?.observation === "string" ? metadata.observation : null,
    resendAuthorized: false,
    appendStartedAtCleared: false,
    locksCleared: false,
    noteBodySha256: row.noteBodySha256,
    sheetRowSha256: row.sheetRowSha256,
    sheetPlan: sheet,
    qaEvidence: qaFrom(row.qaEvidenceJson),
  };
}

function expandAttempt(attempt: RunRow["attempts"][number]): StoredAttempt[] {
  const keys = attempt.keys.length > 0 ? attempt.keys.map((key) => key.idempotencyKey) : [attempt.idempotencyKey];
  const status = ATTEMPT_STATUS.has(attempt.status as AttemptStatus) ? (attempt.status as AttemptStatus) : "failed";
  return keys.map((idempotencyKey) => ({
    id: idempotencyKey,
    destination: attempt.destination as TestDestination,
    idempotencyKey,
    status,
    proves: stringList(attempt.proves),
    doesNotProve: stringList(attempt.doesNotProve),
    externalCallExecuted: attempt.externalCallExecuted,
    downstreamExecuted: false,
    detail: attempt.uncertainReason,
  }));
}

function sheetFromSnapshot(value: unknown): PlannedSheet | null {
  const record = asRecord(value);
  if (!record || !Array.isArray(record.header)) return null;
  const control = asRecord(record.control);
  return {
    spreadsheetId: String(record.spreadsheetId ?? ""),
    worksheetId: Number(record.worksheetId ?? 0),
    worksheetTitle: String(record.worksheetTitle ?? ""),
    worksheetRole: record.schemaVersion === "company_sheets_canary_v1" ? "canary" : "campaign",
    schemaVersion: String(record.schemaVersion ?? ""),
    header: record.header.filter((cell): cell is string => typeof cell === "string"),
    headerSha256: String(record.headerSha256 ?? ""),
    control:
      control && typeof control.establishControl === "string" && typeof control.checkedAt === "string"
        ? { establishControl: control.establishControl, checkedAt: control.checkedAt }
        : null,
    ownerClientAccountId: String(record.ownerClientAccountId ?? ""),
    destinationRevision: Number(record.destinationRevision ?? 0),
    productionCampaignBind: record.productionCampaignBind === true,
    sheetsContract:
      record.sheetsContract === "canary_v1_projection"
        ? "canary_v1_projection"
        : record.sheetsContract === CUSTOM_CAMPAIGN_SHEETS_CONTRACT
          ? CUSTOM_CAMPAIGN_SHEETS_CONTRACT
          : "exact_v3_test_worksheet",
    deliveryRowId: "",
    sourceLeadEventId: "",
    values: [],
    valuesSha256: "",
    kind: "onboarding_captured_test",
    headerCompatible: record.schemaVersion === "company_sheets_campaign_v3",
  };
}

function persistedSheetsContract(sheet: PlannedSheet | null): "exact_v3_test_worksheet" | "canary_v1_projection" | null {
  if (sheet?.sheetsContract === "exact_v3_test_worksheet" || sheet?.sheetsContract === "canary_v1_projection") {
    return sheet.sheetsContract;
  }
  return null;
}

function isCustomCampaignSheet(sheet: PlannedSheet | null): boolean {
  return sheet?.sheetsContract === CUSTOM_CAMPAIGN_SHEETS_CONTRACT || sheet?.schemaVersion === "company_sheets_campaign_custom_v1";
}

function qaOrNull(value: StoredTestRun["qaEvidence"]): Prisma.NullableJsonNullValueInput | Prisma.InputJsonValue {
  if (!value) return Prisma.DbNull;
  return {
    status: value.status,
    discardedDuplicateCount: value.discardedDuplicateCount,
    fullQaCompletenessAsserted: value.fullQaCompletenessAsserted,
  };
}

function qaFrom(value: Prisma.JsonValue | null): StoredTestRun["qaEvidence"] {
  const record = asRecord(value);
  if (!record) return null;
  if (record.status !== "complete" && record.status !== "discarded_duplicates" && record.status !== "not_recoverable") {
    return null;
  }
  return {
    status: record.status,
    fullQaCompletenessAsserted: record.fullQaCompletenessAsserted === true,
    discardedDuplicateCount: Number(record.discardedDuplicateCount ?? 0),
  };
}

function asObject(value: unknown): Prisma.InputJsonValue {
  const record = asRecord(value);
  return (record ?? {}) as Prisma.InputJsonValue;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function stringList(value: Prisma.JsonValue): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function safeText(value: string): string {
  return value.replace(/https?:\/\/\S+/gi, "[link]").replace(/bearer\s+\S+/gi, "[redacted]").slice(0, 500);
}

export type { PriorBlockInput };
