import assert from "node:assert/strict";
import { test } from "node:test";
import Fastify from "fastify";

import { sourcesZapierFacebookRoutes } from "./sources-zapier-facebook.js";
import type { ZapierFacebookCaptureResult } from "../services/source-intake/zapier-facebook-capture.service.js";

const SECRET = "zapier-facebook-test-secret";

const captureResult: ZapierFacebookCaptureResult = {
  ok: true,
  provider: "facebook",
  intakeMethod: "zapier_facebook",
  sourceEventId: "evt_zap_001",
  replayed: false,
  submittedAt: "2025-11-04T15:04:00.000Z",
  receivedAt: "2026-09-30T19:00:00.000Z",
  capture: {
    outcome: "captured",
    status: "normalized",
    leadgenId: "900000000000001",
    pageId: "900000000000101",
    formId: "900000000000201",
    normalizedLeadUid: "facebook-meta_lead_ads-900000000000001",
  },
  association: {
    outcome: "unassociated",
    clientAccountId: null,
    sourceFunnelId: null,
    pageId: "900000000000101",
    formId: "900000000000201",
    explanation: "No confirmed Page ID + Form ID association exists.",
  },
  inventory: {
    tracked: false,
    saleEligible: false,
    mutated: false,
    reason: "capture_only_facebook_intake_does_not_track_inventory",
  },
  delivery: {
    attempted: false,
    status: "not_attempted",
    reason: "capture_only_intake_does_not_deliver",
  },
  nextAction: "Captured for review. No client association was applied, and that does not block capture.",
};

function restoreEnv(snapshot: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

async function buildApp(processImpl: () => Promise<ZapierFacebookCaptureResult> = async () => captureResult) {
  const app = Fastify({ logger: false });
  await app.register(sourcesZapierFacebookRoutes, {
    processZapierFacebookCaptureImpl: processImpl,
  });
  return app;
}

test("Zapier Facebook webhook fails closed in production when the secret is unset", async () => {
  const envSnapshot = {
    NODE_ENV: process.env.NODE_ENV,
    SA360_ENV: process.env.SA360_ENV,
    SA360_ZAPIER_FACEBOOK_WEBHOOK_SECRET: process.env.SA360_ZAPIER_FACEBOOK_WEBHOOK_SECRET,
  };
  process.env.NODE_ENV = "production";
  delete process.env.SA360_ENV;
  delete process.env.SA360_ZAPIER_FACEBOOK_WEBHOOK_SECRET;
  let processCalls = 0;
  const app = await buildApp(async () => {
    processCalls += 1;
    return captureResult;
  });
  try {
    const res = await app.inject({
      method: "POST",
      url: "/sources/zapier/facebook-lead",
      headers: { "content-type": "application/json" },
      payload: { leadgen_id: "900000000000001" },
    });
    assert.equal(res.statusCode, 503);
    assert.equal(processCalls, 0);
    const body = res.json() as { ok: boolean; error?: string; integration?: string };
    assert.equal(body.ok, false);
    assert.equal(body.error, "integration_not_configured");
    assert.equal(body.integration, "zapier_facebook");
  } finally {
    await app.close();
    restoreEnv(envSnapshot);
  }
});

test("Zapier Facebook webhook rejects a missing or wrong key when the secret is set", async () => {
  const envSnapshot = {
    SA360_ZAPIER_FACEBOOK_WEBHOOK_SECRET: process.env.SA360_ZAPIER_FACEBOOK_WEBHOOK_SECRET,
  };
  process.env.SA360_ZAPIER_FACEBOOK_WEBHOOK_SECRET = SECRET;
  let processCalls = 0;
  const app = await buildApp(async () => {
    processCalls += 1;
    return captureResult;
  });
  try {
    const missing = await app.inject({
      method: "POST",
      url: "/sources/zapier/facebook-lead",
      headers: { "content-type": "application/json" },
      payload: { leadgen_id: "900000000000001" },
    });
    const wrong = await app.inject({
      method: "POST",
      url: "/sources/zapier/facebook-lead",
      headers: {
        "content-type": "application/json",
        "x-sa360-zapier-facebook-key": "not-the-secret",
      },
      payload: { leadgen_id: "900000000000001" },
    });
    assert.equal(missing.statusCode, 401);
    assert.equal(wrong.statusCode, 401);
    assert.equal(processCalls, 0);
  } finally {
    await app.close();
    restoreEnv(envSnapshot);
  }
});

test("Zapier Facebook webhook returns separate capture and association outcomes", async () => {
  const envSnapshot = {
    SA360_ZAPIER_FACEBOOK_WEBHOOK_SECRET: process.env.SA360_ZAPIER_FACEBOOK_WEBHOOK_SECRET,
  };
  process.env.SA360_ZAPIER_FACEBOOK_WEBHOOK_SECRET = SECRET;
  const app = await buildApp();
  try {
    const res = await app.inject({
      method: "POST",
      url: "/sources/zapier/facebook-lead",
      headers: {
        "content-type": "application/json",
        "x-sa360-zapier-facebook-key": SECRET,
      },
      payload: {
        leadgen_id: "900000000000001",
        page_id: "900000000000101",
        form_id: "900000000000201",
      },
    });
    assert.equal(res.statusCode, 200);
    const body = res.json() as ZapierFacebookCaptureResult & { nextAction: string };
    assert.equal(body.capture.outcome, "captured");
    assert.equal(body.association.outcome, "unassociated");
    assert.equal(body.inventory.tracked, false);
    assert.equal(body.delivery.attempted, false);
    assert.doesNotMatch(body.nextAction, /approve delivery/i);
    assert.equal(body.sourceEventId, "evt_zap_001");
  } finally {
    await app.close();
    restoreEnv(envSnapshot);
  }
});
