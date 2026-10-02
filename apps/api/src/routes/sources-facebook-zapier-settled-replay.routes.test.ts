import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import Fastify from "fastify";

import type { MetaWebhookConfig } from "../lib/meta-webhook.js";
import {
  META_LEADGEN_ROUTE,
  sourcesFacebookRoutes,
} from "./sources-facebook.js";
import type { FacebookLeadReplayRow } from "../services/source-intake/facebook-lead-intake.service.js";

function sign(secret: string, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

function leadgenPayload(leadgenId: string) {
  return {
    object: "page",
    entry: [
      {
        id: "900000000000101",
        time: 1,
        changes: [
          {
            field: "leadgen",
            value: {
              leadgen_id: leadgenId,
              page_id: "900000000000101",
              form_id: "900000000000201",
              created_time: 1730739840,
            },
          },
        ],
      },
    ],
  };
}

test("a settled Zapier capture is a Meta replay and does not enqueue Graph fetch", async () => {
  const secret = "meta-test-secret";
  const leadgenId = "900000000000001";
  const payload = JSON.stringify(leadgenPayload(leadgenId));
  let enqueueCalls = 0;
  let claimCalls = 0;
  let processCalls = 0;
  const settled = {
    id: "evt_zap_settled",
    status: "normalized",
    sourceRouteKey: "900000000000201",
    sourceLeadId: leadgenId,
    sourceLeadUid: `facebook-meta_lead_ads-${leadgenId}`,
    normalizedAt: new Date("2026-09-30T19:00:00.000Z"),
    routedAt: null,
    routingDryRunDecisionId: null,
    routingRuleIdResolved: null,
    clientAccountIdResolved: null,
    destinationLocationIdResolved: null,
    errorSummary: null,
    enrichmentMetadataJson: {
      intakeMethod: "zapier_facebook",
      captureOnly: true,
      captureSettled: true,
    },
  } as FacebookLeadReplayRow & { enrichmentMetadataJson: Record<string, unknown> };

  const cfg: MetaWebhookConfig = {
    verifyToken: "vt",
    appSecret: secret,
    accessToken: "tok",
    accessTokenPageId: null,
    graphApiVersion: "v22.0",
    masterClientAccountId: "lal_master_vet",
    directIntakeEnabled: true,
    intakeEnabled: true,
    graphFetchEnabled: true,
    routingEnabled: true,
    fixtureEnabled: false,
  };
  const app = Fastify({ logger: false });
  await app.register(sourcesFacebookRoutes, {
    getMetaWebhookConfigImpl: () => cfg,
    findFacebookLeadReplayImpl: async () => settled,
    claimFacebookLeadgenImpl: async () => {
      claimCalls += 1;
      return { event: settled, created: false };
    },
    enqueueMetaLeadgenFetchImpl: async () => {
      enqueueCalls += 1;
      return { enqueued: true, jobId: "should-not-run" };
    },
    processFacebookSourceLeadImpl: async () => {
      processCalls += 1;
      throw new Error("process should not run");
    },
  });
  const res = await app.inject({
    method: "POST",
    url: META_LEADGEN_ROUTE,
    headers: {
      "content-type": "application/json",
      "x-hub-signature-256": sign(secret, payload),
    },
    payload,
  });
  assert.equal(res.statusCode, 200);
  const body = res.json() as { ok: boolean; results?: Array<{ replayed?: boolean; queued?: boolean }> };
  assert.equal(body.ok, true);
  assert.equal(body.results?.[0]?.replayed, true);
  assert.equal(body.results?.[0]?.queued, false);
  assert.equal(enqueueCalls, 0);
  assert.equal(claimCalls, 0);
  assert.equal(processCalls, 0);
  await app.close();
});
