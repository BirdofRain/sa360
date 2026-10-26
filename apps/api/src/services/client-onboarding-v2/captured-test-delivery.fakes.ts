import type {
  BuildOnboardingLeadNote,
  CapturedTestAudit,
  CapturedTestStore,
  GhlStepOutcome,
  OnboardingLeadNoteRequest,
  OnboardingLeadNoteResult,
  SheetsAppendOutcome,
  SheetsAppendRequest,
  StoredTestRun,
  SyntheticSheetsResult,
  CapturedTestGhlLocationPort,
  CapturedTestSheetsAppendPort,
  SyntheticSheetsTestPort,
  GhlContactRequest,
  GhlNoteRequest,
  GhlWorkflowRequest,
} from "./captured-test-delivery.js";
import { priorDeliveryBlock } from "./captured-test-delivery.js";

/**
 * Test doubles only. They do not call Google, GHL, or Prisma.
 * The note fake does not format form answers.
 */

export type MemoryCapturedTestStore = CapturedTestStore & {
  runs: StoredTestRun[];
  audits: CapturedTestAudit[];
};

export function createMemoryCapturedTestStore(): MemoryCapturedTestStore {
  const runs: StoredTestRun[] = [];
  const audits: CapturedTestAudit[] = [];
  const store: MemoryCapturedTestStore = {
    durable: true,
    persistence: "injected_test_store",
    runs,
    audits,
    findByRequestId(clientAccountId, requestId) {
      return runs.find((run) => run.clientAccountId === clientAccountId && run.requestId === requestId) ?? null;
    },
    listForEvent(clientAccountId, sourceLeadEventId) {
      return runs.filter(
        (run) => run.clientAccountId === clientAccountId && run.sourceLeadEventId === sourceLeadEventId
      );
    },
    get(clientAccountId, testRunId) {
      return runs.find((run) => run.clientAccountId === clientAccountId && run.id === testRunId) ?? null;
    },
    insert(run, audit) {
      const existing = store.findByRequestId(run.clientAccountId, run.requestId);
      if (existing) return { persisted: true };
      runs.push(run);
      audits.push(audit);
      return { persisted: true };
    },
    tryBegin(run, audit, blockInput) {
      const existing = store.findByRequestId(run.clientAccountId, run.requestId);
      if (existing) return { ok: false, statusCode: 200, error: "duplicate_request", existing };
      const block = priorDeliveryBlock(runs, blockInput);
      if (block) return { ok: false, statusCode: block.statusCode, error: block.error, discrepancy: block.discrepancy, existing: null };
      runs.push(run);
      audits.push(audit);
      return { ok: true };
    },
    finish(testRunId, patch) {
      const run = runs.find((item) => item.id === testRunId);
      if (!run) return;
      run.status = patch.status;
      run.attempts = patch.attempts;
      run.warningCodes = patch.warningCodes;
      run.previewJson = patch.previewJson;
    },
    reconcile(input) {
      const run = store.get(input.clientAccountId, input.testRunId);
      if (!run) return { ok: false, statusCode: 404, error: "client_not_found" };
      run.reconciledAt = input.at;
      run.reconcileObservation = input.inspectedAbsentRow
        ? `${input.observation} (absent row is not proof)`
        : input.observation;
      run.resendAuthorized = false;
      run.appendStartedAtCleared = false;
      run.locksCleared = false;
      audits.push(input.audit);
      return { ok: true, run };
    },
  };
  return store;
}

type SheetsScript =
  | { status: "succeeded" }
  | { status: "failed"; error: string }
  | { status: "uncertain"; reason: "timeout" | "unknown" | "in_flight" }
  | { status: "throw" }
  | { status: "defer" };

export type FakeSheetsAppend = CapturedTestSheetsAppendPort & {
  calls: SheetsAppendRequest[];
  release: () => void;
};

export function createFakeSheetsAppend(script: SheetsScript = { status: "succeeded" }): FakeSheetsAppend {
  const calls: SheetsAppendRequest[] = [];
  let release = () => {};
  const gate = script.status === "defer" ? new Promise<void>((resolve) => { release = resolve; }) : null;
  return {
    calls,
    release,
    async append(request) {
      calls.push(request);
      if (gate) await gate;
      if (script.status === "throw" || script.status === "defer") {
        if (script.status === "throw") throw new Error("sheets timeout");
        return { status: "succeeded", rowsWritten: 1, externalCallExecuted: true };
      }
      if (script.status === "failed") {
        return { status: "failed", externalCallExecuted: true, error: script.error };
      }
      if (script.status === "uncertain") {
        return {
          status: "uncertain",
          externalCallExecuted: true,
          reason: script.reason,
          appendStartedAt: "2026-10-26T19:00:00.000Z",
        } satisfies SheetsAppendOutcome;
      }
      return { status: "succeeded", rowsWritten: 1, externalCallExecuted: true };
    },
  };
}

export type GhlScriptStep =
  | { status: "succeeded"; id: string; httpStatus?: number }
  | { status: "failed"; httpStatus: number; error: string }
  | { status: "uncertain"; reason: "timeout" | "unknown_post" | "http_5xx"; httpStatus?: number | null }
  | { status: "throw" };

export type FakeGhlCall =
  | { step: "contact"; request: GhlContactRequest }
  | { step: "note"; request: GhlNoteRequest }
  | { step: "workflow"; request: GhlWorkflowRequest };

export type FakeGhlLocation = CapturedTestGhlLocationPort & { calls: FakeGhlCall[] };

export function createFakeGhlLocation(script: {
  contact?: GhlScriptStep;
  notes?: GhlScriptStep[];
  workflow?: GhlScriptStep;
  /** When set, every contact upsert returns this id so distinct events can share a contact. */
  sharedContactId?: string;
} = {}): FakeGhlLocation {
  const calls: FakeGhlCall[] = [];
  const contactScript = script.contact ?? { status: "succeeded" as const, id: "contact_default" };
  return {
    calls,
    async upsertContact(request) {
      calls.push({ step: "contact", request });
      const step = contactScript;
      if (script.sharedContactId && step.status === "succeeded") {
        return ghlOutcome({ status: "succeeded", id: script.sharedContactId });
      }
      return ghlOutcome(step);
    },
    async createNote(request) {
      calls.push({ step: "note", request });
      const step = script.notes?.[request.part - 1] ?? { status: "succeeded" as const, id: `note_${request.part}` };
      return ghlOutcome(step);
    },
    async enrollWorkflow(request) {
      calls.push({ step: "workflow", request });
      return ghlOutcome(script.workflow ?? { status: "succeeded", id: "workflow_http", httpStatus: 200 });
    },
  };
}

function ghlOutcome(step: GhlScriptStep): Promise<GhlStepOutcome> {
  if (step.status === "throw") return Promise.reject(new Error("ghl timeout"));
  if (step.status === "uncertain") {
    return Promise.resolve({
      status: "uncertain",
      externalCallExecuted: true,
      httpStatus: step.httpStatus ?? null,
      externalId: null,
      error: step.reason,
      reason: step.reason,
    });
  }
  if (step.status === "failed") {
    return Promise.resolve({
      status: "failed",
      externalCallExecuted: true,
      httpStatus: step.httpStatus,
      externalId: null,
      error: step.error,
      reason: "rejected",
    });
  }
  return Promise.resolve({
    status: "succeeded",
    externalCallExecuted: true,
    httpStatus: step.httpStatus ?? 200,
    externalId: step.id,
    error: null,
    reason: null,
  });
}

export type FakeSyntheticSheets = SyntheticSheetsTestPort & { calls: string[] };

export function createFakeSyntheticSheets(status: SyntheticSheetsResult["status"] = "succeeded"): FakeSyntheticSheets {
  const calls: string[] = [];
  return {
    calls,
    async send(clientAccountId) {
      calls.push(clientAccountId);
      return {
        externalCallExecuted: true,
        inventoryAffected: false,
        billingAffected: false,
        dispatchIntentCreated: false,
        sourceLeadEventCreated: false,
        campaignDispatchEnabled: false,
        status,
        error: status === "succeeded" ? null : status,
      };
    },
  };
}

/** Stub note body. It does not list form answers or copy Agent B's formatter. */
export function fakeOnboardingLeadNote(mode: "stub" | "omit_test_line" | "too_long" | "split" = "stub"): BuildOnboardingLeadNote {
  return (input: OnboardingLeadNoteRequest): OnboardingLeadNoteResult => {
    const marker = input.testRunId ? `SA360 test run: ${input.testRunId}` : "";
    if (mode === "too_long") {
      return {
        ok: false,
        code: "note_too_long",
        body: `full body withheld from GHL\n${marker}`,
        keptAnswerCount: 4,
        posted: false,
      };
    }
    const stub = [
      "SA360 lead",
      `Event: ${input.sourceLeadEventId}`,
      marker,
      "Form Questions and Answers",
      "1. stub: formatter not integrated",
    ].filter((line) => line.length > 0).join("\n");
    if (mode === "omit_test_line") {
      return {
        ok: true,
        contract: "sa360_lead_note_v2",
        title: "SA360 lead",
        body: "SA360 lead\nEvent only",
        parts: [{ part: 1, body: "SA360 lead\nEvent only" }],
        keptAnswerCount: 0,
      };
    }
    if (mode === "split") {
      const part1 = `${stub}\npart-1`;
      const part2 = "part-2 continuation";
      return {
        ok: true,
        contract: "sa360_lead_note_v2",
        title: "SA360 lead",
        body: `${part1}\n${part2}`,
        parts: [
          { part: 1, body: part1 },
          { part: 2, body: part2 },
        ],
        keptAnswerCount: 2,
      };
    }
    return {
      ok: true,
      contract: "sa360_lead_note_v2",
      title: "SA360 lead",
      body: stub,
      parts: [{ part: 1, body: stub }],
      keptAnswerCount: 1,
    };
  };
}
