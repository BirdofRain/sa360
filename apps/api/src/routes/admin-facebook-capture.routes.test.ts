import assert from "node:assert/strict";
import { test } from "node:test";
import Fastify from "fastify";

import { FacebookCaptureIntakeDisabledError } from "../services/source-intake/facebook-capture-gate.js";
import { adminFacebookCaptureRoutes } from "./admin-facebook-capture.js";

function restoreEnv(snapshot: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

test("Facebook form association admin routes reject missing admin keys", async () => {
  const envSnapshot = {
    ADMIN_API_KEY: process.env.ADMIN_API_KEY,
    SA360_ADMIN_KEY: process.env.SA360_ADMIN_KEY,
  };
  process.env.ADMIN_API_KEY = "admin-test-key";
  delete process.env.SA360_ADMIN_KEY;
  const app = Fastify({ logger: false });
  await app.register(adminFacebookCaptureRoutes, { prefix: "/admin/v1" });
  try {
    const list = await app.inject({ method: "GET", url: "/admin/v1/facebook-form-associations" });
    const write = await app.inject({
      method: "POST",
      url: "/admin/v1/facebook-form-associations",
      headers: { "content-type": "application/json", "x-sa360-admin-key": "wrong" },
      payload: { pageId: "900000000000101", formId: "900000000000201", clientAccountId: "client_a" },
    });
    const reeval = await app.inject({
      method: "POST",
      url: "/admin/v1/facebook-capture/events/evt_1/reevaluate-association",
      headers: { "content-type": "application/json" },
      payload: {},
    });
    assert.equal(list.statusCode, 401);
    assert.equal(write.statusCode, 401);
    assert.equal(reeval.statusCode, 401);
  } finally {
    await app.close();
    restoreEnv(envSnapshot);
  }
});

test("Facebook capture admin writes return disabled and keep operator attribution", async () => {
  const envSnapshot = {
    ADMIN_API_KEY: process.env.ADMIN_API_KEY,
    SA360_ADMIN_KEY: process.env.SA360_ADMIN_KEY,
  };
  process.env.ADMIN_API_KEY = "admin-test-key";
  delete process.env.SA360_ADMIN_KEY;
  const seen = {
    actor: null as string | null,
    requestId: null as string | null,
  };
  const app = Fastify({ logger: false });
  await app.register(adminFacebookCaptureRoutes, {
    prefix: "/admin/v1",
    confirmFacebookFormAssociationImpl: async () => {
      throw new FacebookCaptureIntakeDisabledError();
    },
    reevaluateFacebookCaptureAssociationImpl: async (input: {
      sourceEventId: string;
      actor?: string | null;
      requestId?: string | null;
    }) => {
      seen.actor = input.actor ?? null;
      seen.requestId = input.requestId ?? null;
      return {
        ok: true,
        sourceEventId: input.sourceEventId,
        unchanged: true,
        status: "normalized",
        submittedAt: null,
        receivedAt: "2026-09-30T00:00:00.000Z",
        previous: {
          status: "normalized",
          clientAccountIdResolved: null,
          associationOutcome: null,
          routingDryRunDecisionId: null,
        },
        association: {
          outcome: "unassociated",
          clientAccountId: null,
          sourceFunnelId: null,
          pageId: null,
          formId: null,
          explanation: "No confirmed association.",
        },
        inventory: { tracked: false, mutated: false, saleEligible: false },
        delivery: {
          thisRequestAttempted: false,
          historicalOutcome: "not_recorded",
          historicalDeliveredAt: null,
        },
      };
    },
  });
  try {
    const disabled = await app.inject({
      method: "POST",
      url: "/admin/v1/facebook-form-associations",
      headers: { "content-type": "application/json", "x-sa360-admin-key": "admin-test-key" },
      payload: { pageId: "900000000000101", formId: "900000000000201", clientAccountId: "client_a" },
    });
    assert.equal(disabled.statusCode, 503);
    assert.equal((disabled.json() as { error?: string }).error, "capture_intake_disabled");

    const reeval = await app.inject({
      method: "POST",
      url: "/admin/v1/facebook-capture/events/evt_1/reevaluate-association",
      headers: {
        "content-type": "application/json",
        "x-sa360-admin-key": "admin-test-key",
        "x-sa360-operator": "operator_header",
        "x-request-id": "req_header_1",
      },
      payload: { actor: "body_actor", operatorNote: "check" },
    });
    assert.equal(reeval.statusCode, 200);
    assert.equal(seen.actor, "operator_header");
    assert.equal(seen.requestId, "req_header_1");
  } finally {
    await app.close();
    restoreEnv(envSnapshot);
  }
});
