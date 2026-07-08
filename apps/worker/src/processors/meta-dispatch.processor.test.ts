import test from "node:test";
import assert from "node:assert/strict";
import { UnrecoverableError, type Job } from "bullmq";
import { processMetaDispatch, type ProcessMetaDispatchDeps } from "./meta-dispatch.processor.js";

function buildJob(eventUuid: string, attemptsMade = 0): Job<{ eventUuid: string }> {
  return {
    id: "job_1",
    attemptsMade,
    data: { eventUuid },
  } as Job<{ eventUuid: string }>;
}

function buildPayload() {
  return {
    client_account_id: "client_1",
    contact: {
      lead_uid: "lead_1",
      first_name: "Jane",
      last_name: "Doe",
      email: "jane@example.com",
      phone_e164: "+15555550123",
      state: "NC",
      zip: "27513",
    },
    attribution: {},
    state: {
      lead_type: "Final Expense",
      lifecycle_stage: "Appointment Set",
      appointment_status: "Scheduled",
    },
    event: {
      event_uuid: "evt_1",
      event_name_internal: "appointment_set",
      event_name_meta: "Schedule",
      event_time_unix: Math.floor(Date.now() / 1000),
      value_score: 50,
      currency: "USD",
      send_to_meta: true,
    },
  };
}

test("processMetaDispatch sends once and marks lifecycle event processed", async () => {
  const updateCalls: unknown[] = [];
  const sendCalls: unknown[] = [];
  const dispatchLogs: unknown[] = [];

  const prismaClient = {
    lifecycleEvent: {
      findUnique: async () => ({
        eventUuid: "evt_1",
        clientAccountId: "client_1",
        status: "received",
        payloadJson: buildPayload(),
      }),
      update: async (args: unknown) => {
        updateCalls.push(args);
        return {};
      },
    },
    metaDispatchAttempt: {
      findFirst: async () => null,
    },
    clientConfig: {
      findUnique: async () => ({
        clientAccountId: "client_1",
        metaSyncEnabled: true,
        metaDatasetId: "dataset_1",
        metaAccessToken: "token_1",
      }),
    },
  } as const;

  await processMetaDispatch(buildJob("evt_1"), {
    prismaClient: prismaClient as ProcessMetaDispatchDeps["prismaClient"],
    sendToMetaImpl: async (datasetId, accessToken) => {
      sendCalls.push({ datasetId, accessToken });
      return { ok: true, status: 200, body: { events_received: 1 } };
    },
    logDispatchAttemptImpl: async (args) => {
      dispatchLogs.push(args);
      return {} as Record<string, unknown>;
    },
  });

  assert.equal(sendCalls.length, 1);
  assert.equal(dispatchLogs.length, 1);
  assert.equal(updateCalls.length, 1);
});

test("processMetaDispatch suppresses duplicate redelivery", async () => {
  const sendCalls: unknown[] = [];
  let clientLookupCount = 0;

  const prismaClient = {
    lifecycleEvent: {
      findUnique: async () => ({
        eventUuid: "evt_1",
        clientAccountId: "client_1",
        status: "processed",
        payloadJson: buildPayload(),
      }),
      update: async () => ({}),
    },
    metaDispatchAttempt: {
      findFirst: async () => null,
    },
    clientConfig: {
      findUnique: async () => {
        clientLookupCount += 1;
        return null;
      },
    },
  } as const;

  await processMetaDispatch(buildJob("evt_1"), {
    prismaClient: prismaClient as ProcessMetaDispatchDeps["prismaClient"],
    sendToMetaImpl: async () => {
      sendCalls.push(true);
      return { ok: true, status: 200, body: {} };
    },
    logDispatchAttemptImpl: async () => ({} as Record<string, unknown>),
  });

  assert.equal(sendCalls.length, 0);
  assert.equal(clientLookupCount, 0);
});

test("processMetaDispatch throws retryable error for 5xx Meta failure", async () => {
  const prismaClient = {
    lifecycleEvent: {
      findUnique: async () => ({
        eventUuid: "evt_1",
        clientAccountId: "client_1",
        status: "received",
        payloadJson: buildPayload(),
      }),
      update: async () => ({}),
    },
    metaDispatchAttempt: {
      findFirst: async () => null,
    },
    clientConfig: {
      findUnique: async () => ({
        clientAccountId: "client_1",
        metaSyncEnabled: true,
        metaDatasetId: "dataset_1",
        metaAccessToken: "token_1",
      }),
    },
  } as const;

  await assert.rejects(
    () =>
      processMetaDispatch(buildJob("evt_1"), {
        prismaClient: prismaClient as ProcessMetaDispatchDeps["prismaClient"],
        sendToMetaImpl: async () => ({ ok: false, status: 500, body: { error: "boom" } }),
        logDispatchAttemptImpl: async () => ({} as Record<string, unknown>),
      }),
    (err: unknown) => err instanceof Error && !(err instanceof UnrecoverableError)
  );
});

test("processMetaDispatch throws terminal error for 4xx Meta failure", async () => {
  const prismaClient = {
    lifecycleEvent: {
      findUnique: async () => ({
        eventUuid: "evt_1",
        clientAccountId: "client_1",
        status: "received",
        payloadJson: buildPayload(),
      }),
      update: async () => ({}),
    },
    metaDispatchAttempt: {
      findFirst: async () => null,
    },
    clientConfig: {
      findUnique: async () => ({
        clientAccountId: "client_1",
        metaSyncEnabled: true,
        metaDatasetId: "dataset_1",
        metaAccessToken: "token_1",
      }),
    },
  } as const;

  await assert.rejects(
    () =>
      processMetaDispatch(buildJob("evt_1"), {
        prismaClient: prismaClient as ProcessMetaDispatchDeps["prismaClient"],
        sendToMetaImpl: async () => ({ ok: false, status: 400, body: { error: "bad" } }),
        logDispatchAttemptImpl: async () => ({} as Record<string, unknown>),
      }),
    (err: unknown) => err instanceof UnrecoverableError
  );
});
