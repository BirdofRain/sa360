import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";

import { CLIENT_PORTAL_ASSERTION_HEADER } from "@sa360/shared/client-portal-assertion";

import { verifyAdminApiKey } from "../lib/admin-auth.js";
import { CLIENT_PORTAL_KEY_HEADER } from "../lib/client-portal-auth.js";
import { WORKSPACE_KEY_HEADER } from "../lib/workspace-auth.js";
import {
  CAPTURED_TEST_BLOCKED_ON,
  isCapturedTestEnabled,
  isOnboardingConfigEnabled,
  reconcileCapturedTestRun,
  runCapturedTestDelivery,
  unavailableCapturedTestStore,
  type CapturedTestDeps,
  type CapturedTestOutcome,
  type CapturedTestRequest,
  type CapturedTestWorld,
  type IsolationMode,
  type NoteOverflow,
  type TestDestination,
  type StoredTestRun,
  type TestRunKind,
} from "../services/client-onboarding-v2/captured-test-delivery.js";

/**
 * Route skeleton for captured-lead test runs.
 *
 * Mounted once from app.ts at /admin/v1. Default options keep external
 * execution disabled. Portal, workspace, and client-portal assertion
 * credentials are rejected. These paths stay off the observer allowlist.
 */
export type CapturedTestRouteOptions = CapturedTestDeps & {
  verifyAdmin?: typeof verifyAdminApiKey;
  loadWorld?: (
    clientAccountId: string,
    sourceLeadEventId?: string | null
  ) => Promise<CapturedTestWorld> | CapturedTestWorld;
  saveTestIdentity?: (input: {
    clientAccountId: string;
    requestId: string;
    email: string | null;
    phoneE164: string | null;
  }) => Promise<{ ok: true; persisted: boolean } | { ok: false; statusCode: number; error: string }>;
};

const KINDS = new Set<TestRunKind>([
  "preview",
  "captured_event_replay",
  "captured_event_delivery",
  "synthetic_delivery",
]);

const DESTINATIONS = new Set<TestDestination>(["google_sheets", "ghl_location_api", "ghl_inbound_webhook"]);

export const adminClientOnboardingV2TestRoutes: FastifyPluginAsync<CapturedTestRouteOptions> = async (app, opts) => {
  const verify = opts.verifyAdmin ?? verifyAdminApiKey;
  const env = opts.env ?? process.env;
  const store = opts.store ?? unavailableCapturedTestStore;
  const execution = opts.execution ?? "disabled_pending_review";

  app.post("/clients/:clientAccountId/onboarding/test-runs", async (request, reply) => {
    if (foreignOnboardingCredential(request)) return reply.status(403).send({ ok: false, error: "forbidden" });
    if (!(await verify(request, reply))) return;
    const clientAccountId = pathClient(request);
    const parsed = parseRunBody(request.body, clientAccountId, actorLabel(request));
    if (!parsed.ok) return reply.status(parsed.statusCode).send({ ok: false, error: parsed.error });
    const flag = flagForKind(parsed.request.kind, env);
    if (flag) return reply.status(flag.statusCode).send(flag.body);
    const world = await load(opts.loadWorld, clientAccountId, parsed.request.sourceLeadEventId ?? null);
    const outcome = await runCapturedTestDelivery(parsed.request, world, {
      env,
      now: opts.now,
      newId: opts.newId,
      notes: opts.notes,
      store,
      sheets: opts.sheets,
      ghl: opts.ghl,
      syntheticSheets: opts.syntheticSheets,
      execution,
      priors: opts.priors,
    });
    return sendOutcome(reply, outcome);
  });

  app.get("/clients/:clientAccountId/onboarding/test-runs", async (request, reply) => {
    if (foreignOnboardingCredential(request)) return reply.status(403).send({ ok: false, error: "forbidden" });
    if (!(await verify(request, reply))) return;
    if (!isOnboardingConfigEnabled(env)) {
      return reply.status(404).send({ ok: false, error: "onboarding_config_disabled" });
    }
    const clientAccountId = pathClient(request);
    const runs = await store.listForClient(clientAccountId);
    return reply.send({
      ok: true,
      runs: runs.map((run) => presentRun(run)),
      externalCalls: { providerWebhook: false as const, sheets: false, ghl: false },
      resendAuthorized: false as const,
      sourceDeliverySatisfied: false as const,
      downstreamExecuted: false as const,
    });
  });

  app.get("/clients/:clientAccountId/onboarding/test-runs/:testRunId", async (request, reply) => {
    if (foreignOnboardingCredential(request)) return reply.status(403).send({ ok: false, error: "forbidden" });
    if (!(await verify(request, reply))) return;
    if (!isOnboardingConfigEnabled(env)) {
      return reply.status(404).send({ ok: false, error: "onboarding_config_disabled" });
    }
    const clientAccountId = pathClient(request);
    const testRunId = (request.params as { testRunId: string }).testRunId;
    const run = await store.get(clientAccountId, testRunId);
    if (!run) {
      return reply.status(404).send({
        ok: false,
        error: store.durable ? "client_not_found" : "execution_pending_review",
        persisted: false,
        blockedOn: store.durable ? [] : CAPTURED_TEST_BLOCKED_ON,
        externalCalls: { providerWebhook: false, sheets: false, ghl: false },
      });
    }
    return reply.send({
      ok: true,
      run,
      externalCalls: { providerWebhook: false as const, sheets: false, ghl: false },
      sourceDeliverySatisfied: false,
      downstreamExecuted: false,
      resendAuthorized: false,
    });
  });

  app.post("/clients/:clientAccountId/onboarding/test-runs/:testRunId/reconcile", async (request, reply) => {
    if (foreignOnboardingCredential(request)) return reply.status(403).send({ ok: false, error: "forbidden" });
    if (!(await verify(request, reply))) return;
    if (!isCapturedTestEnabled(env)) {
      return reply.status(404).send({
        ok: false,
        error: "captured_test_disabled",
        externalCalls: { providerWebhook: false, sheets: false, ghl: false },
      });
    }
    const clientAccountId = pathClient(request);
    const testRunId = (request.params as { testRunId: string }).testRunId;
    const body = asRecord(request.body);
    const outcome = await reconcileCapturedTestRun(store, {
      clientAccountId,
      testRunId,
      requestId: typeof body?.requestId === "string" ? body.requestId : "",
      actorLabel: actorLabel(request),
      observation: typeof body?.observation === "string" ? body.observation : "",
      inspectedAbsentRow: body?.inspectedAbsentRow === true,
      now: opts.now?.(),
    });
    return sendOutcome(reply, outcome);
  });

  app.put("/clients/:clientAccountId/onboarding/test-identities", async (request, reply) => {
    if (foreignOnboardingCredential(request)) return reply.status(403).send({ ok: false, error: "forbidden" });
    if (!(await verify(request, reply))) return;
    if (!isOnboardingConfigEnabled(env)) {
      return reply.status(404).send({ ok: false, error: "onboarding_config_disabled" });
    }
    const clientAccountId = pathClient(request);
    const body = asRecord(request.body);
    if (body && "clientAccountId" in body && body.clientAccountId !== clientAccountId) {
      return reply.status(400).send({ ok: false, error: "client_account_mismatch" });
    }
    const requestId = typeof body?.requestId === "string" ? body.requestId.trim() : "";
    const email = typeof body?.email === "string" ? body.email.trim() : null;
    const phoneE164 = typeof body?.phoneE164 === "string" ? body.phoneE164.trim() : null;
    if (!requestId || (!email && !phoneE164)) {
      return reply.status(400).send({ ok: false, error: "invalid_confirmation" });
    }
    if (!opts.saveTestIdentity) {
      return reply.status(409).send({
        ok: false,
        error: "execution_pending_review",
        persisted: false,
        blockedOn: ["prisma_migration_client_onboarding_verified_test_identity"],
        externalCalls: { providerWebhook: false, sheets: false, ghl: false },
      });
    }
    const saved = await opts.saveTestIdentity({ clientAccountId, requestId, email, phoneE164 });
    if (!saved.ok) return reply.status(saved.statusCode).send({ ok: false, error: saved.error, persisted: false });
    return reply.send({ ok: true, persisted: saved.persisted, externalCalls: { providerWebhook: false, sheets: false, ghl: false } });
  });
};

function foreignOnboardingCredential(request: FastifyRequest): boolean {
  return [CLIENT_PORTAL_KEY_HEADER, CLIENT_PORTAL_ASSERTION_HEADER, WORKSPACE_KEY_HEADER].some((name) => {
    const raw = request.headers[name.toLowerCase()];
    const value = Array.isArray(raw) ? raw[0] : raw;
    return typeof value === "string" && value.trim().length > 0;
  });
}

function pathClient(request: FastifyRequest): string {
  return (request.params as { clientAccountId: string }).clientAccountId;
}

function actorLabel(request: FastifyRequest): string | null {
  const raw = request.headers["x-sa360-admin-actor"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function flagForKind(kind: TestRunKind, env: NodeJS.ProcessEnv): { statusCode: number; body: Record<string, unknown> } | null {
  if ((kind === "preview" || kind === "captured_event_replay") && !isOnboardingConfigEnabled(env)) {
    return {
      statusCode: 404,
      body: {
        ok: false,
        error: "onboarding_config_disabled",
        externalCalls: { providerWebhook: false, sheets: false, ghl: false },
      },
    };
  }
  if ((kind === "captured_event_delivery" || kind === "synthetic_delivery") && !isCapturedTestEnabled(env)) {
    return {
      statusCode: 404,
      body: {
        ok: false,
        error: "captured_test_disabled",
        externalCalls: { providerWebhook: false, sheets: false, ghl: false },
      },
    };
  }
  return null;
}

async function load(
  loader: CapturedTestRouteOptions["loadWorld"],
  clientAccountId: string,
  sourceLeadEventId: string | null
): Promise<CapturedTestWorld> {
  if (!loader) return missingClientWorld();
  return loader(clientAccountId, sourceLeadEventId);
}

function parseRunBody(
  body: unknown,
  clientAccountId: string,
  actor: string | null
): { ok: true; request: CapturedTestRequest } | { ok: false; statusCode: number; error: string } {
  const record = asRecord(body);
  if (!record) return { ok: false, statusCode: 400, error: "invalid_confirmation" };
  if ("clientAccountId" in record && record.clientAccountId !== clientAccountId) {
    return { ok: false, statusCode: 400, error: "client_account_mismatch" };
  }
  const kind = record.kind;
  if (typeof kind !== "string" || !KINDS.has(kind as TestRunKind)) {
    return { ok: false, statusCode: 400, error: "invalid_confirmation" };
  }
  if (!Array.isArray(record.destinations) || record.destinations.some((item) => typeof item !== "string" || !DESTINATIONS.has(item as TestDestination))) {
    return { ok: false, statusCode: 400, error: "invalid_confirmation" };
  }
  const isolation = asRecord(record.isolation);
  const mode = isolation?.mode;
  if (mode != null && mode !== "verified_test_identity" && mode !== "isolated_destination") {
    return { ok: false, statusCode: 400, error: "test_isolation_required" };
  }
  const sheetsContract = isolation?.sheetsContract;
  if (
    sheetsContract != null &&
    sheetsContract !== "exact_v3_test_worksheet" &&
    sheetsContract !== "canary_v1_projection"
  ) {
    return { ok: false, statusCode: 400, error: "test_sheet_contract_required" };
  }
  const noteOverflow = record.noteOverflow;
  if (noteOverflow != null && noteOverflow !== "refuse" && noteOverflow !== "split_continuation") {
    return { ok: false, statusCode: 400, error: "invalid_confirmation" };
  }
  return {
    ok: true,
    request: {
      requestId: typeof record.requestId === "string" ? record.requestId : "",
      kind: kind as TestRunKind,
      clientAccountId,
      sourceLeadEventId: typeof record.sourceLeadEventId === "string" ? record.sourceLeadEventId : null,
      destinations: record.destinations as TestDestination[],
      execute: record.execute === true,
      confirmation: typeof record.confirmation === "string" ? record.confirmation : null,
      acknowledgeDownstreamAutomation: record.acknowledgeDownstreamAutomation === true,
      isolation:
        mode || sheetsContract
          ? {
              mode: (mode as IsolationMode | undefined) ?? null,
              sheetsContract: (sheetsContract as "exact_v3_test_worksheet" | "canary_v1_projection" | undefined) ?? null,
            }
          : null,
      noteOverflow: (noteOverflow as NoteOverflow | undefined) ?? "refuse",
      repeatOfTestRunId: typeof record.repeatOfTestRunId === "string" ? record.repeatOfTestRunId : null,
      actorLabel: actor,
    },
  };
}

function sendOutcome(reply: FastifyReply, outcome: CapturedTestOutcome | (CapturedTestOutcome & { discrepancy?: string })) {
  if (!outcome.ok) {
    return reply.status(outcome.statusCode).send({
      ok: false,
      error: outcome.error,
      detail: outcome.detail,
      discrepancy: outcome.discrepancy,
      warningCodes: outcome.warningCodes,
      externalCalls: outcome.externalCalls,
      posted: outcome.posted,
      noteBody: outcome.noteBody,
      keptAnswerCount: outcome.keptAnswerCount,
      blockedOn: outcome.blockedOn,
      resendAuthorized: false,
      appendStartedAtCleared: false,
      locksCleared: false,
      sourceDeliverySatisfied: false,
      testRunId: outcome.testRunId,
      idempotencyKeys: outcome.idempotencyKeys,
    });
  }
  return reply.status(200).send({
    ok: true,
    testRunId: outcome.run.id,
    status: outcome.run.status,
    kind: outcome.run.kind,
    persisted: outcome.persisted,
    persistence: outcome.persistence,
    blockedOn: outcome.blockedOn,
    warningCodes: outcome.run.warningCodes,
    idempotencyKeys: outcome.plan.idempotencyKeys,
    attempts: outcome.run.attempts,
    preview: outcome.run.previewJson,
    externalCalls: { ...outcome.externalCallsThisRequest, providerWebhook: false as const },
    duplicateRequest: outcome.duplicateRequest,
    sourceDeliverySatisfied: false,
    downstreamExecuted: false,
    resendAuthorized: false,
    appendStartedAtCleared: false,
    locksCleared: false,
    discrepancy: "discrepancy" in outcome ? outcome.discrepancy : undefined,
    production: outcome.production,
  });
}

function presentRun(run: StoredTestRun) {
  const preview = asRecord(run.previewJson);
  const sheet = asRecord(preview?.sheet);
  const evidence = asRecord(preview?.qaEvidence) ?? run.qaEvidence ?? null;
  return {
    id: run.id,
    kind: run.kind,
    status: run.status,
    sourceLeadEventId: run.sourceLeadEventId,
    attempts: run.attempts.map((attempt) => ({
      ...attempt,
      downstreamExecuted: false as const,
    })),
    sheet: sheet
      ? {
          worksheetTitle: typeof sheet.worksheetTitle === "string" ? sheet.worksheetTitle : null,
          worksheetRole: typeof sheet.worksheetRole === "string" ? sheet.worksheetRole : null,
          schemaVersion: typeof sheet.schemaVersion === "string" ? sheet.schemaVersion : null,
          header: Array.isArray(sheet.header) ? sheet.header.filter((cell): cell is string => typeof cell === "string") : null,
          values: Array.isArray(sheet.values) ? sheet.values.filter((cell): cell is string => typeof cell === "string") : null,
          valuesSha256: typeof sheet.valuesSha256 === "string" ? sheet.valuesSha256 : null,
          deliveryRowId: typeof sheet.deliveryRowId === "string" ? sheet.deliveryRowId : null,
          sourceLeadEventId: typeof sheet.sourceLeadEventId === "string" ? sheet.sourceLeadEventId : null,
        }
      : null,
    noteBody: typeof preview?.noteBody === "string" ? preview.noteBody : null,
    noteBodySha256: run.noteBodySha256,
    noteContract: typeof preview?.noteContract === "string" ? preview.noteContract : null,
    qaEvidence: evidence,
    reconcileObservation: run.reconcileObservation,
    resendAuthorized: false as const,
    appendStartedAtCleared: false as const,
    locksCleared: false as const,
    sourceDeliverySatisfied: false as const,
    downstreamExecuted: false as const,
  };
}

function missingClientWorld(): CapturedTestWorld {
  return {
    clientFound: false,
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

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}
