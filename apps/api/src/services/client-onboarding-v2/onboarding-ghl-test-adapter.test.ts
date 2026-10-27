import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { text } from "node:stream/consumers";

import {
  buildOnboardingLeadNote,
  reconstructOnboardingNoteBody,
  type OnboardingStoredLeadEvent,
} from "../ghl-delivery-adapter/onboarding-lead-note.js";
import {
  GHL_CONTACT_NOTE_TRANSMIT_CEILING,
  createOnboardingGhlTestAdapter,
  isReservedProductionDeliveryKey,
  onboardingGhlTestOperationKeys,
  type OnboardingGhlTestAdapterDeps,
  type OnboardingGhlTestDeliveryRequest,
} from "./onboarding-ghl-test-adapter.js";

const CLIENT = "client_a";
const RUN = "run_1";
const LOCATION = "loc_client";
const WORKFLOW = "wf_select";
const TOKEN = "loc-token-test";

type Step = { status: number; json: unknown; hang?: boolean };
type Received = {
  method: string;
  path: string;
  headers: http.IncomingHttpHeaders;
  body: unknown;
};

const requests: Received[] = [];
let upsertStep: Step = { status: 200, json: { contact: { id: "contact_1" }, downstream_executed: true } };
let noteSteps: Step[] = [];
let workflowStep: Step = { status: 200, json: { success: true, downstream_executed: true } };
let noteCount = 0;
let origin = "";
let server: https.Server | null = null;
let certDir = "";
let queue: Promise<unknown> = Promise.resolve();
let booting: Promise<void> | null = null;

function exclusive<T>(run: () => Promise<T>): Promise<T> {
  const next = queue.then(run, run);
  queue = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}

function resetScript(): void {
  requests.length = 0;
  noteCount = 0;
  upsertStep = { status: 200, json: { contact: { id: "contact_1" }, downstream_executed: true } };
  noteSteps = [];
  workflowStep = { status: 200, json: { success: true, downstream_executed: true } };
}

function approvedEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    [ "SA360_CLIENT_ONBOARDING_V2_CAPTURED_TEST_ENABLED" ]: "true",
    [ "SA360_CLIENT_ONBOARDING_GHL_LOCATION_TEST_ADAPTER_APPROVED" ]: "true",
    ...extra,
  };
}

function storedEvent(overrides: Partial<OnboardingStoredLeadEvent> = {}): OnboardingStoredLeadEvent {
  return {
    sourceLeadEventId: "evt_note_v2",
    clientAccountId: CLIENT,
    generatedAt: "2026-10-26T15:04:00.000Z",
    fullName: "Ada Lovelace",
    phone: "+15550100",
    email: "ada@example.com",
    state: "TX",
    leadType: "VET",
    sourceText: "leadcapture go.example.com/alex",
    sourceAttributes: {
      primary_reason: "Family",
      age: 47,
      date_of_birth: "1979-04-12",
      military_status: "",
      fbclid: "IwAR123",
    },
    schemaDrift: {
      possibleRenames: [{ from: "Coverage Reason", to: "Primary Reason", canonical: "primary_reason" }],
    },
    answerFields: [
      { key: "Primary Reason", value: "Family", canonicalKey: "primary_reason" },
      { key: "Age", value: "47", canonicalKey: "age" },
      { key: "DOB", value: "April 12, 1979", canonicalKey: "date_of_birth" },
      { key: "Military Status", value: "", canonicalKey: "military_status" },
      { key: "Beneficiary", value: "Child", canonicalKey: "beneficiary" },
      { key: "Beneficiary", value: "Spouse", canonicalKey: "beneficiary" },
      { key: "Desired Coverage", value: ["25000", "50000"], canonicalKey: "desired_coverage" },
      { key: "fbclid", value: "IwAR123", canonicalKey: "fbclid" },
      { key: "xxTrustedFormCertUrl", value: "https://cert.example/secret" },
      { key: "Age/ DOB", value: "should-not-merge" },
    ],
    ...overrides,
  };
}

function deliveryRequest(overrides: Partial<OnboardingGhlTestDeliveryRequest> = {}): OnboardingGhlTestDeliveryRequest {
  const event = overrides.event ?? storedEvent();
  return {
    clientAccountId: CLIENT,
    testRunId: RUN,
    sourceLeadEventId: event.sourceLeadEventId,
    authorization: { scope: "client", clientAccountId: CLIENT, testRunId: RUN, granted: true },
    verifiedTestIdentity: { email: "ada@example.com", phoneE164: "+15550100" },
    contact: {
      fullName: event.fullName,
      firstName: event.firstName,
      lastName: event.lastName,
      email: event.email,
      phone: event.phone,
      state: event.state,
    },
    event,
    locationId: LOCATION,
    selectedLocationId: LOCATION,
    workflowId: WORKFLOW,
    workflowName: "Select Time Zone",
    workflowTriggerMode: "direct_api",
    discoveredWorkflows: [{ id: WORKFLOW, name: "Select Time Zone", status: "published" }],
    acknowledgeDownstreamAutomation: true,
    noteOverflow: "refuse",
    ...overrides,
  };
}

function loopbackFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  const headerRecord: Record<string, string> = {};
  const headers = init?.headers;
  if (headers && !Array.isArray(headers) && !(headers instanceof Headers)) {
    for (const [key, value] of Object.entries(headers)) {
      if (typeof value === "string") headerRecord[key] = value;
    }
  }
  const body = init?.body == null ? undefined : String(init.body);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error: Error | null, response?: Response) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve(response as Response);
    };
    const req = https.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port,
        path: `${url.pathname}${url.search}`,
        method: init?.method ?? "POST",
        headers: headerRecord,
        rejectUnauthorized: false,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          finish(null, new Response(Buffer.concat(chunks).toString("utf8"), { status: res.statusCode ?? 0 }));
        });
      }
    );
    const signal = init?.signal;
    const abort = () => {
      const error = new Error("The operation was aborted.");
      error.name = "TimeoutError";
      req.destroy(error);
      finish(error);
    };
    if (signal) {
      if (signal.aborted) abort();
      else signal.addEventListener("abort", abort, { once: true });
    }
    req.on("error", () => {
      const error = new Error("socket closed");
      error.name = signal?.aborted ? "TimeoutError" : "Error";
      finish(error);
    });
    if (body) req.write(body);
    req.end();
  });
}

function adapter(overrides: OnboardingGhlTestAdapterDeps = {}) {
  return createOnboardingGhlTestAdapter({
    env: approvedEnv(),
    apiBaseUrl: origin,
    fetch: loopbackFetch,
    resolveAuth: async () => ({ token: TOKEN }),
    timeoutMs: 2_000,
    ...overrides,
  });
}

test("operation keys stay on the onboarding-test prefix", () => {
  const keys = onboardingGhlTestOperationKeys(RUN, 2);
  assert.deepEqual(keys, {
    contact: "onboarding-test:run_1:ghl-contact",
    notes: ["onboarding-test:run_1:ghl-note:1", "onboarding-test:run_1:ghl-note:2"],
    workflow: "onboarding-test:run_1:ghl-workflow",
  });
  assert.equal(isReservedProductionDeliveryKey("ghl-note:client_a:evt_note_v2"), true);
  assert.equal(isReservedProductionDeliveryKey("ghl-webhook:client_a:evt_note_v2"), true);
  assert.equal(isReservedProductionDeliveryKey("campaign:client_a:evt_note_v2"), true);
  assert.equal(isReservedProductionDeliveryKey("lead:client_a:evt_note_v2"), true);
  assert.equal(isReservedProductionDeliveryKey(keys.contact), false);
  assert.equal(isReservedProductionDeliveryKey(keys.notes[0] ?? ""), false);
  assert.equal(isReservedProductionDeliveryKey(keys.workflow), false);
});

test("the adapter does not use the retrying live transport or the shared execution binding", () => {
  const source = readFileSync(new URL("./onboarding-ghl-test-adapter.ts", import.meta.url), "utf8");
  assert.equal(source.includes("ghlLiveJson("), false);
  assert.equal(source.includes("from \"./onboarding-execution-binding"), false);
  assert.equal(source.includes("createFailClosedGhlPort("), false);
  assert.equal(source.includes("allowRetry"), false);
  assert.equal(source.includes("downstream_executed: false"), true);
});

test("mock HTTPS delivery keeps the five evidence facts separate", async () => {
  await boot();
  await exclusive(async () => {
    resetScript();
    const request = deliveryRequest();
    const plan = buildOnboardingLeadNote({
      event: request.event,
      clientAccountId: CLIENT,
      testRunId: RUN,
      maxChars: 10_000,
    });
    assert.equal(plan.ok, true);
    if (!plan.ok) return;

    const receipt = await adapter().deliver(request);

    assert.equal(receipt.ok, true);
    assert.equal(receipt.posted, true);
    assert.equal(receipt.retried, false);
    assert.equal(receipt.externalCallExecuted, true);
    assert.equal(receipt.error, null);
    assert.deepEqual(receipt.evidence, {
      http_accepted: true,
      contact_upserted: true,
      note_persisted: true,
      workflow_enrolled: true,
      downstream_executed: false,
    });
    assert.equal(JSON.stringify(receipt).includes('"downstream_executed":true'), false);
    assert.equal(receipt.contactId, "contact_1");
    assert.equal(receipt.workflowId, WORKFLOW);
    assert.equal(receipt.providerNoteBodyCeiling, GHL_CONTACT_NOTE_TRANSMIT_CEILING);
    assert.deepEqual(
      receipt.notes.map((note) => note.noteId),
      ["note_1"]
    );
    assert.deepEqual(receipt.calls.map((call) => [call.operation, call.path, call.idempotencyKey, call.attempts]), [
      ["contact", "/contacts/upsert", "onboarding-test:run_1:ghl-contact", 1],
      ["note", "/contacts/contact_1/notes", "onboarding-test:run_1:ghl-note:1", 1],
      ["workflow", "/contacts/contact_1/workflow/wf_select", "onboarding-test:run_1:ghl-workflow", 1],
    ]);

    assert.equal(requests.length, 3);
    assert.deepEqual(requests.map((call) => `${call.method} ${call.path}`), [
      "POST /contacts/upsert",
      "POST /contacts/contact_1/notes",
      "POST /contacts/contact_1/workflow/wf_select",
    ]);
    const contact = requests[0]!;
    assert.equal(contact.headers.authorization, `Bearer ${TOKEN}`);
    assert.equal(contact.headers.version, "2021-07-28");
    assert.equal(contact.headers["idempotency-key"], "onboarding-test:run_1:ghl-contact");
    assert.deepEqual(contact.body, {
      locationId: LOCATION,
      firstName: "Ada",
      lastName: "Lovelace",
      email: "ada@example.com",
      phone: "+15550100",
      state: "TX",
      source: "sa360",
    });
    const note = requests[1]!;
    assert.deepEqual(Object.keys(note.body as Record<string, unknown>).sort(), ["body", "title"]);
    const noteBody = note.body as { title: string; body: string };
    assert.equal(noteBody.title, "SA360 lead");
    assert.equal(noteBody.body, plan.body);
    assert.match(noteBody.body, /Form Questions and Answers/);
    assert.match(noteBody.body, /1\. Primary Reason \(was: Coverage Reason\): Family/);
    assert.match(noteBody.body, /6\. Beneficiary \(2\): Spouse/);
    assert.match(noteBody.body, /7\. Desired Coverage: 25000; 50000/);
    assert.match(noteBody.body, /SA360 test run: run_1/);
    assert.equal(noteBody.body.includes("fbclid"), false);
    assert.equal(noteBody.body.includes("IwAR123"), false);
    assert.equal(noteBody.body.includes("https://cert.example/secret"), false);
    assert.equal(noteBody.body.includes("Age/ DOB"), false);
    const workflow = requests[2]!;
    assert.deepEqual(workflow.body, { locationId: LOCATION });
    assert.equal(workflow.headers["idempotency-key"], "onboarding-test:run_1:ghl-workflow");
    for (const call of requests) {
      const serialized = JSON.stringify(call.body);
      assert.equal(serialized.includes("customFields"), false);
      assert.equal(serialized.includes("customField"), false);
      assert.equal(serialized.includes("\"tags\""), false);
      assert.equal(serialized.includes("opportunit"), false);
      assert.equal(call.path.includes("/customFields"), false);
      assert.equal(call.path.includes("/tags"), false);
      assert.equal(call.path.includes("/workflows"), false);
    }
  });
});

test("split continuation posts every note part in order and then enrolls once", async () => {
  await boot();
  await exclusive(async () => {
    resetScript();
    const request = deliveryRequest({ noteOverflow: "split_continuation" });
    const plan = buildOnboardingLeadNote({
      event: request.event,
      clientAccountId: CLIENT,
      testRunId: RUN,
      noteOverflow: "split_continuation",
      maxChars: 280,
    });
    assert.equal(plan.ok, true);
    if (!plan.ok) return;
    assert.ok(plan.parts.length > 1);

    const receipt = await adapter({ env: approvedEnv({ SA360_GHL_NOTE_BODY_MAX_CHARS: "280" }) }).deliver(request);
    const noteCalls = requests.filter((call) => call.path.endsWith("/notes"));
    const bodies = noteCalls.map((call) => (call.body as { body: string }).body);

    assert.equal(receipt.evidence.note_persisted, true);
    assert.equal(receipt.evidence.workflow_enrolled, true);
    assert.equal(receipt.evidence.downstream_executed, false);
    assert.equal(receipt.retried, false);
    assert.deepEqual(receipt.notes.map((note) => note.part), plan.parts.map((part) => part.part));
    assert.deepEqual(
      receipt.notes.map((note) => note.idempotencyKey),
      plan.parts.map((part) => `onboarding-test:run_1:ghl-note:${part.part}`)
    );
    assert.equal(new Set(receipt.notes.map((note) => note.noteId)).size, plan.parts.length);
    assert.deepEqual(bodies, plan.parts.map((part) => part.body));
    assert.equal(reconstructOnboardingNoteBody(plan.parts), plan.body);
    assert.match(plan.body, /Form Questions and Answers/);
    assert.equal(requests.at(-1)?.path, "/contacts/contact_1/workflow/wf_select");
    assert.equal(requests.filter((call) => call.path.includes("/workflow/")).length, 1);
    assert.equal(noteCalls.length, plan.parts.length);
  });
});

test("an uncertain note part is not retried and later parts are not posted", async () => {
  await boot();
  await exclusive(async () => {
    resetScript();
    noteSteps = [
      { status: 201, json: { note: { id: "note_1" } } },
      { status: 500, json: { message: "unavailable" } },
    ];
    const receipt = await adapter({ env: approvedEnv({ SA360_GHL_NOTE_BODY_MAX_CHARS: "280" }) }).deliver(
      deliveryRequest({ noteOverflow: "split_continuation" })
    );
    const noteCalls = requests.filter((call) => call.path.endsWith("/notes"));
    assert.equal(noteCalls.length, 2);
    assert.equal(requests.filter((call) => call.path.includes("/workflow/")).length, 0);
    assert.equal(receipt.error, "note_uncertain");
    assert.equal(receipt.evidence.contact_upserted, true);
    assert.equal(receipt.evidence.note_persisted, false);
    assert.equal(receipt.evidence.workflow_enrolled, false);
    assert.equal(receipt.evidence.http_accepted, false);
    assert.equal(receipt.evidence.downstream_executed, false);
    assert.equal(receipt.retried, false);
    assert.equal(receipt.notes[1]?.classification, "uncertain");
    assert.equal(receipt.notes[1]?.attempts, 1);
    assert.ok(receipt.notes.slice(2).every((note) => note.classification === "not_sent" && note.attempts === 0));
  });
});

test("a provider 422 on a note is failed, not retried, and does not enroll", async () => {
  await boot();
  await exclusive(async () => {
    resetScript();
    noteSteps = [{ status: 422, json: { message: "body too long" } }];
    const receipt = await adapter().deliver(deliveryRequest());
    assert.equal(requests.filter((call) => call.path.endsWith("/notes")).length, 1);
    assert.equal(requests.filter((call) => call.path.includes("/workflow/")).length, 0);
    assert.equal(receipt.error, "unsupported_note_size");
    assert.equal(receipt.evidence.note_persisted, false);
    assert.equal(receipt.evidence.workflow_enrolled, false);
    assert.equal(receipt.evidence.downstream_executed, false);
    assert.equal(receipt.notes[0]?.attempts, 1);
    assert.equal(receipt.retried, false);
  });
});

test("duplicate note ids stop the delivery before enrollment", async () => {
  await boot();
  await exclusive(async () => {
    resetScript();
    noteSteps = [
      { status: 201, json: { note: { id: "note_same" } } },
      { status: 201, json: { note: { id: "note_same" } } },
    ];
    const receipt = await adapter({ env: approvedEnv({ SA360_GHL_NOTE_BODY_MAX_CHARS: "280" }) }).deliver(
      deliveryRequest({ noteOverflow: "split_continuation" })
    );
    assert.equal(requests.filter((call) => call.path.endsWith("/notes")).length, 2);
    assert.equal(requests.filter((call) => call.path.includes("/workflow/")).length, 0);
    assert.equal(receipt.error, "note_partial");
    assert.equal(receipt.evidence.note_persisted, false);
    assert.equal(receipt.evidence.downstream_executed, false);
    assert.deepEqual(
      receipt.notes.slice(0, 2).map((note) => note.noteId),
      ["note_same", null]
    );
  });
});

test("an uncertain contact upsert is not retried and does not post notes", async () => {
  await boot();
  await exclusive(async () => {
    resetScript();
    upsertStep = { status: 500, json: { message: "unavailable" } };
    const receipt = await adapter().deliver(deliveryRequest());
    assert.equal(requests.length, 1);
    assert.equal(receipt.error, "contact_upsert_uncertain");
    assert.equal(receipt.evidence.http_accepted, false);
    assert.equal(receipt.evidence.contact_upserted, false);
    assert.equal(receipt.evidence.note_persisted, false);
    assert.equal(receipt.evidence.workflow_enrolled, false);
    assert.equal(receipt.calls[0]?.attempts, 1);
    assert.equal(receipt.retried, false);
  });
});

test("HTTP 408 and 429 are uncertain and are not submitted again", async () => {
  await boot();
  await exclusive(async () => {
    resetScript();
    upsertStep = { status: 408, json: { message: "timeout" } };
    const timedOut = await adapter().deliver(deliveryRequest());
    assert.equal(requests.length, 1);
    assert.equal(timedOut.error, "contact_upsert_uncertain");

    resetScript();
    upsertStep = { status: 429, json: { message: "slow down" } };
    const limited = await adapter().deliver(deliveryRequest());
    assert.equal(requests.length, 1);
    assert.equal(limited.error, "contact_upsert_uncertain");
    assert.equal(limited.evidence.downstream_executed, false);
  });
});

test("a 2xx contact response without an id does not count as contact_upserted", async () => {
  await boot();
  await exclusive(async () => {
    resetScript();
    upsertStep = { status: 200, json: { ok: true, downstream_executed: true } };
    const receipt = await adapter().deliver(deliveryRequest());
    assert.equal(requests.length, 1);
    assert.equal(receipt.evidence.http_accepted, true);
    assert.equal(receipt.evidence.contact_upserted, false);
    assert.equal(receipt.evidence.downstream_executed, false);
    assert.equal(receipt.error, "contact_upsert_uncertain");
  });
});

test("a hung contact POST is uncertain after one attempt", async () => {
  await boot();
  await exclusive(async () => {
    resetScript();
    upsertStep = { status: 200, json: {}, hang: true };
    const receipt = await adapter({ timeoutMs: 150 }).deliver(deliveryRequest());
    assert.equal(requests.length, 1);
    assert.equal(receipt.error, "contact_upsert_uncertain");
    assert.equal(receipt.calls[0]?.httpStatus, null);
    assert.equal(receipt.calls[0]?.classification, "uncertain");
    assert.equal(receipt.evidence.contact_upserted, false);
    assert.equal(receipt.retried, false);
  });
});

test("workflow HTTP 2xx enrolls without proving downstream execution", async () => {
  await boot();
  await exclusive(async () => {
    resetScript();
    workflowStep = { status: 200, json: { downstream_executed: true, succeeded: true } };
    const receipt = await adapter().deliver(deliveryRequest());
    assert.equal(receipt.evidence.workflow_enrolled, true);
    assert.equal(receipt.evidence.downstream_executed, false);
    assert.equal(receipt.ok, true);
  });
});

test("an uncertain workflow enrollment is not retried", async () => {
  await boot();
  await exclusive(async () => {
    resetScript();
    workflowStep = { status: 200, json: {}, hang: true };
    const receipt = await adapter({ timeoutMs: 150 }).deliver(deliveryRequest());
    assert.equal(requests.filter((call) => call.path.includes("/workflow/")).length, 1);
    assert.equal(receipt.error, "workflow_enrollment_uncertain");
    assert.equal(receipt.evidence.workflow_enrolled, false);
    assert.equal(receipt.evidence.note_persisted, true);
    assert.equal(receipt.evidence.downstream_executed, false);
    assert.equal(receipt.retried, false);
  });
});

test("a workflow 4xx is a failed enrollment and is not retried", async () => {
  await boot();
  await exclusive(async () => {
    resetScript();
    workflowStep = { status: 404, json: { message: "workflow not found" } };
    const receipt = await adapter().deliver(deliveryRequest());
    assert.equal(requests.filter((call) => call.path.includes("/workflow/")).length, 1);
    assert.equal(receipt.error, "workflow_enrollment_failed");
    assert.equal(receipt.evidence.http_accepted, false);
    assert.equal(receipt.evidence.workflow_enrolled, false);
    assert.equal(receipt.evidence.downstream_executed, false);
  });
});

test("a redirect is not followed to a production host", async () => {
  await boot();
  await exclusive(async () => {
    resetScript();
    upsertStep = { status: 302, json: { location: "https://services.leadconnectorhq.com/contacts/upsert" } };
    const receipt = await adapter().deliver(deliveryRequest());
    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.path, "/contacts/upsert");
    assert.equal(receipt.error, "contact_upsert_failed");
    assert.equal(receipt.evidence.contact_upserted, false);
    assert.equal(receipt.evidence.downstream_executed, false);
  });
});

test("fail closed before any HTTPS call", async () => {
  await boot();
  await exclusive(async () => {
    const cases: Array<{ name: string; env?: NodeJS.ProcessEnv; request?: OnboardingGhlTestDeliveryRequest; error: string }> = [
      { name: "global flag", env: { SA360_CLIENT_ONBOARDING_GHL_LOCATION_TEST_ADAPTER_APPROVED: "true" }, error: "global_flag_disabled" },
      {
        name: "approval flag",
        env: { SA360_CLIENT_ONBOARDING_V2_CAPTURED_TEST_ENABLED: "true", SA360_CLIENT_ONBOARDING_GHL_LOCATION_TEST_ADAPTER_APPROVED: "TRUE" },
        error: "live_adapter_not_approved",
      },
      {
        name: "other client",
        request: deliveryRequest({
          authorization: { scope: "client", clientAccountId: "other_client", testRunId: RUN, granted: true },
        }),
        error: "client_authorization_required",
      },
      {
        name: "grant missing",
        request: deliveryRequest({
          authorization: { scope: "client", clientAccountId: CLIENT, testRunId: RUN, granted: false },
        }),
        error: "client_authorization_required",
      },
      {
        name: "identity",
        request: deliveryRequest({ verifiedTestIdentity: { email: "other@example.com", phoneE164: "+15559999" } }),
        error: "verified_test_identity_mismatch",
      },
      {
        name: "acknowledgement",
        request: deliveryRequest({ acknowledgeDownstreamAutomation: false }),
        error: "downstream_automation_not_acknowledged",
      },
      { name: "location missing", request: deliveryRequest({ locationId: "", selectedLocationId: "" }), error: "ghl_destination_missing" },
      {
        name: "location mismatch",
        request: deliveryRequest({ selectedLocationId: "loc_other" }),
        error: "ghl_destination_missing",
      },
      { name: "invalid workflow", request: deliveryRequest({ workflowId: "wf/../fields" }), error: "invalid_workflow_id" },
      {
        name: "unknown workflow",
        request: deliveryRequest({
          workflowId: "wf_missing",
          workflowName: "Select Time Zone",
          discoveredWorkflows: [{ id: "wf_other", name: "Welcome" }],
        }),
        error: "workflow_not_found",
      },
      {
        name: "stale workflow",
        request: deliveryRequest({
          discoveredWorkflows: [{ id: "wf_new", name: "Select Time Zone" }],
        }),
        error: "workflow_stale",
      },
      {
        name: "ambiguous workflow",
        request: deliveryRequest({
          discoveredWorkflows: [
            { id: "wf_a", name: "Select Time Zone" },
            { id: "wf_b", name: "select time zone" },
          ],
        }),
        error: "workflow_ambiguous",
      },
      {
        name: "tag trigger",
        request: deliveryRequest({ workflowTriggerMode: "tag_trigger" }),
        error: "workflow_trigger_mode_invalid",
      },
      {
        name: "other event client",
        request: deliveryRequest({ event: storedEvent({ clientAccountId: "other_client" }) }),
        error: "client_account_mismatch",
      },
    ];

    for (const item of cases) {
      resetScript();
      let authCalls = 0;
      const receipt = await adapter({
        env: item.env ?? approvedEnv(),
        resolveAuth: async () => {
          authCalls += 1;
          return { token: TOKEN };
        },
      }).deliver(item.request ?? deliveryRequest());
      assert.equal(receipt.error, item.error, item.name);
      assert.equal(receipt.externalCallExecuted, false, item.name);
      assert.equal(requests.length, 0, item.name);
      assert.equal(authCalls, 0, item.name);
      assert.equal(receipt.evidence.downstream_executed, false, item.name);
      assert.equal(receipt.retried, false, item.name);
    }
  });
});

test("note overflow refuses or rejects an unsupported configured maximum before HTTPS", async () => {
  await boot();
  await exclusive(async () => {
    resetScript();
    const tooLong = await adapter({ env: approvedEnv({ SA360_GHL_NOTE_BODY_MAX_CHARS: "280" }) }).deliver(
      deliveryRequest({ noteOverflow: "refuse" })
    );
    assert.equal(tooLong.error, "note_too_long");
    assert.equal(tooLong.posted, false);
    assert.equal(tooLong.externalCallExecuted, false);
    assert.equal(requests.length, 0);

    resetScript();
    const unsupported = await adapter({
      env: approvedEnv({ SA360_GHL_NOTE_BODY_MAX_CHARS: String(GHL_CONTACT_NOTE_TRANSMIT_CEILING + 1) }),
    }).deliver(deliveryRequest());
    assert.equal(unsupported.error, "unsupported_note_size");
    assert.equal(unsupported.providerNoteBodyCeiling, GHL_CONTACT_NOTE_TRANSMIT_CEILING);
    assert.equal(requests.length, 0);
    assert.equal(unsupported.evidence.downstream_executed, false);
  });
});

test("production and non-loopback hosts are refused before location auth", async () => {
  await boot();
  await exclusive(async () => {
    const hosts = [
      "https://services.leadconnectorhq.com",
      "https://marketplace.leadconnectorhq.com",
      "https://example.com",
      "http://127.0.0.1:9",
    ];
    for (const apiBaseUrl of hosts) {
      resetScript();
      let authCalls = 0;
      const receipt = await adapter({
        apiBaseUrl,
        resolveAuth: async () => {
          authCalls += 1;
          return { token: TOKEN };
        },
      }).deliver(deliveryRequest());
      assert.equal(receipt.error, "live_ghl_write_not_authorized", apiBaseUrl);
      assert.equal(receipt.externalCallExecuted, false, apiBaseUrl);
      assert.equal(authCalls, 0, apiBaseUrl);
      assert.equal(requests.length, 0, apiBaseUrl);
    }
  });
});

test("a missing location connection does not post", async () => {
  await boot();
  await exclusive(async () => {
    resetScript();
    const receipt = await adapter({ resolveAuth: async () => null }).deliver(deliveryRequest());
    assert.equal(receipt.error, "ghl_location_connection_missing");
    assert.equal(receipt.externalCallExecuted, false);
    assert.equal(requests.length, 0);
    assert.equal(receipt.evidence.contact_upserted, false);
  });
});

after(async () => {
  await queue;
  if (!server) return;
  const closing = server;
  server = null;
  await new Promise<void>((resolve, reject) => {
    closing.close((error) => (error ? reject(error) : resolve()));
  });
  if (certDir) rmSync(certDir, { recursive: true, force: true });
});

async function boot(): Promise<void> {
  if (!booting) booting = startMock();
  return booting;
}

async function startMock(): Promise<void> {
  certDir = mkdtempSync(join(tmpdir(), "sa360-ghl-mock-"));
  execFileSync(
    "openssl",
    ["req", "-x509", "-newkey", "rsa:2048", "-keyout", join(certDir, "key.pem"), "-out", join(certDir, "cert.pem"), "-days", "1", "-nodes", "-subj", "/CN=127.0.0.1"],
    { stdio: "ignore" }
  );
  const cert = readFileSync(join(certDir, "cert.pem"));
  const key = readFileSync(join(certDir, "key.pem"));
  server = https.createServer({ cert, key }, (req, res) => {
    void handle(req, res);
  });
  await new Promise<void>((resolve) => {
    server?.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address() as AddressInfo;
  origin = `https://127.0.0.1:${address.port}`;
}

async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const raw = await text(req);
  let body: unknown = null;
  try {
    body = raw ? JSON.parse(raw) : null;
  } catch {
    body = raw;
  }
  const path = req.url ?? "";
  requests.push({ method: req.method ?? "", path, headers: req.headers, body });
  const step = stepFor(path);
  if (step.hang) {
    await new Promise<void>((resolve) => {
      const done = () => resolve();
      req.on("aborted", done);
      req.socket.on("close", done);
    });
    return;
  }
  res.writeHead(step.status, { "content-type": "application/json" });
  res.end(JSON.stringify(step.json));
}

function stepFor(path: string): Step {
  if (path === "/contacts/upsert") return upsertStep;
  if (path.endsWith("/notes")) {
    const step = noteSteps[noteCount] ?? { status: 201, json: { note: { id: `note_${noteCount + 1}` } } };
    noteCount += 1;
    return step;
  }
  if (path.includes("/workflow/")) return workflowStep;
  return { status: 404, json: { message: "unexpected path" } };
}
